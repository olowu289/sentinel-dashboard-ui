/**
 * WHAT A TOWER SAYS ABOUT ITS OWN FOOTAGE.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE CLAIM THAT STOPPED BEING TRUE
 * ══════════════════════════════════════════════════════════════════════
 *
 * The hub used to record every tower's live stream as it arrived, so a tower
 * with no SSD of its own still had its footage kept — at the hub — and two
 * rows on the settings panel said exactly that: "Recording · At the hub", and
 * on a mast with no disk, "Footage · Recorded at the hub".
 *
 * The hub records nothing from a tower now (sentry-core docs/footage-sync.md
 * §1). A tower records to its own SSD and a pipeline moves the finished files
 * up. So a tower that is not recording has NO footage anywhere once the hub's
 * existing archive ages out, and both rows were telling an operator their
 * evidence was safe somewhere it is not. That is the worst shape a wrong
 * reading can take on a monitoring product: every other row green, and
 * nothing being kept.
 *
 * ── AND WHAT IS DELIBERATELY NOT CLAIMED ──────────────────────────────
 *
 * ⚠ THE ROW SAYS "Not recording", NOT "Not recording: no disk". The reason
 * is the only field on the wire that could answer it. `health.recording.mode`
 * is read off `RECORD_ENABLE` and nothing else (sentry-core
 * tower/broker/inventory.py, `_recording_facts`): "hub" means recording is
 * switched OFF and says nothing about whether an SSD is fitted, and "tower"
 * means it is switched ON, which on a diskless mast is the `no_recording_disk`
 * fault rather than proof of a disk. Naming the reason needs
 * `footage.sync.reason`, which the SDK does not parse. Asserted here so that
 * the day it does, this file is what says what the row may then claim.
 *
 * Run:
 *
 *   node --test test/footageStatus.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { build } from "esbuild";
import { chromium } from "playwright";
import { stripComments } from "./lib/copyScan.mjs";

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

/* ⚠ TERRA INDUSTRIES, NEVER kaduna-mine. The second account's fixtures are a
   different site with different hardware, and a reading proven against it
   proves nothing about the fleet this app is built for. */
const TOWER = {
  id: "kln_lab_000002",
  site: "WEST TOWER",
  status: "online",
  online: true,
  asOf: Date.now() - 20_000,
  healthAsOf: Date.now() - 20_000,
  model: "TWR-2CR-PTZ",
  serial: "KLN-T-2610-0002",
};

const FEED = {
  id: "kln_lab_000002:1",
  towerId: "kln_lab_000002",
  index: 1,
  name: "CAMERA 1",
  state: "live",
  lens: "fixed",
  ptz: false,
  poster: "",
  lastSeenAt: null,
};

/* ======================================================================
 *  1. ONE PROFILE IS STANDARD (the recording resolution row)
 * ====================================================================== */

