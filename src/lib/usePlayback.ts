import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { CAMERAS_PER_TOWER } from "@/lib/types";

/**
 * Live WebRTC sessions for every camera this browser is holding, across every
 * screen — the app's session manager.
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
 * ══════════════════════════════════════════════════════════════════════
 *  ATTACHING IS NOT OPENING, AND DETACHING IS NOT CLOSING
 * ══════════════════════════════════════════════════════════════════════
 *
 * Owning the peers up here was not enough on its own, and every navigation
 * proved it. The shell owned them, but it closed any camera the CURRENT screen
 * did not list: the fleet listed its visible tiles at `sub`, a tower listed its
 * two cameras at their chosen profile, and the two lists were swapped whole on
 * every drill-in. The camera an operator had just clicked was torn down and
 * renegotiated on the way into its own tower, and again on the way out — the
 * ownership was the shell's, but the lifetime was still the screen's.
 *
 * So there are two sets, and only one of them belongs to the screen:
 *
 *   held      every session open, keyed by CAMERA — (tower, index) — and never
 *             by screen or by feed list. At most one per camera, whoever asks.
 *   attached  the cameras the current screen is showing. A screen ATTACHES to
 *             the held session if there is one and asks for one if there is
 *             not. Leaving a screen DETACHES, and detaching closes nothing.
 *
 * A detached session keeps streaming, unseen, so an operator who comes back
 * finds a picture that never stopped. These are the ONLY ways one ends:
 *
 *   idle      nothing has attached to it for IDLE_CLOSE_MS;
 *   left      the operator opened a DIFFERENT tower — the one they were on is
 *             left, and its unattached sessions close at once instead of
 *             idling. The same "a different tower, not leaving one" line the
 *             live-view clock draws: stepping out to the fleet or an alert is
 *             not leaving a tower, opening another one is;
 *   evicted   a camera needs a slot and MAX_HELD_SESSIONS are already held —
 *             the longest-idle unattached one goes, never an attached one;
 *   stopped   deliberately: the camera stopped being live or left the roster,
 *             the operator chose a different profile or pressed retry, the tab
 *             unloaded, or the operator signed out (which unmounts the shell).
 *
 * ── THE PROFILE IS A REQUIREMENT ONLY WHEN SOMEBODY CHOSE ONE ──────────
 *
 * A profile is signed into the grant, so a session cannot change one: a
 * different profile is a different session. That used to make the profile part
 * of the camera's IDENTITY, and with the fleet asking for `sub` and a tower
 * asking for the default, one camera was two different sessions on two
 * screens. A target now says what it REQUIRES (`profile` — the operator picked
 * a quality) apart from what it would PREFER if a session has to be opened
 * anyway (`prefer` — the fleet's sub). Only a requirement the held session does
 * not meet reopens it, which is exactly one case — an operator choosing a
 * quality — and that is the one renegotiation that is meant.
 *
 * ── STRICTMODE ─────────────────────────────────────────────────────────
 *
 * Both guards, because they cover different halves. The `AbortController` is
 * checked after every await inside `openPlayback` and stops work CONTINUING.
 * The per-entry `disposed` flag stops a late success from LEAKING: the session
 * may already have been created when cleanup ran, and the cleanup cannot close
 * a handle that did not exist yet — so the resolver closes it itself.
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
 * How many cameras may be ATTACHED at once, whatever the screen asks for.
 *
 * Eight is four sites at two cameras each, which is the widest the design's
 * two-column bands go before a tile stops being worth looking at. It is also a
 * number a browser will hold peers for without complaint, and — the reason it
 * is a hard cap rather than a guideline — it stops a wall-mounted 4K monitor
 * from quietly opening sixty sessions because they all technically fit. A tile
 * over the ceiling says so rather than pretending to load.
 *
 * Enforced HERE, on whatever a screen attaches, so no screen can talk its way
 * past it. Which eight is the screen's call — it lists in priority order.
 */
export const MAX_LIVE_TILES = 8;

/**
 * How many sessions this browser may HOLD, attached or idle.
 *
 * The attached ceiling plus one tower's worth: opening a tower from a full wall
 * keeps the whole wall warm behind it and still has room for that tower's own
 * cameras if they were not on it. Reaching it evicts the longest-idle session —
 * never one somebody is looking at.
 *
 * There is no separate per-tower number because the pool is keyed by camera:
 * this browser holds at most one session per camera, so at most
 * CAMERAS_PER_TOWER on any tower, however many screens want it.
 */
