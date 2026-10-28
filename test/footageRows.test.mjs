/**
 * THE FOUR THINGS A SITE CAN SAY ABOUT ITS OWN RECORDINGS.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT THIS ROUND ADDED, AND THE FAILURE EACH PART GUARDS
 * ══════════════════════════════════════════════════════════════════════
 *
 * A tower records 2K to its own SSD and ships finished fifteen-minute files to
 * the hub, which is the playback source (sentry-core docs/footage-sync.md §1).
 * Four consequences reach a screen, and every one of them looked like
 * something else before it was drawn:
 *
 *   1. THE TAIL IS ALWAYS ON THE MAST. The newest fifteen to thirty minutes of
 *      every camera has not been sent yet, so a timeline with two states —
 *      footage, or the dead surface showing through — drew a permanent outage
 *      at the right-hand edge of every lane on a perfectly healthy site.
 *   2. SOME FOOTAGE HAS NO TIME. A recorder that started before its clock
 *      synced writes a complete file whose beginning nothing can establish
 *      afterwards (§4.4.2). It must not go on the timeline, at any position.
 *   3. THE HUB HAS A VERDICT ABOUT EACH TOWER and nothing on screen said it:
 *      up to date, behind, unreachable, no disk, switched off.
 *   4. A BACKLOG IS A NUMBER. "Behind" with no quantity is a feeling.
 *
 * ── AND THE ONE THING EVERY TEST HERE IS REALLY ABOUT ─────────────────
 *
 * ⚠ SILENCE IS NOT THE GOOD ANSWER. Two of the hub's five verdicts cannot come
 * from a tower at all — `unreachable` needs a link state only the hub observes
 * and `behind` needs a clock — so a site whose hub is too old to reach a
 * verdict says NOTHING, and the tempting default is "Up to date". That would
 * be a monitoring screen reporting a site as fine because it failed to answer,
 * which is the one direction this product may never guess in. Several tests
 * below exist only to pin that.
 *
 *   node --test test/footageRows.test.mjs
 */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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

/* ⚠ TERRA INDUSTRIES, NEVER kaduna-mine. The shapes below are the ones
   coordination's own `project_footage` produces (they are the SDK's committed
   fixture, re-pointed at this account's tower), so what is asserted is what
   the server sends rather than what I thought it sent. */
const DEVICE = "kln_lab_000002";
const TOWER_NAME = "WEST TOWER";

/** A tower that is up to date. */
const FOOTAGE_OK = {
  as_of: "2026-10-27T08:00:00.000Z",
  copy: "tower",
  record_stream: "main",
  sync: { state: "ready", reason: "ok", free_pct: 71.2, total_gb: 1863, separate_disk: true },
  times: "reliable",
  cameras: [
    {
      camera: 1,
      streams: [{ stream: "main", segments: 672, bytes: 77_000_000_000, unconfirmed_segments: 0, unconfirmed_bytes: 0 }],
    },
  ],
};

/** Behind, with an EXACT oldest unconfirmed start. */
const FOOTAGE_BEHIND = {
  as_of: "2026-10-27T08:00:00.000Z",
  copy: "tower",
  sync: { state: "sending", reason: "behind", free_pct: 71.2 },
  cameras: [
    {
      camera: 1,
      streams: [
        {
          stream: "main",
          segments: 672,
          oldest_unconfirmed_start: "2026-10-27T06:00:00.000Z",
          unconfirmed_segments: 8,
          unconfirmed_bytes: 1_390_000_000,
        },
      ],
    },
  ],
};

/** The same, with one stream admitting its start is a guess. */
const FOOTAGE_BEHIND_INEXACT = {
  ...FOOTAGE_BEHIND,
  cameras: [
    {
      camera: 1,
      streams: [
        {
          stream: "main",
          oldest_unconfirmed_start: "2026-10-27T06:00:00.000Z",
          oldest_unconfirmed_exact: false,
          unconfirmed_segments: 8,
          unconfirmed_bytes: 1_390_000_000,
        },
      ],
    },
  ],
};

const FOOTAGE_UNREACHABLE = {
  as_of: "2026-10-27T08:00:00.000Z",
  sync: { state: "unavailable", reason: "unreachable", blocked_by: "wireguard_link" },
  cameras: [
    { camera: 1, streams: [{ stream: "main", unconfirmed_segments: 40, unconfirmed_bytes: 5_600_000_000 }] },
  ],
};

