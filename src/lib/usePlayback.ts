import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewerSession } from "@kallon/sentry-sdk";
import {
  openPlayback,
  type PlaybackFailure,
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

/**
 * How long to wait before each reconnect attempt, in order.
 *
 * ⚠ THE CAP IS THE POINT, not the delays. Every attempt mints a grant on
 * coordination and claims a camera on an off-grid tower, so a client that
 * retried forever would be a client that quietly DDoSes its own control plane
 * from a phone in somebody's pocket. Five attempts over ~30 seconds is long
 * enough to ride out a lift, a tunnel or a cell handover, and short enough that
 * a genuinely dead path is reported while the operator still cares.
 *
 * Growing rather than fixed, because the failures that resolve resolve quickly
 * and the ones that do not should not be asked five times in five seconds.
 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000];

/** After this many failed reconnects the honest terminal state is shown. */
export const MAX_RECONNECTS = RECONNECT_DELAYS_MS.length;

/**
 * How long `disconnected` is given to sort itself out before it counts.
 *
 * ICE genuinely does recover from `disconnected` unaided, which is why the code
 * used to ignore it entirely. Ignoring it is right for two seconds and wrong
 * forever: a `disconnected` that never comes back is a frozen picture nobody is
 * told about. This is the width of "unaided".
 */
export const DISCONNECT_GRACE_MS = 2_500;

/**
 * Failures that will not change if asked again, so they are never retried.
 *
 * ⚠ THIS SET IS WHAT KEEPS THE HONEST STATES HONEST. Both are AUTHORIZATION
 * ANSWERS: coordination has said this viewer may not watch this camera, or that
 * the session it was watching under is over. Retrying an answer is not
 * resilience, it is refusing to hear it — it would spam the control plane and
 * replace a true statement on screen with a spinner that never resolves.
 *
 * Everything else is a statement about the PATH — the tower was unreachable,
 * media never arrived, negotiation failed, the tower did not answer — and every
 * one of those can be different a second later, especially on a phone.
 */
const TERMINAL: ReadonlySet<PlaybackFailure> = new Set<PlaybackFailure>([
  "not_permitted",
  "session_expired",
]);

export type PlaybackPhase =
  /** Negotiating. There is no picture yet and none is being claimed. */
  | { kind: "connecting" }
  | { kind: "playing"; stream: MediaStream }
  /**
   * The path went away and is being rebuilt.
   *
   * ⚠ A DISTINCT STATE, not a relabelled `connecting`. Connecting is a feed
   * that has never played; reconnecting is one the operator was watching a
   * moment ago and expects back. Saying which attempt it is on matters too —
   * the difference between "give it a second" and "this is not coming back" is
   * exactly what an operator is trying to judge while they wait.
   */
  | { kind: "reconnecting"; attempt: number; of: number }
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
  /** This ONE camera's identity. Compared per feed, never as part of a list. */
  key: string;
  /** Kept so a reconnect knows what to reopen without re-running the effect. */
  target: PlaybackTarget;
  controller: AbortController;
  handle: PlaybackHandle | null;
  disposed: boolean;
  timers: ReturnType<typeof setTimeout>[];
  /** Reconnects spent since this feed last delivered media. Reset on success. */
  retries: number;
  /** Whether media ever arrived, which separates "cannot reach" from "lost". */
  everPlayed: boolean;
  /** A pending grace or backoff timer, so returning to the tab can pre-empt it. */
  pending: ReturnType<typeof setTimeout> | null;
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

/**
 * Give back everything an entry holds, WITHOUT disposing it.
 *
 * The difference from disposal is the whole reason this exists: disposal means
 * "this camera is not wanted any more", and this means "this camera is wanted
 * and what it was holding is no longer any use". The session is closed so the
 * tower gets its slot back, the poll timers are cleared so a dead session stops
 * being asked about, and the abort controller is REPLACED rather than reused —
 * an aborted signal stays aborted, and handing one to the next attempt would
 * fail it before it started.
 */
function releaseForRetry(entry: Entry, handles: Map<string, PlaybackHandle>) {
  if (entry.pending) {
    clearTimeout(entry.pending);
    entry.pending = null;
  }
  entry.timers.forEach(clearTimeout);
  entry.timers = [];
  entry.controller.abort();
  entry.controller = new AbortController();
  const held = entry.handle;
  entry.handle = null;
  handles.delete(entry.target.id);
  if (held) void held.close();
}

export function usePlayback(targets: PlaybackTarget[]): Playback {
  const [phases, setPhases] = useState<Record<string, PlaybackPhase>>({});
  /* Read by the visibility listener, which is registered once and would
     otherwise close over the phases of the render that mounted it. */
  const phasesRef = useRef(phases);
  phasesRef.current = phases;
  const [attempts, setAttempts] = useState<Record<string, number>>({});

  /** Every handle currently open, for the unload path. Written by the effect. */
  const openHandles = useRef<Map<string, PlaybackHandle>>(new Map());

  /**
   * The peers that are actually open, by feed id, ACROSS effect runs.
   *
   * ⚠ THIS REF IS THE FIX. It used to be a `Map` created fresh inside the
   * effect, which made the effect's cleanup the only way to close anything —
   * and a cleanup cannot close *some* of what it owns, so every re-run tore
   * down every camera. Held here, the effect can reconcile: compare each
   * camera's own key, disturb the ones that changed, and leave the rest
   * streaming.
   */
  const live = useRef<Map<string, Entry>>(new Map());

  const retry = useCallback((feedId: string) => {
    /* A DELIBERATE PRESS REFILLS THE BUDGET. The automatic reconnects have run
       out by the time this button is reachable, and an operator who has just
       walked to a window or switched to wifi is telling us something the retry
       counter cannot know. Without this, retry would burn one attempt against
       an exhausted budget and fall straight back to the failure. */
    const entry = live.current.get(feedId);
    if (entry) entry.retries = 0;
    setAttempts((prev) => ({ ...prev, [feedId]: (prev[feedId] ?? 0) + 1 }));
  }, []);

  /**
   * ONE CAMERA'S IDENTITY — what has to change for THIS peer to be rebuilt.
   *
   * The address it is opened at, the profile it is opened with, and how many
   * times the operator has asked for it again. A session cannot be re-pointed
   * once open: the camera and the profile are signed into the grant, so a
   * change to either is a different session, not a setting.
   */
  const targetKey = (t: PlaybackTarget) =>
    `${t.towerId}:${t.index}/${t.profile ?? ""}#${attempts[t.id] ?? 0}`;

  /**
   * The effect's trigger. Targets are objects rebuilt on every render, so the
   * dependency has to be a string — depending on the array itself would re-run
   * on every unrelated re-render, and this app re-renders once a second on its
   * own timers.
   *
   * ⚠ IT IS A TRIGGER, NOT A SCOPE. This string changes when ANY camera
   * changes, and that used to be the same thing as tearing every camera down,
   * because the effect owned them all and its cleanup closed the lot. Switching
   * camera 1's profile therefore dropped camera 2's peer as well — two
   * independent sessions, one shared fate. The body below now diffs per feed
   * and only touches what actually moved; this key just says "something did".
   */
  const key = targets
    .map((t) => `${t.id}@${targetKey(t)}`)
    .sort()
    .join("|");

  /* Close one camera and forget it. Everything that can outlive a peer is
     stopped here — the in-flight open, the poll timers, the handle — because a
     camera that is being replaced must not keep a tower session warm. */
  const dispose = (id: string, entry: Entry) => {
    entry.disposed = true;
    entry.controller.abort();
    entry.timers.forEach(clearTimeout);
    void entry.handle?.close();
    live.current.delete(id);
    openHandles.current.delete(id);
  };


  /**
   * Open one camera, and keep it open.
   *
   * ⚠ EVERYTHING PER-CAMERA LIVES IN HERE so a reconnect can re-run exactly
   * what the first attempt ran. Before this, opening was inlined in the
   * reconciling effect's loop, which meant the ONLY way to reopen anything was
   * to change the effect's key and rebuild every entry the diff touched — fine
   * for an operator pressing retry, useless for a connection that drops on its
   * own at three in the morning.
   */
  const connect = useCallback((entry: Entry) => {
    const id = entry.target.id;
    const set = (phase: PlaybackPhase) => {
      if (entry.disposed) return;
      setPhases((prev) => ({ ...prev, [id]: phase }));
    };

    /**
     * Give up, or go round again.
     *
     * The single place the transient/terminal decision is made, so there is no
     * arrangement of callers that can retry an authorization answer or park a
     * recoverable one.
     */
    const backOff = (why: PlaybackError) => {
      if (entry.disposed) return;
      if (TERMINAL.has(why.failure) || entry.retries >= MAX_RECONNECTS) {
        /* The honest terminal state, unchanged — reached AFTER the budget
           rather than instead of it. */
        releaseForRetry(entry, openHandles.current);
        set({ kind: "failed", error: why });
        return;
      }
      const attempt = entry.retries + 1;
      entry.retries = attempt;
      set({ kind: "reconnecting", attempt, of: MAX_RECONNECTS });

      /* The grant and the camera are given back BEFORE asking for another. A
         client that stacked sessions while reconnecting would hold two of a
         tower's finite slots for the same tile. */
      releaseForRetry(entry, openHandles.current);

      const base = RECONNECT_DELAYS_MS[Math.min(attempt - 1, RECONNECT_DELAYS_MS.length - 1)];
      /* Jittered so a tower that drops four tiles at once does not get four
         reconnects landing on the same millisecond, four times over. */
      const wait = Math.round(base * (0.8 + Math.random() * 0.4));
      entry.pending = setTimeout(() => {
        entry.pending = null;
        connectRef.current(entry);
      }, wait);
    };

    set(entry.retries === 0
      ? { kind: "connecting" }
      : { kind: "reconnecting", attempt: entry.retries, of: MAX_RECONNECTS });

    void (async () => {
      try {
        const opened = await openPlayback(
          {
            towerId: entry.target.towerId,
            index: entry.target.index,
            ...(entry.target.profile !== undefined
              ? { profile: entry.target.profile }
              : {}),
          },
          {
            onStream: (stream) => {
              /* MEDIA ARRIVING IS WHAT RESETS THE BUDGET — not the session
                 opening and not the answer applying. A feed that negotiates
                 perfectly and never shows a frame has not recovered, and
                 crediting it there would let exactly that failure loop forever
                 on a budget it kept refilling. */
              entry.retries = 0;
              entry.everPlayed = true;
              set({ kind: "playing", stream });
            },
            /* Long after negotiation succeeded, possibly. Handed to the same
               decision as every other failure rather than parked on screen. */
            onFailure: (error) => backOff(error),
            /* THE PATH WENT AWAY. `failed` is acted on at once; `disconnected`
               gets its grace first, because ICE recovers from it unaided more
               often than not — and when it does, the check below finds the peer
               connected again and does nothing at all. */
            onDropped: (state) => {
              if (entry.disposed || entry.pending) return;
              const act = () => {
                entry.pending = null;
                if (entry.disposed) return;
                if (entry.handle?.pc.connectionState === "connected") return;
                backOff(
                  new PlaybackError(
                    "media_unreachable",
                    entry.everPlayed
                      ? "The connection to this camera dropped"
                      : "No media arrived from this camera",
                  ),
                );
              };
              if (state === "failed") act();
              else entry.pending = setTimeout(act, DISCONNECT_GRACE_MS);
            },
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
        openHandles.current.set(id, opened);

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
        /* Including the very first attempt. A cold start on a phone that has
           just woken with no route yet is the same shape as a drop, and telling
           an operator to press retry for it is asking them to do what the app
           can do itself. */
        backOff(
          err instanceof PlaybackError
            ? err
            : new PlaybackError("unreachable", "Could not start playback"),
        );
      }
    })();
  }, []);

  /* Broken out through a ref because `backOff` schedules a call to `connect`
     from inside `connect` — a plain reference would capture the first
     definition and pin every reconnect to the render it was born in. */
  const connectRef = useRef<(entry: Entry) => void>(connect);
  connectRef.current = connect;

  useEffect(() => {
    const wanted = new Map(targets.map((t) => [t.id, t]));

    /* ── 1. CLOSE only what actually changed ────────────────────────────
       A camera whose key still matches is left completely alone: its peer, its
       stream, its poll timers and its session all survive a sibling's switch.
       This is the whole bug fix, and it is a `continue`. */
    for (const [id, entry] of [...live.current]) {
      const t = wanted.get(id);
      if (t && targetKey(t) === entry.key) continue;
      dispose(id, entry);
    }

    /* ── 2. Forget the phases of cameras nobody is watching any more.
       Guarded, because an unconditional `setPhases` here would re-render on
       every run of an effect that usually has nothing to do. */
    setPhases((prev) => {
      const stale = Object.keys(prev).filter((id) => !wanted.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const id of stale) delete next[id];
      return next;
    });

    /* ── 3. OPEN only what is missing. */
    for (const target of targets) {
      if (live.current.has(target.id)) continue;

      const entry: Entry = {
        key: targetKey(target),
        target,
        controller: new AbortController(),
        handle: null,
        disposed: false,
        timers: [],
        retries: 0,
        everPlayed: false,
        pending: null,
      };
      live.current.set(target.id, entry);
      connect(entry);
    }

    /* NO CLEANUP HERE, and that is deliberate rather than an omission. A
       cleanup runs before the next body and cannot know what the next body
       wants, so anything it closed would be closed unconditionally — which is
       exactly how one camera's switch used to take its sibling down. Closing is
       the body's job now, above, where the diff is known. Unmount is handled by
       its own effect below. */
    /* `targets` is intentionally not a dependency — `key` is its stable
       projection. See the note above. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * Unmount: close everything, once.
   *
   * Separate from the reconciling effect because it is the one moment when
   * closing every peer IS correct. Under StrictMode this runs on the simulated
   * unmount and the reconcile above then finds an empty pool and reopens — the
   * same double-open the abort-aware `openPlayback` was already written for.
   */
  useEffect(() => {
    const pool = live.current;
    return () => {
      for (const [id, entry] of [...pool]) dispose(id, entry);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  /**
   * Coming back to the tab.
   *
   * ══════════════════════════════════════════════════════════════════════
   *  THE MOBILE CASE, WHICH IS THE ONE THAT ACTUALLY HURTS.
   * ══════════════════════════════════════════════════════════════════════
   *
   * A phone browser suspends a backgrounded tab: timers stop, and the peer
   * connection is usually torn down by the OS within seconds. Nothing here
   * noticed, so returning to the app found feeds parked in a terminal failure
   * with no way back but the whole cold sequence — new session, new offer, new
   * gather — which is what "minimise and come back = getting streams" was.
   *
   * ⚠ HIDING IS NOT A TEARDOWN. Nothing is closed on the way out: a tab that is
   * hidden for four seconds while somebody reads a notification must come back
   * to a feed that never stopped, and closing sessions eagerly would guarantee
   * the opposite. The browser may kill the transport anyway — that is its
   * right, and the drop handler is what catches it.
   *
   * On the way back in, three cases, and only one of them does anything:
   *
   *   still connected   nothing at all. This is the fast path and it is FREE:
   *                     the session was never given up, so there is nothing to
   *                     re-establish and the picture is already moving.
   *   dropped           reconnect NOW rather than at the back of a backoff that
   *                     may have grown to fifteen seconds while nobody was
   *                     watching. Waiting out a delay accrued in the background
   *                     is the slow cold start wearing a different name.
   *   terminal          left alone. A revoked grant is still revoked, and
   *                     switching apps is not new information about it.
   *
   * The budget is refilled on the way in for the same reason a deliberate retry
   * refills it: the network on the other side of a backgrounded minute is
   * frequently a different network.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const entry of live.current.values()) {
        if (entry.disposed) continue;
        const phase = phasesRef.current[entry.target.id];
        /* Terminal failures are somebody's answer, not a stale connection. */
        if (phase?.kind === "failed") continue;
        if (entry.handle?.pc.connectionState === "connected") continue;
        entry.retries = 0;
        releaseForRetry(entry, openHandles.current);
        connectRef.current(entry);
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    /* `pageshow` too: iOS Safari restores from its back/forward cache without
       ever firing a visibility change, and a restored page has a peer that is
       long gone. */
    window.addEventListener("pageshow", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
