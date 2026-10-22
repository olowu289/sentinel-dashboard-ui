/**
 * Tower settings with real data: every row REAL, read-only, or absent.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON THAT PANEL
 * ══════════════════════════════════════════════════════════════════════
 *
 * Eighteen rows, and they came from three different places that looked
 * identical on screen:
 *
 *   REAL      the tower's name, Night Vision, Stream Quality, Home Position,
 *             Sharing, the disk percentage, the battery
 *   FIXTURE   "Backup Connection · Satellite" on every tower in every fleet,
 *             from `demoCabinet.ts`
 *   NOTHING   "Recording Settings · 4K HD" on cameras that serve 2560x1440;
 *             "On Detection / Continuous"; "7 / 30 / 90 days";
 *             "Performance / Balanced / Battery saver" -- four drop-downs
 *             writing to `CameraSettings`, which is this browser's own local
 *             state. No server read any of them. An investigator who needed
 *             three months of footage picked "90 days", watched the chevron
 *             close, and changed nothing at all.
 *
 * The retention one is the reason this round exists: it is a silent promise
 * about evidence. So these tests hold the three rules the fix rests on:
 *
 *   1. a GRADE IS NEVER PRODUCED WITHOUT A NUMBER. Every path with no
 *      measurement -- no SNMP community on the site, a radio that would not
 *      answer, a reading outside plausible RF -- must reach the row as an
 *      absence, because a substituted 0 dBm grades as the best link in the
 *      fleet;
 *   2. what the device REPORTED reaches the row, through the mapper, including
 *      the three blocks the SDK used to drop;
 *   3. the strings that were fixtures are GONE from the source, and the rows
 *      that cannot be changed say who holds them.
 *
 *     node --test test/settingsRealData.test.mjs
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { before, describe, test } from "node:test";
import { build } from "esbuild";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

let radio;
let map;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "settings-real-"));
  const entry = join(dir, "entry.ts");
  await writeFile(
    entry,
    `export * as radio from "@/lib/radio";\nexport * as map from "@/lib/api/map";\n`,
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
  radio = mod.radio;
  map = mod.map;
});

/* ── 1. THE GRADE, AND THE THRESHOLDS IT TURNS ON ──────────────────────── */

describe("Radio link: the word for a number", () => {
  test("better than -65 dBm is Good", () => {
    assert.equal(radio.radioGrade(-40).word, "Good");
    assert.equal(radio.radioGrade(-64).word, "Good");
  });

  test("-65 to -75 is Fair, at both ends", () => {
    /* The boundaries are the point: an installer reading -65 and an installer
       reading -75 must get the same word as each other every time, and the
       same word this file says they get. */
    assert.equal(radio.radioGrade(-65).word, "Fair");
    assert.equal(radio.radioGrade(-70).word, "Fair");
    assert.equal(radio.radioGrade(-75).word, "Fair");
  });

  test("worse than -75 is Weak", () => {
    assert.equal(radio.radioGrade(-76).word, "Weak");
    assert.equal(radio.radioGrade(-90).word, "Weak");
  });

  test("each word takes its own colour, and Good is the only green", () => {
    assert.equal(radio.radioGrade(-50).tone, "text-terra");
    assert.equal(radio.radioGrade(-70).tone, "text-warn");
    assert.equal(radio.radioGrade(-80).tone, "text-critical");
  });

  test("the thresholds are exported, so nothing re-states them", () => {
    assert.equal(radio.GOOD_ABOVE_DBM, -65);
    assert.equal(radio.WEAK_BELOW_DBM, -75);
  });
});

describe("the fabric's link state, in plain words", () => {
  test("up says nothing, because the signal beside it already did", () => {
    assert.equal(radio.radioStateNote("up"), null);
  });

  test("degraded and down are the two that change what somebody does", () => {
    assert.equal(radio.radioStateNote("degraded"), "link unsteady");
    assert.equal(radio.radioStateNote("down"), "link down");
  });

  test("an unknown state is silence, not a guess", () => {
    assert.equal(radio.radioStateNote(undefined), null);
    assert.equal(radio.radioStateNote("flapping"), null);
  });
});

/* ── 2. WHAT THE DEVICE REPORTED, THROUGH THE MAPPER ───────────────────── */

/** The §A.3 required set, so each case states only what it is about. */
function projected(extra = {}) {
  return {
    device_id: "kln_north_000001",
    label: "North Gate",
    link: "up",
    as_of: "2026-10-22T09:00:00Z",
    cameras: [],
    sensors: [],
    ...extra,
  };
}