export const MAX_HELD_SESSIONS = MAX_LIVE_TILES + CAMERAS_PER_TOWER;

/**
 * How long a session nobody is looking at is kept open.
 *
 * Long enough to cover a side trip — an alert triaged, a tower opened and
 * closed, a look at another screen — so coming back costs nothing. Short
 * enough that a camera nobody is watching stops spending an off-grid tower's
 * uplink within a minute. An idle session is still a live stream and a claimed
 * camera: this is the whole price of the persistence, and it is bounded here.
 */
export const IDLE_CLOSE_MS = 60_000;

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

/**
 * Failures a RETURN FROM BACKGROUND is new information about.
 *
 * ⚠ THE DISTINCTION THIS TURNS ON: a phone that has been in someone's pocket
 * for five minutes comes back to a session that is gone — suspended timers,
 * a torn-down peer, often a different network — and every one of those is a
 * statement about the PAST. Coming back is the new fact, and the honest answer
 * is to establish the feed again, which is exactly what the retry button does.
 *
 * `not_permitted` is the one that survives it: coordination has said this
 * account may not watch this camera, and switching apps is not an argument
 * against that. It stays on screen with its retry, because a person choosing
 * to ask again is different from this app asking on a timer.
 *
 * `session_expired` is deliberately NOT here. It means the grant lapsed or the
 * viewer session is gone — the ordinary end of being away — and re-creating one
 * is what an operator wants. If access was genuinely revoked, the new session
 * is refused and the honest `not_permitted` takes its place one request later.
 */
function recoverableOnReturn(error: PlaybackError): boolean {
  return error.failure !== "not_permitted";
}

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
   * A profile this screen REQUIRES — the operator chose one for this camera.
   *
   * ⚠ THE ONLY THING ABOUT A TARGET THAT CAN REOPEN A HELD SESSION. There is no
   * such thing as changing the profile of an open session: it is signed into
   * the grant, so a held session at a different profile is closed and a new one
   * opened through exactly the path a retry uses — no second mechanism, and the
   * honest `connecting` state comes for free rather than being simulated.
   */
  profile?: string;
  /**
   * The profile to open at IF a session has to be opened and nothing is
   * required — the fleet's `sub`. It never reopens anything: a camera already
   * streaming at another profile is reused as it is, because renegotiating a
   * working stream to save bandwidth spends more than it saves.
   */
  prefer?: string;
  /**
   * What an open naming no profile resolves to: the camera's advertised
   * default. So a session opened with nothing and a requirement for the default
   * compare EQUAL, and picking the quality that is already playing does not
   * tear it down to open the same stream again.
   */
  defaultProfile?: string;
}

/** What the screen wants, handed to the manager on every render. */
export interface SessionDemand {
  /**
   * What the current screen is showing, in priority order. The first
   * MAX_LIVE_TILES that may be held are attached; the rest get no phase, which
   * is how a tile learns it is over the ceiling.
   */
  attached: PlaybackTarget[];
  /**
   * Cameras that may be held AT ALL, by `cameraKey`: live, in the roster, and
   * not a fixture. A held session whose camera leaves this set is closed at
   * once rather than idled — a camera that has said it is down, or a tower that
   * is gone, is not coming back inside a minute because nobody closed it.
   */
  eligible: ReadonlySet<string>;
  /** The tower the operator has open, or null. Opening a DIFFERENT one is leaving. */
  focusTower: string | null;
}

/** A session's address, and the pool's key. One session per camera. */
export const cameraKey = (towerId: string, index: number) => `${towerId}:${index}`;

