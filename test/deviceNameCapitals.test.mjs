/**
 * A TOWER'S OR A CAMERA'S NAME IS IN CAPITALS. Typed, saved and shown.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * Capitals were a CSS class. `uppercase` changes the glyphs and nothing else,
 * so three things were true at once and all three were wrong:
 *
 *   · The claim wizard's box drew capitals and sent what was typed, so a
 *     tower could be registered as "north gate mast" while every screen
 *     showed "NORTH GATE MAST". The name looked saved in capitals and was not.
 *   · The class had to be remembered at every place a name appears, and was
 *     not — the fleet card had it, the settings rows did not, so one camera
 *     read "GATE TEST" on the wall and "Gate test" in Settings.
 *   · It is invisible to anything that is not a browser: a search, an
 *     `aria-label`, a sentence built in a string.
 *
 * So the rule is a function, `lib/deviceName.ts`, applied on the way in and on
 * the way out. These tests are in three parts, and the middle one is the one
 * that needs a browser: typing a lower-case letter into the MIDDLE of a name
 * has to leave the caret where it was, and nothing short of a real input and
 * a real React render can be asked that.
 *
 * ⚠ WHAT IS DELIBERATELY NOT CHANGED: organizations, people, and evidence
 * filenames. The first two are somebody's own name; the third is covered at
 * the end, because `safeSegment` preserves rather than prettifies and a clip
 * downloaded today should be named the way one downloaded last week was.
 *
 *   node --test test/deviceNameCapitals.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const SDK = join(ROOT, "vendor/sentry-sdk/dist/esm/index.js");
/* Inside the project, so esbuild can resolve `react` by walking up. */
const SCRATCH = join(ROOT, "node_modules/.cache");

const ENV = JSON.stringify({
  MODE: "test",
  DEV: false,
  PROD: true,
  VITE_COORDINATION_URL: "https://coordination.test",
  VITE_SITE_TZ: "Africa/Lagos",
});

const scratch = [];
after(async () => {
  for (const dir of scratch) await rm(dir, { recursive: true, force: true });
});

/** Bundle some app modules for node and import them. */
async function load(exports_) {
  await mkdir(SCRATCH, { recursive: true });
  const dir = await mkdtemp(join(SCRATCH, "caps-"));
  scratch.push(dir);
  const entry = join(dir, "entry.ts");
  await writeFile(entry, exports_, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
    define: { "import.meta.env": ENV },
  });
  return import(pathToFileURL(out).href);
}

/* ======================================================================
 *  1. THE RULE
 * ====================================================================== */

describe("one function decides what a device is called", () => {
  let D;
  before(async () => {
    D = await load(`export * from "@/lib/deviceName";\n`);
  });

  test("⭐ a name typed in lower case is a name in capitals", () => {
    assert.equal(D.deviceName("gate test"), "GATE TEST");
    assert.equal(D.deviceName("West tower"), "WEST TOWER");
  });

  test("it is safe to apply twice, because it is applied twice", () => {
    /* The box capitalises as somebody types AND the wire capitalises what it
       is given. Both call this, and neither knows about the other. */
    assert.equal(D.deviceName(D.deviceName("gate test")), "GATE TEST");
  });

  test("nothing in, nothing out", () => {
    /* What an unnamed camera is called is decided once, in the mapper. A
       second answer here is how the two start to differ. */
    for (const empty of [null, undefined, ""]) {
      assert.equal(D.deviceName(empty), "", JSON.stringify(empty));
    }
  });

  test("digits, punctuation and spacing are left alone", () => {
    assert.equal(D.deviceName("oil depot: north gate 2"), "OIL DEPOT: NORTH GATE 2");
  });

  test("⭐ search is case-blind on BOTH sides", () => {
    assert.ok(D.nameMatches("Gate test", "gate"));
    assert.ok(D.nameMatches("gate test", "GATE"));
    assert.ok(D.nameMatches("GATE TEST", "Gate"));
    assert.ok(!D.nameMatches("Yard", "gate"));
  });

  test("an empty search matches everything, including a nameless camera", () => {
    assert.ok(D.nameMatches("Gate test", ""));
    assert.ok(D.nameMatches("Gate test", "   "));
    assert.ok(D.nameMatches(undefined, ""));
  });
});

