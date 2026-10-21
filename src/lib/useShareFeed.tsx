/**
 * Every share, once, for the cards AND the page.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS A PROVIDER AND NOT A HOOK PER SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * The brief's hardest requirement is one sentence: "Cards and page must always
 * agree: answering in one updates the other at once." Two components each
 * holding their own copy of the share list cannot do that -- they can only
 * approach it, by polling fast enough that the window of disagreement is
 * short. One list, in one place, that both read, does it by construction.
 *
 * So this owns the list, the poll, and every mutation. A card's Accept and the
 * Sharing page's Accept are the same function; the list updates once and both
 * re-render.
 *
 * ── THE POLL, AND WHY IT IS ALLOWED TO EXIST ──────────────────────────
 *
 * Everything else in this product refuses to poll: the sweep poll runs only
 * while a sweep runs, the zoom readout only while the lens moves, and the PTZ
 * control block rides replies rather than asking. Those are per TILE and reach
 * a tower over a metered uplink.
 *
 * This is ONE request to coordination for the whole account, and the thing it
 * is watching for arrives from another person at another site, so there is
 * nothing to ride on. Twenty seconds is slow enough to cost nothing and fast
 * enough that a request feels like it arrived rather than was found.
 *
 * ── WHAT TURNS A CHANGE INTO A CARD ───────────────────────────────────
 *
 * The diff between two polls, and nothing else. A share that is newly pending
 * and incoming raises a persistent card; one that stops being pending takes
 * that card away and, if it was MINE, puts up a short statement of what
 * happened to it. State changes nobody started a conversation about (an
 * expiry) say so once and go.
 *
 * ⚠ THE FIRST POLL RAISES NOTHING. Signing in with four pending requests
 * from last week must not throw four cards over the video. They are in the
 * Sharing page, where somebody went looking for them. The stack is for things
 * that happen WHILE you are watching.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Share, ShareScopeEntry } from "@kallon/sentry-sdk";
import { isShareLive } from "@kallon/sentry-sdk";
import { borrowedFrom } from "@/lib/shareRules";
import {
  type NewShareRequest,
  acceptShare,
  createShare,
  declineShare,
  extendShare,
  listShares,
  revokeShare,
} from "@/lib/api/sites";

export const POLL_MS = 20_000;

/** What a caller needs to answer a share. Mirrors the server's accept body. */
export interface AcceptChoices {
  scope?: readonly ShareScopeEntry[];
  live?: boolean;
  ptz?: boolean;
  playback?: boolean;
  playbackFrom?: string;
  playbackTo?: string;
  durationSec?: number;
}

/**
 * What starting a share takes.
 *
 * ⚠ ONE DEFINITION, IN THE SDK. This restated the shape, and so did
 * `lib/api/sites.ts`: three copies of a thing that is a CONTRACT, which is the
 * one kind of thing that must not be copied. When the SDK learned that a
 * request carries no scope and that an administrator names both sites, the
 * copies went on describing one permissive object and nothing failed to
 * compile.
 */
export type NewShare = NewShareRequest;

interface Feed {
  readonly shares: readonly Share[];
  readonly loading: boolean;
  /** A sentence for a person, or null. Never an exception. */
  readonly error: string | null;
  readonly reload: () => Promise<void>;
  /**
   * Everything waiting for MY answer, as the SERVER sees it.
   *
   * ⚠ NOT "pending and incoming". `incoming` means one of my sites owns the
   * cameras, which is true for an admin of every share in the organization,
   * and true of the side that SENT an offer. Both of those got an Accept
   * button they should never have had.
   */
  readonly awaitingMe: readonly Share[];
  /** Pending, and not mine to answer: I asked, or somebody else decides. */
  readonly awaitingThem: readonly Share[];
  /** In force right now, both directions. */
  readonly active: readonly Share[];
  /** Finished: declined, revoked, expired. */
  readonly finished: readonly Share[];
  readonly create: (req: NewShare) => Promise<Share>;
  readonly accept: (shareId: string, choices: AcceptChoices) => Promise<Share>;
  readonly decline: (shareId: string) => Promise<Share>;
  readonly revoke: (shareId: string) => Promise<Share>;
  readonly extend: (shareId: string, durationSec: number) => Promise<Share>;
  /**
   * Fires whenever the list changes shape, with the previous list. The
   * notification layer subscribes to this; nothing else should.
   */
  readonly subscribe: (fn: Listener) => () => void;
}

export type Listener = (next: readonly Share[], prev: readonly Share[]) => void;

const FeedContext = createContext<Feed | null>(null);

