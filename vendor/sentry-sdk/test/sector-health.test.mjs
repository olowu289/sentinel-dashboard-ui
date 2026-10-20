/**
 * The sector a mast is on, and the hub's own radios, in the health contract.
 *
 * WHY THESE ARE TESTS AND NOT JUST TYPES. `RadioHealth` and `SectorHealth` are
 * interfaces, so nothing at runtime enforces them -- and the two distinctions
 * they exist to carry are exactly the kind that a consumer collapses by
 * accident:
 *
 *   * `associations: "unknown"` is NOT "this radio has no towers". Under
 *     `"unknown"` the tower list is ABSENT, so a consumer that reads
 *     `towers ?? []` and prints "no masts on sector B" is wrong, and a
 *     consumer that checks `associations` first is right. The declaration file
 *     has to make `towers` optional for that to even be expressible.
 *   * `radio.sector` is OBSERVED. A mast with no letter has no letter because
 *     nobody could say, which includes a mast mid-roam, and the field must be
 *     optional rather than a string that is sometimes "".
 *
 * So this asserts the SHAPE OF THE SHIPPED DECLARATIONS: that the two
 * interfaces are exported from the built types, that `TowerHealth` carries
 * them, and that the fields which must be optional are optional and the two
 * that must not be are not. A `.d.ts` is what every consumer compiles against;
 * if it loses `associations` nothing else in this repo notices.
 *
 *   npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const types = readFileSync(join(root, "dist/types/models.d.ts"), "utf8");

/** The body of one `export interface X { ... }` from the declaration file. */
function iface(name) {
  const start = types.indexOf(`interface ${name} {`);
  assert.notEqual(start, -1, `${name} is not in the shipped declarations`);
  const open = types.indexOf("{", start);
  const close = types.indexOf("\n}", open);
  assert.ok(close > open, `${name} has no closing brace`);
  return types.slice(open, close);
}

test("RadioHealth ships, and its sector is optional", () => {
  const body = iface("RadioHealth");
  /* The one field always present when the hub knows the tower at all. */
  assert.match(body, /\n\s+associated: boolean;/);
  /* OPTIONAL, because "no letter" is the answer for a single radio hub, an
     unconfigured station reader, a silent radio, and a mast mid-roam. A
     required `sector: string` would force every one of those to be "". */
  assert.match(body, /\n\s+sector\?: string;/);
  assert.match(body, /\n\s+state\?: "up" \| "degraded" \| "down";/);
  assert.match(body, /\n\s+quality\?: number;/);
});

test("SectorHealth ships, with state and associations REQUIRED", () => {
  const body = iface("SectorHealth");
  assert.match(body, /\n\s+id: string;/);
  /* Required, and the three words only. `unknown` is a real answer and is
     never rendered as up. */
  assert.match(body, /\n\s+state: "up" \| "down" \| "unknown";/);
  /* REQUIRED, and this is the whole point: a consumer cannot read the tower
     list without having been handed the word that says whether it means
     anything. */
  assert.match(body, /\n\s+associations: "observed" \| "unknown";/);
});

test("towers and stations are OPTIONAL, so absent is expressible", () => {
  const body = iface("SectorHealth");
  /* Under `associations: "unknown"` the server omits both. If these were
     required, the only way to satisfy the type would be `[]` -- which reads as
     "this radio has no masts", the one wrong answer available here. */
  assert.match(body, /\n\s+towers\?: string\[\];/);
  assert.match(body, /\n\s+stations\?: string\[\];/);
});

test("TowerHealth carries both, optionally", () => {
  const body = iface("TowerHealth");
  /* Optional: `radio` is absent on a WireGuard tower and whenever the hub
     knows nothing, and `sectors` is absent on every single radio hub, which is
     every hub built before sectors existed. */
  assert.match(body, /\n\s+radio\?: RadioHealth;/);
  assert.match(body, /\n\s+sectors\?: SectorHealth\[\];/);
  /* And nothing that was there before has gone. */
  for (const key of ["door", "cover", "impact", "thermal", "disk", "feeds",
                     "uplink", "battery"]) {
    assert.match(body, new RegExp(`\\n\\s+${key}\\?:`), `${key} left TowerHealth`);
  }
});

test("both are re-exported from the package root", () => {
  /* A type in models.ts that index.ts does not re-export is a type no consumer
     can name, which has happened in this package before. */
  const index = readFileSync(join(root, "dist/types/index.d.ts"), "utf8");
  const reachable = /export \* from ["']\.\/models(\.js)?["']/.test(index)
    || /RadioHealth/.test(index);
  assert.ok(reachable, "models is not re-exported from index");
});
