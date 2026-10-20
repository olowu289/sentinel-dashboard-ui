/**
 * Notifications: floating cards over the video, and the history of them.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE RULE THIS EXISTS FOR: NOBODY LEAVES THE FEED
 * ══════════════════════════════════════════════════════════════════════
 *
 * A share request used to arrive as a banner across the top of the app, which
 * pushed the wall down and sent whoever answered it to another screen. An
 * operator watching a gate does not want to stop watching the gate to answer a
 * question about the gate. So: cards in a corner, over the video, with their
 * controls inside them, and the feed never stops playing.
 *
 * ── BUILT ONCE, FOR EVERY TYPE THAT COMES ─────────────────────────────
 *
 * Share requests are the first kind and deliberately not the only shape this
 * can hold. A door sensor, a detection, a tower going offline: each will want
 * its own colour and its own two or three controls, and none of them should
 * need a second stack, a second set of animations or a second idea of what
 * "dismiss" means.
 *
 * So this module owns the LIFECYCLE and nothing about what is inside a card:
 *   · an id, a kind, a time, whether it persists;
 *   · a `render` the caller supplies, which draws the body and the controls;
 *   · dismissal, replacement, and a bounded history.
 * `NotificationStack` owns the frame, the stacking and the keyboard. A new
 * type is a new `kind` in `KINDS` plus whatever draws its body.
 *
 * ── TWO LIFETIMES, AND THE DIFFERENCE MATTERS ─────────────────────────
 *
 * TRANSIENT cards state something and go: "North Gate accepted", "the share
 * ended". They time out, because a wall of statements nobody dismissed is a
 * wall nobody reads.
 *
 * PERSISTENT cards ask something and STAY until they are answered or until
 * the thing they are about expires. A share request that faded after eight
 * seconds would be a request silently declined by whoever was looking the
 * other way. Pending shares are persistent; they leave when the share leaves
 * `pending`, which the share feed tells us.
 *
 * ── WHAT IS NOT HERE ──────────────────────────────────────────────────
 *
 * No sound, no desktop Notification API, no badge count on the favicon. Each
 * is a separate decision with its own permission prompt, and none of them is
 * needed to stop somebody leaving the feed.
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

/**
 * The kinds of card this product shows. ONE COLOUR EACH, and the token names
 * are the kinds rather than the hues, so a restyle is a value change.
 *
 * ⚠ `terra` AND THE ALARM RED ARE BOTH UNAVAILABLE. Green means live and
 * nothing else; the alarm red is held for the detections and faults that are
 * coming. See the token block in index.css.
 */
export const KINDS = {
  /** Somebody at another site is asking for, or offering, access. */
  share: {
    accent: "text-notify-share",
    wash: "bg-notify-share-wash",
    line: "border-notify-share-line",
    solid: "bg-notify-share text-notify-share-ink",
  },
  /** A statement with nothing to answer. It reports; it does not ask. */
  system: {
    accent: "text-notify-system",
    wash: "bg-notify-system-wash",
    line: "border-notify-system-line",
    solid: "bg-action text-action-ink",
  },
} as const;

export type NotificationKind = keyof typeof KINDS;

export interface Notification {
  /** Stable across updates: a card for the same subject keeps its place. */
  readonly id: string;
  readonly kind: NotificationKind;
  /** One line, for the history list and for assistive technology. */
  readonly title: string;
  /** Epoch ms. The card shows this as a relative time while it is on screen. */
  readonly at: number;
  /**
   * Stays until something takes it away. See the note above: a question that
   * fades is a question answered by whoever was looking elsewhere.
   */
  readonly persistent?: boolean;
  /** How long a transient card lives. Ignored when `persistent`. */
  readonly ttlMs?: number;
  /** The body and the controls. Given `dismiss` so a control can close itself. */
  readonly render?: (api: { dismiss: () => void }) => ReactNode;
}

/** What a dismissed card becomes: a line in the history, with no body. */
export interface HistoryEntry {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly title: string;
  readonly at: number;
  /** Why it left: answered, timed out, or taken away by the thing it was about. */
  readonly ended: "dismissed" | "expired" | "resolved";
}

const DEFAULT_TTL_MS = 9000;

/**
 * How many cards are visible at once. The rest wait, newest first.
 *
 * THREE, BECAUSE THE FOURTH COVERS THE PICTURE. These sit over live video and
 * the whole point is that the video keeps playing where somebody can see it. A
 * stack that grows without limit is a modal with extra steps.
 */
export const MAX_VISIBLE = 3;

/** The history is bounded for the same reason a log is rotated. */
const HISTORY_MAX = 50;

interface Ctx {
  readonly all: readonly Notification[];
  readonly visible: readonly Notification[];
  readonly waiting: number;
  readonly history: readonly HistoryEntry[];
  /** Add or REPLACE by id, keeping the original position in the stack. */
  readonly notify: (n: Notification) => void;
  readonly dismiss: (id: string, ended?: HistoryEntry["ended"]) => void;
  /** Take away every card about something that no longer applies. */
  readonly resolve: (predicate: (n: Notification) => boolean) => void;
  readonly clearHistory: () => void;
}

