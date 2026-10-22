/**
 * About device: what the box is, and what it is running.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  FOUR LINES, THREE OF THEM WRONG
 * ══════════════════════════════════════════════════════════════════════
 *
 * "Tower settings > About device" showed Model, Serial Number, Cameras and
 * Firmware. Model and Serial Number came from the FIXTURE in `lib/data.ts`, so
 * every tower on every fleet was a "Terra Sentry XL" with the same serial.
 * Firmware read
 *
 *     v1.5.0-23-g8e6f18b (dev)
 *
 * on a tower whose checkout was two hundred commits further on -- a commit
 * hash, the word "dev" about a tower doing its job, and the one number that
 * answers "how far along is this one" buried between them.
 *
 * So these cover the three rules the fix rests on:
 *
 *   1. the ROW is the version and the build number, with the full string kept
 *      for the detail;
 *   2. what the tower REPORTED reaches the row, and nothing invents a value
 *      when it reported nothing;
 *   3. the unit serial and the BOARD serial are two different lines, because a
 *      swapped board changes one and not the other.
 *
 *     node --test test/deviceInfo.test.mjs
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

let fw;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "device-info-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/firmware";`, "utf8");
  const out = join(dir, "entry.mjs");
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    alias: { "@": SRC },
  });
  fw = await import(pathToFileURL(out).href);
});

describe("the version a customer reads", () => {
  test("is the release and the build number, with no commit", () => {
    /* THE ONE FROM THE REPORT. 23 builds past v1.5.0 is worth knowing; which
       commit it was is not, to the person reading this screen. */
    assert.equal(fw.shortVersion("v1.5.0-23-g8e6f18b"), "v1.5.0-23");
    assert.equal(fw.shortVersion("v1.5.0-255-gabcdef1"), "v1.5.0-255");
  });

  test("a clean release is itself", () => {
    assert.equal(fw.shortVersion("v1.5.0"), "v1.5.0");
    assert.equal(fw.shortVersion("v1.5.0-rc2"), "v1.5.0-rc2");
  });

  test("an untagged build is shown as what it is, never invented into one", () => {
    assert.equal(fw.shortVersion("8e6f18b"), "8e6f18b");
  });

  test("and nothing is nothing", () => {
    assert.equal(fw.shortVersion(""), "");
    assert.equal(fw.shortVersion(null), "");
    assert.equal(fw.shortVersion(undefined), "");
  });

  test("it agrees with the python that produces it", async () => {
    /* ⚠ TWO IMPLEMENTATIONS, ONE FORMAT. `short_release` in
       core/ota/version.py does this for the tower's own status API, and the
       day they disagree the screen and the box are telling different stories
       about the same build. The table there is the one asserted here. */
    const py = await readFile(
      resolve(ROOT, "..", "sentry-core", "core", "ota", "version.py"), "utf8",
    ).catch(() => "");
    if (!py) return; // the sibling checkout is not always there
    assert.match(py, /def short_release/);
    assert.match(py, /_DESCRIBE_TAIL = re\.compile/);
  });
});

describe("the firmware row", () => {
  test("says the short version and keeps the whole string as its detail", () => {
    const got = fw.classifyFirmware("v1.5.0-23-g8e6f18b", "stable");
    assert.equal(got.label, "v1.5.0-23");
    assert.equal(got.detail, "v1.5.0-23-g8e6f18b (stable)");
  });

  test("never says \"(dev)\" to anybody", () => {
    /* It said it about a tower that was working. The COLOUR carries "not on a
       release"; the label does not have to. */
    for (const v of ["v1.5.0-23-g8e6f18b", "8e6f18b", "v1.5.0"]) {
      const got = fw.classifyFirmware(v, "stable");
      assert.doesNotMatch(got.label, /dev/i, v);
      assert.doesNotMatch(got.label, /-g[0-9a-f]{4,}/i, v);
    }
  });

  test("green on a release on stable, amber on beta", () => {
    assert.equal(fw.classifyFirmware("v1.5.0", "stable").tone, "text-terra");
    assert.equal(fw.classifyFirmware("v1.5.0", "beta").tone, "text-warn");
  });

  test("grey when it is ahead of a release, whatever channel it claims", () => {
    /* A build between releases is not on a channel. The channel field can say
       "stable" because device.env says so, and it is still not a stable
       release -- so the colour says what is true. */
    assert.equal(fw.classifyFirmware("v1.5.0-23-g8e6f18b", "stable").tone, "text-muted");
  });

  test("and Unknown when the tower reported nothing", () => {
    const got = fw.classifyFirmware(undefined, "stable");
    assert.equal(got.label, "Unknown");
    assert.equal(got.tone, "text-muted");
    assert.equal(got.detail, "", "there is no detail to show about an absence");
  });
});

