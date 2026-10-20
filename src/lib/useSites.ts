/**
 * The hooks the sites screens read. One place that knows how to load, fail and
 * reload, so no screen invents its own three states.
 *
 * ── WHY A HOOK PER RESOURCE AND NOT ONE STORE ──────────────────────────
 *
 * These screens are reached deliberately and left: an admin opens People,
 * changes somebody, and goes back to the wall. Nothing on the camera wall reads
 * them, and nothing ticks. A store would make them global state that has to be
 * invalidated from six places; a hook with an explicit `reload` makes the
 * invalidation visible at the call site that caused it.
 *
 * ── THREE STATES, ALWAYS, AND ABSENCE IS DIAGNOSTIC ────────────────────
 *
 * `loading`, `error` and the value, never a value that silently means "not
 * loaded yet". The product's rule (CLAUDE.md: "Absence is diagnostic") applies
 * to a failed fetch too: a screen that renders an empty list for a 403 is
 * telling the operator there is nothing there, which is a different and worse
 * statement than "we could not ask".
 */

import { useCallback, useEffect, useState } from "react";
import type {
  AuditResponse,
  Capabilities,
  CellDetailResponse,
  CellListResponse,
  PeopleListResponse,
  ShareListResponse,
  SiteListResponse,
} from "@kallon/sentry-sdk";
import {
  adminAudit,
  adminListPeople,
  adminListShares,
  capabilities,
  getCell,
  listCells,
  listShares,
  listSites,
  NO_SITES,
} from "@/lib/api/sites";

export interface Loaded<T> {
  readonly value: T | null;
  readonly loading: boolean;
  /** A sentence to show the operator, or null. Never an exception object. */
  readonly error: string | null;
  readonly reload: () => void;
}

/** What to say about a failure, in words an operator can act on. */
function describe(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string };
  if (e?.status === 403 || e?.code === "forbidden") {
    return "This account may not see that.";
  }
  if (e?.status === 404) {
    return "That is not available on this server.";
  }
  if (e?.status === 401 || e?.code === "unauthorized") {
    return "Your session has expired. Sign in again.";
  }
  if (e?.code === "network_error" || e?.status === 0) {
    return "Could not reach coordination. Check the connection and try again.";
  }
  return e?.message || "Something went wrong loading this.";
}

function useLoader<T>(load: () => Promise<T>, enabled = true): Loaded<T> {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    setError(null);
    load()
      .then((v) => {
        if (!live) return;
        setValue(v);
        setLoading(false);
      })
      .catch((err) => {
        if (!live) return;
        // THE VALUE IS LEFT ALONE on a failed reload. A list that empties
        // itself because a refresh failed reads as "everything was deleted".
        setError(describe(err));
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // `load` is a fresh closure each render by design; `tick` is the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { value, loading, error, reload };
}

/**
 * What this server is. Resolves to `sites: false` on a hub and on any failure.
 *
 * Starts as `null` rather than as a hub, and callers must treat `null` as "not
 * yet known": rendering the hub answer while the probe is in flight makes the
 * Administration item flicker into existence a moment after login, which looks
 * like a bug even though it is only a race.
 */
export function useCapabilities(): Capabilities | null {
  const [caps, setCaps] = useState<Capabilities | null>(null);
  useEffect(() => {
    let live = true;
    capabilities()
      .then((c) => live && setCaps(c))
      .catch(() => live && setCaps(NO_SITES));
    return () => {
      live = false;
    };
  }, []);
  return caps;
}

export function useSites(enabled = true): Loaded<SiteListResponse> {
  return useLoader(listSites, enabled);
}

export function useShares(enabled = true): Loaded<ShareListResponse> {
  return useLoader(listShares, enabled);
}

/**
 * The cells this account may see, NAMED.
 *
 * Not `useSites().value.sites[].hubs`, which is a list of hub IDS. A cell has a
 * name somebody chose, a tower count and a ceiling, and the only place those
 * exist is this route — a screen that drew `hub_kaduna_01` where a person had
 * written "North Camp" is the screen this whole change exists to replace.
 *
 * Available to a SITE USER as well as an admin, because a site user may add a
 * tower to their own cells and has to be able to choose one.
 */
export function useCells(enabled = true): Loaded<CellListResponse> {
  return useLoader(listCells, enabled);
}

/**
 * One cell and the towers in it.
 *
 * `hubId` null means nothing is open, and then nothing is fetched: a detail
 * hook that loaded on every render of a closed panel is a request per keystroke
 * somewhere else on the page.
 */
export function useCell(hubId: string | null): Loaded<CellDetailResponse> {
  const load = useCallback(() => getCell(hubId ?? ""), [hubId]);
  return useLoader(load, Boolean(hubId));
}

export function useAdminShares(enabled = true): Loaded<ShareListResponse> {
  return useLoader(adminListShares, enabled);
}

export function usePeople(enabled = true): Loaded<PeopleListResponse> {
  return useLoader(adminListPeople, enabled);
}

export function useAudit(
  filter: { action?: string; limit?: number },
  enabled = true,
): Loaded<AuditResponse> {
  const load = useCallback(
    () => adminAudit({ ...filter, limit: filter.limit ?? 100 }),
    // the filter is a fresh object each render; its contents are the identity
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filter.action, filter.limit],
  );
  return useLoader(load, enabled);
}