const FOOTAGE_NO_DISK = {
  as_of: "2026-10-27T08:00:00.000Z",
  copy: "hub_only",
  record_stream: "sub",
  sync: {
    state: "unavailable",
    reason: "no_recording_disk",
    blocked_by: "no_recording_disk",
    free_pct: 3,
    separate_disk: false,
  },
  times: "unreliable",
};

const FOOTAGE_OFF = {
  as_of: "2026-10-27T08:00:00.000Z",
  sync: { state: "idle", reason: "recording_off", blocked_by: "recording_disabled" },
};

/** Reported its cameras and said nothing about sync. The dangerous one. */
const FOOTAGE_SILENT = {
  as_of: "2026-10-27T08:00:00.000Z",
  copy: "tower",
  record_stream: "sub",
  cameras: [{ camera: 1, streams: [{ stream: "sub", segments: 4 }] }],
};

/* ======================================================================
 *  1. THE READINGS, AS PURE FUNCTIONS
 * ====================================================================== */

describe("what a tower's footage block says", () => {
  let lib;
  /** 2026-10-27T08:00:00Z, which the fixtures are written against. */
  const NOW = Date.parse("2026-10-27T08:00:00.000Z");

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "footage-rows-"));
    scratch.push(dir);
    const out = join(dir, "footageStatus.mjs");
    await build({
      entryPoints: [join(SRC, "lib/footageStatus.ts")],
      outfile: out,
      bundle: true,
      format: "esm",
      platform: "neutral",
      alias: { "@": SRC, "@kallon/sentry-sdk": SDK },
      define: { "import.meta.env": ENV },
    });
    lib = await import(`file://${out.replace(/\\/g, "/")}`);
  });

  test("⭐ a tower that has said nothing gets NO reading, not a good one", () => {
    /* The whole module in one assertion. `ok` from silence is a guess, and it
       is the guess that says a site is fine. */
    assert.equal(lib.footageReading(FOOTAGE_SILENT, NOW), null);
    assert.equal(lib.footageReading(undefined, NOW), null);
    assert.equal(lib.footageReading({}, NOW), null);
  });

  test("up to date is green", () => {
    assert.deepEqual(lib.footageReading(FOOTAGE_OK, NOW), {
      value: "Up to date",
      tone: "text-terra",
    });
  });

  test("⭐ behind says how far, in whole hours", () => {
    /* 06:00 to 08:00. The hours come from `oldest_unconfirmed_start`, which is
       the field sentry-core added to the projection for this row. */
    assert.deepEqual(lib.footageReading(FOOTAGE_BEHIND, NOW), {
      value: "Behind 2 h",
      tone: "text-detect",
    });
  });

  test('⭐ and says "about" when the start was not exact', () => {
    /* A segment whose beginning could not be established is stamped when it
       ARRIVED, so the hours derived from it are a floor. One word carries the
       difference, and without it the number reads as a measurement. */
    assert.deepEqual(lib.footageReading(FOOTAGE_BEHIND_INEXACT, NOW), {
      value: "Behind about 2 h",
      tone: "text-detect",
    });
  });

  test("⭐ an absent `oldest_unconfirmed_exact` means EXACT, not unknown", () => {
    /* The inverted-boolean trap. The server sends the key only when the answer
       is bad, so reading it as falsy would print "about" over every exact
       reading in the fleet. */
    const one = lib.oldestUnconfirmed(FOOTAGE_BEHIND);
    assert.equal(one.exact, true);
    assert.equal(lib.oldestUnconfirmed(FOOTAGE_BEHIND_INEXACT).exact, false);
  });

  test("⭐ with two cameras it reports the WORSE one", () => {
    /* A site an hour behind on one camera and a day behind on the other is a
       day behind. The reassuring number is the wrong one to pick. */
    const two = {
      ...FOOTAGE_BEHIND,
      cameras: [
        { camera: 1, streams: [{ stream: "main", oldest_unconfirmed_start: "2026-10-27T07:00:00.000Z" }] },
        { camera: 2, streams: [{ stream: "main", oldest_unconfirmed_start: "2026-10-26T08:00:00.000Z" }] },
      ],
    };
    assert.equal(lib.footageReading(two, NOW).value, "Behind 24 h");
  });

  test("⭐ and one inexact stream makes the whole reading inexact", () => {
    const mixed = {
      ...FOOTAGE_BEHIND,
      cameras: [
        { camera: 1, streams: [{ stream: "main", oldest_unconfirmed_start: "2026-10-27T06:00:00.000Z" }] },
        {
          camera: 2,
          streams: [
            {
              stream: "main",
              oldest_unconfirmed_start: "2026-10-27T07:00:00.000Z",
              oldest_unconfirmed_exact: false,
            },
          ],
        },
      ],
    };
    assert.equal(lib.footageReading(mixed, NOW).value, "Behind about 2 h");
  });

  test("behind with no start to measure from keeps the verdict and drops the number", () => {
    const vague = { sync: { reason: "behind" }, cameras: [] };
    assert.deepEqual(lib.footageReading(vague, NOW), { value: "Behind", tone: "text-detect" });
  });

  test("unreachable is red, and never blames a disk", () => {
    const r = lib.footageReading(FOOTAGE_UNREACHABLE, NOW);
    assert.deepEqual(r, { value: "Can't reach hub", tone: "text-critical" });
    /* `blocked_by: "wireguard_link"` is on that fixture and must not surface:
       the fold to `unreachable` is the hub's and is not done twice. */
    assert.ok(!/wireguard/i.test(r.value));
    assert.ok(!/disk/i.test(r.value));
  });

  test("no disk is red", () => {
    assert.deepEqual(lib.footageReading(FOOTAGE_NO_DISK, NOW), {
      value: "Not recording: no disk",
      tone: "text-critical",
    });
  });

  test("⭐ recording switched off is NOT red", () => {
    /* A decision, not a fault. The hub's own table says so in those words, and
       painting a decision red teaches an operator to stop reading the colour. */
    assert.deepEqual(lib.footageReading(FOOTAGE_OFF, NOW), { value: "Recording off" });
  });

  test("a verdict this build has never heard of renders as nothing", () => {
    /* Not as its own code: `sync.reason` is a machine value and rule 3 says an
       internal word never reaches a screen. */
    const future = { sync: { reason: "quantum_entangled" }, cameras: [] };
    assert.equal(lib.footageReading(future, NOW), null);
  });

  test("⭐ the backlog is summed across every camera and stream", () => {
    const many = {
      sync: { reason: "behind" },
      cameras: [
        { camera: 1, streams: [{ stream: "main", unconfirmed_segments: 8, unconfirmed_bytes: 1_000_000_000 }] },
        {
          camera: 2,
          streams: [
            { stream: "main", unconfirmed_segments: 3, unconfirmed_bytes: 500_000_000 },
            { stream: "sub", unconfirmed_segments: 1, unconfirmed_bytes: 4_000_000 },
          ],
        },
      ],
    };
    assert.deepEqual(lib.footageWaiting(many), { files: 12, bytes: 1_504_000_000 });
    assert.equal(lib.waitingReading(many).value, "12 files · 1.40 GB");
  });

  test("one file is a file, not 1 files", () => {
    const one = { cameras: [{ camera: 1, streams: [{ stream: "main", unconfirmed_segments: 1, unconfirmed_bytes: 900_000 }] }] };
    assert.match(lib.waitingReading(one).value, /^1 file · /);
  });

  test('⭐ a measured zero reads "Nothing waiting" and silence reads nothing at all', () => {
    /* The distinction this row exists for. Its neighbour says "Up to date" for
       a site that is up to date AND for a site nobody measured; the only thing
       on screen that separates them is whether this row has anything in it. */
    assert.deepEqual(lib.waitingReading(FOOTAGE_OK), { value: "Nothing waiting" });
    assert.equal(lib.waitingReading(FOOTAGE_SILENT), null);
    assert.equal(lib.waitingReading(FOOTAGE_NO_DISK), null);
  });

  test("the Recording row stands down only when Footage can name the reason", () => {
    assert.equal(lib.recordingRowIsRedundant(FOOTAGE_NO_DISK), true);
    assert.equal(lib.recordingRowIsRedundant(FOOTAGE_OFF), true);
    assert.equal(lib.recordingRowIsRedundant(FOOTAGE_OK), false);
    assert.equal(lib.recordingRowIsRedundant(FOOTAGE_UNREACHABLE), false);
    assert.equal(lib.recordingRowIsRedundant(undefined), false);
  });

  test("hours never go negative on a tower whose clock is ahead", () => {
    assert.equal(lib.hoursBehind(NOW + 3 * 3_600_000, NOW), 0);
  });
});

