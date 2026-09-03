import { useEffect, useState } from "react";
import { siteNow } from "@/lib/time";

/**
 * A clock that ticks, for the things whose correctness depends on the passage
 * of time rather than on a user action.
 *
 * The alert date filters are the reason this exists. "Last 1 hour" compared
 * against a timestamp captured when the module loaded, so on a wall left open
 * for a shift the range silently drifted away from the truth. Making `now` a
 * function fixed the value; this is what makes the SCREEN follow it, because a
 * filter only recomputes when its component renders.
 *
 * ── WHY 30 SECONDS, AND WHY IT LIVES IN THE FEED ───────────────────────
 *
 * The coarsest range this drives is a day and the finest is an hour, so a
 * 30-second granularity is far more than the ranges can resolve — the boundary
 * is never visibly wrong. A one-second tick would be thirty times the renders
 * for no readable difference.
 *
 * And it is called INSIDE the alerts feed rather than in a parent, on the same
 * reasoning `SiteClock` is its own component: a tick in `TowerView` would push
 * a re-render through the tile tree twice a minute, and the tiles gate motion's
 * layout measurement on a key that would not have changed — which is the
 * documented way this app makes a takeover snap instead of animate.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => siteNow());

  useEffect(() => {
    const t = setInterval(() => setNow(siteNow()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return now;
}
