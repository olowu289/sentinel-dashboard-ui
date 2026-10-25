/**
 * The hub's own dashboard: one bundle, and the server says which product it is.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS IS GUARDING
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same `dist` serves sentri.watch and the hub at `https://<hub>:9081/` --
 * the kiosk TV at localhost, a laptop over USB at 192.168.55.1, and the site
 * LAN. The hub has no internet in the field.
 *
 * Three ways that goes wrong, and one test each:
 *
 *   1. A BUILD FLAG decides what to show. Then there are two artefacts that
 *      look identical and the wrong one puts an Administration area on a
 *      kiosk whose endpoints answer 404. `sentry-core`'s own test says this
 *      in one line. So: `isHubMode` reads `GET /v1/capabilities`, and these
 *      tests feed it a hub-shaped and a cloud-shaped answer.
 *
 *   2. A FIXED HOST is baked in. Then the kiosk at localhost asks
 *      coord.artemisfalcon.com for its fleet and gets nothing, on a box whose
 *      whole point is working with the uplink down.
 *
 *   3. SOMETHING IS FETCHED FROM THE INTERNET. A font, an icon, an analytics
 *      script. On the cloud it is invisible; on the hub every label falls back
 *      to system-ui and nobody can say why. The build scan below is the only
 *      check that actually looks at the artefact rather than at the source,
 *      and it is the one `build-hub-dashboard.sh` runs its own version of.
 *
 *   node --test test/hubMode.test.mjs
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, readdir, stat, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const DIST = join(ROOT, "dist");

let hub;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-mode-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * as hub from "@/lib/hubMode";\n`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  hub = (await import(pathToFileURL(out).href)).hub;
});

/* ======================================================================
 *  1. WHAT THE SERVER SAID IT IS
 * ====================================================================== */

/** `GET /v1/capabilities` on a hub, exactly as coordination answers it. */
const HUB_CAPS = { role: "hub", features: { sites: false } };
/** And on Kallon Cloud. */
const CLOUD_CAPS = { role: "datacenter", features: { sites: true } };

describe("isHubMode, from the capability probe", () => {
  test("⭐ a hub-shaped answer is hub mode", () => {
    assert.equal(hub.isHubMode(HUB_CAPS), true);
    assert.equal(hub.hasSites(HUB_CAPS), false);
  });

  test("⭐ a datacenter-shaped answer is not", () => {
    assert.equal(hub.isHubMode(CLOUD_CAPS), false);
    assert.equal(hub.hasSites(CLOUD_CAPS), true);
  });

  test("⭐ not answered yet is NOT hub mode", () => {
    /* `useCapabilities` is null until the probe lands. Hiding on null would
       make sentri.watch flash its own navigation away on every load. Nothing
       depends on this alone: every gated screen is also behind a feature that
       is false while null. */
    assert.equal(hub.isHubMode(null), false);
    assert.equal(hub.isHubMode(undefined), false);
  });

  test("⭐ the test is `not datacenter`, not `is hub`", () => {
    /* The claim coordination's own test makes is `role != "datacenter"`. A
       third role is far likelier to be an edge box than a second cloud, and
       being wrong that way hides a Sharing page rather than showing one that
       404s on a site with no uplink. */
    for (const role of ["hub", "edge", "regional", "HUB", " hub "]) {
      assert.equal(hub.isHubMode({ role, features: { sites: false } }), true, role);
    }
    assert.equal(hub.isHubMode({ role: "DATACENTER", features: { sites: true } }), false);
  });

  test("a server too old to send a role falls back to the feature", () => {
    assert.equal(hub.isHubMode({ role: "", features: { sites: false } }), true);
    assert.equal(hub.isHubMode({ role: "", features: { sites: true } }), false);
  });
});

/* ======================================================================
 *  2. WHAT HUB MODE HIDES, AND WHAT IT KEEPS
 * ====================================================================== */