/* ======================================================================
 *  2. THE ROWS, IN A BROWSER
 * ====================================================================== */

const TOWER = {
  id: DEVICE,
  site: TOWER_NAME,
  status: "online",
  online: true,
  asOf: Date.now() - 20_000,
  healthAsOf: Date.now() - 20_000,
  model: "TWR-2CR-PTZ",
  serial: "KLN-T-2610-0002",
};

const FEED = {
  id: `${DEVICE}:1`,
  towerId: DEVICE,
  index: 1,
  name: "CAMERA 1",
  state: "live",
  lens: "fixed",
  ptz: false,
  poster: "",
  lastSeenAt: null,
};

describe("the Storage group's Footage and Waiting rows", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "footage-rows-panel-"));
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
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
    await page.addScriptTag({ content: bundle });
  });

  after(async () => {
    await browser?.close();
  });

  /** Render one tower and read the Storage group back as label/value pairs. */
  const rowsFor = async (tower) => {
    await page.evaluate(([t, f]) => window.show(t, f), [tower, [FEED]]);
    await page.waitForTimeout(80);
    return page.evaluate(() => {
      const heading = [...document.querySelectorAll("*")].find(
        (el) => el.children.length === 0 && el.textContent.trim() === "Storage",
      );
      if (!heading) return null;
      const group = heading.closest("section, div")?.parentElement ?? null;
      return (group ?? heading.parentElement).textContent ?? "";
    });
  };

  const toneOf = async (word) =>
    page.evaluate((w) => {
      const el = [...document.querySelectorAll("span")].find(
        (s) => s.children.length === 0 && s.textContent.trim() === w,
      );
      return el ? el.className : null;
    }, word);

  test("⭐ a site that cannot reach the hub says so, in red", async () => {
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
      footage: FOOTAGE_UNREACHABLE,
    });
    assert.match(text, /Footage/);
    assert.match(text, /Can't reach hub/);
    assert.match(await toneOf("Can't reach hub"), /text-critical/);
  });

  test("⭐ and says how much is stuck on the mast", async () => {
    /* "Behind" with no quantity is a feeling. 40 files is a decision about
       whether somebody drives out there today. */
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
      footage: FOOTAGE_UNREACHABLE,
    });
    assert.match(text, /Waiting/);
    assert.match(text, /40 files/);
    assert.match(text, /5\.22 GB/);
  });

  test("up to date, with a measured empty backlog", async () => {
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
      footage: FOOTAGE_OK,
    });
    assert.match(text, /Up to date/);
    assert.match(text, /Nothing waiting/);
  });

  test("⭐ one claim, one row: no disk does not also print 'Not recording'", async () => {
    /* `health.recording.mode` is `RECORD_ENABLE` and cannot tell a missing
        disk from a switch somebody turned off, so its row said the vaguer
        thing. `sync.reason` can, so the exact sentence is on Footage and the
        vaguer row stands down rather than hedging beside it. */
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "hub" } },
      footage: FOOTAGE_NO_DISK,
    });
    assert.match(text, /Not recording: no disk/);
    const bare = text.replace(/Not recording: no disk/g, "");
    assert.ok(!/Not recording/.test(bare), `the vaguer row is back beside it: ${text}`);
  });

  test("⭐ recording switched off is not drawn as a fault", async () => {
    await rowsFor({
      ...TOWER,
      health: { recording: { mode: "hub" } },
      footage: FOOTAGE_OFF,
    });
    const tone = await toneOf("Recording off");
    assert.ok(tone, "the row is gone");
    assert.ok(!/text-critical/.test(tone), `a decision is painted as a fault: ${tone}`);
  });

  test("⭐ a tower that said nothing about sync gets neither row", async () => {
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
      footage: FOOTAGE_SILENT,
    });
    assert.match(text, /On this tower/);
    assert.ok(!/Up to date/.test(text), "silence was rendered as the good answer");
    assert.ok(!/Waiting/.test(text), "a Waiting row appeared with nothing to count");
  });

  test("a tower with no footage block at all is unchanged from before", async () => {
    const text = await rowsFor({
      ...TOWER,
      health: { recording: { mode: "tower" }, disk: { freePct: 62 } },
    });
    assert.match(text, /On this tower/);
    assert.match(text, /62% free/);
    assert.ok(!/Footage/.test(text));
  });

  test("the group still disappears entirely when a device has reported nothing", async () => {
    assert.equal(await rowsFor({ ...TOWER, health: {} }), null);
  });
});

