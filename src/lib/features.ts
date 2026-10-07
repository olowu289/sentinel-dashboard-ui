/**
 * What this account may see. The SERVER decides; this file only reads.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════
 *
 * This app ships screens nothing is behind, and says so in its own source. The
 * alert feed loads six FIXTURE alerts on every account, naming towers no account
 * owns — `App.tsx` calls it out in a block headed "FIXTURE ALERTS, ON EVERY
 * FLEET — NOT REAL DETECTIONS" and finishes "Nothing here is a detection
 * anything saw." The watchlist, face matching, the per-camera detection tuning,
 * the siren and the evidence export are local state with nothing behind them.
 *
 * That was a knowing choice while we were the only account. With a paying
 * customer signed in it is a monitoring product showing somebody an event that
 * never happened, on a site they are responsible for — which is the fake-green
 * failure the whole integration exists to refuse.
 *
 * So coordination returns the enabled list on the login response and on
 * `GET /v1/account`, and this app renders only what is in it.
 *
 * ── THIS IS NOT THE ACCESS CONTROL ─────────────────────────────────────
 *
 * Hiding a button hides a button. Every route that matters is gated on the
 * SERVER too (see the camera-rename route, which answers 404 for an account
 * without `settings`). This file exists so the customer is not shown a product
 * that lies to them — not to keep anybody out. Treating it as a security
 * boundary is how a client-side check becomes the only check.
 *
 * ── THE FALLBACK IS RESTRICTIVE, DELIBERATELY ──────────────────────────
 *
 * No list (an old server, a failed fetch, a session from before this shipped)
 * means `DEFAULT_FEATURES` — the five that are really backed. Not "everything":
 * a missing list must not be the thing that shows a customer the demo. The cost
 * of being wrong in this direction is a feature we have to turn on; the cost of
 * the other direction is the bug this file exists to prevent.
 */

import type { AuthAccount } from "./api/auth";

/** Every feature name the server knows. Mirrors `registry/features.py` ALL. */
export const FEATURES = [
  "live",
  "playback",
  "ptz",
  "towers",
  "settings",
  "add_tower",
  "alerts",
  "watchlist",
  "face_match",
  "detections",
  "camera_tuning",
  "siren",
  "simulator",
  "clip_export",
] as const;

export type Feature = (typeof FEATURES)[number];

/**
 * What to assume when the server told us nothing.
 *
 * Mirrors `registry/features.py` DEFAULT_ON: the subset that is actually backed
 * end to end. Duplicated across two languages with no shared schema, so it can
 * drift — and the drift is safe in the direction that matters. If the server
 * loosens, this is merely fussier than it needs to be. If the server tightens,
 * the server still refuses the request; the only cost is a visible control that
 * fails, which is noisy rather than dangerous.
 */
export const DEFAULT_FEATURES: readonly Feature[] = [
  "live",
  "playback",
  "ptz",
  "towers",
  "settings",
];

/**
 * The enabled set for an account, as a Set for O(1) checks.
 *
 * ⚠ UNKNOWN NAMES ARE DROPPED. A server newer than this bundle may send a
 * feature this build has no code for, and carrying it through would mean asking
 * the UI to render something it cannot. Dropping it is the honest reading: this
 * client does not have that feature, whatever the server thinks.
 */
export function featureSet(account: AuthAccount | null): ReadonlySet<Feature> {
  const raw = (account as { features?: unknown } | null)?.features;
  if (!Array.isArray(raw)) {
    /* No list at all. See the header: restrictive, not permissive. */
    return new Set(DEFAULT_FEATURES);
  }
  const known = new Set<Feature>();
  for (const name of raw) {
    if (typeof name === "string" && (FEATURES as readonly string[]).includes(name)) {
      known.add(name as Feature);
    }
  }
  /* An EMPTY array is a real answer — "this account may see nothing" — and is
     honoured rather than replaced by the defaults. Only a MISSING or malformed
     list falls back, because that is the case where we were told nothing at
     all. Collapsing the two would make a deliberately stripped account
     indistinguishable from an old server. */
  return known;
}

/** Does this set allow `feature`? */
export function can(
  features: ReadonlySet<Feature>,
  feature: Feature,
): boolean {
  return features.has(feature);
}

/**
 * Every rail destination, and the feature it needs.
 *
 * THE RAIL AND THE ROUTER READ THE SAME MAP. `IconRail` dims what is not
 * allowed and `App.tsx`'s `navigate` refuses it — both from here, so an item
 * cannot be visible and unreachable, or hidden and reachable. The two halves
 * drifting apart is exactly what the rail's own note warns about ("clear
 * `unavailable` in NAV and add the branch — both, or the item lights up and
 * still goes nowhere").
 *
 * `dashboard` has no entry: it is the wall, it is live video, and an account
 * that cannot see live video has no dashboard to go to. It is gated on `live`
 * at the one place it is reached instead.
 */
export const NAV_FEATURE: Partial<Record<string, Feature>> = {
  add: "add_tower",
  towers: "towers",
  poi: "watchlist",
  alerts: "alerts",
  playback: "playback",
  settings: "settings",
  dashboard: "live",
};

/**
 * Can this rail destination be opened?
 *
 * A destination with no feature in the map is always allowed — the map is a
 * list of things that CAN be restricted, not a whitelist of everything that
 * exists, so adding a rail item does not silently make it unreachable.
 */
export function navAllowed(
  features: ReadonlySet<Feature>,
  id: string,
): boolean {
  const needed = NAV_FEATURE[id];
  return needed === undefined || features.has(needed);
}