describe("hidden on a hub, present on the cloud", () => {
  let rail, settings, chip, app, panel, tiles;
  before(async () => {
    const read = (p) => readFile(join(SRC, p), "utf8");
    rail = await read("components/IconRail.tsx");
    settings = await read("components/SettingsView.tsx");
    chip = await read("components/ActingSiteChip.tsx");
    app = await read("App.tsx");
    panel = await read("components/CameraSettingsPanel.tsx");
    tiles = await read("lib/useTileControls.ts");
  });

  test("⭐ Sharing and Administration leave the navigation", async () => {
    /* One decision, in `lib/features.ts`, which the router reads too -- so an
       item cannot be visible and unreachable, or hidden and reachable. */
    assert.match(rail, /navVisible/);
    const features = await readFile(join(SRC, "lib/features.ts"), "utf8");
    assert.match(features, /SITE_NAV[^=]*=\s*new Set\(\["shares", "admin"\]\)/);
    assert.match(features, /serverHasSites/);
  });

  test("⭐ the site picker draws nothing", () => {
    /* `candidates.length === 0` did NOT cover it: the admin branch returns
       first and prints "Every site" off the account's role alone, and the
       hub's one company login is an administrator. */
    assert.match(chip, /if \(isHubMode\(caps\)\) return null;/);
  });

  test("⭐ the share cards do not float over the kiosk", () => {
    assert.match(app, /hubMode \? null : <ShareDeck \/>/);
  });

  test("⭐ Account and Sharing leave the settings sections", () => {
    assert.match(settings, /HUB_HIDES[^=]*=\s*new Set\(\["account", "sharing"\]\)/);
    assert.match(settings, /sections = useMemo/);
    /* And a cloud bookmark opened on a kiosk lands somewhere real. */
    assert.match(settings, /sections\.includes\(section\) \? section :/);
  });

  test("the Share rows in tower settings are already behind the server", () => {
    assert.match(panel, /canShare = hasSites\(caps\)|canShare = caps\?\.features\.sites === true/);
  });

  test("the tile's share control is too", () => {
    assert.match(tiles, /caps\?\.features\.sites === true|hasSites\(caps\)/);
  });
});

describe("kept on a hub, because the hub does these itself", () => {
  let features, app;
  before(async () => {
    features = await readFile(join(SRC, "lib/features.ts"), "utf8");
    app = await readFile(join(SRC, "App.tsx"), "utf8");
  });

  test("⭐ Add a tower is NOT a site destination", () => {
    /* THE CLAIM WIZARD, and the hub needs it: a tower is claimed against the
       hub it will live on. It posts to `/v1/viewer/claims`, which exists on a
       hub -- unlike `POST /v1/towers`, the sites flow behind the Towers
       page's drawer, which coordination answers 404 for on a hub and which
       `sitesEnabled` correctly hides. Two different "add a tower"s. */
    const siteNav = /SITE_NAV[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(features);
    assert.ok(siteNav, "SITE_NAV not found");
    assert.ok(!/"add"/.test(siteNav[1]), "add_tower became a site destination");
    assert.match(features, /add: "add_tower"/);
  });

  test("the claim wizard posts to a viewer route", async () => {
    const claim = await readFile(join(SRC, "lib/api/claim.ts"), "utf8");
    assert.match(claim, /\/v1\/viewer\/claims/);
  });

  test("⭐ playback, live, PTZ and settings are account features, not site ones", () => {
    const siteNav = /SITE_NAV[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(features)[1];
    for (const id of ["playback", "dashboard", "towers", "settings", "alerts"]) {
      assert.ok(!siteNav.includes(`"${id}"`), `${id} became a site destination`);
    }
  });

  test("the Kallon Cloud row stays a status and claims nothing else", async () => {
    /* Point 6: nothing may say the cloud is NEEDED for something the hub
       does. The row is allowed, as a reading. */
    const panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    const { stripComments } = await import("./lib/copyScan.mjs");
    const code = stripComments(panel);
    assert.match(code, /label="Kallon Cloud"/);
    assert.ok(!/requires? (an? )?internet/i.test(code));
    assert.ok(!/needs Kallon Cloud|only available online|no internet connection/i.test(code));
  });
});

/* ======================================================================
 *  3. ADDRESSES: WHATEVER SERVED THE PAGE
 * ====================================================================== */

describe("every address is the page's own origin unless told otherwise", () => {
  let config;
  before(async () => {
    config = await readFile(join(SRC, "lib/config.ts"), "utf8");
  });

  test("⭐ the default base is window.location.origin", () => {
    /* Which is what makes one build work at localhost, 127.0.0.1,
       192.168.55.1 and the hub's LAN address with no per-hub configuration
       and no CORS. `build-hub-dashboard.sh` builds with the variable unset. */
    assert.match(config, /window\.location\.origin/);
    assert.match(config, /EXPLICIT[\s\S]{0,120}SAME_ORIGIN/);
  });

  test("⭐ no host is hardcoded anywhere in the source", async () => {
    const { stripComments } = await import("./lib/copyScan.mjs");
    const files = await walk(SRC, [".ts", ".tsx"]);
    const hits = [];
    for (const f of files) {
      if (SKIP_SOURCE.some((skip) => f.endsWith(skip))) continue;
      const code = stripComments(await readFile(f, "utf8"));
      for (const m of code.matchAll(/https?:\/\/[a-z0-9.-]+/gi)) {
        if (ALLOWED_REFERENCE.some((re) => re.test(m[0]))) continue;
        hits.push(`${relative(ROOT, f)}: ${m[0]}`);
      }
    }
    assert.deepEqual(hits, [], `a host is baked into the source:\n  ${hits.join("\n  ")}`);
  });
});

/* ======================================================================
 *  4. THE ARTEFACT: NOTHING IS FETCHED FROM OUTSIDE
 * ====================================================================== */

/**
 * URLs that may appear in the build because NOTHING EVER REQUESTS THEM.
 *
 * ⚠ EACH ONE IS A STRING, NOT A FETCH, and that distinction is the whole
 * reason this list is short and will stay short. An XML namespace is an
 * identifier that happens to look like a URL; no browser has ever resolved
 * one. React's error link is printed into a console message. The font licence
 * is a text file we are required to ship. Adding anything here means claiming
 * the browser will not go and get it, so say why.
 */
const ALLOWED_REFERENCE = [
  /^https?:\/\/www\.w3\.org\//,          // XML/SVG/MathML namespaces: identifiers
  /^https?:\/\/react\.dev\//,            // printed into a console error message
  /^https?:\/\/openfontlicense\.org\//,  // the OFL text, in public/fonts/OFL.txt
  /^https?:\/\/github\.com\/[A-Za-z-]+\)/, // author credits inside that licence
  /^https?:\/\/localhost/,               // a dev-server default, never shipped
  /^https?:\/\/coord\.example\.com/,     // the SDK's "baseUrl is required, e.g. ..."
  /^http:\/\/x$/,                        // a parsing base for `new URL(path, base)`
];

/** The screens harness is a fixture picker, not the product. */
const SKIP_SOURCE = ["screens.tsx"];

async function walk(dir, exts) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, exts)));
    else if (exts.includes(extname(entry.name))) out.push(full);
  }
  return out;
}

