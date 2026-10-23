/**
 * A hub mast's settings page reads exactly like a tower's.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE BUG THIS SUITE IS ABOUT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Lab Tower 1 showed Model, Serial Number, Firmware, Connected since and
 * Picture quality correctly. The hub mast beside it, on the same screen, in
 * the same component, showed:
 *
 *   Picture quality    nothing at all, because its camera advertises no
 *                      profile list and the summary had nothing to name --
 *                      while the choices rendered UNDER that row said
 *                      "Standard" for the same camera
 *   Internet           "Fibre · connected", which is the Kallon Cloud row's
 *                      answer said a second time in the same group
 *   Connected since    "Not connected", in red, directly above a Kallon Cloud
 *                      row reading "Connected" -- because a hub read the
 *                      cloud reading and a tower read its own record
 *   Radios             hidden, or "One radio, no sectors" in the value column
 *
 * None of those is a missing field. Every one was a second code path for the
 * same fact, which is why the fix was to delete the second path rather than
 * to teach it the first one's answer. These tests run the shared functions
 * against a HUB fixture built from the tower's own field names, so a second
 * path cannot come back without one of them going red.
 *
 *   node --test test/hubMastSettings.test.mjs
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let rows;
let map;
let time;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "hub-mast-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as rows from "@/lib/settingsRows";\n`
      + `export * as map from "@/lib/api/map";\n`
      + `export * as time from "@/lib/time";\n`,
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
  rows = mod.rows;
  map = mod.map;
  time = mod.time;
  time.setSiteTz("Africa/Lagos");
});

/**
 * A hub mast as coordination serves it: THE TOWER'S OWN FIELD NAMES.
 *
 * ⚠ THE POINT OF THIS FIXTURE IS THAT IT IS NOT SPECIAL. `model`, `serial`,
 * `agent_version`, `connected_at` -- every one of them is the key a tower
 * sends, read by the one mapper both kinds go through. The only hub-shaped
 * things here are `kind: "hub"` and the sector list, which is the hardware.
 */
const HUB_RAW = {
  device_id: "kln_hub_kaduna",
  label: "KADUNA HUB",
  kind: "hub",
  link: "up",
  as_of: "2026-10-22T12:00:00Z",
  connected_at: "2026-10-22T12:18:00Z",
  model: "HUB-3S",
  serial: "KLN-H-2610-0001",
  board_serial: "1424498765432",
  agent_version: "v1.5.0-255",
  ota_channel: "stable",
  cameras: [{ index: 1, name: "HUB MAST", state: "live" }],
};

/** The same record with no sectors: a one-radio hub, which declares none. */
const ONE_RADIO_RAW = { ...HUB_RAW, device_id: "kln_hub_small" };

const THREE_SECTOR_RAW = {
  ...HUB_RAW,
  health: {
    sectors: [
      { id: "A", state: "up" },
      { id: "B", state: "up" },
      { id: "C", state: "up" },
    ],
  },
};

const CLOUD_FIBRE = {
  connected: true,
  iface: "Fibre",
  since: "2026-10-13T12:18:00Z",
  latencyMs: 42,
};

/* ======================================================================
 *  THE FIELDS A TOWER USES, READ THE SAME WAY
 * ====================================================================== */

describe("a hub mast's About Device, off the tower's own fields", () => {
  test("⭐ Model, Serial Number and Firmware come through one mapper", () => {
    const { tower } = map.toTower(HUB_RAW);
    assert.equal(tower.model, "HUB-3S");
    assert.equal(tower.serial, "KLN-H-2610-0001");
    assert.equal(tower.firmware, "v1.5.0-255");
    assert.equal(tower.kind, "hub");
  });

  test("a tower sending the same keys lands in the same places", () => {
    /* The claim stated as a test rather than as a comment: swap the kind and
       the sectors and every other field reads identically. */
    const hub = map.toTower(HUB_RAW).tower;
    const twr = map.toTower({ ...HUB_RAW, kind: "tower", device_id: "kln_t" }).tower;
    for (const key of ["model", "serial", "firmware", "firmwareChannel", "connectedAt"]) {
      assert.equal(hub[key], twr[key], key);
    }
  });

  test("the board serial still crosses, it is simply not shown", () => {
    /* Dropping it on the way in would be losing data; the screen is what
       stopped printing it. `deviceInfo.test.mjs` holds the rendering half. */
    assert.equal(map.toTower(HUB_RAW).tower.boardSerial, "1424498765432");
  });

  test("⭐ Radios is a count, and a one-radio hub says 1", () => {
    assert.equal(rows.radioCount(map.toTower(ONE_RADIO_RAW).tower), 1);
    assert.equal(rows.radioCount(map.toTower(THREE_SECTOR_RAW).tower), 3);
  });
});

