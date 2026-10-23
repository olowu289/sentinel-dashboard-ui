/**
 * One radio, one reading, two screens.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * Lab Tower 1, on sentri.watch. Its settings said "Radio link: Good" off a
 * real -44 dBm read over SNMP. The Towers board, two clicks away, showed the
 * same mast with three grey bars and "No link" in amber -- in a row that also
 * said the tower had been up for eighteen minutes. The Lab hub mast's Uplink
 * cell showed a dash.
 *
 * Neither screen was lying. They were reading DIFFERENT BLOCKS: settings read
 * `health.radio`, which is the mast's own radio over SNMP and the thing the
 * hub actually fills, and the board read `health.uplink` through
 * `uplinkReading`, which is a different block about a different link and was
 * empty.
 *
 * So the tests here are mostly about one claim: the board and the settings
 * row now take the same function, and there is no record for which they can
 * disagree. The rest pin the thresholds and the one rule that was broken
 * loudly -- "No link" must never appear against an online tower.
 *
 *   node --test test/uplinkBars.test.mjs
 */
import assert from "node:assert/strict";
import { readFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let up;
let map;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "uplink-bars-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as up from "@/lib/uplinkDisplay";\nexport * as map from "@/lib/api/map";\n`,
    "utf8",
  );
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC, "@kallon/sentry-sdk": join(ROOT, "vendor/sentry-sdk/dist/esm/index.js") },
  });
  const mod = await import(pathToFileURL(out).href);
  up = mod.up;
  map = mod.map;
});

const DASH = "–";

/**
 * Lab Tower 1 as the wire sends it, with its radio reading.
 *
 * ⚠ THE SIGNAL IS AT `health.radio.signal_dbm`, WITH `signal_from`. That is
 * the field settings always read and the one the fix points the board at.
 */
const TOWER_WIRE = (signalDbm, extra = {}) => ({
  device_id: "kln_lab_000001",
  label: "LAB TOWER 1",
  link: "up",
  as_of: "2026-10-23T09:00:00Z",
  connected_at: "2026-10-23T08:42:00Z",
  cameras: [],
  sensors: [],
  health: {
    radio: {
      associated: true,
      state: "up",
      sector: "A",
      ...(signalDbm === null ? {} : { signal_dbm: signalDbm, signal_from: "tower" }),
      ...extra,
    },
  },
});

const towerOf = (signalDbm, extra, patch = {}) =>
  map.toTower({ ...TOWER_WIRE(signalDbm, extra), ...patch }).tower;

/* ======================================================================
 *  THE THRESHOLDS, AND THE BARS THAT COUNT THEM
 * ====================================================================== */

describe("a tower's reading, graded", () => {
  test("⭐ -44 dBm is Good: 3 bars, green", () => {
    /* The lab's actual number, and the one that was showing "No link". */
    const d = up.uplinkDisplay(towerOf(-44));
    assert.equal(d.word, "Good");
    assert.equal(d.bars, 3);
    assert.equal(d.tone, "text-terra");
    assert.equal(d.dbm, -44);
    assert.equal(d.meter, true);
  });

  test("⭐ -65 dBm is Fair: 2 bars, amber", () => {
    /* The boundary, and it belongs to Fair: "better than -65" is `> -65`. */
    const d = up.uplinkDisplay(towerOf(-65));
    assert.equal(d.word, "Fair");
    assert.equal(d.bars, 2);
    assert.equal(d.tone, "text-warn");
  });

  test("⭐ -70 dBm is Fair: 2 bars, amber", () => {
    const d = up.uplinkDisplay(towerOf(-70));
    assert.equal(d.word, "Fair");
    assert.equal(d.bars, 2);
    assert.equal(d.tone, "text-warn");
  });

  test("⭐ -75 dBm is Fair, at the far end: 2 bars, amber", () => {
    /* Both ends of Fair are Fair. An installer reading -75 and one reading
       -65 must get the same word as each other, every time. */
    const d = up.uplinkDisplay(towerOf(-75));
    assert.equal(d.word, "Fair");
    assert.equal(d.bars, 2);
  });

  test("⭐ -80 dBm is Weak: 1 bar, red", () => {
    const d = up.uplinkDisplay(towerOf(-80));
    assert.equal(d.word, "Weak");
    assert.equal(d.bars, 1);
    assert.equal(d.tone, "text-critical");
  });

  test("the bars never exceed the meter, at any reading", () => {
    for (let dbm = -5; dbm >= -120; dbm -= 1) {
      const d = up.uplinkDisplay(towerOf(dbm));
      assert.ok(d.bars >= 1 && d.bars <= up.UPLINK_BARS, `${dbm} lit ${d.bars}`);
    }
  });
});