describe("the production build asks the internet for nothing", () => {
  let files = [];

  before(async () => {
    /* Build if there is nothing to look at. The scan is about the ARTEFACT:
       a font added to index.html, an icon pasted into a component, a tracker
       pulled in by a dependency are all invisible in the source review that
       catches the rest of this file's concerns. */
    let present = false;
    try {
      present = (await stat(join(DIST, "index.html"))).isFile();
    } catch {
      present = false;
    }
    if (!present) {
      await run("npx", ["vite", "build"], { cwd: ROOT, shell: process.platform === "win32" });
    }
    files = await walk(DIST, [".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest"]);
  });

  test("⭐ not one absolute URL to an outside host", async () => {
    const hits = [];
    for (const f of files) {
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+/g)) {
        if (ALLOWED_REFERENCE.some((re) => re.test(m[0]))) continue;
        hits.push(`${relative(ROOT, f)}: ${m[0].slice(0, 90)}`);
      }
    }
    assert.deepEqual(
      hits,
      [],
      `the build reaches outside; the hub has no internet:\n  ${hits.join("\n  ")}`,
    );
  });

  test("⭐ and no font is loaded from a stylesheet host", async () => {
    /* The specific one that bit: two Google Fonts stylesheets, which on a hub
       simply do not arrive, taking every heading in the product down to a
       system fallback with no error anybody sees.

       Over the files the PAGE LOADS. `fonts/OFL.txt` is the licence we are
       required to ship and it names the foundry's own page; nothing fetches
       a licence. */
    const loaded = files.filter((f) => [".html", ".js", ".css"].includes(extname(f)));
    assert.ok(loaded.length > 0, "nothing to scan");
    for (const f of loaded) {
      const text = await readFile(f, "utf8");
      assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(text), relative(ROOT, f));
    }
  });

  test("⭐ the typefaces ship as files, in the build", async () => {
    const woff = (await walk(DIST, [".woff2"])).map((f) => relative(DIST, f));
    assert.ok(woff.length >= 2, `only ${woff.length} woff2 in the build`);
    const css = (await walk(DIST, [".css"]))[0];
    const text = await readFile(css, "utf8");
    assert.match(text, /@font-face/);
    /* Relative, so they load at every address the hub answers on. */
    assert.ok(!/src:[^;]*https?:\/\//.test(text), "a @font-face points outside");
  });

  test("the built page does not name the cloud host", async () => {
    /* With `VITE_COORDINATION_URL` unset -- which is how the hub build is
       made -- nothing should carry a coordination hostname at all. */
    for (const f of files) {
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/https?:\/\/coord\.[a-z0-9.-]+/gi)) {
        if (ALLOWED_REFERENCE.some((re) => re.test(m[0]))) continue;
        assert.fail(`${relative(ROOT, f)} names ${m[0]}`);
      }
    }
  });
});