const NotificationContext = createContext<Ctx | null>(null);

export function NotificationProvider({ children }: { children: ReactNode }) {
  const [all, setAll] = useState<readonly Notification[]>([]);
  const [history, setHistory] = useState<readonly HistoryEntry[]>([]);

  const remember = useCallback((n: Notification, ended: HistoryEntry["ended"]) => {
    setHistory((prev) =>
      [{ id: n.id, kind: n.kind, title: n.title, at: n.at, ended }, ...prev].slice(
        0,
        HISTORY_MAX,
      ),
    );
  }, []);

  const dismiss = useCallback(
    (id: string, ended: HistoryEntry["ended"] = "dismissed") => {
      setAll((prev) => {
        const found = prev.find((n) => n.id === id);
        if (found) remember(found, ended);
        return prev.filter((n) => n.id !== id);
      });
    },
    [remember],
  );

  const notify = useCallback((n: Notification) => {
    setAll((prev) => {
      const at = prev.findIndex((x) => x.id === n.id);
      if (at < 0) return [...prev, n];
      /* REPLACED IN PLACE. A share card that gains an expanded form, or a
         countdown that ticks, must not jump to the bottom of the stack and
         lose the pointer that was on its way to its button. */
      const next = prev.slice();
      next[at] = n;
      return next;
    });
  }, []);

  const resolve = useCallback(
    (predicate: (n: Notification) => boolean) => {
      setAll((prev) => {
        const going = prev.filter(predicate);
        for (const n of going) remember(n, "resolved");
        return going.length === 0 ? prev : prev.filter((n) => !predicate(n));
      });
    },
    [remember],
  );

  /* THE ONE TIMER, not one per card. A card per timer is a card that keeps a
     timer after it unmounts, and the cost of being half a second late to
     retire a toast is nothing at all. */
  useEffect(() => {
    const tick = setInterval(() => {
      const now = Date.now();
      setAll((prev) => {
        const going = prev.filter(
          (n) => !n.persistent && now - n.at > (n.ttlMs ?? DEFAULT_TTL_MS),
        );
        for (const n of going) remember(n, "expired");
        return going.length === 0 ? prev : prev.filter((n) => !going.includes(n));
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [remember]);

  const value = useMemo<Ctx>(() => {
    /* NEWEST NEAREST THE CORNER, and the overflow waits rather than being
       dropped: a request that arrived while three others were open is still a
       request. */
    const ordered = [...all].sort((a, b) => b.at - a.at);
    return {
      all,
      visible: ordered.slice(0, MAX_VISIBLE),
      waiting: Math.max(0, ordered.length - MAX_VISIBLE),
      history,
      notify,
      dismiss,
      resolve,
      clearHistory: () => setHistory([]),
    };
  }, [all, history, notify, dismiss, resolve]);

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
}

/**
 * The stack, from anywhere.
 *
 * Returns a no-op outside a provider rather than throwing: the screenshot
 * harness mounts single components, and a screen that explodes because nobody
 * wrapped it in a provider is a worse failure than one that shows no cards.
 */
export function useNotifications(): Ctx {
  const ctx = useContext(NotificationContext);
  const fallback = useRef<Ctx>({
    all: [],
    visible: [],
    waiting: 0,
    history: [],
    notify: () => {},
    dismiss: () => {},
    resolve: () => {},
    clearHistory: () => {},
  });
  return ctx ?? fallback.current;
}

/** `4m` / `2h` / `now`, for a card's corner and the history list. */
export function sinceLabel(at: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  if (s < 45) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/**
 * `14:02` left, as `m:ss` or `h:mm`, for a share's remaining time.
 *
 * ⚠ NULL WHEN IT HAS RUN OUT, never "0:00". A share at zero is not a share
 * with no time left on it; it is over, and the card says so in words.
 */
export function timeLeftLabel(expiresAt: string, now: number = Date.now()): string | null {
  const end = Date.parse(expiresAt);
  if (!Number.isFinite(end)) return null;
  const s = Math.round((end - now) / 1000);
  if (s <= 0) return null;
  if (s < 3600) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const h = Math.floor(s / 3600);
  /* ⚠ PAST A DAY IT STOPS BEING A CLOCK. A week-long share rendered as
     "167:59" is a number nobody can read at a glance, and the glance is the
     whole purpose of this label: the minute-by-minute countdown matters when
     a share is nearly over, and "6d" is the right answer when it is not. */
  if (h >= 24) {
    const d = Math.floor(h / 24);
    const rest = h % 24;
    return rest === 0 ? `${d}d` : `${d}d ${rest}h`;
  }
  return `${h}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}`;
}
