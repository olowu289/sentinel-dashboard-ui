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
import {
  NO_COUNTS,
  readAlertCounts,
  type AlertCounts,
} from "@/lib/api/alertCounts";

/**
 * HOW MANY ALERTS ARE WAITING, read once and shared by everything that counts.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THE NUMBER IS THE SERVER'S AND NOT `alerts.length`
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tower card used to draw the length of the alert array the browser was
 * holding, with a `+` glued on the end -- so a quiet site read `0+`, and a
 * busy one read however many rows had been fetched rather than however many
 * were outstanding. Those are two different numbers the moment a feed is
 * paged or filtered, and only one of them is a reason to walk over to a
 * screen. The server counts what is unacknowledged; this side draws it.
 *
 * ── WHY IT IS A PROVIDER ──────────────────────────────────────────────
 *
 * Two surfaces read it and they must never disagree: the fleet's tower cards
 * and the badge on the rail's Alerts icon. The rail is rendered by ten
 * different screens, and the note in `IconRail` is about exactly what happens
 * when a value it needs is threaded as a prop instead -- nine of them forgot,
 * and a destination appeared on two screens. One read, one value, every
 * consumer.
 *
 * ── AND WHY IT DOES NOT POLL ──────────────────────────────────────────
 *
 * The alert channel is already open. `useSiteAlerts` holds
 * `GET /v1/viewer/events` and every frame on it is a reason this number may
 * have changed, so the shell hands each one to {@link AlertCountsFeed.noted}
 * and the count is re-read. A poll beside a live stream is a second, lossier
 * answer to a question already being answered -- and a node holds at most 64
 * streams, so opening a second one for this would be worse than lossier.
 *
 * ⚠ ONE RE-READ PER BURST. A real incident is a raise, then its clips, then
 * its recovery, as three frames in a few seconds. Three requests for one
 * answer, of which the first two are thrown away by the third, is the shape
 * `useSiteAlerts` already debounces its clip re-reads against, for the same
 * reason and with the same number.
 *
 * ⚠ AND `alerts.acknowledged` IS THE ONE KIND THAT CARRIES NOTHING ELSE.
 * A sweep is ONE frame for the whole batch rather than an `alert.updated`
 * per row, because a row apiece would close the channel of every browser
 * watching a busy site for falling behind. It names no alerts, so this
 * number cannot be adjusted from it and has to be asked for again -- which
 * is the only path by which a screenful cleared in SOMEBODY ELSE's browser
 * reaches these cards at all. Acknowledgements made in THIS browser do not
 * wait for it: the shell calls `reload` when its own write returns, because
 * a click that appears to do nothing for a second is how an operator learns
 * to click twice.
 *
 * It arrived in `@kallon/sentry-sdk` 0.14.0. Before it the SDK's
 * `alertEventOf` returned null for any frame that was not `alert.new` or
 * `alert.updated` and `subscribeSiteAlerts` dropped what it returned null
 * for, so this side was written for the kind and could not receive it, with
 * a test asserting the gap and saying in its own message to delete itself
 * when it closed. That is the shape worth copying when this side is
 * finished before the SDK is.
 */

export interface AlertCountsFeed {
  /** Every unacknowledged alert this account may see, as the server counts it. */
  readonly total: number;
  /** Per device. A device with none is ABSENT, never present with a zero. */
  readonly byDevice: ReadonlyMap<string, number>;
  /**
   * `true` until the first answer, and never again.
   *
   * A later re-read that fails leaves the last number on screen rather than
   * blanking it: a badge that disappears because one request did not get out
   * says "all clear", which is the one thing this number may never say by
   * accident.
   */
  readonly loading: boolean;
  /** The count could not be read. The surfaces draw nothing rather than zero. */
  readonly error: boolean;
  /** Re-read now. The shell calls this after its own acknowledgement. */
  readonly reload: () => void;
  /**
   * One event arrived on the alert channel; the count may have moved.
   *
   * Takes the kind rather than nothing so the reason is readable at the call
   * site, and so a kind this bundle predates costs no re-read at all.
   * Debounced -- see the header.
   */
  readonly noted: (kind: string) => void;
}

/** Nothing read, nothing claimed. What a tree with no provider gets. */
const NOTHING: AlertCountsFeed = {
  total: 0,
  byDevice: NO_COUNTS.byDevice,
  loading: false,
  error: false,
  reload: () => {},
  noted: () => {},
};