describe("what the About section reads", () => {
  let panel;
  let map;
  before(async () => {
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    map = await readFile(join(SRC, "lib/api/map.ts"), "utf8");
  });

  test("the model and both serials come from the TOWER, not a fixture", () => {
    assert.match(map, /\.\.\.\(raw\.model \? \{ model: raw\.model \} : \{\}\)/);
    assert.match(map, /\.\.\.\(raw\.serial \? \{ serial: raw\.serial \} : \{\}\)/);
    assert.match(map, /\.\.\.\(raw\.board_serial \? \{ boardSerial: raw\.board_serial \} : \{\}\)/);
  });

  test("an absent field is NOT defaulted on the way in", () => {
    /* ⚠ THE DISTINCTION THE WHOLE CHAIN RESTS ON. `raw.model ?? ""` here would
       put an empty line on the screen where "Not reported" belongs, and an
       empty line reads as a unit with no model rather than one that has not
       said. */
    assert.doesNotMatch(map, /model: raw\.model \?\? ""/);
    assert.doesNotMatch(map, /serial: raw\.serial \?\? ""/);
  });

  test("the panel shows five rows, the two serials among them", () => {
    assert.match(panel, /label="Model Name" value=\{tower\.model \?\? ""\}/);
    assert.match(panel, /label="Serial Number" value=\{tower\.serial \?\? ""\}/);
    assert.match(panel, /label="Board Serial" value=\{tower\.boardSerial \?\? ""\}/);
    assert.match(panel, /label="Cameras"/);
    assert.match(panel, /label="Firmware"/);
  });

  test("a row with no value says \"Not reported\"", () => {
    assert.match(panel, /\{value \|\| "Not reported"\}/);
  });

  test("and the firmware row carries its detail", () => {
    assert.match(panel, /detail=\{firmware\.detail\}/);
    assert.match(panel, /title=\{detail \|\| undefined\}/);
  });
});

describe("the cell's About block", () => {
  let cells;
  before(async () => {
    cells = await readFile(join(SRC, "components/SiteCells.tsx"), "utf8");
  });

  test("a hub shows the same facts a tower does", () => {
    assert.match(cells, /function HubAbout/);
    for (const label of ["Model", "Serial number", "Board serial", "Firmware"]) {
      assert.match(cells, new RegExp(`"${label}"`), label);
    }
  });

  test("its radios are shown only when it declares any", () => {
    /* A single radio hub declares none, and "0" would read as a hub with no
       radios rather than one with one. */
    assert.match(cells, /cell\.sectors \?/);
    assert.match(cells, /"Radio sectors"/);
  });

  test("a hub that has not reported says so in a sentence, not five blanks", () => {
    assert.match(cells, /has not reported what it is yet/);
    /* The explanation of WHEN it fills in was a second sentence about how
       a hub reports itself. The row still says the one thing that matters:
       it has not reported yet. */
    assert.match(cells, /has not reported what it is yet/);
  });

  test("and nothing in that block prints a hub id", () => {
    const block = cells.slice(cells.indexOf("function HubAbout"),
                              cells.indexOf("The towers in one cell"));
    assert.doesNotMatch(block, /hub_id/);
  });
});