/* ======================================================================
 *  3. THE TIMELINE: WHAT IS STILL ON THE TOWER, AND WHAT HAS NO TIME
 * ====================================================================== */

/* One camera, two hours of footage ending NOW, and a tower span running the
   half hour after it — the tail the mast has not sent yet. Plus one file that
   arrived whole with no start.

   ⚠ RELATIVE TO NOW, NOT A FIXED DATE. Playback opens on the site's TODAY, so
   a fixture pinned to a calendar day would be on screen for one day and
   invisible for every other, and the test would pass the afternoon it was
   written. Two hours ending now is inside today's site day at every hour
   except the two after midnight, and a segment straddling midnight is kept by
   both days anyway. */
const SEG_START = Math.floor(Date.now() / 1000) - 7200;

const RECORDINGS = {
  device_id: DEVICE,
  camera: null,
  archive_enabled: true,
  segments: [
    {
      key: `archive/${DEVICE}/cam1/2026-10-26/a.mp4`,
      camera: 1,
      device_id: DEVICE,
      start: new Date(SEG_START * 1000).toISOString(),
      start_epoch: SEG_START,
      duration: 7200,
      size: 690_000_000,
      url: "/v1/viewer/recordings/segment?key=a&exp=1&sig=1",
      download_url: "/v1/viewer/recordings/segment?key=a&exp=1&sig=1&dl=1",
      filename: "westtower_cam1.mp4",
    },
  ],
  tower_spans: [
    {
      camera: 1,
      start: new Date((SEG_START + 7200) * 1000).toISOString(),
      start_epoch: SEG_START + 7200,
      duration: 1800,
      state: "on_tower",
    },
  ],
  time_unknown: [
    {
      key: `archive/${DEVICE}/cam1/2026-10-26/2026-10-26_05-12-44_unknown.mp4`,
      camera: 1,
      device_id: DEVICE,
      time_unknown: true,
      size: 118_374_912,
      url: "/v1/viewer/recordings/segment?key=k1&exp=1&sig=s1",
      download_url: "/v1/viewer/recordings/segment?key=k1&exp=1&sig=s1&dl=1",
      filename: "westtower_cam1_2026-10-26_06-12-44_WAT_unknown.mp4",
      arrived: "2026-10-26T05:12:44.000Z",
      arrived_epoch: 1792991564,
    },
  ],
  tower_sync: { state: "sending", reason: "behind" },
  tower_copy: "tower",
};