describe("a camera that advertises one profile", () => {
  let panel;
  before(async () => {
    panel = stripComments(
      await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8"),
    );
  });

  test("⭐ the Recording resolution row names it through profileLabel", () => {
    /* Not through `tierFor`, which has no tier below 1920 and answers "HD"
       for a 704x576 stream. The naming lives in one place precisely so this
       row and the panel cannot disagree, and the sole-profile bug was the
       rule simply not being asked — see `lib/settingsRows.ts`. */
    assert.match(panel, /profileLabel\(match, list\)/);
    assert.ok(!/tierFor\(/.test(panel), "the panel names a tier itself again");
  });
});

/* ======================================================================
 *  2. THE RECORDING ROW, IN A BROWSER
 * ====================================================================== */

describe("what the settings panel says about recording", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "footage-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement } from "react";
       import { createRoot } from "react-dom/client";
       import { AuthProvider } from "@/components/AuthProvider";
       import { CameraSettingsPanel } from "@/components/CameraSettingsPanel";
       import { DEFAULT_CAMERA_SETTINGS } from "@/lib/types";

       const root = createRoot(document.getElementById("root"));
       const noop = () => {};
       (window as any).show = (tower, feeds) =>
         root.render(
           createElement(AuthProvider, null,
             createElement(CameraSettingsPanel, {
               tower, feeds,
               settings: DEFAULT_CAMERA_SETTINGS,
               onChange: noop, onRename: noop, onClose: noop,
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
    await page.setContent(
      "<!doctype html><html><body><div id='root'></div></body></html>",
    );
    await page.addScriptTag({ content: bundle });
  });

  after(async () => {
    await browser?.close();
  });

  /** Render one tower and read the Storage group's label·value pairs back. */
  const rowsFor = async (tower) => {
    await page.evaluate(([t, f]) => window.show(t, f), [tower, [FEED]]);
    await page.waitForTimeout(80);
    return page.evaluate(() => {
      const heading = [...document.querySelectorAll("*")].find(
        (el) => el.children.length === 0 && el.textContent.trim() === "Storage",
      );
      if (!heading) return null;
      const group = heading.closest("section, div")?.parentElement ?? null;
      const text = (group ?? heading.parentElement).textContent ?? "";
      return text;
    });
  };

  test("⭐ a tower that is not recording says so, and does not blame the hub", async () => {
    /* `mode: "hub"` is `RECORD_ENABLE=0`. The old row read "Recorded at the
       hub" for exactly this tower. */
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "hub" } },
    });
    assert.ok(text, "the Storage group is gone");
    assert.match(text, /Not recording/);
    assert.ok(
      !/at the hub/i.test(text),
      `the hub is still being credited with the footage: ${text}`,
    );
  });

  test("⭐ and it is drawn as a fault, not as a setting", async () => {
    /* A site keeping nothing is the one thing on this panel that can be
       true while every other reading is green. Red is what this app uses
       for a fault, and this is one. */
    await page.evaluate(([t, f]) => window.show(t, f), [
      { ...TOWER, health: { recording: { mode: "hub" } } },
      [FEED],
    ]);
    await page.waitForTimeout(80);
    const tone = await page.evaluate(() => {
      /* The LEAF span. The row wraps its value in a flex span, and that
         one's textContent trims to the same words with none of the colour. */
      const el = [...document.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && s.textContent.trim() === "Not recording",
      );
      return el ? el.className : null;
    });
    assert.ok(tone, "the row is gone");
    assert.match(tone, /text-critical/);
  });

  test("a tower that IS recording says where", async () => {
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
    });
    assert.match(text, /On this tower/);
    assert.match(text, /62% free/);
  });

  test("a hub mast records on the hub, which is its OWN disk", async () => {
    /* §6.4: the hub records its own cameras over a LAN cable, locally. "the
       hub" is the one device for which that phrase is not a claim about
       somewhere else. */
    const text = await rowsFor({
      ...TOWER,
      kind: "hub",
      health: { recording: { mode: "hub" }, disk: { freePct: 41 } },
    });
    assert.match(text, /On this hub/);
    assert.ok(!/Not recording/.test(text), "a hub mast reads as a dead tower");
  });

  test("a device that has said nothing gets no Storage group at all", async () => {
    /* Absence of a field and a field whose value is unknown are different,
       and only the second gets words. A heading over nothing reads as a
       group that failed to load. */
    const text = await rowsFor({ ...TOWER, health: {} });
    assert.equal(text, null);
  });
});

/* ======================================================================
 *  3. THE INERT CONTROL, AND ITS PREFERENCE
 * ====================================================================== */

describe("the live picture-quality picker is gone", () => {
  let panel;
  let app;
  let prefs;
  before(async () => {
    const read = async (p) =>
      stripComments(await readFile(join(SRC, p), "utf8"));
    panel = await read("components/CameraSettingsPanel.tsx");
    app = await read("App.tsx");
    prefs = await read("lib/prefs.ts");
  });

  test("⭐ the row, the picker and the callback are all gone", () => {
    assert.ok(!/label="Picture quality"/.test(panel));
    assert.ok(!/function StreamChoice/.test(panel));
    assert.ok(!/onChooseProfile/.test(panel + app));
    assert.ok(!/chooseProfile/.test(app));
  });

  test("⭐ and so is the remembered preference behind it", () => {
    /* `loadPrefs` builds its answer field by field rather than spreading
       what it parsed, so an old browser's stored key is dropped on the
       first read with no migration to write. */
    assert.ok(!/cameraProfiles/.test(prefs), "the preference is back");
    assert.ok(!/cameraProfiles/.test(app), "the shell still holds it");
  });

  test("no live open asks for a profile as a requirement", () => {
    /* Which makes CLAUDE.md's rule true by construction instead of by an
       operator happening not to have picked anything: drilling into a tower
       reuses the session the wall already holds for that camera. */
    assert.ok(!/profile: chosen/.test(app));
    assert.match(app, /defaultProfileField\(f\)/);
  });

  test("the RECORDING resolution row stays, because it is a reading", () => {
    /* It is the row a customer was looking for on that part of the panel,
       and it answers a different question: not which stream this browser
       pulls, but what the site is keeping. */
    assert.match(panel, /recordingResolution/);
  });
});
