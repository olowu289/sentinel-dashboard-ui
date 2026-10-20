/**
 * The Sector column, and the one rule it exists to keep: a letter only when the
 * hub observed the association.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS NOT JUST A TYPE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Which sector radio a mast is on used to be a value a technician typed into
 * the tower's `device.env` (`TOWER_SECTOR`). It is now OBSERVED: all three of a
 * hub's sector radios carry one SSID on different channels, a mast associates
 * with whichever it hears best and re-associates by itself, and the hub reads
 * the answer out of its own radios' station lists.
 *
 * So there are now four distinct ways for the answer to be "nobody knows":
 *
 *   * the hub declares no sectors at all (every hub built before this);
 *   * nobody has given the hub the radios' credentials, which is the default;
 *   * a radio would not answer, or this mast's own radio has not answered ARP;
 *   * the mast is mid-roam and two sectors both claim it.
 *
 * Every one of them arrives as an ABSENT `health.radio.sector`, and the failure
 * this file guards against is any of them rendering as a letter. A mast shown
 * confidently on sector A when it is actually on C sends a technician up the
 * wrong mast, in the dark, on a site that may be hours from a road -- which is
 * worse than a board that says "Roaming".
 *
 * The second half asserts the board's own bookkeeping: the grid has to declare
 * one track per column, and Tailwind generates class names by scanning source
 * text, so the count cannot be computed. A column added without touching the
 * grid silently falls off the right-hand edge.
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

let m;

before(async () => {
  const dir = await mkdtemp(join(tmpdir(), "sector-test-"));
  const entry = join(dir, "entry.ts");
  await writeFile(entry, `export * from "@/lib/api/map";`, "utf8");
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
  m = await import(pathToFileURL(out).href);
});

describe("sectorReading", () => {
  test("an observed association is the ONLY thing that yields a letter", () => {
    assert.deepEqual(m.sectorReading({ associated: true, sector: "B" }),
      { kind: "on", sector: "B" });
  });

  test("a lower case letter from a radio is still that sector", () => {
    /* The probe lower cases MACs and upper cases ids, but this value crosses
       two scripts and a projection. Normalising here means the column never
       shows "Sector b" next to "Sector A". */
    assert.deepEqual(m.sectorReading({ associated: true, sector: "c" }),
      { kind: "on", sector: "C" });
    assert.deepEqual(m.sectorReading({ associated: true, sector: " a " }),
      { kind: "on", sector: "A" });
  });

  test("a radio link with no sector is UNOBSERVED, not sector A", () => {
    /* The default state of every hub: sector radios declared or not, nobody has
       put credentials in /etc/kallon/radio.env. */
    assert.deepEqual(m.sectorReading({ associated: true }), { kind: "unobserved" });
    assert.deepEqual(m.sectorReading({ associated: false }), { kind: "unobserved" });
  });

  test("no radio block at all is a different answer again", () => {
    /* A wired mast, or a tower on WireGuard rather than the hub's radios.
       "There is no sector to be on" is not "we could not tell". */
    assert.deepEqual(m.sectorReading(undefined), { kind: "none" });
  });

  test("anything that is not a single letter is refused", () => {
    /* Whatever came off the radio reaches this through two shell scripts and a
       projection. A board that prints an arbitrary string as a sector is a
       board that prints whatever a radio felt like saying. */
    for (const bad of ["", "  ", "AB", "1", "-", "sector A", "A1"]) {
      assert.deepEqual(m.sectorReading({ associated: true, sector: bad }),
        { kind: "unobserved" }, `accepted ${JSON.stringify(bad)}`);
    }
  });
});