/* ======================================================================
 *  2. WHAT GOES UP THE WIRE
 * ====================================================================== */

describe("the server is sent capitals, whoever called", () => {
  let api, claim, asked;

  before(async () => {
    api = await load(
      `export * from "@/lib/api/fleet";
       export * as claim from "@/lib/api/claim";
       export { saveSession } from "@/lib/api/auth";\n`,
    );
    claim = api.claim;
    /* A session, so the hand-rolled calls get past their own guard.
       `saveSession` holds it in memory whether or not there is storage to put
       it in, which is exactly the case this process is. */
    api.saveSession({ ref: "tok_test", account: { id: "acct_1" } });
  });

  /** Catch the next request and answer it with `body`. */
  const intercept = (status, body) => {
    asked = [];
    globalThis.fetch = async (url, init) => {
      asked.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null });
      return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    };
  };

  test("⭐ a camera renamed in lower case is SAVED in capitals", async () => {
    intercept(200, { tower: { device_id: "kln_lab_000002", label: "WEST", link: "up", cameras: [] } });
    await api.renameCamera("kln_lab_000002", 1, "gate test").catch(() => {});
    assert.equal(asked.length, 1, "nothing was sent");
    assert.deepEqual(asked[0].body, { label: "GATE TEST" });
  });

  test("⭐ and a tower registered in lower case is too", async () => {
    intercept(200, {
      claim: { pairing_code: "X", label: "NORTH GATE MAST", expires_at: "", status: "pending" },
    });
    await claim.createClaim("K7QM4X8NP2W3", "north gate mast").catch(() => {});
    assert.equal(asked.length, 1, "nothing was sent");
    assert.equal(asked[0].body.label, "NORTH GATE MAST");
  });

  test("⭐ clearing a name still clears it", async () => {
    /* An empty label is the server's "clear this". Capitalising nothing must
       not turn it into something, or the one way to un-name a camera would
       quietly stop working. */
    intercept(200, { tower: { device_id: "kln_lab_000002", label: "WEST", link: "up", cameras: [] } });
    await api.renameCamera("kln_lab_000002", 1, "").catch(() => {});
    assert.deepEqual(asked[0].body, { label: "" });
  });
});

/* ======================================================================
 *  3. ON SCREEN, IN A BROWSER
 * ====================================================================== */