describe("the radio signal reaches the row", () => {
  test("a measured signal crosses with the end that measured it", () => {
    const { tower } = map.toTower(
      projected({
        health: {
          radio: { associated: true, state: "up", sector: "B", signal_dbm: -62, signal_from: "tower" },
        },
      }),
    );
    assert.equal(tower.health.radio.signalDbm, -62);
    assert.equal(tower.health.radio.signalFrom, "tower");
    assert.equal(tower.health.radio.sector, "B");
  });

  test("an UNMEASURED radio has no number at all", () => {
    /* A site with no SNMP community configured. The row prints "Connected ·
       not measured"; a 0 here would print "Good · 0 dBm". */
    const { tower } = map.toTower(
      projected({ health: { radio: { associated: true, sector: "A" } } }),
    );
    assert.equal(tower.health.radio.signalDbm, undefined);
    assert.equal(tower.health.radio.signalFrom, undefined);
    assert.equal(tower.health.radio.associated, true);
  });

  test("no radio block is no radio link, not an unassociated one", () => {
    const { tower } = map.toTower(projected({ health: { disk: { free_pct: 42 } } }));
    assert.equal(tower.health.radio, undefined);
  });
});

describe("a hub's sectors, and the per-mast signals", () => {
  test("the signals cross, keyed by device id", () => {
    const { tower } = map.toTower(
      projected({
        kind: "hub",
        health: {
          sectors: [
            {
              id: "A",
              state: "up",
              associations: "observed",
              towers: ["kln_north_000001"],
              tower_signals: [{ device_id: "kln_north_000001", signal_dbm: -61 }],
            },
          ],
        },
      }),
    );
    assert.deepEqual(tower.health.sectors[0].towerSignals, [
      { deviceId: "kln_north_000001", signalDbm: -61 },
    ]);
  });

  test("an unmeasured sector carries no signal list", () => {
    /* The older password station reader scrapes MACs off an HTTP page. Absent
       is "not measured"; a mast in `towers` with no entry is associated and
       unmeasured, which the row prints as such. */
    const { tower } = map.toTower(
      projected({
        kind: "hub",
        health: {
          sectors: [
            { id: "A", state: "up", associations: "observed", towers: ["kln_a"] },
          ],
        },
      }),
    );
    assert.equal(tower.health.sectors[0].towerSignals, undefined);
    assert.deepEqual(tower.health.sectors[0].towers, ["kln_a"]);
  });

  test("associations unknown keeps the tower list ABSENT", () => {
    const { tower } = map.toTower(
      projected({
        kind: "hub",
        health: { sectors: [{ id: "C", state: "up", associations: "unknown", towers: ["x"] }] },
      }),
    );
    /* The server omits it; the mapper must not put it back. `[]` beside
       "unknown" reads as "this sector has lost every mast it had". */
    assert.equal(tower.health.sectors[0].towers, undefined);
    assert.equal(tower.health.sectors[0].associations, "unknown");
  });
});

describe("tower or hub: the box's own word", () => {
  test("a hub says so, and the settings screen can branch on it", () => {
    const { tower } = map.toTower(projected({ kind: "hub" }));
    assert.equal(tower.kind, "hub");
  });

  test("a tower says nothing, which is every release before the field", () => {
    const { tower } = map.toTower(projected());
    assert.equal(tower.kind, undefined);
  });

  test("a single-radio hub is still a hub, with no sectors to infer from", () => {
    /* THE WHOLE REASON THE FIELD EXISTS. Inferring hub-ness from
       `health.sectors` draws this box with a tower's Network rows: a radio
       link to a hub it IS, and no uplink row at all. */
    const { tower } = map.toTower(projected({ kind: "hub", health: { disk: { free_pct: 60 } } }));
    assert.equal(tower.kind, "hub");
    assert.equal(tower.health.sectors, undefined);
  });
});

describe("where the footage goes, and what survives", () => {
  test("a hub's window crosses with what is actually deciding it", () => {
    const { tower } = map.toTower(
      projected({
        kind: "hub",
        health: {
          recording: {
            mode: "hub",
            stream: "main",
            retain_days: 30,
            effective_days: 12.4,
            bound_by: "disk",
          },
        },
      }),
    );
    const rec = tower.health.recording;
    assert.equal(rec.mode, "hub");
    assert.equal(rec.stream, "main");
    /* BOTH NUMBERS. Printing `retainDays` alone tells a customer they have
       thirty days of evidence while the sweep deletes at twelve. */
    assert.equal(rec.retainDays, 30);
    assert.equal(rec.effectiveDays, 12.4);
    assert.equal(rec.boundBy, "disk");
  });

  test("a mast records at the hub and claims no window of its own", () => {
    const { tower } = map.toTower(
      projected({ health: { recording: { mode: "hub" } } }),
    );
    assert.equal(tower.health.recording.mode, "hub");
    assert.equal(tower.health.recording.retainDays, undefined);
  });

  test("a device on an older release reports no recording block", () => {
    const { tower } = map.toTower(projected({ health: { disk: { free_pct: 55 } } }));
    assert.equal(tower.health.recording, undefined);
  });
});

