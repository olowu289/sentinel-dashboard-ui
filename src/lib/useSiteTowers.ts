/**
 * The towers of one of MY sites, ready to be picked from.
 *
 * ── WHY TWO REQUESTS AND NOT ONE ──────────────────────────────────────
 *
 * `GET /v1/sites/{id}` knows which masts belong to a site, by id, and nothing
 * about them: it is the site model, and a site contains hubs which contain
 * towers. The fleet (`GET /v1/viewer/towers`) knows their labels and how many
 * cameras each is reporting, and nothing about sites.
 *
 * Neither is wrong to be missing the other half -- a site is an organizational
 * fact and the fleet is an operational one -- so the picker joins them. The
 * site answers WHICH, the fleet answers WHAT IT IS CALLED.
 *
 * ⚠ A TOWER MISSING FROM THE FLEET IS STILL OFFERED. An offline mast is
 * still that site's mast, and lending it while it is down is a perfectly
 * ordinary thing to do before somebody drives out to restart it. It is listed
 * by its device id with no camera list, which the picker renders as "all
 * cameras" -- the honest answer when nobody is reporting what it has.
 */

import { useEffect, useState } from "react";
import { said } from "@/lib/said";
import { getSite } from "@/lib/api/sites";
import { listFleet } from "@/lib/api/fleet";
import type { PickableTower } from "@/components/sharing/ShareControls";

export interface SiteTowers {
  readonly towers: readonly PickableTower[];
  readonly loading: boolean;
  readonly error: string | null;
}

export function useSiteTowers(siteId: string | null | undefined): SiteTowers {
  const [state, setState] = useState<SiteTowers>({
    towers: [],
    loading: Boolean(siteId),
    error: null,
  });

  useEffect(() => {
    if (!siteId) {
      setState({ towers: [], loading: false, error: null });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, loading: true, error: null }));

    Promise.all([getSite(siteId), listFleet().catch(() => null)])
      .then(([detail, fleet]) => {
        if (!live) return;
        const ids = detail.cells.flatMap((c) => c.towers);
        const labels = new Map<string, string>();
        const cameras = new Map<string, number[]>();
        for (const t of fleet?.towers ?? []) labels.set(t.id, t.site || t.id);
        for (const f of fleet?.feeds ?? []) {
          if (f.index === undefined) continue;
          const list = cameras.get(f.towerId) ?? [];
          if (!list.includes(f.index)) list.push(f.index);
          cameras.set(f.towerId, list);
        }
        setState({
          towers: ids.map((id) => ({
            deviceId: id,
            label: labels.get(id) ?? id,
            cameras: (cameras.get(id) ?? []).sort((a, b) => a - b),
          })),
          loading: false,
          error: null,
        });
      })
      .catch((err) => {
        if (!live) return;
        /* An empty list and a failed load are different statements, and the
           picker says which. Offering an empty tower list for a failed fetch
           would tell somebody their site has no cameras. */
        setState({
          towers: [],
          loading: false,
          error: said(err, "Could not load this site's towers. Try again."),
        });
      });
    return () => {
      live = false;
    };
  }, [siteId]);

  return state;
}