/**
 * One re-read per burst of frames.
 *
 * The same 300 ms, for the same reason, as `useSiteAlerts`'s clip re-read: a
 * raise and its clip and its recovery are one incident and should be one
 * question.
 */
export const COUNTS_DEBOUNCE_MS = 300;

/**
 * Every event kind that moves this number.
 *
 * A closed list rather than "any frame at all": a new kind on this channel
 * is an additive server change, and re-reading the counts on one would spend
 * a request per frame on something that may have nothing to do with them.
 */
export const COUNTED_KINDS = [
  "alert.new",
  "alert.updated",
  "alerts.acknowledged",
] as const;

export function countsOnKind(kind: string): boolean {
  return (COUNTED_KINDS as readonly string[]).includes(kind);
}

/**
 * The read itself. Called once by the shell, which then provides the value.
 *
 * A hook rather than something inside the provider because the shell needs
 * the number too -- the fleet list is rendered by the same component that
 * renders the provider, and a component cannot consume a context it provides.
 */
export function useAlertCountsFeed(enabled: boolean): AlertCountsFeed {
  const [counts, setCounts] = useState<AlertCounts>(NO_COUNTS);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setCounts(NO_COUNTS);
      setLoading(false);
      setError(false);
      return;
    }
    const controller = new AbortController();
    void (async () => {
      try {
        const next = await readAlertCounts(controller.signal);
        if (controller.signal.aborted) return;
        setCounts(next);
        setError(false);
      } catch {
        if (controller.signal.aborted) return;
        /* ⚠ THE LAST NUMBER IS LEFT ON SCREEN. A count that resets itself
           because a refresh failed reads as "everything was acknowledged",
           which is the fake-green failure this product refuses everywhere
           else and the worst place in the app to make it. */
        setError(true);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    })();
    return () => controller.abort();
  }, [enabled, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  /* The burst timer. A ref, because nothing renders from it and a pending
     re-read in state would re-render every card on every frame. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current);
    },
    [],
  );

  const noted = useCallback(
    (kind: string) => {
      if (!countsOnKind(kind)) return;
      if (timer.current !== null) return;
      timer.current = setTimeout(() => {
        timer.current = null;
        reload();
      }, COUNTS_DEBOUNCE_MS);
    },
    [reload],
  );

  return useMemo(
    () => ({
      total: counts.total,
      byDevice: counts.byDevice,
      loading,
      error,
      reload,
      noted,
    }),
    [counts, loading, error, reload, noted],
  );
}

const CountsContext = createContext<AlertCountsFeed>(NOTHING);

export function AlertCountsProvider({
  value,
  children,
}: {
  value: AlertCountsFeed;
  children: ReactNode;
}) {
  return (
    <CountsContext.Provider value={value}>{children}</CountsContext.Provider>
  );
}

/**
 * The shared count.
 *
 * Returns zeros outside a provider rather than throwing, and that is not
 * laziness: the rail renders in the screenshot harness and in tests with no
 * shell above it, and a badge is an ornament on a destination rather than the
 * destination itself. Nothing is drawn for a count of zero, so "no provider"
 * and "nothing outstanding" land in the same place on screen.
 */
export function useAlertCounts(): AlertCountsFeed {
  return useContext(CountsContext);
}

/**
 * The number as it is drawn: exact to 99, then "99+", and nothing at zero.
 *
 * ⚠ ONE PLACE, TWO SURFACES. The card's pill and the rail's badge show the
 * same count and must round it the same way. They did not: the card glued a
 * `+` onto every number it had, so a site with nothing outstanding read `0+`
 * and a site with three read `3+` -- which claims there are more than three.
 * There is exactly one "+" in this product now and it means "over ninety
 * nine".
 */
export function countLabel(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 99 ? "99+" : String(Math.trunc(n));
}

/** The same number, said in words, for a label nobody can see. */
export function countAria(n: number): string | null {
  if (!Number.isFinite(n) || n <= 0) return null;
  const exact = Math.trunc(n);
  if (exact > 99) return "More than 99 unacknowledged alerts";
  return `${exact} unacknowledged ${exact === 1 ? "alert" : "alerts"}`;
}