/* ======================================================================
 *  NETWORK
 * ====================================================================== */

describe("a hub mast's Network group", () => {
  const upFrom = (type) => ({ health: { uplink: { type } } });

  test("⭐ Internet is the TYPE, not the type and its state", () => {
    assert.deepEqual(rows.internetRow(undefined, CLOUD_FIBRE), { value: "Fibre" });
  });

  test("every declared interface reaches the row as its own word", () => {
    for (const iface of ["Ethernet", "Fibre", "Mobile", "Satellite", "Wi-Fi"]) {
      assert.equal(rows.internetRow(undefined, { connected: true, iface }).value, iface);
    }
  });

  test("⭐ the DEVICE's own word wins, and is spelled by us", () => {
    /* A tower's `health.uplink.type` has always been lowercase, and a hub
       filling the same field will be too. The row owns the spelling so the
       five words read alike wherever they came from. */
    const { tower } = map.toTower({ ...HUB_RAW, ...upFrom("satellite") });
    assert.equal(rows.internetRow(tower, CLOUD_FIBRE).value, "Satellite");
    for (const [sent, shown] of [
      ["ethernet", "Ethernet"], ["fiber", "Fibre"], ["lte", "Mobile"],
      ["wifi", "Wi-Fi"], ["wi-fi", "Wi-Fi"],
    ]) {
      const t = map.toTower({ ...HUB_RAW, ...upFrom(sent) }).tower;
      assert.equal(rows.internetRow(t, { connected: true }).value, shown, sent);
    }
  });

  test("a word we have not thought of is shown, not dropped", () => {
    /* A site on something unexpected still has a way out, and the installer's
       word for it beats ours. */
    const { tower } = map.toTower({ ...HUB_RAW, ...upFrom("starlink") });
    assert.equal(rows.internetRow(tower, { connected: true }).value, "Starlink");
  });

  test("a hub that declares no interface says Connected", () => {
    assert.equal(rows.internetRow(undefined, { connected: true }).value, "Connected");
  });

  test("a link that is down says so, in red, with no interface name", () => {
    /* The interface is still true and still useless: what the reader needs is
       that the way out is down, and one fact is the whole row. */
    const { tower } = map.toTower({ ...HUB_RAW, ...upFrom("fibre") });
    const row = rows.internetRow(tower, { connected: false, iface: "Fibre" });
    assert.equal(row.value, "Not connected");
    assert.equal(row.tone, "text-critical");
  });

  test("nothing reported at all is blank, never \"Not reported\"", () => {
    /* A site that has not told us about its link has not told us it is down
       either, and a row saying so is a gap in our reporting dressed as a fact
       about their site. */
    assert.equal(rows.internetRow(undefined, undefined).value, "");
    assert.equal(rows.internetRow(map.toTower(HUB_RAW).tower, undefined).value, "");
  });

  test("an answer from the cloud itself is Connected, not an interface", () => {
    assert.equal(rows.internetRow(undefined, { isCloud: true }).value, "Connected");
  });

  test("⭐ Connected since reads the RECORD, exactly as a tower does", () => {
    const { tower } = map.toTower(HUB_RAW);
    assert.equal(
      rows.connectedSinceAt(tower, CLOUD_FIBRE),
      Date.parse("2026-10-22T12:18:00Z"),
    );
  });

  test("⭐ it is never \"Not connected\" while the cloud row says Connected", () => {
    /* THE EXACT CONTRADICTION THAT WAS ON SCREEN. A hub whose record carries
       no connection time still has the cloud's `since` for the same link, and
       the two rows must not disagree about it. */
    const { tower } = map.toTower({ ...HUB_RAW, connected_at: undefined });
    assert.equal(tower.connectedAt, undefined, "the fixture withholds it");
    assert.equal(
      rows.connectedSinceAt(tower, CLOUD_FIBRE),
      Date.parse("2026-10-13T12:18:00Z"),
    );
  });

  test("with neither, it is absent rather than invented", () => {
    const { tower } = map.toTower({ ...HUB_RAW, connected_at: undefined });
    assert.equal(rows.connectedSinceAt(tower, undefined), undefined);
    assert.equal(rows.connectedSinceAt(tower, { connected: false, since: "x" }), undefined);
  });
});