describe("the health mapping keeps the absences", () => {
  /* `toHealth` is not exported, so this goes through `toTower`, which is how
     the app gets there too. */
  const raw = (health) => ({
    device_id: "kln_north", label: "North Gate", link: "up", cameras: [], health,
  });

  test("the observed sector crosses", () => {
    const { tower } = m.toTower(raw({ radio: { associated: true, sector: "B" } }));
    assert.equal(tower.health.radio.sector, "B");
    assert.equal(tower.health.radio.associated, true);
  });

  test("an absent sector does not become a letter or an empty string", () => {
    const { tower } = m.toTower(raw({ radio: { associated: true } }));
    assert.equal("sector" in tower.health.radio, false);
  });

  test("the hub's sectors cross, and `unknown` keeps NO tower list", () => {
    /* THE DISTINCTION THIS WHOLE CHANGE RESTS ON. `towers: []` under
       `associations: "unknown"` reads as "this radio has lost its masts". The
       server omits the list; the mapping must not put it back. */
    const { tower } = m.toTower(raw({
      sectors: [
        { id: "A", state: "up", associations: "observed",
          towers: ["kln_north"], stations: ["04:18:d6:11:11:11"] },
        { id: "B", state: "up", associations: "observed", towers: [], stations: [] },
        { id: "C", state: "down", associations: "unknown",
          towers: ["kln_ghost"], stations: ["de:ad:be:ef:00:01"] },
      ],
    }));
    const by = Object.fromEntries(tower.health.sectors.map((s) => [s.id, s]));
    assert.deepEqual(by.A.towers, ["kln_north"]);
    /* An EMPTY list under `observed` is a real answer: a radio with no masts. */
    assert.deepEqual(by.B.towers, []);
    /* And under `unknown` the lists are dropped even though the server sent
       them, because the word says they mean nothing. */
    assert.equal(by.C.associations, "unknown");
    assert.equal("towers" in by.C, false);
    assert.equal("stations" in by.C, false);
  });

  test("a sector block with no `associations` word reads as unknown", () => {
    /* An older probe, or a hand written file. Saying nothing about whether the
       list was observed is not permission to present it. */
    const { tower } = m.toTower(raw({
      sectors: [{ id: "A", state: "up", towers: ["kln_north"] }],
    }));
    assert.equal(tower.health.sectors[0].associations, "unknown");
    assert.equal("towers" in tower.health.sectors[0], false);
  });

  test("an empty sectors array projects nothing, like a single radio hub", () => {
    const { tower } = m.toTower(raw({ sectors: [] }));
    assert.equal(tower.health === undefined || tower.health.sectors === undefined, true);
  });
});

describe("the board's grid declares one track per column", () => {
  let src;
  before(async () => {
    src = await readFile(join(ROOT, "src/components/TowersView.tsx"), "utf8");
  });

  test("the repeat count matches the number of reading columns", () => {
    /* Tailwind generates class names by scanning source text, so the count has
       to be a literal -- which means it can drift from COLUMNS, and a column
       past the end of the grid falls off the right edge of the board. */
    const cols = src.match(/^const COLUMNS = \[$([\s\S]*?)^\] as const;$/m);
    assert.ok(cols, "could not find the COLUMNS list");
    const count = (cols[1].match(/^\s+\[".*?",\s*".*?"\],$/gm) || []).length;
    assert.ok(count > 0, "parsed no columns");
    const grid = src.match(/repeat\((\d+),minmax\(96px,1fr\)\)/);
    assert.ok(grid, "could not find the grid's repeat()");
    assert.equal(Number(grid[1]), count,
      `the grid declares ${grid[1]} reading tracks for ${count} columns`);
  });

  test("Sector is one of them, and it sits next to Uplink", () => {
    /* Reading order: connectivity first, because everything else rides on it.
       Which radio a mast is on belongs beside how well it is hearing it. */
    const ids = [...src.matchAll(/^\s+\["(\w+)",\s*"[^"]*"\],$/gm)].map((x) => x[1]);
    const uplink = ids.indexOf("uplink");
    assert.notEqual(uplink, -1);
    assert.equal(ids[uplink + 1], "sector");
  });

  test("the cell never colours a sector letter", () => {
    /* A sector is not a status. Being on B is neither better nor worse than
       being on A, and a tone would make the board look as though something had
       happened to a mast that is working perfectly. */
    const fn = src.match(/function sectorCell\([\s\S]*?\n}/);
    assert.ok(fn, "sectorCell is gone");
    const onBranch = fn[0].slice(fn[0].indexOf('case "on"'), fn[0].indexOf('case "unobserved"'));
    assert.doesNotMatch(onBranch, /tone:/,
      "the observed branch sets a tone; a sector letter is not a status");
  });
});