describe("playback shows what the hub does not have", () => {
  let browser;
  let page;

  before(async () => {
    await mkdir(SCRATCH, { recursive: true });
    const dir = await mkdtemp(join(SCRATCH, "footage-rows-view-"));
    scratch.push(dir);
    const entry = join(dir, "entry.tsx");
    await writeFile(
      entry,
      `import { createElement, useState } from "react";
       import { createRoot } from "react-dom/client";
       import { FootageView } from "@/components/FootageView";

       function Harness() {
         const [open, setOpen] = useState(false);
         return createElement(FootageView, { clipsOpen: open, onClipsOpen: setOpen });
       }
       createRoot(document.getElementById("root")).render(createElement(Harness));
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
    /* ⚠ THE REAL PATH. Nothing here hands the component a parsed object: the
       bytes go through `SentryClient.listArchivedRecordings`, which is the
       whitelist that dropped every one of these fields before 0.13.0. A test
       that injected a shaped list would prove the component and nothing about
       the parser, which is where both bugs actually were. */
    await page.setContent("<!doctype html><html><body><div id='root'></div></body></html>");
    /* The stub is installed AFTER the document exists and BEFORE the bundle,
       not through `addInitScript`: an init script registered against
       `about:blank` does not reliably survive `setContent`, and the symptom is
       a real request to a hostname that does not resolve, which looks exactly
       like a component that chose not to ask. */
    await page.evaluate(
      ([towers, recordings]) => {
        window.fetch = (url) => {
          const path = String(url);
          const body = path.includes("/recordings/towers")
            ? towers
            : path.includes("/v1/viewer/recordings")
              ? recordings
              : null;
          if (!body) return Promise.reject(new Error(`unrouted: ${path}`));
          return Promise.resolve(
            new Response(JSON.stringify(body), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        };
      },
      [
        { towers: [{ device_id: DEVICE, label: TOWER_NAME, online: true, cameras: [1], has_recordings: true }] },
        RECORDINGS,
      ],
    );
    await page.addScriptTag({ content: bundle });
    try {
      await page.waitForSelector("[data-time-unknown]", { timeout: 10_000 });
    } catch (err) {
      const body = await page.evaluate(() => document.body.innerText.slice(0, 600));
      throw new Error([err.message, "--- errors ---", ...errors, "--- body ---", body].join(" | "));
    }
  });

  after(async () => {
    await browser?.close();
  });

  test("⭐ the tail still on the mast is drawn, and is not a gap", async () => {
    const legend = await page.textContent("[data-tower-legend]");
    assert.match(legend, /On tower/);
    /* And it says the one thing that distinguishes it from footage: you cannot
       play it from here. A band that looks playable and is not is worse than
       the gap it replaced. */
    assert.match(legend, /cannot be played here/);
  });

  test("⭐ the On tower band is NOT painted in the footage colour", async () => {
    /* Green on this bar means "there is footage here and you can scrub to it".
       Half of that is false for a tower span, and a click that does nothing is
       the failure. */
    const classes = await page.evaluate(() =>
      [...document.querySelectorAll('[title="On tower, not at the hub yet"]')].map(
        (el) => el.className,
      ),
    );
    assert.ok(classes.length > 0, "no tower span was drawn");
    for (const c of classes) assert.ok(!/bg-terra/.test(c), `a tower span is green: ${c}`);
  });

  test("⭐ an undated file is listed, and never placed on the timeline", async () => {
    const list = await page.textContent("[data-time-unknown]");
    assert.match(list, /Time unknown/);
    assert.match(list, /CAMERA 1/);
    /* Its stamp is the ARRIVAL and is labelled as one. An unlabelled time in a
       row of recordings is read as the recording's own, which is the single
       claim this list exists to not make. */
    assert.match(list, /Arrived/);
    assert.match(list, /112\.9 MB/);
  });

  test("⭐ and the timeline itself gained no band for it", async () => {
    /* The second failure mode, and the quieter one: drawing it at the moment it
       arrived both shows footage at a time it was not recorded AND cuts the
       real segment before it short to the invented gap in front of it. The
       lanes hold exactly one footage band, the one real segment. */
    const bands = await page.evaluate(() =>
      [...document.querySelectorAll("[data-footage-timeline] span")].filter((el) =>
        /bg-terra/.test(el.className),
      ).length,
    );
    assert.equal(bands, 1, "an undated file reached the timeline");
  });

  test("⭐ its download carries no time in the name", async () => {
    /* A file that states a time it is not of survives longest exactly where it
       does the most damage: on a disk, in an evidence folder, long after the
       screen that explained it is closed. */
    const name = await page.getAttribute("[data-time-unknown] a[download]", "download");
    /* ⚠ THE CAMERA IS "Camera_1", NOT "CAMERA_1", AND THAT IS THE RULE
       RATHER THAN A MISS. `deviceName` capitalises a device's name everywhere
       it is SHOWN; evidence filenames are the documented exception and go
       through `safeSegment`, which preserves rather than prettifies. The clip
       downloads beside this one are named the same way, and the point of the
       exception is that a file an operator has on disk reads as they filed
       it. */
    assert.equal(name, "WEST_TOWER_Camera_1_time-unknown.mp4");
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(name), `a date reached the filename: ${name}`);
    assert.ok(!/\d{2}-\d{2}-\d{2}/.test(name), `a clock reached the filename: ${name}`);
  });

  test("the row plays, in a player of its own", async () => {
    await page.click("[data-time-unknown] button");
    await page.waitForSelector("[data-undated-player]", { timeout: 5000 });
    const src = await page.getAttribute("[data-undated-player] video", "src");
    assert.match(src, /key=k1/);
    /* And it says what it is, over the picture, rather than leaving a player
       with no time on it looking like a player that lost one. */
    assert.match(await page.textContent("[data-undated-player]"), /Time unknown/);
    await page.keyboard.press("Escape");
    await page.waitForSelector("[data-undated-player]", { state: "detached", timeout: 5000 });
  });
});
