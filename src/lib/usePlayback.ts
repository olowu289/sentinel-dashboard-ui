import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewerSession } from "@kallon/sentry-sdk";
import {
  openPlayback,
  readSessionExpiry,
  PlaybackError,
  STATUS_POLL_MS,
  STATUS_POLL_TOLERANCE,
  type PlaybackHandle,
} from "@/lib/api/media";

/**
 * Live WebRTC playback for a set of cameras.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS OWNED BY THE SHELL AND NOT BY A TILE
 * ══════════════════════════════════════════════════════════════════════
 *
 * A peer connection is expensive at both ends: it holds a session on
 * coordination and a camera busy on the tower. Its lifetime therefore has to
 * match what the operator is actually watching — and a tile's lifetime does
 * not, for two concrete reasons already true of this app:
 *
 *   `TowerView` is keyed on `${id}|${showAlerts}` and REMOUNTS on every
 *   drill-in, so a tile-owned peer would be torn down and renegotiated every
 *   time an operator opened the same tower again.
 *
 *   `DashboardView` UNMOUNTS ENTIRELY whenever a tower is open, so anything it
 *   owned would die on navigation and be rebuilt on the way back.
 *
 * This is the same problem the live-viewing clock already has, solved the same
 * way: the state lives in `App.tsx` and a ref (`watchedTower`) distinguishes
 * "a different tower" from "left and came back". Streams get the same
 * treatment, so drilling into a tower, ducking out to the fleet and returning
 * does not cost two full renegotiations and a fresh grant.
 *
 * ── STRICTMODE ─────────────────────────────────────────────────────────
 *
 * Both guards, because they cover different halves. The `AbortController` is
 * checked after every await inside `openPlayback` and stops work CONTINUING.
 * The per-entry `disposed` flag stops a late success from LEAKING: the session
 * may already have been created when cleanup ran, and the cleanup cannot close
 * a handle that did not exist yet — so the resolver closes it itself.
 *
 * ── ONE EFFECT, WHOLE-SET LIFECYCLE ────────────────────────────────────
 *
 * The effect closes everything on cleanup and reopens on the next run, rather
 * than diffing the set. That means changing which cameras are targeted
 * renegotiates all of them, which is a real cost and an accepted one here: the
 * set only changes when the operator changes tower, at which point every stream
 * was going to change anyway. Diffing would buy nothing and is the kind of
 * bookkeeping that leaks a session the first time it is wrong.
 */

export type PlaybackPhase =
  /** Negotiating. There is no picture yet and none is being claimed. */
  | { kind: "connecting" }
  | { kind: "playing"; stream: MediaStream }
  | { kind: "failed"; error: PlaybackError };

export interface PlaybackTarget {
  /** This app's feed id — a key, never an address. */
  id: string;
  /** The tower's `device_id`. Half of what a session is addressed to. */
  towerId: string;
  /** The protocol address. The other half. */
  index: number;
  /**
   * Which stream to open, when the viewer has chosen one.
   *
   * ⚠ IT IS PART OF THE TARGET'S IDENTITY, not a setting applied to a running
   * session. There is no such thing as changing the profile of an open
   * session: it is signed into the grant, so a different profile is a
   * different session. Putting it in the effect key below means choosing one
   * tears the old peer down and opens a new one through exactly the path a
   * retry already uses — no second mechanism, and the honest `connecting`
   * state comes for free rather than being simulated.
   */
  profile?: string;
}

