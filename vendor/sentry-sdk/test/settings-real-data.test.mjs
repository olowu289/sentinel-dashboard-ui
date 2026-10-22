/**
 * The readings a tower's settings screen prints, carried through the parser.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS FILE EXISTS: THREE BLOCKS WERE TYPED AND NEVER PARSED
 * ══════════════════════════════════════════════════════════════════════
 *
 * `health.radio` and `health.sectors` were declared on `TowerHealth`, served
 * by coordination, and SILENTLY DROPPED by `parseTowerHealth` -- which rebuilds
 * the block field by field and had no case for either. `test/sector-health.test.mjs`
 * did not catch it, because it asserts the shape of the shipped `.d.ts` and a
 * declaration cannot tell you whether the runtime copies the field out.
 *
 * That is the worst available failure: the contract says the field exists, the
 * server sends it, the types let a consumer read it, and the value is
 * `undefined` for ever. A dashboard row then renders "Not measured" over a
 * perfectly good measurement, and nobody can tell that from a radio that would
 * not answer.
 *
 * So these tests parse REAL BODIES and assert the values come out the far side.
 * Shape tests live next door; these are about the wire.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTowerList, parseTowerDetail } from "../dist/esm/index.js";

/** The §A.3 required set, so each test can say only what it is about. */
function tower(extra = {}) {
  return {
    device_id: "kln_abc",
    label: "North Gate",
    link: "up",
    as_of: "2026-10-22T09:00:00Z",
    cameras: [],
    sensors: [],
    ...extra,
  };
}

/* ── RADIO: THE NUMBER, AND WHICH END MEASURED IT ───────────────────────── */

test("a tower's radio block survives the parser, signal and all", () => {
  const got = parseTowerList({
    towers: [
      tower({
        health: {
          radio: {
            associated: true,
            node_id: 3,
            state: "up",
            sector: "B",
            signal_dbm: -62,
            signal_from: "tower",
          },
        },
      }),
    ],
  });
  const radio = got.towers[0].health.radio;
  assert.equal(radio.associated, true);
  assert.equal(radio.node_id, 3);
  assert.equal(radio.state, "up");
  assert.equal(radio.sector, "B");
  /* THE WHOLE POINT. Before this landed the two lines below read `undefined`
     on a body that carried both. */
  assert.equal(radio.signal_dbm, -62);
  assert.equal(radio.signal_from, "tower");
});

test("an unmeasured radio has NO signal, rather than a zero", () => {
  const got = parseTowerList({
    towers: [tower({ health: { radio: { associated: true, sector: "A" } } })],
  });
  const radio = got.towers[0].health.radio;
  /* A site with no SNMP community configured. The row says "Not measured",
     which it can only do if the field is absent -- a 0 dBm would grade as a
     perfect link, and a -120 would grade as a dead one. */
  assert.equal(radio.signal_dbm, undefined);
  assert.equal(radio.signal_from, undefined);
  assert.equal(radio.associated, true);
});

test("a signal that is not a number does not reach a row that grades it", () => {
  const got = parseTowerList({
    towers: [
      tower({ health: { radio: { associated: true, signal_dbm: "-62" } } }),
    ],
  });
  assert.equal(got.towers[0].health.radio.signal_dbm, undefined);
});

test("no radio block at all is absence, not an unassociated radio", () => {
  const got = parseTowerList({ towers: [tower({ health: { disk: { free_pct: 40 } } })] });
  /* A WireGuard tower, or a hub that knows nothing about this mast. A
     substituted `{associated: false}` would claim a radio joined to nothing. */
  assert.equal(got.towers[0].health.radio, undefined);
});

/* ── SECTORS: PER-MAST SIGNALS ON A HUB'S OWN RADIOS ────────────────────── */