/* ======================================================================
 *  PICTURE QUALITY
 * ====================================================================== */

describe("a hub mast's Picture quality", () => {
  const bare = { id: "kln_hub_kaduna:1", name: "HUB MAST" };
  const twoProfiles = {
    id: "kln_northgate_000001:1",
    name: "GATE",
    profiles: [
      { id: "sub", resolution: { width: 704, height: 576 }, default: true },
      { id: "main", resolution: { width: 2560, height: 1440 } },
    ],
  };

  test("⭐ a camera advertising no profiles is Standard, not blank", () => {
    /* The hub mast's row, and the whole of point 8: it showed nothing while
       the choices under it said "Standard" for the same camera. */
    assert.equal(rows.pictureQualitySummary([bare]), "Standard");
  });

  test("and the choices under it say the same word", () => {
    /* Both now come from `profileLabel`, so they cannot drift. A profile with
       no resolution is the single-quality case stated on the wire. */
    assert.equal(rows.profileLabel({ id: "sub" }, []), "Standard");
  });

  test("a tower's two profiles still read Standard and the resolution", () => {
    assert.equal(rows.pictureQualitySummary([twoProfiles]), "Standard");
    assert.equal(
      rows.pictureQualitySummary([twoProfiles], { "kln_northgate_000001:1": "main" }),
      "2K",
    );
  });

  test("two cameras that agree speak as one, two that disagree say so", () => {
    assert.equal(rows.pictureQualitySummary([bare, { ...bare, id: "b" }]), "Standard");
    assert.equal(
      rows.pictureQualitySummary([bare, twoProfiles], {
        "kln_northgate_000001:1": "main",
      }),
      "2 cameras",
    );
  });

  test("no cameras at all is blank, which hides the row", () => {
    assert.equal(rows.pictureQualitySummary([]), "");
  });
});

/* ======================================================================
 *  CONNECTED SINCE, AS WORDS
 * ====================================================================== */