/* ── 3. THE FIXTURES ARE GONE FROM THE SOURCE ──────────────────────────── */

describe("the panel's own source: no fixture rows left", () => {
  let panel;
  /* Every string the panel puts on screen: the right-hand side of a `value`,
     `label`, `detail` or `note`. The file's own comments are not on screen and
     are deliberately not searched -- a comment that names the fixture it
     removed is the record of why the row changed. */
  let rendered;
  before(async () => {
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    rendered = panel.match(/(?:value|label|detail|note)=(?:"[^"]*"|\{`[^`]*`\})/g) ?? [];
  });

  test('"Backup Connection" is not rendered anywhere', () => {
    /* It read "Satellite" on every tower in every fleet, from
       `demoCabinet.ts`, and nothing measured it. Replaced by Kallon Cloud,
       which is a real measurement from the hub's own uplink agent. */
    assert.ok(!/label="Backup Connection"/.test(panel));
    assert.ok(!/tower\.backupConnection/.test(panel));
  });

  test('"4K HD" is gone, on cameras that serve 2560x1440', () => {
    /* Checked against the strings the panel RENDERS, not the file: the comment
       explaining why the row was removed names the old label, and should. 4K
       is not a resolution any of this hardware produces. */
    assert.ok(!rendered.some((one) => /4K HD/.test(one)));
    /* The option table itself is gone, so nothing can put it back by passing
       it to a `Choices`. */
    assert.ok(!/options=\{RECORDING_QUALITY\}/.test(panel));
  });

  test("the three drop-downs that wrote to nothing are gone", () => {
    /* `RECORDING`, `RETENTION` and `POWER` were option tables over
       `CameraSettings`, which no server reads. Each is now a reading. */
    assert.ok(!/options=\{RECORDING\}/.test(panel));
    assert.ok(!/options=\{RETENTION\}/.test(panel));
    assert.ok(!/options=\{POWER\}/.test(panel));
    assert.ok(!/onChange\(\{ retentionDays/.test(panel));
    assert.ok(!/onChange\(\{ powerMode/.test(panel));
    assert.ok(!/onChange\(\{ recordingQuality/.test(panel));
    assert.ok(!/onChange\(\{ recording:/.test(panel));
  });

  test('the rows a customer cannot change say "Set by Kallon"', () => {
    /* Three of them: recording mode, the retention window, working mode. A
       reading where a control used to be reads as a thing that has stopped
       working unless the row says who holds it. */
    const notes = panel.match(/note="Set by Kallon"/g) ?? [];
    assert.ok(notes.length >= 3, `expected 3 or more, found ${notes.length}`);
  });

  test('the words "Recorded at the hub" exist for a mast with no SSD', () => {
    assert.match(panel, /Recorded at the hub/);
  });

  test("the recording row claims no capture mode nobody reports", () => {
    /* ⚠ THE FOURTH FIXTURE THAT ALMOST GOT WRITTEN. `health.recording` carries
       WHERE the footage goes and WHICH stream. There is no continuous/on-
       detection fact on the wire, so the row must not print one beside two
       real ones. */
    assert.ok(!rendered.some((one) => /Continuous|On Detection/.test(one)));
    assert.ok(!/`Continuous/.test(panel));
  });

  test('"DC" is never a word on a customer screen', () => {
    /* ⚠ THE DATA CENTRE IS OUR WORD FOR OUR OWN MACHINE. A customer is being
       told whether their site can be seen from outside, and that service is
       called Kallon Cloud. This looks for the abbreviation as a standalone
       word inside the strings this panel renders. */
    for (const one of rendered) {
      assert.ok(!/\bDC\b/.test(one), `"DC" reaches a customer in: ${one}`);
    }
    assert.match(panel, /Kallon Cloud/);
  });

  test("the Network group draws a hub and a tower differently", () => {
    /* Two boxes, two networks. A tower has a radio link to its hub and reaches
       the cloud through it; a hub has an uplink of its own and sectors masts
       associate with. */
    assert.match(panel, /isHub \?/);
    assert.match(panel, /<RadioLinkRow/);
    assert.match(panel, /<SectorRows/);
    assert.match(panel, /<CloudRow/);
    assert.match(panel, /label="Internet"/);
  });

});

describe("the demo cabinet stays off", () => {
  test("DEMO_CABINET_READINGS is false", async () => {
    const src = await readFile(join(SRC, "lib/api/demoCabinet.ts"), "utf8");
    assert.match(src, /export const DEMO_CABINET_READINGS = false;/);
  });
});