interface Entry {
  /** The pool key. Never the feed list, never the screen. */
  camera: string;
  /** The feed it was opened for — what a reconnect reopens and phases are keyed by. */
  target: PlaybackTarget;
  /** The profile actually named at open; `undefined` is the camera's default. */
  openedWith: string | undefined;
  /** The operator's retry count for this feed when it was opened. */
  generation: number;
  /** Whether a screen is showing it right now. */
  attached: boolean;
  /** When it was last detached, which is the eviction order. */
  idleSince: number;
  /** The idle close, armed while detached and cancelled by attaching. */
  idle: ReturnType<typeof setTimeout> | null;
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
  /**
   * Phase by feed id, for ATTACHED cameras only. A feed with no entry is not
   * being played here — including one held idle behind another screen, which
   * is streaming but is not this screen's to show or to steer.
   */
  phases: Record<string, PlaybackPhase>;
  /** Reopen one camera. Deliberate, operator-driven — there is no retry loop. */
  retry: (feedId: string) => void;
  /**
   * The live session for one ATTACHED camera, or `null`.
   *
   * PTZ is session-scoped — the session IS the authorization, and the protocol
   * defines no PTZ endpoint outside one — so a command needs the same handle
   * the stream is using. Read from a ref at press time rather than returned as
   * state, because a command wants the session that exists NOW, and re-rendering
   * every tile whenever a session is established would be a lot of churn for a
   * value only a pointer event reads.
   */
  sessionFor: (feedId: string) => ViewerSession | null;
  /**
   * The profile a held session is ACTUALLY streaming, or `undefined` when none
   * is held or the camera advertises no profiles. A reused session may be at a
   * profile nobody on this screen asked for, and a quality selector that showed
   * the operator's last pick over it would be describing a stream that is not
   * the one playing.
   */
  profileOf: (feedId: string) => string | undefined;
}

/**
 * The cameras a screen gets, in its own order, capped and de-duplicated.
 *
 * Shared by the render (which phases to hand out) and the effect (which
 * sessions to attach), so the two cannot disagree about which eight won.
 */
