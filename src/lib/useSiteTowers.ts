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
 * with no camera list, which the picker renders as "all cameras" -- the honest
 * answer when nobody is reporting what it has.
 *
 * ── AND WHY THE CELLS ARE ASKED AS WELL ──────────────────────────────
 *
 * Such a tower used to be labelled with its DEVICE ID, which is the one thing
 * this product promises never to put in front of anybody.
 * `GET /v1/cells/{hub_id}` names every tower its hub has reported, online or
 * not, so the name comes from there when the fleet is silent; only a tower
 * that neither list can name falls back to a word. Both name sources are
 * tolerant: losing one costs a label, not the picker.
 */

import { useEffect, useState } from "react";
import { said } from "@/lib/said";
import { getCell, getSite } from "@/lib/api/sites";
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

    getSite(siteId)
      .then(async (detail) => {
        /* The site's own cells are asked for their towers BY NAME. One request
           per cell, and a site has a handful; each is tolerant, because a cell
           that will not answer should cost that cell's labels and nothing
           else. */
        const [fleet, ...cells] = await Promise.all([
          listFleet().catch(() => null),
          ...detail.cells.map((c) => getCell(c.hub_id).catch(() => null)),
        ]);
        return { detail, fleet, cells };
      })
      .then(({ detail, fleet, cells }) => {
        if (!live) return;
        const ids = detail.cells.flatMap((c) => c.towers);
        const labels = new Map<string, string>();
        const cameras = new Map<string, number[]>();
        /* The cells first, the fleet over the top: both name the same tower,
           and the fleet's is the one a viewer sees on the wall. */
        for (const cell of cells) {
          for (const t of cell?.towers ?? []) {
            if (t.name && t.name !== t.device_id) labels.set(t.device_id, t.name);
          }
        }
        for (const t of fleet?.towers ?? []) {
          if (t.site) labels.set(t.id, t.site);
        }
        for (const f of fleet?.feeds ?? []) {
          if (f.index === undefined) continue;
          const list = cameras.get(f.towerId) ?? [];
          if (!list.includes(f.index)) list.push(f.index);
          cameras.set(f.towerId, list);
        }
        setState({
          towers: ids.map((id) => ({
            deviceId: id,
            /* NEVER THE ID. A tower nothing can name is "an unnamed tower":
               less useful than a name and more useful than a serial, and the
               cure is to give it a name on the Sites page. */
            label: labels.get(id) ?? "An unnamed tower",
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