describe("typing, and what the screen shows", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "caps-render-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    /* TWO harnesses in one bundle. `NameBox` is the real hook in a real
       controlled input, which is what the caret claim is about; `show` is the
       real fleet screen, which is what the "every place" claim is about. */
    await writeFile(
      entry,
      `import { createElement, useState } from "react";
       import { createRoot } from "react-dom/client";
       import { AuthProvider } from "@/components/AuthProvider";
       import { DashboardView } from "@/components/DashboardView";
       import { useCapitalName } from "@/lib/useCapitalName";

       function NameBox() {
         const [value, setValue] = useState("");
         const capitals = useCapitalName(setValue);
         (window as any).typed = value;
         return createElement("input", {
           id: "box", ref: capitals.ref, value, onChange: capitals.onChange,
         });
       }

       const root = createRoot(document.getElementById("root"));
       const noop = () => {};
       (window as any).showBox = () => root.render(createElement(NameBox));
       (window as any).show = (towers, feeds) =>
         root.render(
           createElement(AuthProvider, null,
             createElement(DashboardView, {
               towers, feeds, alerts: [], pendingClaim: null,
               onNavigate: noop, onResumeSetup: noop, onOpenTower: noop,
               onRetryFeed: noop, onToggleRecord: noop,
             })));
      `,
      "utf8",
    );
    const out = join(dir, "bundle.js");
    await build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "process.env.NODE_ENV": '"production"', "import.meta.env": ENV },
    });
    const bundle = await readFile(out, "utf8");

    browser = await chromium.launch();
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.addInitScript(() => {
      window.fetch = () => Promise.reject(new Error("no network in this test"));
    });
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
    await page.addScriptTag({ content: bundle });
  });

  after(async () => {
    await browser?.close();
  });

  describe("a name box", () => {
    before(async () => {
      await page.evaluate(() => window.showBox());
      await page.waitForSelector("#box");
    });

    test("⭐ lower case becomes capitals as it is typed", async () => {
      await page.fill("#box", "");
      await page.click("#box");
      await page.keyboard.type("gate test");
      assert.equal(await page.inputValue("#box"), "GATE TEST");
    });

    test("⭐ and the STATE is capitals, which is what gets sent", async () => {
      /* The box could be drawing capitals over a lower-case value — that is
         precisely the bug this replaced. What the component holds is what a
         save would put on the wire. */
      assert.equal(await page.evaluate(() => window.typed), "GATE TEST");
    });

    test("⭐ THE CURSOR DOES NOT MOVE when typing into the middle", async () => {
      /* THE CLAIM THAT NEEDS A BROWSER. A controlled input whose state differs
         from the node makes React write `value` back, and assigning `value`
         puts the caret at the end — so correcting a name in the middle would
         scatter the letters to the end of it. */
      await page.fill("#box", "");
      await page.click("#box");
      await page.keyboard.type("WST GATE");
      /* Put the caret between the W and the S, and type a lower-case e. */
      await page.evaluate(() => document.getElementById("box").setSelectionRange(1, 1));
      await page.keyboard.type("e");
      assert.equal(await page.inputValue("#box"), "WEST GATE");
      assert.equal(
        await page.evaluate(() => document.getElementById("box").selectionStart),
        2,
        "the caret jumped",
      );
    });

    test("and a second letter lands beside the first", async () => {
      /* The real shape of the bug: one letter looks fine, the next one is
         somewhere else entirely. */
      await page.keyboard.type("x");
      assert.equal(await page.inputValue("#box"), "WEXST GATE");
    });
  });

  describe("a fleet whose names were saved in lower case", () => {
    const TOWERS = [
      { id: "kln_lab_000002", site: "West tower", status: "online", online: true },
      { id: "kln_hub_000001", site: "Lab hub mast", status: "online", online: true, kind: "hub" },
    ];
    const FEEDS = [
      cam("kln_lab_000002", 1, "Gate test"),
      cam("kln_lab_000002", 2, "yard"),
      cam("kln_hub_000001", 1),
      cam("kln_hub_000001", 2),
    ];

    function cam(towerId, index, label) {
      return {
        id: `${towerId}:${index}`,
        towerId,
        index,
        name: label ?? `CAMERA ${index}`,
        ...(label ? { label } : {}),
        state: "live",
        lens: "fixed",
        ptz: false,
        poster: "",
        lastSeenAt: null,
      };
    }

    before(async () => {
      await page.evaluate(([t, f]) => window.show(t, f), [TOWERS, FEEDS]);
      await page.waitForTimeout(300);
    });

    test("⭐ the TOWERS list shows them in capitals", async () => {
      const names = await page.$$eval("aside button[aria-label]", (els) =>
        els
          .map((e) => e.getAttribute("aria-label"))
          .filter((l) => /^kln_\w+, /.test(l))
          .map((l) => l.split(", ")[1].split(".")[0]),
      );
      assert.deepEqual(names, ["WEST TOWER", "LAB HUB MAST"]);
    });

    test("⭐ and so do the band headings on the wall", async () => {
      const bands = await page.$$eval("main > section[aria-label]", (els) =>
        els.map((e) => e.getAttribute("aria-label")),
      );
      assert.deepEqual(bands, ["WEST TOWER", "LAB HUB MAST"]);
    });

    test("⭐ and the tiles", async () => {
      const tiles = await page.$$eval("main section[aria-label*='camera,']", (els) =>
        els.map((e) => e.getAttribute("aria-label")),
      );
      assert.ok(tiles.includes("GATE TEST camera, kln_lab_000002"), tiles.join(" | "));
      assert.ok(tiles.includes("YARD camera, kln_lab_000002"), tiles.join(" | "));
    });

    test("⭐ including the camera name inside the feed chip", async () => {
      /* `FeedChip` builds "LIVE: GATE TEST" as a STRING. A CSS class on the
         wall would never have reached it, which is how one camera came to be
         two different names on one screen. */
      const text = await page.$eval("main", (el) => el.innerText);
      assert.ok(/GATE TEST/.test(text), "the chip is not in capitals");
      assert.ok(!/Gate test/.test(text), "a lower-case name survived on the wall");
    });

    test("the text on the wall is not shouting anything ELSE", async () => {
      /* A guard against the lazy fix of uppercasing the whole screen. */
      const text = await page.$eval("main", (el) => el.innerText);
      assert.ok(/Sentry camera|LIVE|RECORDING|OFFLINE|CONNECTING/.test(text));
    });
  });
});