/* ======================================================================
 *  THE TWO ABSENCES, WHICH ARE NOT THE SAME ABSENCE
 * ====================================================================== */

describe("nothing measured, and nothing connected", () => {
  test("⭐ online with no reading is a dash and a dark meter", () => {
    /* No SNMP community on the site, a radio that would not answer, or a
       reading outside plausible RF. The instrument stays, unlit. */
    const d = up.uplinkDisplay(towerOf(null));
    assert.equal(d.word, DASH);
    assert.equal(d.bars, 0);
    assert.equal(d.tone, undefined, "no colour on a reading nobody has");
    assert.equal(d.meter, true);
  });

  test("⭐ an offline tower is No link: 0 bars, red", () => {
    const d = up.uplinkDisplay(towerOf(-44, {}, { link: "down" }));
    assert.equal(d.word, "No link");
    assert.equal(d.bars, 0);
    assert.equal(d.tone, "text-critical");
  });

  test("an offline tower is not graded off a reading from before it went", () => {
    /* Coordination keeps the last health block a tower sent, so the -44 is
       still in the record. Grading it would draw a link that held an hour ago
       as though it held now. */
    const d = up.uplinkDisplay(towerOf(-44, {}, { link: "down" }));
    assert.equal(d.kind, "down");
    assert.equal(d.dbm, undefined);
  });

  test("a radio up but joined to nothing keeps the words settings uses", () => {
    const d = up.uplinkDisplay(towerOf(null, { associated: false }));
    assert.equal(d.word, "Not connected");
    assert.equal(d.bars, 0);
    assert.equal(d.tone, "text-critical");
  });

  test("⭐ \"No link\" NEVER appears against an online tower", () => {
    /* THE RULE THAT WAS BROKEN, AND THE LOUDEST THING THIS COLUMN SAYS.
       Every shape of an online record, including the ones with nothing in
       them at all. */
    const online = [
      towerOf(-44), towerOf(-65), towerOf(-75), towerOf(-80), towerOf(null),
      towerOf(null, { associated: false }),
      towerOf(null, { state: "down" }),
      towerOf(-44, { state: "degraded" }),
      map.toTower({ ...TOWER_WIRE(null), health: {} }).tower,
      map.toTower({ ...TOWER_WIRE(null), health: undefined }).tower,
    ];
    for (const tower of online) {
      assert.equal(tower.online, true, "the fixture is online");
      const d = up.uplinkDisplay(tower);
      assert.notEqual(d.word, "No link", JSON.stringify(tower.health));
    }
  });
});

/* ======================================================================
 *  A HUB MAST
 * ====================================================================== */