function describe(err: unknown): string {
  const e = err as { code?: string; status?: number; message?: string };
  if (e?.status === 403) return "This is not yours to answer.";
  if (e?.status === 404) return "That share is no longer there.";
  if (e?.status === 409) return "Somebody answered that already.";
  if (e?.status === 422) return e.message || "That was not accepted.";
  if (e?.code === "network_error" || e?.status === 0) {
    return "Could not reach coordination. Check the connection.";
  }
  return e?.message || "Something went wrong.";
}

export function ShareFeedProvider({
  enabled = true,
  children,
}: {
  /** False on a hub, where there are no shares and nothing to ask for. */
  enabled?: boolean;
  children: ReactNode;
}) {
  const [shares, setShares] = useState<readonly Share[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const listeners = useRef(new Set<Listener>());
  const previous = useRef<readonly Share[]>([]);

  const publish = useCallback((next: readonly Share[]) => {
    const prev = previous.current;
    previous.current = next;
    setShares(next);
    for (const fn of listeners.current) fn(next, prev);
  }, []);

  const reload = useCallback(async () => {
    if (!enabled) return;
    try {
      const out = await listShares();
      publish(out.shares);
      setError(null);
    } catch (err) {
      /* THE LIST IS LEFT ALONE on a failed refresh. A list that empties itself
         because one poll failed reads as "every share was revoked", which is
         a far more alarming thing to say than "could not reach". */
      setError(describe(err));
    } finally {
      setLoading(false);
    }
  }, [enabled, publish]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    let live = true;
    const tick = () => {
      if (live) void reload();
    };
    tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [enabled, reload]);

  /* Every mutation reloads before it returns, so the caller's `await` is also
     the moment the other screen is right. The server is the source of truth
     for what a share became -- an accept can narrow what was asked for, and
     guessing locally would show the asker a share they did not get. */
  const after = useCallback(
    async <T,>(work: Promise<T>): Promise<T> => {
      const out = await work;
      await reload();
      return out;
    },
    [reload],
  );

  const value = useMemo<Feed>(() => {
    const live = shares.filter((s) => isShareLive(s));
    return {
      shares,
      loading,
      error,
      reload,
      awaitingMe: shares.filter((s) => s.status === "pending" && s.can_answer),
      awaitingThem: shares.filter((s) => s.status === "pending" && !s.can_answer),
      active: live,
      finished: shares.filter((s) => s.status !== "pending" && !isShareLive(s)),
      create: (req) => after(createShare(req)),
      accept: (id, choices) => after(acceptShare(id, choices)),
      decline: (id) => after(declineShare(id)),
      revoke: (id) => after(revokeShare(id)),
      extend: (id, sec) => after(extendShare(id, sec)),
      subscribe: (fn) => {
        listeners.current.add(fn);
        return () => listeners.current.delete(fn);
      },
    };
  }, [shares, loading, error, reload, after]);

  return <FeedContext.Provider value={value}>{children}</FeedContext.Provider>;
}

const EMPTY: Feed = {
  shares: [],
  loading: false,
  error: null,
  reload: async () => {},
  awaitingMe: [],
  awaitingThem: [],
  active: [],
  finished: [],
  create: async () => {
    throw new Error("no share feed");
  },
  accept: async () => {
    throw new Error("no share feed");
  },
  decline: async () => {
    throw new Error("no share feed");
  },
  revoke: async () => {
    throw new Error("no share feed");
  },
  extend: async () => {
    throw new Error("no share feed");
  },
  subscribe: () => () => {},
};

/**
 * The shares, from anywhere inside the provider.
 *
 * Outside one -- the screenshot harness, a hub build where sharing does not
 * exist -- this is an empty feed rather than a crash, for the same reason
 * `useNotifications` is.
 */
export function useShareFeed(): Feed {
  return useContext(FeedContext) ?? EMPTY;
}

/** True when this share is one of my own site's cameras being lent out. */
export function isMine(share: Share): boolean {
  return share.incoming === true;
}

/* The naming and scope rules live in `lib/shareRules`, with no component or
   hook around them. Re-exported here because this is where screens reach for
   them, and one import beats two. */
export { otherSiteName, scopeSummary } from "@/lib/shareRules";

/**
 * The live share that is lending me THIS camera, if any.
 *
 * ⚠ ONLY SHARES COMING TO ME. A camera my own site owns is not borrowed
 * however many other sites are watching it, and badging it as somebody else's
 * because I lent it out would be exactly backwards.
 *
 * A scope entry with no `cameras` covers the whole mast, which is what makes
 * "lend this tower" mean the camera added to it next week as well.
 */
export function useBorrowedShare(
  deviceId: string | undefined,
  camera: number | undefined,
): Share | null {
  const { active } = useShareFeed();
  return borrowedFrom(active, deviceId, camera);
}