/* ======================================================================
 *  4. WHAT IS LEFT ALONE
 * ====================================================================== */

describe("the line this rule stops at", () => {
  let audit, people, chip, pane, snapshot, footage;

  before(async () => {
    const read = async (p) => readFile(join(SRC, p), "utf8");
    audit = await read("lib/auditSentence.ts");
    people = await read("components/PeopleView.tsx");
    chip = await read("components/ActingSiteChip.tsx");
    pane = await read("components/sharing/SharingPane.tsx");
    snapshot = await read("lib/snapshot.ts");
    footage = await read("components/FootageView.tsx");
  });

  test("⭐ a person's name is theirs", () => {
    assert.ok(!/deviceName\(person\./.test(people), "a person was shouted at");
    assert.ok(!/deviceName/.test(people), "PeopleView capitalises something");
  });

  test("⭐ an organization's name is left as somebody chose it", () => {
    for (const [what, source] of [["the site chip", chip], ["the sharing pane", pane]]) {
      assert.ok(!/deviceName/.test(source), `${what} capitalises a site name`);
    }
  });

  test("⭐ the audit log keeps people and sites in their own case", () => {
    /* Two helpers, and the difference is the whole point: `nameOf` for a
       person, an account or a site; `deviceNameOf` for a tower, a mast or a
       cell. */
    assert.match(audit, /function deviceNameOf\(/);
    assert.match(audit, /nameOf\(d\.site_id, names, "a site"\)/);
    assert.match(audit, /nameOf\(d\.created, names/);
  });

  test("⭐ a noun-phrase fallback is not a name and is not shouted", () => {
    /* "Dave replaced A TOWER" is a sentence shouting about something it could
       not name. `deviceNameOf` capitalises the name and never the fallback. */
    assert.match(audit, /const found = nameOf\(id, names, ""\);\s*\n\s*return found \? deviceName\(found\) : fallback;/);
  });

  test("⭐ EVIDENCE FILENAMES ARE UNTOUCHED", () => {
    /* A still and a clip are evidence. `safeSegment` preserves rather than
       prettifies, and nothing was added to it. */
    assert.ok(!/deviceName/.test(snapshot), "the filename builder re-cases a name");
    assert.match(snapshot, /THE NAME IS PRESERVED, not prettified/);
  });

  test("and the clip download still uses the raw label", () => {
    /* The footage screen DRAWS the camera name in capitals and names the FILE
       with what it always did. The two are one line apart, so the comment
       between them is load-bearing. */
    assert.match(footage, /cameraName: cameraLabel\(focus\)/);
    assert.match(footage, /\{deviceName\(cameraLabel\(camera\)\)\}/);
  });
});

/* ======================================================================
 *  5. NO NAME IS LEFT TO A CSS CLASS
 * ====================================================================== */

describe("the boxes capitalise, rather than being painted", () => {
  let wizard, panel, settings, cells, stripComments;

  before(async () => {
    ({ stripComments } = await import("./lib/copyScan.mjs"));
    const read = async (p) => stripComments(await readFile(join(SRC, p), "utf8"));
    wizard = await read("components/AddTowerView.tsx");
    panel = await read("components/CameraSettingsPanel.tsx");
    settings = await read("components/SettingsView.tsx");
    cells = await read("components/SiteCells.tsx");
  });

  test("⭐ every rename box uses the hook", () => {
    for (const [what, source] of [
      ["the claim wizard", wizard],
      ["tower settings", panel],
      ["Settings › Cameras", settings],
      ["Administration", cells],
    ]) {
      assert.match(source, /useCapitalName\(/, `${what} does not capitalise as you type`);
    }
  });

  test("⭐ and none of them is a text-transform over the typed value", () => {
    /* The claim wizard's box was exactly this: `uppercase` on the class and
       the typed string on the wire. */
    const box = wizard.slice(wizard.indexOf("capitals.ref"));
    assert.ok(!/uppercase/.test(box.slice(0, 500)), "the wizard still paints capitals");
    assert.ok(
      !/text-body-ink uppercase outline-none focus-visible/.test(panel),
      "the tower name box still paints capitals",
    );
  });
});

/* ======================================================================
 *  6. AND NOWHERE WAS MISSED
 * ====================================================================== */

describe("every place a device name is drawn goes through the function", () => {
  /**
   * The reason this sweep exists rather than a list of screens.
   *
   * A class had to be remembered at every site and was not, which is the bug
   * this replaced. A function call has exactly the same weakness: the
   * thirty-first place somebody draws `{feed.name}` will be raw, and nothing
   * about it will look wrong in review. So the source is swept, and a new
   * unwrapped name fails here the moment it is written.
   *
   * ⚠ THE EXEMPTIONS ARE NAMED ONE BY ONE and each says why. Most are a name
   * being HANDED ON to a component that capitalises it; one is the evidence
   * filename, which must not be capitalised at all.
   */
  const DRAWN = [
    /\{tower\.site\}/,
    /\{feed\.name\}/,
    /\{claim\.label\}/,
    /\{cell\.name\}/,
    /\$\{tower\.site\}/,
    /\$\{feed\.name\}/,
  ];

  /** `file:line` of each raw draw, so a failure says where. */
  const EXEMPT = new Set([
    /* Handed to a component that capitalises it: `FeedChip`, the tile
       fallbacks, `TowerName`, `TopBar`, `ClipPlayer`, `AlertsPanel`,
       `QuickShare`, `PatrolControl`. A second call here would be harmless and
       would also be a second place to forget. */
    "name={feed.name}",
    "<AwaitingMediaFallback name={feed.name} />",
    "name={tower.site}",
    "towerName={tower.site}",
    "towerName={towerName}",
    "cameraLabel={feed.name}",
    /* THE EVIDENCE FILENAME. Preserved, never prettified. */
    "cameraName: feed.name,",
  ]);

  test("⭐ no screen draws a raw device name", async () => {
    const { sourceFiles, stripComments } = await import("./lib/copyScan.mjs");
    const raw = [];
    for (const file of await sourceFiles(SRC)) {
      const code = stripComments(await readFile(file, "utf8"));
      code.split("\n").forEach((line, i) => {
        const trimmed = line.trim();
        if (EXEMPT.has(trimmed)) return;
        if (/deviceName\(/.test(line)) return;
        if (DRAWN.some((re) => re.test(line))) {
          raw.push(`${file.slice(file.indexOf("src"))}:${i + 1}  ${trimmed}`);
        }
      });
    }
    assert.deepEqual(raw, [], `\n${raw.join("\n")}\n`);
  });
});