interface Entry {
  controller: AbortController;
  handle: PlaybackHandle | null;
  disposed: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

export interface Playback {
  /** Phase by feed id. A feed with no entry is simply not being played. */
  phases: Record<string, PlaybackPhase>;
  /** Reopen one camera. Deliberate, operator-driven — there is no retry loop. */
  retry: (feedId: string) => void;
  /**
   * The live session for one camera, or `null`.
   *
   * PTZ is session-scoped — the session IS the authorization, and the protocol
   * defines no PTZ endpoint outside one — so a command needs the same handle
   * the stream is using. Read from a ref at press time rather than returned as
   * state, because a command wants the session that exists NOW, and re-rendering
   * every tile whenever a session is established would be a lot of churn for a
   * value only a pointer event reads.
   */
  sessionFor: (feedId: string) => ViewerSession | null;
}

export function usePlayback(targets: PlaybackTarget[]): Playback {
  const [phases, setPhases] = useState<Record<string, PlaybackPhase>>({});
  const [attempts, setAttempts] = useState<Record<string, number>>({});

  /** Every handle currently open, for the unload path. Written by the effect. */
  const openHandles = useRef<Map<string, PlaybackHandle>>(new Map());

  const retry = useCallback((feedId: string) => {
    setAttempts((prev) => ({ ...prev, [feedId]: (prev[feedId] ?? 0) + 1 }));
  }, []);

  /* The effect's identity. Targets are objects rebuilt on every render, so the
     dependency has to be a string — depending on the array itself would tear
     down and rebuild every peer on every unrelated re-render, and this app
     re-renders once a second on its own timers. */
  const key = targets
    .map(
      (t) =>
        `${t.id}@${t.towerId}:${t.index}/${t.profile ?? ""}#${attempts[t.id] ?? 0}`,
    )
    .sort()
    .join("|");

  useEffect(() => {
    if (targets.length === 0) {
      setPhases({});
      return;
    }

    const entries = new Map<string, Entry>();

    for (const target of targets) {
      const entry: Entry = {
        controller: new AbortController(),
        handle: null,
        disposed: false,
        timers: [],
      };
      entries.set(target.id, entry);

      const set = (phase: PlaybackPhase) => {
        if (entry.disposed) return;
        setPhases((prev) => ({ ...prev, [target.id]: phase }));
      };

      set({ kind: "connecting" });

      void (async () => {
        try {
          const opened = await openPlayback(
            {
              towerId: target.towerId,
              index: target.index,
              ...(target.profile !== undefined
                ? { profile: target.profile }
                : {}),
            },
            {
              onStream: (stream) => set({ kind: "playing", stream }),
              /* ICE gave up, possibly long after negotiation succeeded. Drop
                 the stream so a permanently black frame cannot sit there
                 looking live. */
              onFailure: (error) => set({ kind: "failed", error }),
            },
            entry.controller.signal,
          );

          if (entry.disposed) {
            /* Cleanup ran while the session was being created. It could not
               close a handle that did not exist yet, so close it here —
               otherwise a live tower session leaks on every StrictMode
               double-mount and every fast navigation. */
            await opened.close();
            return;
          }
          entry.handle = opened;
          openHandles.current.set(target.id, opened);

          /* ── THE CLOCK ────────────────────────────────────────────────
             `expires_at` is a wall clock, not a hint — but coordination can
             ADVANCE it by renewing, and renewal is the moment it re-asks
             whether this viewer may still watch. So the value handed back at
             creation is a snapshot that goes stale at the first renewal, and a
             viewer that counted down to it would tear down a feed coordination
             had just extended.

             The viewer never extends its own clock. `deadline` only ever takes
             a value the SERVER reported, so a revoked viewer sees `ended` and
             stops. Pulled forward from the renewal stage because without it a
             tile shows a frozen frame fifteen minutes in, which is the one
             thing the state grammar exists to prevent. */
          let deadline = Date.parse(opened.session.expires_at);
          let misses = 0;

          const end = (message: string) => {
            if (entry.disposed) return;
            void opened.close();
            set({ kind: "failed", error: new PlaybackError("session_expired", message) });
          };

          const poll = async () => {
            if (entry.disposed) return;
            try {
              const expiresAt = await readSessionExpiry(
                opened.session,
                entry.controller.signal,
              );
              if (entry.disposed) return;
              if (expiresAt === null) {
                /* DEFINITIVE: coordination no longer holds this session.
                   Renewal was refused, or it lapsed. Never blame the network
                   for an access ending. */
                end("Access to this camera ended");
                return;
              }
              misses = 0;
              const next = Date.parse(expiresAt);
              // Only ever move the deadline the way the SERVER moved it.
              if (Number.isFinite(next)) deadline = next;
            } catch {
              if (entry.disposed) return;
              /* NOT an authorization answer. Keep playing on the expiry we
                 know and try again — a working feed must not die because one
                 request failed. The real deadline below is still the backstop. */
              misses += 1;
            }
            if (!entry.disposed) {
              entry.timers.push(setTimeout(() => void poll(), STATUS_POLL_MS));
            }
          };

          // Re-armed each tick against the CURRENT deadline, so a renewal
          // pushes it out and a genuine expiry still ends the feed.
          const watchExpiry = () => {
            if (entry.disposed) return;
            if (Number.isFinite(deadline) && Date.now() >= deadline) {
              end(
                misses >= STATUS_POLL_TOLERANCE
                  ? "The session expired and coordination could not be reached"
                  : "The viewing session ended",
              );
              return;
            }
            entry.timers.push(setTimeout(watchExpiry, 1000));
          };

          entry.timers.push(setTimeout(() => void poll(), STATUS_POLL_MS));
          watchExpiry();
        } catch (err) {
          set({
            kind: "failed",
            error:
              err instanceof PlaybackError
                ? err
                : new PlaybackError("unreachable", "Could not start playback"),
          });
        }
      })();
    }

    return () => {
      for (const [id, entry] of entries) {
        entry.disposed = true;
        entry.controller.abort();
        entry.timers.forEach(clearTimeout);
        void entry.handle?.close();
        openHandles.current.delete(id);
      }
      entries.clear();
    };
    /* `targets` is intentionally not a dependency — `key` is its stable
       projection. See the note above. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * A viewer that navigates away without closing leaves the tower waiting on a
   * reap, so sessions are closed on unload as well as on unmount.
   *
   * Best effort, and honestly so: `closeSession` goes through the SDK's normal
   * transport, which a browser may cut off mid-flight during unload. The
   * server-side reap is the backstop and exists precisely because a viewer can
   * vanish.
   */
  useEffect(() => {
    const onUnload = () => {
      for (const handle of openHandles.current.values()) void handle.close();
    };
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, []);

  const sessionFor = useCallback(
    (feedId: string) => openHandles.current.get(feedId)?.session ?? null,
    [],
  );

  return { phases, retry, sessionFor };
}
