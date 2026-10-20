/**
 * Going to a camera, from anywhere, and reading the fleet again on the way.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE BUG THIS EXISTS FOR
 * ══════════════════════════════════════════════════════════════════════
 *
 * On the real fleet: a site requested a camera, the owner accepted, the card
 * said so, and pressing "Watch now" gave
 *
 *     kln_lab_000003 IS UNAVAILABLE
 *     This tower is not on your fleet any more.
 *
 * Nothing was wrong with the share and nothing was refused: the data centre's
 * journal shows no denial, because nothing was ever asked. The fleet is read
 * ONCE, on mount, and re-read only by the reload banner or when an enrolment
 * claim is consumed. A share that lands afterwards changes what the server
 * would answer and nothing goes and finds out, so the drill-in looked the
 * tower up in a list fetched before the share existed and found nothing.
 *
 * "Not on your fleet any more" was true of the client's copy and false of the
 * fleet. That sentence is the most alarming one this app can say -- it means
 * access was taken away -- and it was being said about a share that had just
 * been granted.
 *
 * ── TWO HALVES, AND BOTH ARE NEEDED ───────────────────────────────────
 *
 * `FleetFollowsShares` watches the set of device ids that live shares lend
 * this account and re-reads the fleet when it changes. That covers the badge
 * appearing on the wall, the tile, the count: everything that reads `towers`
 * without anybody pressing anything.
 *
 * `watch(deviceId)` re-reads the fleet FIRST when the device is not in it yet,
 * and only then navigates. That covers the press that happens in the same
 * second as the accept, before any poll has run. Belt and braces on purpose:
 * the first is what keeps the screen honest, the second is what makes the
 * button work every single time.
 *
 * ── WHY A CONTEXT AND NOT A PROP ──────────────────────────────────────
 *
 * Three places need it now -- the card deck, Sharing > Active, and the badge
 * on a borrowed tile -- and the last two are four and five components deep
 * inside SettingsView. Threading a callback down there is how two of them end
 * up with different behaviour.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useShareFeed } from "@/lib/useShareFeed";

interface WatchApi {
  /**
   * Open this camera, reading the fleet again first if it is not there yet.
   *
   * Resolves once the screen has been asked to change. A device that is still
   * absent after the re-read is genuinely absent, and the caller navigates
   * anyway so the "unavailable" screen can say so -- having actually asked.
   */
  readonly watch: (deviceId: string) => Promise<void>;
  /** Whether anything is wired up. False in the screenshot harness. */
  readonly ready: boolean;
}

const WatchContext = createContext<WatchApi | null>(null);

export function WatchProvider({
  open,
  hasDevice,
  refreshFleet,
  children,
}: {
  /** Navigate to this camera. Owned by the shell, which knows the screens. */
  open: (deviceId: string) => void;
  /** Is this device in the fleet the client currently holds? */
  hasDevice: (deviceId: string) => boolean;
  /** Re-read `GET /v1/viewer/towers`. Resolves when the state has been set. */
  refreshFleet: () => Promise<void>;
  children: ReactNode;
}) {
  /* Read through a ref so `watch` is stable: it is passed to the deck, to the
     page and to every tile, and a new function identity on every fleet change
     would re-render all of them for nothing. */
  const latest = useRef({ open, hasDevice, refreshFleet });
  latest.current = { open, hasDevice, refreshFleet };

  const watch = useCallback(async (deviceId: string) => {
    if (!deviceId) return;
    if (!latest.current.hasDevice(deviceId)) {
      /* ONE ATTEMPT, NOT A RETRY LOOP. An absent tower is an answer, not a
         wait -- the rule this whole app is built on. If it is still not there
         we navigate and the screen says "unavailable", which is now an honest
         statement about what the server said rather than about a stale copy. */
      try {
        await latest.current.refreshFleet();
      } catch {
        /* A failed re-read is not a reason to refuse to navigate. The fleet
           banner already reports an unreachable coordination, and the screen
           we are going to can say what it does not have. */
      }
    }
    latest.current.open(deviceId);
  }, []);

  const value = useMemo<WatchApi>(() => ({ watch, ready: true }), [watch]);
  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

/**
 * Open a camera from anywhere.
 *
 * Returns a no-op outside a provider rather than throwing: the screenshot
 * harness mounts single components, and a screen that explodes because nobody
 * wrapped it is a worse failure than a button that does nothing in a
 * photograph. `ready` says which case you are in, so a caller can hide a
 * button it cannot honour.
 */
export function useWatch(): WatchApi {
  const ctx = useContext(WatchContext);
  const fallback = useRef<WatchApi>({ watch: async () => {}, ready: false });
  return ctx ?? fallback.current;
}

/**
 * Re-read the fleet whenever the set of borrowed cameras changes.
 *
 * ⚠ THE SET, NOT THE LIST. The share feed re-polls every twenty seconds and
 * hands back new objects each time; reacting to that would re-read the fleet
 * three times a minute forever. What matters is which device ids are lent to
 * this account, as a sorted key, and that changes exactly when a share starts
 * or ends.
 *
 * ⚠ AND IT RE-READS WHEN A SHARE ENDS, TOO. A camera whose share has
 * expired has to leave the wall, and until this existed it stayed there until
 * somebody reloaded -- a tile for a feed nobody is entitled to any more, which
 * is a worse failure than the missing one.
 *
 * Renders nothing. It is a component rather than a hook so it can live inside
 * `ShareFeedProvider` while the fleet state lives outside it.
 */
export function FleetFollowsShares({
  refreshFleet,
}: {
  refreshFleet: () => Promise<void>;
}) {
  const { active } = useShareFeed();
  const borrowed = useMemo(
    () =>
      [
        ...new Set(
          active
            /* ⚠ ONLY SHARES COMING TO ME. A camera my own site owns is in
               my fleet whether or not I have lent it out, so a share going
               the other way changes nothing about what I can see. */
            .filter((s) => !s.incoming)
            .flatMap((s) => s.scope.map((e) => e.device_id)),
        ),
      ]
        .sort()
        .join("|"),
    [active],
  );

  /* The first value is the one the mount load already covers, so skip it:
     otherwise every sign-in reads the fleet twice. */
  const seen = useRef<string | null>(null);
  useEffect(() => {
    if (seen.current === null) {
      seen.current = borrowed;
      return;
    }
    if (seen.current === borrowed) return;
    seen.current = borrowed;
    void refreshFleet();
  }, [borrowed, refreshFleet]);

  return null;
}
