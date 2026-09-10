import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Which fleet tiles are actually on screen, settled rather than instantaneous.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────
 *
 * The fleet wall used to hold no sessions at all: it drew stills and told the
 * operator to open a tower to watch. The reasoning is still in `App.tsx` and
 * still true as far as it goes — a session costs a grant on coordination and a
 * busy camera on an off-grid tower, and this app carries its own banner warning
 * that live viewing drains a battery. What that reasoning got wrong is the
 * assumption that "the fleet screen" means "the whole fleet". It does not. It
 * means the eight or so tiles that fit on a monitor, and that number does not
 * grow when the fleet does.
 *
 * So the cost is bounded by the VIEWPORT, not by the estate. A hundred-tower
 * fleet opens exactly as many sessions as a two-tower one.
 *
 * ── THE HAZARD THIS IS SHAPED AROUND ───────────────────────────────────
 *
 * ⚠ SCROLL CHURN. A tile flicking through the viewport during a fast scroll is
 * not something anybody is watching, and treating it as one is how you get a
 * burst of sessions opened and torn down in a second — each one a grant minted,
 * a camera briefly claimed, and a peer negotiated for nobody. The tower's
 * session slots are shared and finite; churning them has taken whole walls
 * down before.
 *
 * The guard is asymmetric hysteresis, and the asymmetry is the point:
 *
 *   OPENING waits {@link VISIBLE_SETTLE_MS}. A tile has to still be there after
 *   the scroll stops. Scrolling past costs nothing at all.
 *
 *   CLOSING waits {@link HIDDEN_SETTLE_MS}, three times longer. Nudging a tile
 *   half off the screen and back must not cost a full renegotiation, and a
 *   session held a moment too long is far cheaper than one rebuilt
 *   unnecessarily.
 *
 * Both timers are per tile and each cancels the other, so a tile that leaves
 * and returns inside the grace never notices, and one that arrives and leaves
 * inside the settle never opens.
 */

/** A tile must hold still this long before it is worth a session. */
export const VISIBLE_SETTLE_MS = 400;

/**
 * And be gone this long before its session is given up.
 *
 * Deliberately longer than the open delay — see the asymmetry note above.
 */
export const HIDDEN_SETTLE_MS = 1_200;

/**
 * How much of a tile has to be showing to count.
 *
 * A sliver at the edge of the viewport is not something an operator is reading,
 * and opening a session for it spends a tower's battery on a strip of pixels.
 */
export const VISIBLE_RATIO = 0.25;

export interface VisibleTiles {
  /**
   * A ref callback for one tile, stable across renders.
   *
   * ⚠ IT MUST BE STABLE. Returning a fresh closure per render would make React
   * detach and reattach the ref every time — unobserving and re-observing on
   * every latency tick, which this app fires once a second. The callbacks are
   * cached per id for exactly that reason.
   */
  observe: (id: string) => (el: HTMLElement | null) => void;
  /** Tile ids currently settled as visible. Order is not meaningful. */
  visible: ReadonlySet<string>;
}

/**
 * @param frozen  Hold the current set still, ignoring the observer entirely.
 *
 * ⚠ FOR NAVIGATION, NOT FOR SCROLLING. When another screen renders over the
 * wall, its tiles UNMOUNT — every ref detaches, every tile is reported gone,
 * and 1.2 seconds later the sessions close. Coming back then paid the full cold
 * connect, which is what "playback and back re-loads everything" was. The tiles
 * did not stop being what the operator is watching; they stopped being
 * RENDERED, and the observer cannot tell those apart.
 *
 * So the caller freezes the set across a navigation that should not disturb
 * live sessions, and the observer's own hysteresis keeps handling the case it
 * IS good at: actual scrolling, on a screen that is actually on.
 */
export function useVisibleTiles(frozen = false): VisibleTiles {
  const [visible, setVisible] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );

  const observer = useRef<IntersectionObserver | null>(null);
  /** element → id, to resolve an observer entry back to a tile. */
  const idOf = useRef(new Map<Element, string>());
  /** id → element, so re-attaching one tile unobserves only its own node. */
  const elOf = useRef(new Map<string, HTMLElement>());
  /** id → pending open/close timer. At most one per tile, either direction. */
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  /** The committed truth, read synchronously — `visible` state lags a render. */
  const settled = useRef(new Set<string>());
  /** Stable ref callbacks, one per tile id. */
  const callbacks = useRef(
    new Map<string, (el: HTMLElement | null) => void>(),
  );

  const commit = useCallback((id: string, isVisible: boolean) => {
    if (isVisible === settled.current.has(id)) return;
    if (isVisible) settled.current.add(id);
    else settled.current.delete(id);
    setVisible(new Set(settled.current));
  }, []);

  /* Schedule a change, cancelling whatever was pending for this tile. A tile
     that leaves and comes back inside the grace therefore never closes, and one
     that arrives and leaves inside the settle never opens — the two timers can
     never both be armed. */
  /* Read inside callbacks that are created once; a captured boolean would be
     whatever it was when the observer was built. */
  const frozenRef = useRef(frozen);
  frozenRef.current = frozen;

  const schedule = useCallback(
    (id: string, isVisible: boolean) => {
      /* Frozen: neither direction commits. Not just hides — a tile arriving
         while another screen is up is not on screen either. */
      if (frozenRef.current) return;
      const pending = timers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        timers.current.delete(id);
      }
      if (isVisible === settled.current.has(id)) return;
      const delay = isVisible ? VISIBLE_SETTLE_MS : HIDDEN_SETTLE_MS;
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          commit(id, isVisible);
        }, delay),
      );
    },
    [commit],
  );

  const ensure = useCallback(() => {
    if (observer.current) return observer.current;
    observer.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = idOf.current.get(entry.target);
          if (id === undefined) continue;
          /* `isIntersecting` already accounts for the threshold, but the ratio
             is checked too: a resize can deliver an entry that is technically
             intersecting at a ratio below it. */
          schedule(
            id,
            entry.isIntersecting && entry.intersectionRatio >= VISIBLE_RATIO,
          );
        }
      },
      { threshold: [0, VISIBLE_RATIO] },
    );
    return observer.current;
  }, [schedule]);

  const observe = useCallback(
    (id: string) => {
      const cached = callbacks.current.get(id);
      if (cached) return cached;

      const cb = (el: HTMLElement | null) => {
        const io = ensure();
        const previous = elOf.current.get(id);
        if (previous && previous !== el) {
          io.unobserve(previous);
          idOf.current.delete(previous);
          elOf.current.delete(id);
        }
        if (el) {
          elOf.current.set(id, el);
          idOf.current.set(el, id);
          io.observe(el);
          return;
        }
        /* Detached. Treated as leaving the viewport rather than as an instant
           close, so a remount — a reorder, a re-key — lands inside the grace
           and costs nothing. */
        schedule(id, false);
      };
      callbacks.current.set(id, cb);
      return cb;
    },
    [ensure, schedule],
  );

  /* Everything is torn down together: a stray timer would commit a visibility
     change against an unmounted wall, and a live observer would hold every
     tile's node alive. */
  useEffect(() => {
    const pending = timers.current;
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
      idOf.current.clear();
      elOf.current.clear();
      settled.current.clear();
    };
  }, []);

  return { observe, visible };
}
