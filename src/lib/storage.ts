/**
 * How much room a tower has left to record, as a status.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE TIER, TWO CALL SITES, SO THEY CANNOT DRIFT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The fleet board's Storage cell and the settings panel's Memory row are the
 * same fact in two places. They had two separate copies of the threshold, and a
 * threshold duplicated is a threshold that disagrees with itself the first time
 * one is tuned — the operator then sees amber on one screen and white on the
 * other for the identical tower.
 *
 * ── SUPERSEDED 2026-09-12: "AMBER AT 90% USED, AND NO INVENTED RED" ────
 *
 * Both sites previously warned at 90% used and deliberately went no further,
 * on the reasoning that a red tier nobody had specified would be invented
 * severity. That was the right instinct with no data behind it; there is data
 * now, and it argues the other way.
 *
 * A recordings disk is not a resource that merely gets tight — it is a ring
 * buffer with a deadline. Below 10% free, MediaMTX is deleting footage to make
 * room for footage, so the tower is LOSING EVIDENCE while every other reading
 * on the board says the site is healthy. That is a fault, and red is what this
 * app uses for a fault. Amber moves to 20% free to give an operator time to act
 * before that starts, rather than warning them as it begins.
 *
 * ── FREE, NOT USED ─────────────────────────────────────────────────────
 *
 * The tiers are expressed in free space because that is the protocol's field
 * (§3.1 `disk.free_pct`) and because it is the quantity that matters: "how much
 * longer can this tower keep recording" is answered by what is left, not by
 * what is gone.
 */

/** Below this much free space, the tower is overwriting footage. */
export const STORAGE_CRITICAL_FREE_PCT = 10;

/** Below this much free space, it will be soon. */
export const STORAGE_LOW_FREE_PCT = 20;

export type StorageTier = "ok" | "low" | "critical";

export function storageTier(freePct: number): StorageTier {
  if (freePct < STORAGE_CRITICAL_FREE_PCT) return "critical";
  if (freePct <= STORAGE_LOW_FREE_PCT) return "low";
  return "ok";
}

/**
 * The colour class for a free-space reading.
 *
 * Matches the uplink row's vocabulary — `text-terra` / `text-warn` /
 * `text-critical` — so a healthy storage cell reads the same green as a healthy
 * signal rather than inventing a fourth way to say "fine".
 */
export function storageTone(freePct: number): string {
  switch (storageTier(freePct)) {
    case "critical":
      return "text-critical";
    case "low":
      return "text-warn";
    default:
      return "text-terra";
  }
}

/**
 * The sentence behind the colour, for a hover or a row that has room for it.
 *
 * Says what is actually happening rather than restating the number: "12% free"
 * is on screen already, and what an operator needs to know is whether footage
 * is being lost right now.
 *
 * ⚠ PASS THE MEASURED VALUE, NOT A ROUNDED ONE. The tier is decided on what the
 * tower actually reported and the rounding happens here, for display only. A
 * caller that rounds first hands 9.6 in as 10 and gets the amber sentence under
 * a red colour — and worse, 9.6% free is a disk ALREADY overwriting footage
 * being described as one that will start soon. Rounding must never move a
 * reading across a tier boundary.
 */
export function storageHint(freePct: number, usedGb?: number, totalGb?: number): string {
  const size =
    usedGb !== undefined && totalGb !== undefined
      ? ` — ${usedGb} of ${totalGb} GB used`
      : "";
  const shown = Math.round(freePct);
  switch (storageTier(freePct)) {
    case "critical":
      return `${shown}% free${size}. The tower is overwriting older footage to keep recording.`;
    case "low":
      return `${shown}% free${size}. Older footage will start being overwritten soon.`;
    default:
      return `${shown}% free${size}.`;
  }
}
