/**
 * Which site am I acting as?
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE QUESTION NOBODY COULD ANSWER
 * ══════════════════════════════════════════════════════════════════════
 *
 * A site user could not tell which site they were in. That sounds cosmetic
 * until you watch somebody use it: every share is BETWEEN two sites, so "who
 * is asking" and "whose cameras are these" are the two facts that make a
 * request mean anything, and one of them was never on screen. A person in two
 * sites had no way to say which one they were acting for at all.
 *
 * So the site is explicit, it is shown wherever it matters, and where there is
 * a choice it is a choice somebody makes rather than one the first element of
 * an array makes for them.
 *
 * ── WHO HAS A CHOICE ──────────────────────────────────────────────────
 *
 *   one site      no choice, and no picker: the label states it
 *   several       a picker, remembered per account
 *   an ADMIN      every site in the organization, because an admin is in none
 *                 of them by membership and acts on their behalf. Their choice
 *                 starts EMPTY on purpose: "on behalf of" is a deliberate act
 *                 and defaulting to whichever site sorted first is how an
 *                 administrator sends a request they did not mean to send.
 *   no site       nothing to act as, and nothing to share
 *
 * ── WHY IT IS REMEMBERED, AND WHERE ───────────────────────────────────
 *
 * `localStorage`, keyed by account id. Keyed, because two people using one
 * browser must not inherit each other's choice; `localStorage` rather than the
 * server, because this is a preference about a screen and not a fact about the
 * organization. A storage that throws (private mode, locked-down browser) is
 * caught: the choice is then per-session, which costs one click.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isAdminRole, type Site } from "@kallon/sentry-sdk";
import { useSession } from "@/components/AuthProvider";
import { useSites } from "@/lib/useSites";

const KEY = (accountId: string) => `kallon.actingSite.${accountId}`;

function remembered(accountId: string | undefined): string {
  if (!accountId) return "";
  try {
    return window.localStorage.getItem(KEY(accountId)) ?? "";
  } catch {
    return "";
  }
}

function remember(accountId: string | undefined, siteId: string): void {
  if (!accountId) return;
  try {
    window.localStorage.setItem(KEY(accountId), siteId);
  } catch {
    /* A browser that will not remember is not a browser that should fail. */
  }
}

export interface ActingSite {
  /** The site this person is acting as, or null when they have not chosen. */
  readonly site: Site | null;
  /** Every site they could act as. One entry means there is no choice. */
  readonly candidates: readonly Site[];
  /** True when a choice is outstanding and something is waiting on it. */
  readonly mustChoose: boolean;
  readonly isAdmin: boolean;
  readonly loading: boolean;
  readonly choose: (siteId: string) => void;
  /**
   * The sites this person may share WITH, given who they are acting as.
   *
   * ⚠ NEVER INCLUDES THE ACTING SITE. A site cannot share with itself, and
   * the server refuses it -- but it appeared in its own "share with" list,
   * which is how somebody found out. The list is built here, once, so no form
   * can assemble a different one.
   */
  readonly others: readonly Site[];
  /** The ones worth ASKING: an empty site has nothing to lend. */
  readonly othersToAsk: readonly Site[];
}

export function useActingSite(): ActingSite {
  const { account } = useSession();
  const sites = useSites();
  const isAdmin = isAdminRole(account?.role);
  const [chosen, setChosen] = useState<string>(() => remembered(account?.account_id));

  const candidates = useMemo<readonly Site[]>(
    () => sites.value?.sites ?? [],
    [sites.value],
  );

  /* A SITE USER WITH ONE SITE HAS NO CHOICE TO MAKE, so it is settled for
     them rather than asked. An admin's is never settled automatically: see
     the note above. */
  useEffect(() => {
    if (isAdmin) return;
    if (chosen && candidates.some((s) => s.site_id === chosen)) return;
    if (candidates.length >= 1) {
      const first = candidates[0]!.site_id;
      setChosen(first);
      remember(account?.account_id, first);
    }
  }, [isAdmin, chosen, candidates, account?.account_id]);

  const choose = useCallback(
    (siteId: string) => {
      setChosen(siteId);
      remember(account?.account_id, siteId);
    },
    [account?.account_id],
  );

  const site = useMemo(
    () => candidates.find((s) => s.site_id === chosen) ?? null,
    [candidates, chosen],
  );

  const others = useMemo<readonly Site[]>(() => {
    /* The directory the server sends is every site in the organization this
       account is NOT in, by name and id only. An admin is in every site, so
       theirs is empty and their list is `candidates` instead -- which is the
       same statement from the other end. */
    const directory = (sites.value?.others ?? []).map((o) => ({
      site_id: o.site_id,
      name: o.name,
      status: "active" as const,
      created_at: "",
      /* ⚠ THE DIRECTORY CARRIES NO HUBS, deliberately: a site knows another
         site's NAME and nothing else. `has_cameras` is the one bit the server
         does say, and it is kept here so `othersToAsk` can use it. */
      hubs: [] as readonly string[],
      has_cameras: o.has_cameras,
    }));
    const all = isAdmin ? [...candidates] : [...candidates, ...directory];
    return all.filter((s) => s.site_id !== (site?.site_id ?? chosen));
  }, [sites.value, candidates, isAdmin, site, chosen]);

  /**
   * The sites worth ASKING, which is not the same list as the ones worth
   * OFFERING to.
   *
   * ⚠ A SITE WITH NO CAMERAS IS NOT SOMEBODY TO ASK. Asking one used to be
   * possible: the request was created, the owner opened it, the picker said
   * "This site has no towers to lend yet", and the only way out was a refusal
   * written for a programmer. An OFFER to such a site is perfectly sensible --
   * you are giving them yours -- so only this list is narrowed.
   *
   * `has_cameras` absent means an older server that does not say, and the site
   * stays: offering one that turns out to be empty is better than hiding them
   * all. The server refuses it either way, in words.
   */
  const othersToAsk = useMemo<readonly Site[]>(
    () => others.filter((s) => (s as { has_cameras?: boolean }).has_cameras !== false),
    [others],
  );

  return {
    site,
    candidates,
    mustChoose: candidates.length > 1 && site === null,
    isAdmin,
    loading: sites.loading && candidates.length === 0,
    choose,
    others,
    othersToAsk,
  };
}