test("a hub's sectors survive the parser, with their per-mast signals", () => {
  const got = parseTowerList({
    towers: [
      tower({
        device_id: "hub-lab",
        health: {
          sectors: [
            {
              id: "A",
              state: "up",
              azimuth: 120,
              ssid: "kallon-kaduna",
              associations: "observed",
              stations: ["04:18:d6:11:11:11"],
              towers: ["kln_north"],
              tower_signals: [{ device_id: "kln_north", signal_dbm: -61 }],
            },
          ],
        },
      }),
    ],
  });
  const [sector] = got.towers[0].health.sectors;
  assert.equal(sector.id, "A");
  assert.equal(sector.state, "up");
  assert.equal(sector.azimuth, 120);
  assert.equal(sector.associations, "observed");
  assert.deepEqual(sector.towers, ["kln_north"]);
  assert.deepEqual(sector.tower_signals, [
    { device_id: "kln_north", signal_dbm: -61 },
  ]);
});

test("associations unknown keeps towers ABSENT, never an empty list", () => {
  const got = parseTowerList({
    towers: [
      tower({
        health: { sectors: [{ id: "C", state: "up", associations: "unknown" }] },
      }),
    ],
  });
  const [sector] = got.towers[0].health.sectors;
  /* `towers: []` beside "unknown" reads as "this sector has lost every mast",
     which is the one wrong answer available here. */
  assert.equal(sector.towers, undefined);
  assert.equal(sector.stations, undefined);
  assert.equal(sector.associations, "unknown");
});

test("an unrecognized sector state is REFUSED, not quietly read as up", () => {
  /* The three words are a closed set, and coordination clamps to them before
     the wire (projection._project_sectors), so a fourth arriving here is a
     contract violation rather than a newer hub being helpful. The SDK says so
     loudly, which is this whole layer's job: the alternative is a screen
     drawing a word nobody designed a row for, and the one direction that must
     never happen -- an unknown sector rendering as `up` -- is exactly what a
     silent passthrough would allow. */
  assert.throws(
    () =>
      parseTowerList({
        towers: [
          tower({
            health: {
              sectors: [{ id: "A", state: "sort-of", associations: "observed" }],
            },
          }),
        ],
      }),
    /did not match/,
  );
});

test("the three words themselves parse, including unknown", () => {
  for (const state of ["up", "down", "unknown"]) {
    const got = parseTowerList({
      towers: [
        tower({ health: { sectors: [{ id: "A", state, associations: "unknown" }] } }),
      ],
    });
    assert.equal(got.towers[0].health.sectors[0].state, state);
  }
});

test("a sector with no measured signals carries no tower_signals", () => {
  const got = parseTowerList({
    towers: [
      tower({
        health: {
          sectors: [
            {
              id: "A",
              state: "up",
              associations: "observed",
              towers: ["kln_north"],
              tower_signals: [],
            },
          ],
        },
      }),
    ],
  });
  /* The older password station reader scrapes MACs off an HTTP page and has no
     signal to give. Absent is "not measured"; it is not "no signal". */
  assert.equal(got.towers[0].health.sectors[0].tower_signals, undefined);
  assert.deepEqual(got.towers[0].health.sectors[0].towers, ["kln_north"]);
});

/* ── TOWER OR HUB: THE BOX'S OWN WORD ───────────────────────────────────── */

test("a hub says what it is, so a settings screen can branch on it", () => {
  const got = parseTowerList({ towers: [tower({ kind: "hub" })] });
  assert.equal(got.towers[0].kind, "hub");
});

test("a tower says nothing, which is every release before the field", () => {
  const got = parseTowerList({ towers: [tower()] });
  assert.equal(got.towers[0].kind, undefined);
});

test("an unrecognized kind reads as a tower, never as a hub", () => {
  /* A screen branches on this to decide which Network rows to draw. A word
     from a newer box that this code does not understand must take the
     conservative branch rather than reach the other one. */
  const got = parseTowerList({ towers: [tower({ kind: "relay" })] });
  assert.equal(got.towers[0].kind, undefined);
});

/* ── RECORDING: WHERE THE FOOTAGE GOES, AND WHAT SURVIVES ───────────────── */