function selectAttached(
  attached: PlaybackTarget[],
  eligible: ReadonlySet<string>,
): Map<string, PlaybackTarget> {
  const out = new Map<string, PlaybackTarget>();
  for (const t of attached) {
    if (out.size >= MAX_LIVE_TILES) break;
    const camera = cameraKey(t.towerId, t.index);
    if (!eligible.has(camera) || out.has(camera)) continue;
    out.set(camera, t);
  }
  return out;
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

export function usePlayback({ attached, eligible, focusTower }: SessionDemand): Playback {
  const [phases, setPhases] = useState<Record<string, PlaybackPhase>>({});
  /* Read by the visibility listener, which is registered once and would
     otherwise close over the phases of the render that mounted it. */
  const phasesRef = useRef(phases);
  phasesRef.current = phases;
  const [attempts, setAttempts] = useState<Record<string, number>>({});

  /** Every handle currently open, by feed id, for the unload path and PTZ. */
  const openHandles = useRef<Map<string, PlaybackHandle>>(new Map());

  /**
   * Every HELD session, by camera, across every screen and every effect run.
   *
   * ⚠ THIS REF IS THE MANAGER. It used to be a `Map` created fresh inside the
   * effect, which made the effect's cleanup the only way to close anything —
   * and a cleanup cannot close *some* of what it owns, so every re-run tore
   * down every camera. Held here, the effect reconciles instead: it attaches
   * what the screen shows, detaches the rest, and closes only by the rules in
   * the header.
   */
  const live = useRef<Map<string, Entry>>(new Map());

  /** The last tower the operator had open — so "a different tower" can be
      told apart from "no tower right now", which is not leaving one. */
  const lastFocus = useRef<string | null>(null);

  const retry = useCallback((feedId: string) => {
    /* A DELIBERATE PRESS REFILLS THE BUDGET. The automatic reconnects have run
       out by the time this button is reachable, and an operator who has just
       walked to a window or switched to wifi is telling us something the retry
       counter cannot know. Without this, retry would burn one attempt against
       an exhausted budget and fall straight back to the failure. */
    for (const e of live.current.values()) if (e.target.id === feedId) e.retries = 0;
    setAttempts((prev) => ({ ...prev, [feedId]: (prev[feedId] ?? 0) + 1 }));
  }, []);

  const selected = selectAttached(attached, eligible);

  /**
   * The effect's trigger. Targets are objects rebuilt on every render, so the
   * dependency has to be a string — depending on the array itself would re-run
   * on every unrelated re-render, and this app re-renders once a second on its
   * own timers.
   *
   * ⚠ IT IS A TRIGGER, NOT A SCOPE. It changes when anything about the demand
   * changes — which cameras are attached, what they require, a retry, what is
   * eligible, which tower is open — and says only "look again". The body
   * decides per camera, and most runs touch nothing but the attached flags.
   */
  const key = [
    [...selected.values()]
      .map(
        (t) =>
          `${t.id}/${t.profile ?? ""}/${t.prefer ?? ""}/${t.defaultProfile ?? ""}#${attempts[t.id] ?? 0}`,
      )
      .sort()
      .join(","),
    [...eligible].sort().join(","),
    focusTower ?? "",
  ].join("|");

  /* Close one session and forget it. Everything that can outlive a peer is
     stopped here — the in-flight open, the poll and idle timers, the handle —
     because a session being let go must not keep a tower camera warm. */
  const dispose = useCallback((entry: Entry) => {
    if (entry.disposed) return;
    entry.disposed = true;
    entry.attached = false;
    entry.controller.abort();
    entry.timers.forEach(clearTimeout);
    entry.timers = [];
    if (entry.pending) clearTimeout(entry.pending);
    if (entry.idle) clearTimeout(entry.idle);
    entry.pending = null;
    entry.idle = null;
    const id = entry.target.id;
    if (entry.handle) {
      if (openHandles.current.get(id) === entry.handle) openHandles.current.delete(id);
      void entry.handle.close();
    }
    if (live.current.get(entry.camera) === entry) live.current.delete(entry.camera);
    setPhases((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  /* A screen let go of it. It keeps streaming, unseen, until something
     attaches again or the idle close runs — see the header for why. */
  const detach = useCallback(
    (entry: Entry) => {
      if (!entry.attached || entry.disposed) return;
      entry.attached = false;
      entry.idleSince = Date.now();
      entry.idle = setTimeout(() => {
        entry.idle = null;
        dispose(entry);
      }, IDLE_CLOSE_MS);
    },
    [dispose],
  );

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
  const connect = useCallback(
    (entry: Entry, resuming = false) => {
      const id = entry.target.id;
      const set = (phase: PlaybackPhase) => {
        if (entry.disposed) return;
        setPhases((prev) => ({ ...prev, [id]: phase }));
      };

      /**
       * Give up, or go round again.
       *
       * The single place the transient/terminal decision is made, so there is
       * no arrangement of callers that can retry an authorization answer or
       * park a recoverable one.
       */
      const backOff = (why: PlaybackError) => {
        if (entry.disposed) return;
        /* NOBODY IS WATCHING IT. A detached session that drops is closed, not
           rebuilt: reconnecting a camera no screen is showing spends a grant
           and an uplink on a picture nobody will see, and the next screen to
           want it opens it fresh, honestly, from `connecting`. */
        if (!entry.attached) {
          dispose(entry);
          return;
        }
        if (TERMINAL.has(why.failure) || entry.retries >= MAX_RECONNECTS) {
          /* The honest terminal state, unchanged — reached AFTER the budget
             rather than instead of it. */
          releaseForRetry(entry, openHandles.current);
          set({ kind: "failed", error: why });
          return;
        }
        /* ⚠ A HIDDEN TAB DOES NOT SPEND THE BUDGET, and this is the half of
           the phone bug that made the other half fatal. A backgrounded phone
           suspends timers and takes the radio down, so every attempt made in
           somebody's pocket fails on `fetch` within milliseconds of being
           allowed to run. Five of those burn the whole allowance against a
           network that was never asked, and the operator returns to a feed
           that has already given up — terminal before they were even looking.

           So while hidden: give back the grant, say what is happening, and
           STOP. The return handler below reconnects from a full budget the
           moment there is a network and a person to see it. */
        if (document.visibilityState === "hidden") {
          set({ kind: "reconnecting", attempt: entry.retries + 1, of: MAX_RECONNECTS });
          releaseForRetry(entry, openHandles.current);
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
          /* Detached while it waited: same rule as above. */
          if (!entry.attached) {
            dispose(entry);
            return;
          }
          connectRef.current(entry);
        }, wait);
      };

      /* `connecting` is a feed that has never played; `reconnecting` is one the
         operator was watching and expects back. Coming off a background is the
         second thing even on the first attempt, so it says so — the picture was
         there when they locked the phone. It costs no budget: `resuming` only
         changes the word. */
      set(entry.retries === 0 && !resuming
        ? { kind: "connecting" }
        : {
            kind: "reconnecting",
            attempt: Math.max(1, entry.retries),
            of: MAX_RECONNECTS,
          });

      void (async () => {
        try {
          const opened = await openPlayback(
            {
              towerId: entry.target.towerId,
              index: entry.target.index,
              /* What it was OPENED with, not what the latest screen prefers: a
                 reconnect restores the stream the operator was watching, and a
                 profile change is a different session, made on purpose. */
              ...(entry.openedWith !== undefined ? { profile: entry.openedWith } : {}),
            },
            {
              onStream: (stream) => {
                /* MEDIA ARRIVING IS WHAT RESETS THE BUDGET — not the session
                   opening and not the answer applying. A feed that negotiates
                   perfectly and never shows a frame has not recovered, and
                   crediting it there would let exactly that failure loop
                   forever on a budget it kept refilling. */
                entry.retries = 0;
                entry.everPlayed = true;
                set({ kind: "playing", stream });
              },
              /* Long after negotiation succeeded, possibly. Handed to the same
                 decision as every other failure rather than parked on screen. */
              onFailure: (error) => backOff(error),
              /* THE PATH WENT AWAY. `failed` is acted on at once;
                 `disconnected` gets its grace first, because ICE recovers from
                 it unaided more often than not — and when it does, the check
                 below finds the peer connected again and does nothing at all. */
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
             just woken with no route yet is the same shape as a drop, and
             telling an operator to press retry for it is asking them to do what
             the app can do itself. */
          backOff(
            err instanceof PlaybackError
              ? err
              : new PlaybackError("unreachable", "Could not start playback"),
          );
        }
      })();
    },
    [dispose],
  );

  /* Broken out through a ref because `backOff` schedules a call to `connect`
     from inside `connect` — a plain reference would capture the first
     definition and pin every reconnect to the render it was born in. */
  const connectRef = useRef<(entry: Entry, resuming?: boolean) => void>(connect);
  connectRef.current = connect;

  useEffect(() => {
    const pool = live.current;
    const wanted = selectAttached(attached, eligible);

    /* ── 1. STOPPED — cameras that may not be held at all any more. At once,
       not after the idle: nothing is coming back to a camera that is down. */
    for (const entry of [...pool.values()]) {
      if (!eligible.has(entry.camera)) dispose(entry);
    }

    /* ── 2. LEFT — a DIFFERENT tower was opened. The one before it is left,
       and whatever of it no screen is showing closes now rather than idling. A
       null focus (the fleet, an alert, a person) is not leaving anything, so
       the ref only ever moves to another tower. */
    if (focusTower !== null) {
      const left = lastFocus.current;
      if (left !== null && left !== focusTower) {
        for (const entry of [...pool.values()]) {
          if (entry.target.towerId === left && !wanted.has(entry.camera)) dispose(entry);
        }
      }
      lastFocus.current = focusTower;
    }

    /* ── 3. EVERY HELD SESSION: attach it, reopen it, or let it go idle.
       ⚠ A MATCHING SESSION IS REUSED WHATEVER SCREEN OPENED IT, and that is the
       whole fix — the fleet's session is the tower's session is the fleet's
       again. Only a requirement it cannot meet (a profile the operator chose,
       or a retry they pressed) closes it, and then only it. */
    for (const entry of [...pool.values()]) {
      const t = wanted.get(entry.camera);
      if (!t) {
        detach(entry);
        continue;
      }
      const meets =
        entry.generation === (attempts[t.id] ?? 0) &&
        (t.profile === undefined || t.profile === (entry.openedWith ?? t.defaultProfile));
      if (!meets) {
        dispose(entry);
        continue;
      }
      entry.attached = true;
      if (entry.idle) {
        clearTimeout(entry.idle);
        entry.idle = null;
      }
    }

    /* ── 4. OPEN only what nobody holds. */
    for (const [camera, t] of wanted) {
      if (pool.has(camera)) continue;

      /* Make room by evicting the longest-idle session. Never an attached
         one — and the attached ceiling is below the held one, so there is
         always an idle one to evict when the pool is full. */
      while (pool.size >= MAX_HELD_SESSIONS) {
        let oldest: Entry | null = null;
        for (const e of pool.values()) {
          if (!e.attached && (!oldest || e.idleSince < oldest.idleSince)) oldest = e;
        }
        if (!oldest) break;
        dispose(oldest);
      }

      const entry: Entry = {
        camera,
        target: t,
        openedWith: t.profile ?? t.prefer,
        generation: attempts[t.id] ?? 0,
        attached: true,
        idleSince: 0,
        idle: null,
        controller: new AbortController(),
        handle: null,
        disposed: false,
        timers: [],
        retries: 0,
        everPlayed: false,
        pending: null,
      };
      pool.set(camera, entry);
      connect(entry);
    }

    /* NO CLEANUP HERE, and that is deliberate rather than an omission. A
       cleanup runs before the next body and cannot know what the next body
       wants, so anything it closed would be closed unconditionally — which is
       exactly how one screen's departure used to take every stream down.
       Closing is the body's job, above, where the rules are applied. Unmount
       is handled by its own effect below. */
    /* `attached` and `eligible` are intentionally not dependencies — `key` is
       their stable projection. See the note above. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  /**
   * Unmount: close everything, once.
   *
   * The one moment when closing every peer IS correct — and it is sign-out as
   * well as teardown, because `AuthGate` unmounts the whole shell. Under
   * StrictMode this runs on the simulated unmount and the reconcile above then
   * finds an empty pool and reopens — the same double-open the abort-aware
   * `openPlayback` was already written for.
   */
  useEffect(() => {
    const pool = live.current;
    return () => {
      for (const entry of [...pool.values()]) dispose(entry);
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
   *   failed            RE-ESTABLISHED, unless it was refused. This is the
   *                     phone case and it used to be the bug: the handler
   *                     skipped anything already in `failed`, so a tile whose
   *                     session died in somebody's pocket sat on "Stream
   *                     unavailable" until they tapped retry — and the tap
   *                     worked instantly, which is the tell that nothing was
   *                     broken but this rule. `recoverableOnReturn` decides;
   *                     only `not_permitted` is left alone, because that one
   *                     is an answer rather than a casualty.
   *
   * Only ATTACHED sessions are revived. An idle one nobody is showing is left
   * to its drop handler, which closes it rather than rebuilding it.
   *
   * The budget is refilled on the way in for the same reason a deliberate retry
   * refills it: the network on the other side of a backgrounded minute is
   * frequently a different network.
   */
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      for (const entry of live.current.values()) {
        if (entry.disposed || !entry.attached) continue;
        const phase = phasesRef.current[entry.target.id];
        /* An answer, not a casualty — see `recoverableOnReturn`. */
        if (phase?.kind === "failed" && !recoverableOnReturn(phase.error)) continue;
        if (entry.handle?.pc.connectionState === "connected") continue;
        /* A full budget, because the network on the other side of a
           backgrounded minute is frequently a different network — and because
           anything spent while hidden was spent against no network at all. */
        entry.retries = 0;
        releaseForRetry(entry, openHandles.current);
        connectRef.current(entry, true);
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

  const sessionFor = useCallback((feedId: string) => {
    const handle = openHandles.current.get(feedId);
    if (!handle) return null;
    /* A held session behind another screen is not this screen's to steer. */
    for (const e of live.current.values()) {
      if (e.handle === handle) return e.attached ? handle.session : null;
    }
    return null;
  }, []);

  const profileOf = useCallback((feedId: string) => {
    for (const e of live.current.values()) {
      if (e.target.id === feedId) return e.openedWith ?? e.target.defaultProfile;
    }
    return undefined;
  }, []);

  /* Only what this screen attached is handed out. Computed in render, from the
     same selection the effect uses, so a screen that comes back to a held
     session shows its picture on the very first frame rather than one effect
     later. */
  const attachedKey = [...selected.values()].map((t) => t.id).join("|");
  const shown = useMemo(() => {
    const out: Record<string, PlaybackPhase> = {};
    for (const id of attachedKey ? attachedKey.split("|") : []) {
      const phase = phases[id];
      if (phase) out[id] = phase;
    }
    return out;
  }, [phases, attachedKey]);

  return { phases: shown, retry, sessionFor, profileOf };
}