describe("Connected since reads as a day and a time", () => {
  const AT = Date.parse("2026-10-22T12:18:00Z");   // 1:18 PM in Lagos

  test("⭐ today is \"Today 1:18 PM\"", () => {
    assert.equal(time.formatConnectedSince(AT, AT + 3 * 3600_000), "Today 1:18 PM");
  });

  test("⭐ the day before is \"Yesterday 1:18 PM\"", () => {
    const nextDay = Date.parse("2026-10-23T09:00:00Z");
    assert.equal(time.formatConnectedSince(AT, nextDay), "Yesterday 1:18 PM");
  });

  test("⭐ anything older carries the date: \"22 Oct 1:18 PM\"", () => {
    const later = Date.parse("2026-10-30T09:00:00Z");
    assert.equal(time.formatConnectedSince(AT, later), "22 Oct 1:18 PM");
  });

  test("⭐ no seconds, no zone name, no uptime", () => {
    for (const now of [AT, AT + 86_400_000, AT + 30 * 86_400_000]) {
      const out = time.formatConnectedSince(AT, now);
      assert.doesNotMatch(out, /:\d\d:\d\d/, `seconds in "${out}"`);
      assert.doesNotMatch(out, /\b(WAT|GMT|UTC|[A-Z]{3,4}T)\b/, `a zone in "${out}"`);
      assert.doesNotMatch(out, /\bup\b/, `an uptime in "${out}"`);
    }
  });

  test("the hour has no leading zero", () => {
    /* `clockShort` pads to "01:18 PM", which is the clock on a microwave. */
    const nine = Date.parse("2026-10-22T08:05:00Z");   // 9:05 AM in Lagos
    assert.equal(time.formatConnectedSince(nine, nine), "Today 9:05 AM");
  });

  test("it is read in SITE time, not the reader's", () => {
    /* The same instant, two site zones, two wall clocks. An operator in London
       watching Lagos must see the time at the site. */
    time.setSiteTz("UTC");
    assert.equal(time.formatConnectedSince(AT, AT), "Today 12:18 PM");
    time.setSiteTz("Africa/Lagos");
    assert.equal(time.formatConnectedSince(AT, AT), "Today 1:18 PM");
  });
});

/* ======================================================================
 *  THE ROWS THAT ARE MARKUP, NOT A FUNCTION
 * ====================================================================== */

