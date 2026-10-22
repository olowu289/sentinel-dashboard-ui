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
import { SUPPORT_HINT, said } from "@/lib/said";
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

/**
 * What to say about a failure, in words an operator can act on.
 *
 * ⚠ THIS USED TO END IN `return e?.message || ...`, AND THAT IS HOW
 * "people list from /v1/admin/people is not the documented shape" reached a
 * customer. The message came from our own client library, so it was written
 * for us: an API path and the word "documented", on the People screen, while
 * the person it was about had in fact been created.
 *
 * Every loader now says WHAT did not load and what to do next, and the error
 * itself goes through the one place that decides whether a server sentence is
 * fit to show (`lib/said.ts`), which also puts the technical detail in the
 * console under a reference.
 */
function describe(err: unknown, what: string): string {
  const e = err as { code?: string; status?: number };
  if (e?.status === 403 || e?.code === "forbidden") {
    return `This account may not see ${what}.`;
  }
  if (e?.status === 404) {
    return `${capitalise(what)} is not available on this server.`;
  }
  return said(
    err,
    `We could not load ${what}. Refresh the page; ${SUPPORT_HINT}.`,
  );
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * `what` names what is being loaded, for the sentence shown if it fails.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  `key` IS WHAT MAKES A FILTERED LOADER RELOAD, AND IT WAS MISSING
 * ══════════════════════════════════════════════════════════════════════
 *
 * The effect below depends on `enabled`, `tick` and `what` -- deliberately not
 * on `load`, which is a fresh closure on every render and would re-fetch
 * forever. The cost of that was invisible for the loaders that take no
 * argument and total for the two that do:
 *
 *   * the AUDIT LOG. Pressing a group chip, choosing a person or setting a
 *     date built a new filter, which built a new `load`, which nothing
 *     watched. The rows never changed. Every filter on that page was dead on
 *     the real site, which is how it was reported.
 *   * ONE CELL. Opening cell A and then cell B kept A's towers on screen: the
 *     hub id changed, `enabled` stayed true, and the effect never re-ran.
 *
 * So a loader whose request depends on something passes that something as
 * `key`, a string, and the effect watches it. A loader with no argument passes
 * nothing and behaves exactly as before. The dependency is a VALUE, not a
 * function, which is the one shape that cannot loop.
 */
function useLoader<T>(load: () => Promise<T>, what: string,
                      enabled = true, key = ""): Loaded<T> {
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
        setError(describe(err, what));
        setLoading(false);
      });
    return () => {
      live = false;
    };
    // `load` is a fresh closure each render by design; `key` is what its
    // request depends on, and `tick` is the reload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, tick, what, key]);

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
  return useLoader(listSites, "the site list", enabled);
}

export function useShares(enabled = true): Loaded<ShareListResponse> {
  return useLoader(listShares, "your shares", enabled);
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
  return useLoader(listCells, "the cells", enabled);
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
  /* ⚠ THE HUB ID IS THE KEY. Without it, opening a second cell while a first
     one was open showed the first one's towers: `enabled` was already true,
     so nothing re-ran. */
  return useLoader(load, "this cell", Boolean(hubId), hubId ?? "");
}

export function useAdminShares(enabled = true): Loaded<ShareListResponse> {
  return useLoader(adminListShares, "the shares in this organization", enabled);
}

export function usePeople(enabled = true): Loaded<PeopleListResponse> {
  return useLoader(adminListPeople, "the people list", enabled);
}

export function useAudit(
  filter: {
    action?: string;
    limit?: number;
    /** The four readable groups. A SERVER filter: see `AuditResponse.names`. */
    groups?: readonly string[];
    /** One person, by account id. The page shows their NAME. */
    accountId?: string;
    since?: string;
    until?: string;
  },
  enabled = true,
): Loaded<AuditResponse> {
  /* ⚠ THE FILTER IS THE KEY, AS A STRING.
     Every field that changes what is fetched is in it, in a fixed order, so
     two renders that ask for the same thing produce the same key and a change
     to any one of them produces a different one. Memoising `load` on the same
     contents is not enough on its own -- `useLoader` cannot watch a function
     -- and that is precisely why the group chips, the person and the dates did
     nothing on the real site. */
  const key = [
    filter.action ?? "",
    String(filter.limit ?? 100),
    (filter.groups ?? []).join("+"),
    filter.accountId ?? "",
    filter.since ?? "",
    filter.until ?? "",
  ].join("|");
  const load = useCallback(
    () => adminAudit({ ...filter, limit: filter.limit ?? 100 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return useLoader(load, "the activity log", enabled, key);
}