/* ======================================================================
 *  THE CLOUD BUILD, WHICH IS A DIFFERENT ARTEFACT
 * ====================================================================== */

/**
 * ⚠ THE HUB BUILD AND THE CLOUD BUILD ARE NOT THE SAME FILES, and the scan
 * above only ever looked at whichever one happened to be in `dist/`.
 *
 * They differ by `VITE_COORDINATION_URL`: the hub build leaves it unset so
 * the page talks to whatever served it, and the cloud build bakes
 * sentri.watch's coordination origin in. That one variable reaches
 * `vite.config.ts`, which narrows the CSP's `connect-src` and `media-src` at
 * build time -- so the two artefacts genuinely differ, and "the hub build is
 * clean" is not a statement about the one customers load.
 *
 * sentri.watch was requesting a Google Fonts stylesheet (blocked by the
 * edge CSP, red in DevTools) long after the fonts were self-hosted here, and
 * nothing in this suite could have said so.
 */
describe("the CLOUD build asks the internet for nothing either", () => {
  let files = [];

  before(async () => {
    const out = join(ROOT, "dist-cloud-scan");
    await run(
      "npx",
      ["vite", "build", "--outDir", "dist-cloud-scan", "--emptyOutDir"],
      {
        cwd: ROOT,
        shell: process.platform === "win32",
        /* The one thing that makes it the cloud artefact. */
        env: { ...process.env, VITE_COORDINATION_URL: "https://coord.example.com" },
      },
    );
    files = await walk(out, [".html", ".js", ".css", ".json", ".svg", ".txt", ".webmanifest"]);
  });

  test("⭐ no font, and no other outside host", async () => {
    const hits = [];
    for (const f of files) {
      const text = await readFile(f, "utf8");
      for (const m of text.matchAll(/https?:\/\/[a-zA-Z0-9._~:/?#@!$&'()*+,;=%-]+/g)) {
        if (ALLOWED_REFERENCE.some((re) => re.test(m[0]))) continue;
        /* The coordination origin IS baked into this one, on purpose: it is
           what the page is configured to talk to, not something it fetches
           from a third party. */
        if (m[0].startsWith("https://coord.example.com")) continue;
        hits.push(`${relative(ROOT, f)}: ${m[0].slice(0, 90)}`);
      }
    }
    assert.deepEqual(hits, [], `the cloud build reaches outside:\n  ${hits.join("\n  ")}`);
  });

  test("⭐ specifically: nothing asks fonts.googleapis.com", async () => {
    /* The exact request seen on sentri.watch. */
    const loaded = files.filter((f) => [".html", ".js", ".css"].includes(extname(f)));
    for (const f of loaded) {
      const text = await readFile(f, "utf8");
      assert.ok(!/fonts\.(googleapis|gstatic)\.com/.test(text), relative(ROOT, f));
      assert.ok(!/Inter\+?\s?Tight/i.test(text), `${relative(ROOT, f)} still names Inter Tight`);
    }
  });

  test("and its typefaces still ship as files", async () => {
    const woff = await walk(join(ROOT, "dist-cloud-scan"), [".woff2"]);
    assert.ok(woff.length >= 2, `only ${woff.length} woff2 in the cloud build`);
  });
});