describe("the panel wires those answers in, and only once", () => {
  let panel;
  /**
   * The same source with the comments blanked.
   *
   * ⚠ NEEDED, AND NOT AS A TIDINESS MEASURE. Every removal here left a
   * comment at the site saying what used to be there and why it went --
   * "Location not reported", "Radio sectors", "One radio, no sectors" are all
   * still in this file, in prose, on purpose. A test searching the raw source
   * for those strings fails on the explanation for its own fix, which is the
   * surest way to get the explanation deleted.
   */
  let code;
  before(async () => {
    const { readFile } = await import("node:fs/promises");
    const { stripComments } = await import("./lib/copyScan.mjs");
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    code = stripComments(panel);
  });

  test("both kinds take Connected since from the same expression", () => {
    /* Two call sites, one value. A hub branch reaching for the cloud again is
       the bug coming back, and it would read perfectly well in a diff. */
    const uses = panel.match(/<ConnectedSince at=\{connectedSince\}/g) ?? [];
    assert.equal(uses.length, 2, "a hub branch and a tower branch");
    assert.ok(!/<ConnectedSince at=\{cloud/.test(panel), "a cloud source is back");
  });

  test("⭐ a hub's archive disk is called Disk", () => {
    /* "Memory" is what a phone calls its storage. A hub writes the site's
       footage to a disk and that is the word on the invoice for it. */
    assert.match(panel, /label=\{isHub \? "Disk" : "Memory"\}/);
  });

  test("⭐ no location means no line, not a line about the gap", () => {
    assert.ok(!/Location not reported/.test(code), "the string is back");
    assert.match(code, /\{tower\.location \? \(/);
  });

  test("the Radios row is not behind a sector test any more", () => {
    assert.match(code, /label="Radios"/);
    assert.ok(!/Radio sectors/.test(code), "the old label is back");
    assert.ok(!/One radio, no sectors/.test(code), "the sentence is back");
  });
});

/* ======================================================================
 *  THE LAB HUB, EXACTLY AS THE WIRE SENT IT
 * ====================================================================== */

/**
 * One tower out of `GET /v1/viewer/towers`, nested the way the live response
 * nests it: Terra Industries' lab hub mast, website on 45bb449, hub and
 * Kallon Cloud on sentry-core 23c423b.
 *
 * ⚠ THE SHAPE IS THE TEST. The word sits at `health.uplink.type`, which is
 * the tower's own uplink field and the one the hub was agreed to fill
 * (`coordination/hub/local_camera.py` does
 * `hello["health"].setdefault("uplink", {})["type"]`). Every earlier test in
 * this file builds that nesting with a helper; this one writes it out, so a
 * reader can compare it against a response by eye.
 */
const LAB_HUB_WIRE = {
  device_id: "kln_hub_terra_lab",
  label: "LAB HUB MAST",
  kind: "hub",
  link: "up",
  as_of: "2026-10-22T20:37:11Z",
  connected_at: "2026-10-22T20:37:02Z",
  model: "HUB-1S",
  serial: "KLN-H-LAB-0001",
  board_serial: "1424498765432",
  agent_version: "v1.5.0-263-gd1a5bb7",
  cameras: [{ index: 1, name: "HUB MAST", state: "live" }],
  sensors: [],
  health: {
    uplink: { type: "Satellite" },
    recording: { mode: "hub" },
  },
};

/**
 * What the DATA CENTRE sends for `cloud`, which is the whole of the bug.
 *
 * Not the hub's `/run/kallon/cloud.json` -- that one carries the interface and
 * a latency. Coordination running in the data centre has no round trip to
 * report and says so, with no `iface` at all. The row used to read this,
 * answer "Connected", and stop.
 */
const DC_CLOUD = { connected: true, isCloud: true };

/** What a HUB sends for the same block, read off /run/kallon/cloud.json. */
const HUB_CLOUD = {
  connected: true,
  since: "2026-10-22T20:37:02Z",
  latencyMs: 208,
  iface: "Satellite",
};

describe("the lab hub's Internet row", () => {
  test("⭐ shows Satellite, although the answer came from the data centre", () => {
    /* THE REGRESSION. `is_cloud` was tested before the record was read, so a
       hub reporting Satellite perfectly well showed "Connected" on
       sentri.watch and the right word on nothing. */
    const { tower } = map.toTower(LAB_HUB_WIRE);
    assert.equal(tower.health.uplink.type, "Satellite", "the record carries it");
    assert.equal(rows.internetRow(tower, DC_CLOUD).value, "Satellite");
  });

  test("and the same word when the hub itself answers", () => {
    const { tower } = map.toTower(LAB_HUB_WIRE);
    assert.equal(rows.internetRow(tower, HUB_CLOUD).value, "Satellite");
  });

  test("⭐ each of the five words, at that exact path, from the data centre", () => {
    for (const [sent, shown] of [
      ["Ethernet", "Ethernet"],
      ["Fibre", "Fibre"],
      ["Mobile", "Mobile"],
      ["Satellite", "Satellite"],
      ["Wi-Fi", "Wi-Fi"],
    ]) {
      const wire = { ...LAB_HUB_WIRE, health: { uplink: { type: sent } } };
      const { tower } = map.toTower(wire);
      assert.equal(rows.internetRow(tower, DC_CLOUD).value, shown, sent);
    }
  });

  test("⭐ and case does not matter, in either direction", () => {
    /* The hub's table and ours agree today. They are two processes and they
       will not always, so the row lowercases before it looks up. */
    for (const sent of ["SATELLITE", "satellite", "SaTeLlItE"]) {
      const wire = { ...LAB_HUB_WIRE, health: { uplink: { type: sent } } };
      const { tower } = map.toTower(wire);
      assert.equal(rows.internetRow(tower, DC_CLOUD).value, "Satellite", sent);
    }
  });

  test("a data centre answer with no record still says Connected", () => {
    /* Unchanged, and the reason the old branch looked right: with nothing
       declared there is still nothing to name. */
    const wire = { ...LAB_HUB_WIRE, health: { recording: { mode: "hub" } } };
    const { tower } = map.toTower(wire);
    assert.equal(rows.internetRow(tower, DC_CLOUD).value, "Connected");
  });

  test("a link that is down still beats the declared word", () => {
    /* The way out hardly matters when there is no way out, and the red row is
       the one thing worth reading. `is_cloud` has no down case: the data
       centre answering at all is the proof it is reachable. */
    const { tower } = map.toTower(LAB_HUB_WIRE);
    const row = rows.internetRow(tower, { connected: false, iface: "Satellite" });
    assert.equal(row.value, "Not connected");
    assert.equal(row.tone, "text-critical");
  });
});
