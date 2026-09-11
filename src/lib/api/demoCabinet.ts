import type { Tower } from "@/lib/types";

/**
 * ══════════════════════════════════════════════════════════════════════
 *  ⚠⚠  DEMO CABINET READINGS — NOT REAL TELEMETRY.  DELETE BEFORE DEPLOY.  ⚠⚠
 * ══════════════════════════════════════════════════════════════════════
 *
 * Battery, solar array state, cabinet temperature, uplink QUALITY and storage
 * are fabricated here and attached to real towers.
 *
 * None of them exist in coordination's §A.3 projection. They are not withheld,
 * not unimplemented, not coming later — the contract has no field for any of
 * them. A tower reports `device_id`, `label`, `link`, `as_of`, `cameras`,
 * `sensors` and a health block of door · cover · impact · thermal · disk, and
 * that is the whole of it.
 *
 * ── WHY THIS EXISTS ANYWAY ─────────────────────────────────────────────
 *
 * A deliberate, owner-approved departure from this app's honest-absence rule,
 * taken so the populated UI can be seen during development. The default
 * behaviour — and what `map.ts` still does — is to leave these absent, and
 * every read site already renders that absence properly: no battery cell on the
 * mast, `NO CABINET READINGS` in the hover panel, `Not reported` in the
 * settings rows. Turning this module off restores all of it.
 *
 * ── WHAT MUST HAPPEN BEFORE THIS SHIPS ─────────────────────────────────
 *
 * One of, and it is not optional:
 *
 *   1. The readings become REAL — the protocol grows them and `map.ts` maps
 *      them, at which point this file is deleted; or
 *   2. They are MARKED ON SCREEN as demo values, so nobody can read a
 *      fabricated 87% as their site's actual charge; or
 *   3. This module is switched off and the honest-absence states show.
 *
 * Shipping as-is is the fake-green failure this whole integration exists to
 * refuse, in the one place an operator would never think to doubt it: a number
 * on a card, in the right font, next to real data. An off-grid site's charge is
 * the reading a dispatch decision gets made on.
 *
 * `docs/integration/README.md` carries the same note. This is the code half.
 */

/**
 * The single switch — OFF, taking option 3 above.
 *
 * Honest absence shows on every real tower: no cell on the mast, NO CABINET
 * READINGS in the hover panel, "Not reported" in the settings rows, no battery
 * in the tower bar. A seeded fleet is unaffected — its fixtures carry their own
 * readings and never pass through here — so demos keep their populated screens.
 *
 * Switched off 2026-09-11, when the towers board made these fields a column an
 * operator scans the whole fleet by. Turn it back on for a development
 * screenshot at most, never for anything an operator will see.
 */
export const DEMO_CABINET_READINGS = false;

/**
 * Deterministic per tower, so a card does not reshuffle its own readings on
 * every fetch. A stable lie is at least a consistent one; a jittering one would
 * also look like live telemetry, which is worse.
 */
function seedOf(deviceId: string): number {
  let h = 2166136261;
  for (let i = 0; i < deviceId.length; i++) {
    h ^= deviceId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0xffffffff;
}

/**
 * Attach demo cabinet readings to a real tower.
 *
 * Only fills what is ABSENT — it never overwrites something the projection
 * actually carried, so if any of these fields ever become real the real value
 * wins without this file having to be edited first.
 */
export function withDemoCabinetReadings(tower: Tower): Tower {
  if (!DEMO_CABINET_READINGS) return tower;

  const r = seedOf(tower.id);
  const battery = Math.round(38 + r * 57); // 38–95
  const temp = Math.round(29 + r * 16); // 29–45
  const usedGb = Math.round(20 + r * 90);

  return {
    ...tower,
    solar: tower.solar ?? (r > 0.75 ? "idle" : "charging"),
    batteryPct: tower.batteryPct ?? battery,
    tempC: tower.tempC ?? temp,
    location: tower.location ?? "Lokogoma, Abuja GMT +1",
    model: tower.model ?? "Terra Sentry XL",
    backupConnection: tower.backupConnection ?? "Satellite",
    serial: tower.serial ?? `SN-${tower.id.replace(/\D/g, "").slice(-4) || "0000"}-D`,
    storageUsedGb: tower.storageUsedGb ?? usedGb,
    storageTotalGb: tower.storageTotalGb ?? 128,
  };
}
