/**
 * ONE ORDER FOR THE FLEET, read by both halves of the dashboard.
 *
 * ── WHAT WAS ON SCREEN ─────────────────────────────────────────────────
 *
 * The TOWERS list read Terra Factory Tower 2, West tower, Lab hub mast. The
 * ACTIVE CAMERAS wall beside it, showing the same sites, read Lab hub mast,
 * then West tower. Two panels, one fleet, two answers — and an operator
 * scanning the wall for the site they just read about in the list had to find
 * it by name every time. At three towers that is an irritation; at thirty it
 * is the whole reason the wall is banded by site in the first place.
 *
 * The orders diverged because they came from different places. The list
 * renders `towers` as the fleet answered. The wall rendered a SEPARATE flat
 * arrangement of feed ids, seeded from the fixtures and reconciled by
 * appending whatever was new to the end — so it accumulated the history of
 * every fleet this browser had ever read, and a tower that arrived late sat
 * last on the wall and third in the list for ever.
 *
 * ⚠ SO THE WALL DOES NOT HAVE AN ORDER OF ITS OWN ANY MORE. It has the
 * list's. Both panels call the functions below, which is the only way two
 * views of one fleet can be guaranteed never to disagree: not by keeping two
 * orders in step, which is a thing to maintain and therefore a thing to get
 * wrong, but by there being one.
 */

import type { CameraFeed, Tower } from "@/lib/types";

/**
 * The fleet, in the order every screen shows it.
 *
 * ⚠ IT RETURNS WHAT IT WAS GIVEN, AND THAT IS THE RULE, NOT A STUB. The fleet
 * arrives from `GET /v1/viewer/towers` already ordered and the list has always
 * rendered it as served — so "the order the list uses" is, today, the order
 * coordination sends. Encoding that as a function changes nothing on screen
 * and buys the one thing worth having: if the rule ever becomes alphabetical,
 * or worst-first, or an arrangement somebody saved, it changes HERE and both
 * panels change with it. A rule that lives in one panel is a rule the other
 * one is already free to break.
 *
 * The array itself is returned rather than a copy, so a caller's `useMemo` and
 * React's own reconciliation still see the identity they had.
 */
export function fleetOrder(towers: Tower[]): Tower[] {
  return towers;
}

/** One site's header over the row of its cameras. */
export interface WallBand {
  towerId: string;
  feeds: CameraFeed[];
}

/**
 * Lowest camera number first.
 *
 * The tower numbers its own cameras and that numbering is what an operator
 * says out loud, so it is the order they are drawn in. A camera with no index
 * sorts last rather than first: `sort` is stable, so an unnumbered pair keeps
 * the order the fleet listed them in instead of being shuffled against each
 * other.
 */
function byCameraNumber(a: CameraFeed, b: CameraFeed): number {
  return (a.index ?? Number.MAX_SAFE_INTEGER) - (b.index ?? Number.MAX_SAFE_INTEGER);
}

/**
 * The wall, banded by site, in the list's order.
 *
 * A tower with no cameras on the wall gets NO BAND — which is what already
 * happened and is kept deliberately. A site that has never sent an inventory
 * has nothing to show, and a band header over an empty row would be a heading
 * that promises a picture and delivers a gap. It is still in the list beside
 * the wall, with its status on its card, which is where the fact that it is
 * dark belongs.
 *
 * ⚠ A FEED WHOSE TOWER IS NOT IN THE LIST STILL GETS A BAND, at the end.
 * Nothing on the wire produces one — towers and feeds are mapped from the same
 * answer in the same loop — but the alternative is a camera silently vanishing
 * from a monitoring wall, and the band header already has a word for a tower
 * the fleet does not have.
 */
export function wallBands(towers: Tower[], feeds: CameraFeed[]): WallBand[] {
  const byTower = new Map<string, CameraFeed[]>();
  for (const feed of feeds) {
    const own = byTower.get(feed.towerId);
    if (own) own.push(feed);
    else byTower.set(feed.towerId, [feed]);
  }

  const bands: WallBand[] = [];
  for (const tower of fleetOrder(towers)) {
    const own = byTower.get(tower.id);
    if (!own) continue;
    byTower.delete(tower.id);
    bands.push({ towerId: tower.id, feeds: own.sort(byCameraNumber) });
  }
  for (const [towerId, own] of byTower) {
    bands.push({ towerId, feeds: own.sort(byCameraNumber) });
  }
  return bands;
}

/**
 * The same wall, flattened to feed ids.
 *
 * What this is for: the session cap is applied in WALL ORDER, so what an
 * operator sees first is what streams. That decision has to be made outside
 * the view that draws the wall, and it has to be made on the same order the
 * view will draw — a cap applied to a different arrangement drops the wrong
 * tiles, and nobody would be able to see why.
 */
export function wallOrder(towers: Tower[], feeds: CameraFeed[]): string[] {
  return wallBands(towers, feeds).flatMap((band) => band.feeds.map((f) => f.id));
}