describe("a hub mast's Uplink cell", () => {
  const HUB_WIRE = (uplink) => ({
    device_id: "kln_hub_terra_lab",
    label: "LAB HUB MAST",
    kind: "hub",
    link: "up",
    as_of: "2026-10-23T09:00:00Z",
    cameras: [],
    sensors: [],
    ...(uplink === null ? {} : { health: { uplink } }),
  });
  const hubOf = (uplink, patch = {}) =>
    map.toTower({ ...HUB_WIRE(uplink), ...patch }).tower;

  test("⭐ names the way out, and draws no bars", () => {
    /* A hub is not ON a radio link; it is the thing masts link to. A meter
       beside "Satellite" would read as a satellite link with no signal. */
    const d = up.uplinkDisplay(hubOf({ type: "Satellite" }));
    assert.equal(d.word, "Satellite");
    assert.equal(d.meter, false);
    assert.equal(d.bars, 0);
    assert.equal(d.tone, undefined);
  });

  test("⭐ each of the five words, from health.uplink.type", () => {
    for (const [sent, shown] of [
      ["Ethernet", "Ethernet"], ["Fibre", "Fibre"], ["Mobile", "Mobile"],
      ["Satellite", "Satellite"], ["Wi-Fi", "Wi-Fi"],
      ["satellite", "Satellite"], ["lte", "Mobile"], ["wifi", "Wi-Fi"],
    ]) {
      const d = up.uplinkDisplay(hubOf({ type: sent }));
      assert.equal(d.word, shown, sent);
      assert.equal(d.meter, false, sent);
    }
  });

  test("nothing declared is a dash, still with no bars", () => {
    const d = up.uplinkDisplay(hubOf(null));
    assert.equal(d.word, DASH);
    assert.equal(d.meter, false);
  });

  test("⭐ a cloud link that is down is No link, in red", () => {
    const d = up.uplinkDisplay(hubOf({ type: "Satellite" }), { connected: false });
    assert.equal(d.word, "No link");
    assert.equal(d.tone, "text-critical");
    assert.equal(d.meter, false);
  });

  test("an answer from the data centre is not a link that is down", () => {
    /* `is_cloud` carries no `connected: false`: the data centre answering at
       all is proof it is reachable. The same rule the Internet row follows. */
    const d = up.uplinkDisplay(hubOf({ type: "Satellite" }), { isCloud: true });
    assert.equal(d.word, "Satellite");
  });

  test("the cloud's observed interface stands in where the record is silent", () => {
    const d = up.uplinkDisplay(hubOf(null), { connected: true, iface: "Fibre" });
    assert.equal(d.word, "Fibre");
  });
});

/* ======================================================================
 *  ONE FUNCTION, BOTH SCREENS
 * ====================================================================== */

describe("the board and the settings row cannot disagree", () => {
  let board;
  let panel;
  /* The same sources with the comments blanked. Both removals left a note at
     the site naming what used to be there -- `uplinkReading` and
     `SignalBars` are both still in this file's prose, deliberately -- and a
     test searching the raw source fails on the explanation for its own fix,
     which is the surest way to get that explanation deleted. */
  let boardCode;
  before(async () => {
    const { stripComments } = await import("./lib/copyScan.mjs");
    board = await readFile(join(SRC, "components/TowersView.tsx"), "utf8");
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    boardCode = stripComments(board);
  });

  test("⭐ both take their reading from uplinkDisplay", () => {
    assert.match(board, /uplinkDisplay\(tower, cloud\)/);
    assert.match(panel, /uplinkDisplay\(tower\)/);
  });

  test("⭐ both draw the same meter component", () => {
    /* One set of heights, one colour table. The board used to own a local
       `SignalBars` and the panel owned nothing at all. */
    assert.match(board, /<UplinkBars display=\{row\.uplink\}/);
    assert.match(panel, /<UplinkBars display=\{meter\}/);
    assert.ok(!/function SignalBars/.test(boardCode), "a local copy is back");
  });

  test("⭐ the board no longer reads the other block", () => {
    /* `health.uplink` through `uplinkReading` is what made the two screens
       disagree. The hub branch still reads `health.uplink.type`, which is the
       hub's way out and a different fact -- inside `uplinkDisplay`, not here. */
    assert.ok(!/uplinkReading/.test(boardCode), "uplinkReading is back on the board");
  });

  test("the meter is fixed-width and the word is what gives", async () => {
    /* Phone width: the bars are 12px that cannot shrink and the value
       truncates, so a narrow panel shortens the word rather than wrapping the
       row onto a second line. */
    const bars = await readFile(join(SRC, "components/UplinkBars.tsx"), "utf8");
    assert.match(bars, /shrink-0/);
    assert.match(panel, /\{meter && <UplinkBars/);
    assert.match(panel, /truncate \$\{VALUE_TYPE\}/);
  });

  test("the colours are the app's reserved three, and nothing else", async () => {
    const bars = await readFile(join(SRC, "components/UplinkBars.tsx"), "utf8");
    assert.match(bars, /"bg-terra"/);
    assert.match(bars, /"bg-warn"/);
    assert.match(bars, /"bg-critical"/);
    /* No raw hex, which the token rule forbids outside a scrim. */
    assert.ok(!/#[0-9a-fA-F]{3,6}/.test(bars), "a raw hex is in the meter");
  });
});