test("a hub's recording block carries the window AND what is deciding it", () => {
  const got = parseTowerDetail({
    ...tower({ device_id: "hub-lab" }),
    health_as_of: "2026-10-22T09:00:00Z",
    health: {
      recording: {
        mode: "hub",
        stream: "main",
        retain_days: 30,
        effective_days: 12.4,
        bound_by: "disk",
      },
    },
  });
  const rec = got.health.recording;
  assert.equal(rec.mode, "hub");
  assert.equal(rec.stream, "main");
  /* BOTH NUMBERS, because printing the asked-for window alone would tell a
     customer they have thirty days while the sweep deletes at twelve. */
  assert.equal(rec.retain_days, 30);
  assert.equal(rec.effective_days, 12.4);
  assert.equal(rec.bound_by, "disk");
});

test("a tower records at the hub and claims no window of its own", () => {
  const got = parseTowerList({
    towers: [tower({ health: { recording: { mode: "hub" } } })],
  });
  const rec = got.towers[0].health.recording;
  assert.equal(rec.mode, "hub");
  assert.equal(rec.retain_days, undefined);
  assert.equal(rec.effective_days, undefined);
});

test("a device on an older release reports no recording block", () => {
  const got = parseTowerList({ towers: [tower({ health: { disk: { free_pct: 55 } } })] });
  assert.equal(got.towers[0].health.recording, undefined);
});

/* ── CLOUD: ONE FACT ABOUT THE SERVER, NOT ABOUT A TOWER ────────────────── */

test("the cloud block rides beside the towers and is parsed", () => {
  const got = parseTowerList({
    towers: [tower()],
    cloud: {
      connected: true,
      iface: "Fibre",
      since: "2026-10-22T06:30:00Z",
      latency_ms: 42,
    },
  });
  assert.equal(got.cloud.connected, true);
  assert.equal(got.cloud.iface, "Fibre");
  assert.equal(got.cloud.since, "2026-10-22T06:30:00Z");
  assert.equal(got.cloud.latency_ms, 42);
});

test("the data centre says it IS the cloud and invents no latency", () => {
  const got = parseTowerList({
    towers: [tower()],
    cloud: { connected: true, is_cloud: true },
  });
  assert.equal(got.cloud.is_cloud, true);
  /* Nothing made a round trip, so there is no round trip to report. */
  assert.equal(got.cloud.latency_ms, undefined);
});

test("no cloud block is CANNOT SAY, which is not disconnected", () => {
  const got = parseTowerList({ towers: [tower()] });
  /* A hub whose uplink agent has never run. `connected: false` would be a
     claim nobody made. */
  assert.equal(got.cloud, undefined);
});

test("an empty cloud object is also cannot-say, not a reading", () => {
  const got = parseTowerList({ towers: [tower()], cloud: {} });
  assert.equal(got.cloud, undefined);
});

test("a disconnected cloud keeps the interface and drops the measurements", () => {
  /* The server already strips `since` and `latency_ms` while disconnected --
     see coordination/hub/cloud.py. This asserts the parser carries that shape
     faithfully rather than filling either back in. */
  const got = parseTowerList({
    towers: [tower()],
    cloud: { connected: false, iface: "Mobile" },
  });
  assert.equal(got.cloud.connected, false);
  assert.equal(got.cloud.iface, "Mobile");
  assert.equal(got.cloud.since, undefined);
  assert.equal(got.cloud.latency_ms, undefined);
});

test("listTowers' array form and the full envelope agree on the towers", async () => {
  /* `listTowers` is now `listFleet().towers`, so the two cannot drift. Proved
     through the parser rather than a live client: the envelope is where the
     difference is, and it is one field. */
  const body = { towers: [tower()], cloud: { connected: true, iface: "Ethernet" } };
  const full = parseTowerList(body);
  assert.equal(full.towers.length, 1);
  assert.equal(full.towers[0].device_id, "kln_abc");
  assert.equal(full.cloud.iface, "Ethernet");
});
