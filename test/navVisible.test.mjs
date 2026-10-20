/**
 * Who sees Shares and Administration in the rail, and the bug that hid them.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE BUG THIS EXISTS FOR
 * ══════════════════════════════════════════════════════════════════════
 *
 * `IconRail` took `sites` and `admin` as props, both defaulting to `false`.
 * Ten screens draw that rail and NINE of them passed neither. The two that
 * did were SharesView and AdministrationView.
 *
 * So Administration and Shares appeared on exactly the two screens you can
 * only reach by clicking the icons that were missing. Signed in as an
 * administrator against a server with sites fully enabled, the rail showed
 * nothing, and every layer underneath was correct: the server answered
 * `/v1/capabilities` with `sites: true`, the login carried `role: "admin"`,
 * the policy, the routes and the registries all worked. A default of `false`
 * on a prop nobody passed was the whole of it.
 *
 * ── WHAT EACH HALF OF THIS FILE CATCHES ───────────────────────────────
 *
 * The first half tests `navVisible`, which is the decision itself, now in one
 * place that the rail and the router both read. It would NOT have caught the
 * original bug on its own: the logic was right, the inputs were missing.
 *
 * The second half is the one that would have. It reads the shipped source and
 * asserts the rail DERIVES those inputs rather than requiring them, and that
 * neither prop has a falsy default. That is the actual defect: a default that
 * silently removes a destination cannot be seen in the file where it happens.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let f;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "nav-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/features";`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": join(ROOT, "src") },
    define: {
      "import.meta.env": JSON.stringify({ MODE: "test", DEV: false, PROD: true }),
    },
    logLevel: "silent",
  });
  f = await import(pathToFileURL(out).href);
});

/** The five features every real account has. */
const FULL = () => new Set(["live", "playback", "ptz", "towers", "settings"]);

describe("navVisible", () => {
  test("an admin on a server WITH sites sees both", () => {
    const opts = { features: FULL(), serverHasSites: true, isAdmin: true };
    assert.equal(f.navVisible("admin", opts), true);
    assert.equal(f.navVisible("shares", opts), true);
  });

  test("a site user sees Shares and NOT Administration", () => {
    /* A site user asks for shares and answers them, so Shares is theirs. The
       organization's people and sites are not. */
    const opts = { features: FULL(), serverHasSites: true, isAdmin: false };
    assert.equal(f.navVisible("shares", opts), true);
    assert.equal(f.navVisible("admin", opts), false);
  });

  test("a hub shows NEITHER, however many features the account has", () => {
    /* The same bundle serves the hub. There are no sites, no people and no
       shares there, so an account's feature list cannot answer this and the
       capability probe does. */
    const admin = { features: FULL(), serverHasSites: false, isAdmin: true };
    assert.equal(f.navVisible("admin", admin), false);
    assert.equal(f.navVisible("shares", admin), false);
  });

  test("before the probe answers, both are hidden rather than flickering in", () => {
    /* `useCapabilities` starts `null`, which the rail reads as false. Showing
       them and removing them a moment later looks like a bug even though it is
       only a race; the other direction appears a moment late and is correct. */
    const pending = { features: FULL(), serverHasSites: false, isAdmin: false };
    assert.equal(f.navVisible("shares", pending), false);
  });

  test("the ordinary destinations still answer from the feature list", () => {
    const opts = (features) => ({ features, serverHasSites: true, isAdmin: true });
    assert.equal(f.navVisible("towers", opts(FULL())), true);
    assert.equal(f.navVisible("alerts", opts(FULL())), false, "not a real feature");
    assert.equal(f.navVisible("towers", opts(new Set())), false);
  });

  test("an unknown destination is allowed, so adding one is not silently dead", () => {
    /* NAV_FEATURE is a list of what CAN be restricted, not a whitelist of
       everything that exists. */
    const opts = { features: new Set(), serverHasSites: false, isAdmin: false };
    assert.equal(f.navVisible("something-new", opts), true);
  });
});

/* ================================================================== *
 * THE HALF THAT WOULD HAVE CAUGHT IT
 * ================================================================== */

describe("the rail does not depend on its callers for this", () => {
  let src;
  before(async () => {
    src = await readFile(join(ROOT, "src/components/IconRail.tsx"), "utf8");
  });

  test("it derives the server's answer itself", () => {
    assert.match(src, /useCapabilities\(\)/,
      "the rail must ask /v1/capabilities, not be told");
    assert.match(src, /isAdminRole\(/,
      "the rail must read the role from the session, not be told");
  });

  test("NEITHER prop defaults to false, which is the bug itself", () => {
    /* `sites = false` in the signature is what turned nine forgetful callers
       into a missing Administration area. `undefined` has to mean ASK. */
    assert.doesNotMatch(src, /\bsites\s*=\s*false/,
      "a false default silently removes the destination");
    assert.doesNotMatch(src, /\badmin\s*=\s*false/,
      "a false default silently removes the destination");
    assert.match(src, /sites\s*\?\?/, "undefined must fall through to the probe");
    assert.match(src, /admin\s*\?\?/, "undefined must fall through to the role");
  });

  test("the rail and the router read the SAME function", async () => {
    /* Either alone is a bug: the rail alone leaves the destination reachable
       by any other caller, the router alone leaves an item that does nothing.
       They drifted here once already. */
    const app = await readFile(join(ROOT, "src/App.tsx"), "utf8");
    assert.match(src, /navVisible\(/);
    assert.match(app, /navVisible\(/);
  });

  test("no screen hands the rail a hardcoded answer", async () => {
    /* The props survive for the screenshot harness, which has no server. A
       SCREEN passing them is the old mistake in a new place: whatever it
       passes is a second source of truth that can disagree with the probe. */
    const { readdir } = await import("node:fs/promises");
    const dir = join(ROOT, "src/components");
    const offenders = [];
    for (const name of await readdir(dir)) {
      if (!name.endsWith(".tsx") || name === "IconRail.tsx") continue;
      const text = await readFile(join(dir, name), "utf8");
      const rail = text.indexOf("<IconRail");
      if (rail < 0) continue;
      const tag = text.slice(rail, text.indexOf("/>", rail));
      if (/\b(sites|admin)=/.test(tag)) offenders.push(name);
    }
    assert.deepEqual(offenders, [],
      "these pass sites= or admin= to IconRail; let the rail answer instead");
  });
});
