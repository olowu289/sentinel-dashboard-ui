import { createElement, useCallback, useEffect, useRef, useState } from "react";
import { formatZoom, useZoomReadout } from "@/lib/useZoomReadout";
import { captureFrame, downloadBlob, snapshotFilename } from "@/lib/snapshot";
import type { TileControl } from "@/components/ControlStack";
import type { CameraFeed } from "@/lib/types";
import type { MutationPhase } from "@/lib/useMutation";
import { useSiren } from "@/lib/useSiren";
import { useSession } from "@/components/AuthProvider";
import type { Feature } from "@/lib/features";
import { useMutation } from "@/lib/useMutation";
import {
  PTZ_CLICK_MS,
  PTZ_ERROR_LINGER_MS,
  SWEEP_POLL_MS,
  CONTINUOUS_AXES,
  beginHold,
  describeControl,
  describePtzFailure,
  describeStepRefusal,
  isStepDirection,
  readStatus,
  readSweep,
  step,
  stopKeepingSweep,
  stopOrHome,
  sweepPause,
  sweepResume,
  sweepStart,
  sweepStop,
  type JogDirection,
  type PtzHold,
} from "@/lib/api/ptz";
import {
  isPtzYielded,
  sweepOf,
  type PtzControl,
  type PtzResult,
  type SweepStatus,
  type ViewerSession,
} from "@kallon/sentry-sdk";
import { SweepRadar } from "@/components/SweepRadar";

/**
 * The device's own countdown to an auto-resume, as `m:ss`.
 *
 * `undefined` draws nothing, per the badge contract -- a paused sweep whose
 * countdown the device did not report has no number to show, and inventing one
 * would be a claim about when a camera is going to start moving again.
 */
function formatCountdown(sec: number | undefined): string | null {
  if (sec === undefined || !Number.isFinite(sec)) return null;
  const whole = Math.max(0, Math.round(sec));
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/* The feed renders slightly over-scaled at rest so the PTZ head has somewhere
   to travel before any letterboxing shows. Without it, panning a 1x image just
   drags black in from the edge. */
/**
 * Overscan, so a FIXED camera has somewhere to pan to.
 *
 * ⚠ ONLY FOR A CAMERA WITH NO HEAD. A tile driving a real head renders at
 * exactly 1 — the true frame, uncropped — because every movement it offers is
 * the lens actually moving and there is nothing to fake. Without this, a local
 * pan on a fixed camera just drags black in from the edge.
 */
export const BASE_SCALE = 1.15;
export const PAN_STEP = 2.5;

/**
 * Where a FIXED camera's picture is nudged to. POSITION ONLY — there is no
 * local zoom any more; the zoom controls move the lens. See the note on them.
 */
export interface View {
  x: number;
  y: number;
}

export const HOME: View = { x: 0, y: 0 };

/** Furthest the media can travel before its own edge enters the frame. */
export function maxPan(scale: number) {
  return ((scale - 1) / (2 * scale)) * 100;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

/* How often to check the tilt limit while a tilt is held. The tower is the real
   guard (it halts tilt at the stop); this poll is only so the button reflects it
   and stops pushing. A real round trip to the camera, so no faster than needed. */
const TILT_LIMIT_POLL_MS = 400;

/**
 * A tile's actuators, and the eight controls that drive them.
 *
 * Both walls carry the full set now, so the set lives here for the reason
 * `FeedChip` owns the state grammar: two walls showing the same four cameras
 * must not offer two different vocabularies for acting on them. Add a ninth
 * control and both pick it up; build the list twice and only one of them will.
 *
 * The components themselves stay separate — the fleet tile is a picture in a
 * grid and the tower tile carries the PTZ pad, the talk timer and the zoom
 * readout around it. What is shared is what a control *is*, not how a tile is
 * laid out.
 */
export function useTileControls({
  feed,
  isDead,
  fullscreen = false,
  fsBtnRef,
  recordPhase,
  session,
  videoRef,
  streaming = false,
  towerName,
  zoomReadout = false,
  onToggleFullscreen,
  onToggleRecord,
}: {
  feed: CameraFeed;
  /** No link, so nothing can be acted on and nothing can be sounding. */
  isDead: boolean;
  fullscreen?: boolean;
  /** Never unmounts, so the tile can hand focus back to it. */
  fsBtnRef?: React.Ref<HTMLButtonElement>;
  /** The record command's phase, so the control can go busy while it runs. */
  recordPhase?: MutationPhase;
  /**
   * The live viewing session for this camera, when there is one.
   *
   * PTZ is session-scoped — the session IS the authorization — so its presence
   * is what separates a real head from a picture. Absent means the local
   * digital nudge, which is all a seeded feed ever had.
   */
  session?: ViewerSession | null;
  /**
   * The element holding the frame, for the snapshot.
   *
   * A ref rather than the element, because the tile mounts and unmounts its
   * `<video>` as playback comes and goes and a captured value would go stale
   * the first time a stream reconnected.
   */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Whether there is a live frame at all. Gates the snapshot control. */
  streaming?: boolean;
  /** The site's name, for the snapshot's filename. Falls back to the id. */
  towerName?: string;
  /**
   * Whether to read the camera's real magnification while it is being zoomed.
   *
   * OPT-IN, and the fleet wall does not take it. Each reading is a round trip
   * to a real camera over an off-grid uplink, and a wall of tiles animating a
   * number nobody is reading is the same arithmetic the live-tile ceiling
   * exists to refuse. The tower view is where somebody is actually watching
   * one camera closely enough for the figure to mean anything.
   */
  zoomReadout?: boolean;
  onToggleFullscreen?: () => void;
  onToggleRecord?: () => void;
}) {
  /* What this account may see. Read here rather than threaded in as a prop:
     this hook is used by two tile components on four screens, and the rail
     already reads the session the same way. */
  const { features } = useSession();

  const [siren, setSiren] = useState(false);
  const [overlays, setOverlays] = useState(false);
  const [talking, setTalking] = useState(false);
  const [talkSec, setTalkSec] = useState(0);
  const [flash, setFlash] = useState(false);
  const [view, setView] = useState<View>(HOME);

  /**
   * The actuators that reach the physical site.
   *
   * Local today — the siren sounds in this browser, the talk timer counts
   * nothing, the shutter writes nothing — so these resolve at once and the
   * pending flash is genuinely brief. Wrapped anyway, and the reason is Stage 7:
   * these become real commands to a real tower, and a fire-and-forget siren is
   * a hazard rather than a rough edge. An operator who pressed it and got
   * silence would believe a speaker was sounding in a yard when it was not.
   *
   * Keyed per feed AND per action, so two tiles cannot share a phase and the
   * siren's failure cannot appear on the shutter.
   *
   * `quiet`: each of these confirms itself — the beacon lights, the timer
   * starts, the frame flashes white.
   */
  const command = useMutation({ quiet: true });
  const key = (action: string) => `${action}:${feed.id}`;

  const isRecording = feed.state === "recording";
  /** Whether this tile drives a real head. Hoisted, because the transform
   *  below now depends on it. */
  const realPtz = Boolean(feed.ptz && session && feed.index !== undefined);

  /**
   * ⚠ A REAL CAMERA IS DRAWN AT 1 — NO CROP, NO SCALE.
   *
   * Every frame used to render at `BASE_SCALE` times a digital zoom factor, so
   * even at "1×" the picture was a 15% crop of what the camera sent. That
   * overscan exists to give the LOCAL pan somewhere to travel, and a camera
   * with a real head does not local-pan — it moves the lens. So on a real
   * camera the crop bought nothing and cost 15% of the frame permanently.
   *
   * A fixed camera keeps it, because there the local nudge is the only pan
   * there is.
   */
  const scale = realPtz ? 1 : BASE_SCALE;
  const limit = maxPan(scale);

  // A dead feed cannot be sounding an alarm at the site.
  const alarming = siren && !isDead;
  useSiren(alarming);

  /* A feed that drops takes its actuators with it: an alarm cannot be sounding
     at a site there is no link to, and a frame that is gone cannot be zoomed. */
  useEffect(() => {
    if (!isDead) return;
    setSiren(false);
    setTalking(false);
    setView(HOME);
    /* A feed that drops takes its actuators with it — and a held move must be
       ENDED rather than merely forgotten, or the head keeps turning until the
       ~3s link-death deadman catches it. */
    const held = holdRef.current;
    holdRef.current = null;
    if (held) void held.stop().catch(() => {});
  }, [isDead]);

  /**
   * Unmount, navigation, StrictMode teardown — all the same obligation.
   *
   * A hold that outlives its tile is a camera nobody is watching still moving.
   * The deadman would stop it within four seconds, but relying on a safety
   * backstop for ordinary teardown is how the backstop stops being a backstop.
   */
  useEffect(
    () => () => {
      const held = holdRef.current;
      holdRef.current = null;
      pressedAt.current = 0;
      if (held) void held.stop().catch(() => {});
    },
    [],
  );

  /* Talk-down is push-to-hold: transmitting is the state with consequences,
     so it is the one that gets the saturated fill and a running timer. */
  const talkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!talking) {
      setTalkSec(0);
      return;
    }
    talkTimer.current = setInterval(() => setTalkSec((s) => s + 1), 1000);
    return () => {
      if (talkTimer.current) clearInterval(talkTimer.current);
    };
  }, [talking]);

  /**
   * ══════════════════════════════════════════════════════════════════
   *  THE TWO ZOOMS, AND WHY ONLY ONE OF THEM IS A CSS TRANSFORM
   * ══════════════════════════════════════════════════════════════════
   *
   * THERE IS ONLY ONE ZOOM NOW, AND IT MOVES THE LENS.
   *
   * The control stack's zoom buttons used to be a CSS crop of the frame that
   * had already arrived — legitimate, free, and not what anybody meant by
   * "zoom" on a camera that has a real one. Magnifying 704×576 pixels makes a
   * blurrier picture of the same view; the lens makes a sharper picture of a
   * closer one. They are different operations and only one is worth a button.
   *
   * So the buttons now drive `CONTINUOUS_AXES.in` / `.out` through the same
   * held continuous-move path the pad's pan and tilt use, and the local crop is
   * gone entirely.
   *
   * WHAT REMAINS LOCAL is the nudge for a camera with NO head, which is the
   * only pan such a tile can offer. It is gated on `feed.ptz`, which the
   * projection sets from `ptz_capable`.
   *
   * ⚠ FOR A REAL HEAD, THE LOCAL TRANSFORM IS NOT APPLIED. This is the bug
   * behind "it only moves a little": the pad used to nudge the on-screen image
   * by 2.5% per tick and clamp it at the frame's edge, so the picture shifted a
   * fraction and stopped while the camera never moved at all. Doing both would
   * be worse than either — the frame would jump instantly by the CSS amount and
   * then drift again as the real head arrived, showing one movement twice.
   *
   * The picture moving IS the feedback. Nothing local is needed.
   */
  const localNudge = useCallback(
    (dir: "up" | "down" | "left" | "right" | "home") => {
      setView((v) => {
        if (dir === "home") return HOME;
        const bound = maxPan(BASE_SCALE);
        const dx = dir === "left" ? PAN_STEP : dir === "right" ? -PAN_STEP : 0;
        const dy = dir === "up" ? PAN_STEP : dir === "down" ? -PAN_STEP : 0;
        return {
          ...v,
          x: clamp(v.x + dx, -bound, bound),
          y: clamp(v.y + dy, -bound, bound),
        };
      });
    },
    [],
  );

  /* The open hold, and when it started. A ref because a pointerup can arrive
     before React has re-rendered from the pointerdown, and a hold tracked in
     state would be missed by the release that has to end it. */
  const holdRef = useRef<PtzHold | null>(null);
  const pressedAt = useRef(0);

  /* The pending hold. A press does NOT begin a hold any more -- it waits
     PTZ_CLICK_MS to find out whether this is a click or a hold, and this is the
     timer that decides. A ref for the same reason as `holdRef`: a release can
     arrive before React has re-rendered. */
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDir = useRef<JogDirection | null>(null);
  /* Which direction the CURRENT press is, kept for the release: a tilt or zoom
     release during a sweep has to send a different stop from a pan release, and
     by the time the release fires the direction is no longer an argument. */
  const lastDir = useRef<JogDirection | null>(null);

  /**
   * A PTZ error that CLEARS ITSELF.
   *
   * ⚠ IT USED TO STAY UNTIL SOMETHING ELSE REPLACED IT, which on a working
   * camera is the worst version: a single REQUEST_TIMEOUT or a SUPERSEDED from
   * a rapid direction change would sit on a tile whose head was moving
   * perfectly well, and an operator reading it has no way to tell a stale line
   * from a live fault. A transient fault must look transient.
   *
   * So it goes two ways: after {@link PTZ_ERROR_LINGER_MS}, or the moment any
   * PTZ command succeeds -- whichever comes first. Setting `null` cancels the
   * timer, so a success does not leave an old one armed to fire later.
   */
  const [ptzError, setPtzErrorState] = useState<string | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setPtzError = useCallback((message: string | null) => {
    if (errorTimer.current !== null) {
      clearTimeout(errorTimer.current);
      errorTimer.current = null;
    }
    setPtzErrorState(message);
    if (message !== null) {
      errorTimer.current = setTimeout(() => {
        errorTimer.current = null;
        setPtzErrorState(null);
      }, PTZ_ERROR_LINGER_MS);
    }
  }, []);
  /* Timers outlive the component unless something cancels them, and this one
     would call setState on an unmounted tile every time a wall is navigated
     away from within the linger window. */
  useEffect(() => () => {
    if (errorTimer.current !== null) clearTimeout(errorTimer.current);
    if (holdTimer.current !== null) clearTimeout(holdTimer.current);
    if (controlTimer.current !== null) clearTimeout(controlTimer.current);
  }, []);

  /* The camera's sweep, as the DEVICE reports it -- never inferred here.
     `null` means we have not been told, which is not the same as idle: a
     view-only session cannot read it at all, and drawing "idle" for that would
     be a claim about a camera that might be turning. */
  const [sweep, setSweep] = useState<SweepStatus | null>(null);
  const sweepRef = useRef<SweepStatus | null>(null);
  sweepRef.current = sweep;
  /* Every reply that CHANGED a sweep carries the new block, so the UI reflects
     a pause caused by a pan without waiting for the next poll. */
  const applySweep = useCallback((res: PtzResult | null | undefined) => {
    const block = sweepOf(res ?? undefined);
    if (block) setSweep(block);
  }, []);

  /* ── WHO MAY DRIVE THIS CAMERA ───────────────────────────────────────────

     THE CAMERA'S OWN SITE ALWAYS WINS. An operator at the site a camera
     belongs to must never find it being driven by somebody they lent it to, so
     a shared user's commands are refused while the owning side is driving.
     The server decides that; this is only the tile reflecting it.

     `null` means WE HAVE NOT BEEN TOLD, and the controls are live -- which is
     also what a deployment that does not arbitrate control looks like, and what
     a hub on a LAN looks like. It is deliberately not "nobody has it".

     ⚠ NO POLLING. Every ptz reply carries this block, and a refusal carries
     the same facts, so the tile learns from traffic it was sending anyway. A
     control poll on every tile of a four-up wall would be four round trips to
     real towers over a possibly-metered uplink, every few seconds, forever --
     the cost the sweep poll and the zoom readout are both careful to avoid. */
  const [control, setControl] = useState<PtzControl | null>(null);
  const controlTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* The hold LAPSES, and the controls have to come back on their own.
     Disabling a pad with no way back would be a deadlock: the thing that would
     re-enable it is a command, and a disabled pad cannot send one. The server
     told us when the hold runs out, so the tile forgets it then (a second's
     grace for the round trip) and the next press finds out for itself -- either
     it works, or it is refused and the line comes back. */
  const holdControl = useCallback((next: PtzControl | null) => {
    if (controlTimer.current !== null) {
      clearTimeout(controlTimer.current);
      controlTimer.current = null;
    }
    setControl(next);
    if (next && !next.yours && typeof next.expires_in_sec === "number") {
      const ms = Math.max(0, next.expires_in_sec) * 1000 + 1000;
      controlTimer.current = setTimeout(() => {
        controlTimer.current = null;
        setControl(null);
      }, ms);
    }
  }, []);

  /** Every reply carries it. Absent means "this server does not arbitrate". */
  const applyControl = useCallback((res: PtzResult | null | undefined) => {
    if (res?.control) holdControl(res.control);
  }, [holdControl]);

  /**
   * A refusal says the same things a reply would, so read it the same way.
   *
   * This is the case that matters most: the FIRST a shared operator hears of
   * the owning site taking a camera is their own command coming back refused,
   * and if that does not reach the tile the pad stays live and every press is
   * refused in silence.
   */
  const applyYield = useCallback((err: unknown): boolean => {
    if (!isPtzYielded(err)) return false;
    holdControl({
      held: true,
      yours: false,
      holder_site: err.holderSite,
      /* The owning side is the only one that can refuse us, by the rule. */
      holder_is_owner: true,
      expires_in_sec: err.retryAfterSec,
    });
    return true;
  }, [holdControl]);

  /** True when somebody else has it. The ONE thing a control gates on. */
  const yielded = control !== null && !control.yours;
  const controlledBy = describeControl(control);

  /* Whether the lens is being zoomed RIGHT NOW, which is the only time the
     magnification is worth asking the camera for. Separate from `holdRef`
     because a pan is also a hold and a pan does not change the zoom. */
  const [zooming, setZooming] = useState(false);

  /* Which of the two buttons the readout sits beside. It follows the last
     zoom rather than the current one so the figure does not jump sides — or
     vanish — the instant the hand comes off, while the tail is still
     resolving where the lens actually stopped. */
  const [zoomSide, setZoomSide] = useState<"zoom-in" | "zoom-out">("zoom-in");

  /* The camera's real magnification, or null. Never derived, never guessed —
     see `useZoomReadout`. Null renders as nothing at all. */
  const zoomRatio = useZoomReadout({
    enabled: zoomReadout && realPtz,
    session,
    camera: feed.index,
    active: zooming,
  });

  /* TILT LIMIT — feedback only; the TOWER enforces the physical stop (it halts
     tilt at PTZ_TILT_MIN/MAX and keeps pan rotating). "max" = the up-stop, "min"
     = the down-stop, null = free. PAN IS NEVER LIMITED, so this only ever gates
     the up/down arrows. While a tilt is held we poll status; when the tower
     reports the tilt at the limit we are pushing toward, we stop pushing and
     mark the button. The mark persists until the operator tilts the other way
     (moving away clears it). */
  const [tiltLimit, setTiltLimit] = useState<"max" | "min" | null>(null);
  const [tiltHeld, setTiltHeld] = useState<"up" | "down" | null>(null);
  const tiltHeldRef = useRef<"up" | "down" | null>(null);
  tiltHeldRef.current = tiltHeld;
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sessionId = typeof session === "string" ? session : session?.session_id;

  const jogStart = useCallback(
    (dir: JogDirection) => {
      setPtzError(null);
      if (!realPtz) {
        localNudge(dir === "in" || dir === "out" ? "home" : dir);
        return;
      }
      /* SOMEBODY ELSE IS DRIVING. The pad is already disabled, so this is the
         keyboard path and anything else that can reach a handler without a
         pointer. Not sending is not the enforcement -- the server refuses it
         either way -- it is declining to spend a round trip to be told
         something the tile already knows. */
      if (yielded) return;
      pressedAt.current = Date.now();
      if (dir === "in" || dir === "out") {
        setZoomSide(dir === "in" ? "zoom-in" : "zoom-out");
        setZooming(true);
      }
      if (dir === "up" || dir === "down") {
        // Moving AWAY from a limit is always allowed and clears the mark.
        if ((dir === "down" && tiltLimit === "max") || (dir === "up" && tiltLimit === "min")) {
          setTiltLimit(null);
        } else if ((dir === "up" && tiltLimit === "max") || (dir === "down" && tiltLimit === "min")) {
          // Already at this tilt limit — do not push into the stop. The button is
          // disabled too; this guards an edge/programmatic call. Pan is never here.
          return;
        }
        setTiltHeld(dir);
      }
      /* ── CLICK OR HOLD, DECIDED BY TIME HELD ──────────────────────────
         A press no longer begins a move. Pan and tilt wait PTZ_CLICK_MS: let
         go inside that and it was a CLICK, which sends one fixed step; keep
         holding and the continuous move begins and runs until release.

         WHY THE WAIT IS ON THE START AND NOT THE END. The old code started a
         hold immediately and used MIN_PRESS_MS to delay the STOP, so a quick
         tap moved the camera for however long the round trip took -- a
         different distance on every press, furthest on the worst link. There
         is no way to make that repeatable from the stop side, because the
         distance was already travelled. Waiting before starting is what makes
         a click a known quantity.

         ZOOM IS NOT STEPPABLE and begins its hold at once: there is no
         zoom step in the contract, and a 300ms dead patch before a zoom
         responds would feel broken. */
      lastDir.current = dir;
      if (!isStepDirection(dir)) {
        void (async () => {
          try {
            const held = await beginHold(feed, session, {
              mode: "continuous",
              ...CONTINUOUS_AXES[dir],
            });
            if (pressedAt.current === 0) {
              void held.stop();
              return;
            }
            holdRef.current = held;
            setPtzError(null);
          } catch (err) {
            /* A yield is read for its holder and then says nothing more:
               `describePtzFailure` returns null for it, so the chip clears and
               the "controlled by" line is the one message. */
            applyYield(err);
            setPtzError(describePtzFailure(err));
          }
        })();
        return;
      }

      pendingDir.current = dir;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (pressedAt.current === 0) return;      // released on the boundary
        void (async () => {
          try {
            /* CONTINUOUS hold: ONE ContinuousMove, kept alive by the SDK's
               keepalive (which only refreshes the tower's ~3s link-death
               deadman -- no per-tick movement, so nothing piles up at any
               latency). Release is bounded by the prompt Stop (jogEnd), NOT the
               deadman; the deadman only bites if the link genuinely drops. */
            const held = await beginHold(feed, session, {
              mode: "continuous",
              ...CONTINUOUS_AXES[dir],
            });
            /* The release may already have happened while this was in flight.
               Stop it immediately rather than storing a hold nobody will end --
               the same late-success discipline the video seam uses. */
            if (pressedAt.current === 0) {
              void held.stop();
              return;
            }
            holdRef.current = held;
            setPtzError(null);
          } catch (err) {
            /* A yield is read for its holder and then says nothing more:
               `describePtzFailure` returns null for it, so the chip clears and
               the "controlled by" line is the one message. */
            applyYield(err);
            setPtzError(describePtzFailure(err));
          }
        })();
      }, PTZ_CLICK_MS);
    },
    [applyYield, feed, localNudge, realPtz, session, setPtzError, tiltLimit, yielded],
  );

  /**
   * Release.
   *
   * ⚠ ALWAYS SENDS A STOP. Not gated on a permission check, not skipped when
   * the session looks expired, not conditional on the hold having been
   * registered — refusing a stop can only leave a camera moving; accepting one
   * can only leave it still.
   *
   * `MIN_PRESS_MS` is press FEEL, not protocol: a 60ms tap would otherwise
   * queue a stop behind a move that has not been dispatched yet.
   */
  const jogEnd = useCallback(() => {
    /* Before the `realPtz` guard: the readout's tail must end even on a tile
       that cannot move a lens, or a stray press would leave it polling. */
    setZooming(false);
    setTiltHeld(null);        // stop polling tilt; the mark (if any) persists
    if (!realPtz) return;
    pressedAt.current = 0;

    /* THE CLICK CASE. The hold never started, so nothing is moving and there is
       nothing to stop -- send one step instead. Cancelling the timer first is
       what makes this exclusive: a click must not also start a hold 40ms later. */
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
      const dir = pendingDir.current;
      pendingDir.current = null;
      if (dir !== null && isStepDirection(dir)) {
        void (async () => {
          try {
            const res = await step(feed, session, dir);
            /* A step the camera DECLINED is not a failure: it answered, and the
               answer was "not that way". Its own words, which is better than
               ours. */
            const refused = describeStepRefusal(res);
            setPtzError(refused);
            /* A step pauses a running sweep at the device; the reply says so. */
            applySweep(res);
            applyControl(res);
          } catch (err) {
            applyYield(err);
            const said = describePtzFailure(err);
            if (said) setPtzError(said);
          }
        })();
      }
      return;
    }

    pendingDir.current = null;
    const held = holdRef.current;
    holdRef.current = null;
    /* ⚠ WHICH STOP THIS IS DEPENDS ON THE AXIS AND ON THE SWEEP, and the
       device cannot work it out. Releasing a TILT or ZOOM hold during a sweep
       must drop only the held axes and leave the circle turning, which is what
       `keep_sweep` says. A release and the sweep's own Stop button are the same
       command on the wire, so forgetting the flag here would end the operator's
       sweep every time they let go of tilt. A PAN release is an ordinary stop:
       pan is the sweep's own axis and taking it over already paused the
       circle. */
    const sweeping = sweepRef.current?.state === "sweeping";
    const axisKeepsSweep = sweeping && lastDir.current !== null
      && (lastDir.current === "up" || lastDir.current === "down"
          || lastDir.current === "in" || lastDir.current === "out");
    lastDir.current = null;

    void (async () => {
      try {
        /* THE PROMPT STOP -- this is what bounds the release coast, not the
           deadman. It sends an explicit Stop that the tower expedites (it
           preempts the queue), stopping the head in ~1 link-latency; the
           generous deadman is only a link-death backstop. The last path covers
           a hold that never registered -- a failure, or a release that beat the
           round trip -- because the tower may still have started moving. Either
           way, always a real stop. */
        let res: PtzResult | null = null;
        if (axisKeepsSweep) res = await stopKeepingSweep(feed, session);
        else if (held) res = await held.stop();
        else res = await stopOrHome(feed, session, false);
        applySweep(res);
        /* A STOP IS ALWAYS ALLOWED, so its reply is the one that most reliably
           reports who holds the camera -- including "you do", which is how the
           tile learns it took control back. */
        applyControl(res);
      } catch (err) {
        applyYield(err);
        const said = describePtzFailure(err);
        if (said) setPtzError(said);
      }
    })();
  }, [applyControl, applySweep, applyYield, feed, realPtz, session, setPtzError]);

  /* Poll status WHILE a tilt is held and stop pushing into the stop the moment
     the tower reports the tilt at the limit we are driving toward. Only runs
     during a held up/down (never for pan or zoom), and only on a real head. */
  useEffect(() => {
    if (!realPtz || !tiltHeld || feed.index === undefined || !sessionId) return;
    const cam = feed.index;
    let cancelled = false;
    let inFlight = false;
    const poll = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const ref = sessionRef.current;
        if (!ref) return;
        /* Through ptz.ts for the same reason as the zoom readout -- and this
           is the call that most needed it: it polls on a timer while a tilt is
           held, so whatever a refusal means here, it must mean there too. */
        const res = await readStatus(ref, cam);
        if (cancelled || !res) return;
        const lim = (res.result as Record<string, unknown> | undefined)?.["tilt_limit"];
        const held = tiltHeldRef.current;
        if ((held === "up" && lim === "max") || (held === "down" && lim === "min")) {
          setTiltLimit(lim as "max" | "min");
          jogEnd();     // the tower already halted tilt; stop pushing + mark it
        }
      } catch {
        /* A failed status is not a limit — keep holding, do not falsely stop. */
      } finally {
        inFlight = false;
      }
    };
    void poll();
    const timer = setInterval(poll, TILT_LIMIT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [realPtz, tiltHeld, feed.index, sessionId, jogEnd]);

  const goHome = useCallback(() => {
    setPtzError(null);
    if (!realPtz) {
      localNudge("home");
      return;
    }
    /* Home is a MOVE, so it yields like any other. The stop half of it is not
       lost: a release still sends its own unconditional stop. */
    if (yielded) return;
    void (async () => {
      try {
        const res = await stopOrHome(feed, session, true);
        applyControl(res);
      } catch (err) {
        applyYield(err);
        setPtzError(describePtzFailure(err));
      }
    })();
  }, [applyControl, applyYield, feed, localNudge, realPtz, session, setPtzError, yielded]);

  /* ── DRIVING THE SWEEP ───────────────────────────────────────────────────

     Every one of these is a SINGLE COMMAND to the device, never a loop: the
     circle runs on the tower, so a closed tab, a navigation or a dropped link
     leaves it turning. That is the whole design, and it is why there is no
     progress timer here that advances anything -- the only numbers rendered are
     the ones the device just reported. */
  const [sweepBusy, setSweepBusy] = useState(false);

  /**
   * One button, three meanings, decided by what the device last said.
   *
   * ⚠ THE STATE COMES FROM THE DEVICE, NOT FROM WHAT WE PRESSED. Two
   * operators can drive one camera, and a sweep somebody else started is
   * already on this tile's status. So the cycle reads `sweep` rather than a
   * local toggle -- pressing "start" on a sweep another tab is running answers
   * with the sweep already in progress, which is the behaviour the contract
   * promises rather than an error.
   */
  const cycleSweep = useCallback(async () => {
    /* Starting, pausing or resuming a circle is driving the camera, so the
       owning site's hold covers it too. Their sweep is not ours to pause. */
    if (yielded) return;
    setSweepBusy(true);
    try {
      const current = sweepRef.current?.state;
      const next =
        current === "sweeping"
          ? await sweepPause(feed, session)
          : current === "paused"
            ? await sweepResume(feed, session)
            : await sweepStart(feed, session);
      setSweep(next);
      setPtzError(null);
    } catch (err) {
      applyYield(err);
      const said = describePtzFailure(err);
      if (said) setPtzError(said);
    } finally {
      setSweepBusy(false);
    }
  }, [applyYield, feed, session, setPtzError, yielded]);

  /**
   * End the circle where the camera is.
   *
   * ⚠ NOT GATED AND NOT MARKED BUSY. Like every stop, it always sends:
   * refusing to stop a turning camera can only leave it turning. A busy state
   * here would mean a second press during a slow round trip does nothing, on
   * the one control an operator may be pressing because something is wrong.
   */
  const endSweep = useCallback(async () => {
    try {
      const ended = await sweepStop(feed, session);
      if (ended) setSweep(ended);
      setPtzError(null);
    } catch (err) {
      /* ⚠ NOT GATED ABOVE, unlike the others, because every other stop in
         this file is unconditional -- but the SERVER does refuse this one,
         since ending somebody else's circle is not a de-escalation of our own
         command. So it can come back a yield, and that has to show. */
      applyYield(err);
      const said = describePtzFailure(err);
      if (said) setPtzError(said);
    }
  }, [applyYield, feed, session, setPtzError]);

  /* Progress, and the countdown to an auto-resume.

     POLLED ONLY WHILE THERE IS A SWEEP, and only on a tile that may read one.
     An idle camera asks nothing: this is a real round trip to a real tower over
     a possibly-metered uplink, which is the same reason the zoom readout does
     not poll continuously. A paused sweep is polled too -- its countdown is
     the device's, and when it reaches zero the device resumes and the next tick
     reports `sweeping` without anybody pressing anything. */
  const canReadSweep = features.has("ptz") && realPtz;
  const sweepActive = sweep !== null && sweep.state !== "idle";
  useEffect(() => {
    if (!canReadSweep || !sweepActive || !sessionId || feed.index === undefined) return;
    let cancelled = false;
    let inFlight = false;
    const tick = async () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      try {
        const now = await readSweep(feed, sessionRef.current);
        if (!cancelled && now) setSweep(now);
      } catch {
        /* A refused or failed read is not a sweep state. Leave the last one
           standing rather than claiming idle: the circle is the device's, and
           one unanswered poll is no evidence it stopped. */
      } finally {
        inFlight = false;
      }
    };
    const timer = setInterval(() => void tick(), SWEEP_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [canReadSweep, sweepActive, sessionId, feed]);

  /**
   * Capture the current frame and hand it to the operator as a file.
   *
   * ⚠ THE FLASH NOW MEANS SOMETHING. It used to be the whole feature: the
   * screen blanked, nothing was written anywhere, and an operator had every
   * reason to believe a still had been saved. The flash is kept because a
   * capture with no feedback gets taken twice — but it fires AFTER the encode
   * succeeds, so it confirms a file rather than announcing an intention.
   *
   * A failure surfaces through the same keyed mutation every other control
   * uses. There is no path here that flashes and produces nothing.
   */
  const captureStill = useCallback(async () => {
    /* ⚠ DELIBERATELY NOT THROUGH `command.run`.
    
       That helper coalesces a second call into a first that is still in flight,
       which is exactly right for a server write — it is the latch that stopped
       three sign-in POSTs — and exactly wrong here. Each press is a DIFFERENT
       MOMENT the operator chose to keep; two stills a fraction apart are two
       pieces of evidence, not a double submit. A snapshot also sends nothing to
       a server, so there is no request to de-duplicate in the first place.
       
       Nor is there a `busy` state: encoding a frame takes tens of
       milliseconds, and a spinner nobody can see is noise on a control that
       has to feel instant. */
    try {
      const blob = await captureFrame(videoRef?.current);
      downloadBlob(
        blob,
        snapshotFilename({
          towerName: towerName ?? feed.towerId,
          cameraName: feed.name,
        }),
      );
      /* AFTER the file exists, never before. The flash is this control's whole
         claim that a still was taken, and it used to fire on its own with
         nothing written anywhere. */
      setFlash(true);
      setTimeout(() => setFlash(false), 180);
    } catch {
      /* The disabled state already prevents the only expected failure — no
         frame to capture. Anything reaching here is the browser refusing to
         encode, and the honest response is for the flash NOT to fire: no
         confirmation is the signal, because a flash with no file is the exact
         lie this change was made to remove. */
    }
  }, [feed.name, feed.towerId, towerName, videoRef]);

  const controls: TileControl[] = [
    {
      id: "fullscreen",
      label: fullscreen ? "Exit fullscreen" : "Fullscreen",
      icon: "/icons/ctl-fullscreen.svg",
      /* 17, not the 20 the rest of the stack uses. This glyph was exported on a
         16.86 canvas with the artwork bled to the edge, so its ink is 100% of
         its box where every sibling sits at 67-88%. At size 20 it rendered 20px
         of ink against their ~16.7, reading 20% heavier than record or siren
         and 50% heavier than the zoom pair — and it is the one control that is
         always visible. Sizing to 17 matches their ink, not their box.
         Delete this once the Figma set has a consistent ink margin. */
      size: 17,
      persistent: true,
      active: fullscreen,
      onSelect: onToggleFullscreen,
      buttonRef: fsBtnRef,
    },
    {
      id: "record",
      label: isRecording ? "Stop recording" : "Start recording",
      /* Shape changes with state, not just colour: a ring around a circle to
         start, a ring around a square to stop. Colour alone would leave the
         two states indistinguishable to anyone who cannot separate red from
         white, and it is the control that decides whether evidence exists. */
      icon: isRecording ? "/icons/ctl-stop.svg" : "/icons/ctl-record.svg",
      tone: "critical",
      active: isRecording,
      /* Disabled while the command is in flight as well as on a dead feed. A
         second press mid-command is how an operator ends up believing they
         stopped a recording they actually restarted. */
      disabled: isDead || recordPhase?.kind === "pending",
      busy: recordPhase?.kind === "pending",
      onSelect: onToggleRecord,
    },
    {
      id: "talk",
      label: talking ? "Release to stop talking" : "Hold to talk",
      icon: "/icons/ctl-talk.svg",
      tone: "critical",
      active: talking,
      disabled: isDead,
      busy: command.phase(key("talk")).kind === "pending",
      /* Held, not toggled — see `hold` on `TileControl`. The label has always
         said "release to stop"; it is now true. */
      hold: {
        onStart: () => void command.run(key("talk"), async () => setTalking(true)),
        /* UNCONDITIONAL, and never wrapped. The same rule PTZ stop follows:
           refusing to close a channel can only leave a microphone open into a
           live yard, accepting one can only leave it shut. It must not be
           gated behind a pending state, a permission check, or a failure. */
        onEnd: () => setTalking(false),
      },
    },
    {
      id: "siren",
      label: siren ? "Silence alarm" : "Sound alarm",
      icon: "/icons/ctl-siren.svg",
      /* The only control here that reaches the physical site. Record and talk
         are consequential but reversible from this desk; a speaker left wailing
         in a yard is not, so it keeps the saturated fill. */
      tone: "alarm",
      active: siren,
      disabled: isDead,
      onSelect: () =>
        void command.run(key("siren"), async () => setSiren((v) => !v)),
      busy: command.phase(key("siren")).kind === "pending",
    },
    {
      id: "screenshot",
      label: "Capture still",
      icon: "/icons/ctl-screenshot.svg",
      /* ⚠ NOT JUST `isDead`. A tile can be perfectly alive and still have no
         frame — off screen on the fleet wall, over the concurrency ceiling,
         mid-negotiation, or showing a poster. Capturing then would write a
         black rectangle with an authoritative filename on it, which is the one
         outcome worse than the button being unavailable. */
      disabled: isDead || !streaming,
      onSelect: captureStill,
    },
    {
      id: "zoom-in",
      /* Says what it cannot do rather than going quietly grey. A fixed camera
         has no lens to move, and "why is this greyed out" is a question an
         operator should not have to carry to a supervisor. */
      label: feed.ptz ? "Zoom in" : "Zoom in — this camera cannot zoom",
      /* The camera's REAL magnification, or nothing. Never a count of presses
         and never derived from the normalized axis — see `useZoomReadout`. */
      badge: zoomSide === "zoom-in" ? formatZoom(zoomRatio) : null,
      icon: "/icons/ctl-zoom-in.svg",
      /* ⚠ GATED ON A REAL HEAD, NOT ON `isDead` ALONE. Without a head there is
         nothing to send: the old code fell through to `localNudge("home")`,
         which RECENTRED the picture — a zoom button that re-frames instead of
         zooming is worse than one that refuses. */
      disabled: isDead || !realPtz,
      /* Held, exactly like the pad's pan and tilt and for the same reason: a
         lens moves for as long as it is told to, so the command has to end
         when the hand does. `ControlStack` already owns the pointer capture,
         the cancel and leave paths and the keyboard equivalents — this reuses
         the shape talk-down proved rather than inventing a second one. */
      hold: {
        onStart: () => jogStart("in"),
        onEnd: jogEnd,
      },
    },
    {
      id: "zoom-out",
      label: feed.ptz ? "Zoom out" : "Zoom out — this camera cannot zoom",
      badge: zoomSide === "zoom-out" ? formatZoom(zoomRatio) : null,
      icon: "/icons/ctl-zoom-out.svg",
      disabled: isDead || !realPtz,
      hold: {
        onStart: () => jogStart("out"),
        onEnd: jogEnd,
      },
    },
    {
      id: "overlays",
      label: "Camera overlays",
      icon: "/icons/ctl-overlays.svg",
      active: overlays,
      onSelect: () => setOverlays((o) => !o),
    },
  ];

  /* ── THE SWEEP'S TWO CONTROLS ────────────────────────────────────────────

     One button CYCLES (start -> pause -> resume) and a second STOPS, appearing
     only while a sweep is in play. Two buttons rather than one because the two
     gestures are not the same promise: pause is reversible and the device
     resumes it by itself, stop ends the circle. An operator who wants it to
     stop must not have to find that behind a cycle.

     GATED ON `ptz`, AND NOT MERELY TO HIDE A BUTTON. `status` requires the
     `ptz` permission, so a session without it cannot READ a sweep at all -- it
     would render a control whose state is permanently unknowable. The honest
     move is to show nothing, which is also why `sweep` stays `null` rather
     than defaulting to idle. (A read-only badge for view-only operators needs a
     coordination change and is deliberately not faked here.) */
  const canSweep = features.has("ptz") && realPtz;
  const sweeping = sweep?.state === "sweeping";
  const paused = sweep?.state === "paused";

  if (canSweep) {
    controls.push({
      id: "sweep",
      /* The label is also the hover title and the accessible name, which on the
         fleet wall is the ONLY explanation there is: `MonitorTile` renders no
         message line of its own, so a chip that had merely stopped working
         would say nothing at all there. */
      label: yielded
        ? `Sweep held by ${control?.holder_site ?? "another site"}`
        : sweeping
          ? `Pause sweep (${sweep?.percent ?? 0}% round)`
          : paused
            ? `Resume sweep (${sweep?.percent ?? 0}% round)`
            : "360\u00b0 Sweep",
      /* ONE ICON IN EVERY STATE. It was a play/pause pair, which read as a
         video transport -- press it and you expect footage, not a camera to
         start turning. A radar says what this does: a head sweeping a circle.
         Deliberately NOT a circular arrow, which reads as refresh.

         The state is carried by the label and the badge, which is where state
         belongs on a 32px chip: a glyph that changes under the pointer is a
         second thing to learn, and the badge already says 42% or 1:34. */
      icon: "/icons/nav-sweep.svg",
      /* IDLE KEEPS THE MASK. The static icon and the live one are the same
         drawing, so there is nothing to gain from rendering the component when
         nothing is turning -- and a needle parked at 0 would read as a sweep at
         0%, which is a different claim from "no sweep". */
      /* `createElement` rather than JSX because this is a HOOK file, not a
         component one -- renaming it to .tsx for a single element would move a
         file every tile imports, to buy syntax sugar on one line. */
      glyph: sweeping || paused
        ? createElement(SweepRadar, {
            percent: sweep?.percent ?? 0,
            paused,
            // The needle glides over exactly the interval the next reading
            // arrives on, so it is never far from what the device last said.
            trackMs: SWEEP_POLL_MS,
          })
        : undefined,
      active: sweeping || paused,
      /* MEASURED OR ABSENT, per the badge contract. While sweeping it is the
         degrees the DEVICE has observed; while paused it is the device's own
         countdown to auto-resume. Neither is computed here, and nothing is
         drawn when there is no sweep. */
      badge: sweeping
        ? `${sweep?.percent ?? 0}%`
        : paused
          ? formatCountdown(sweep?.resume_in_sec)
          : null,
      busy: sweepBusy,
      /* `yielded`: the owning site is driving, so this circle is not ours to
         start, pause or resume. The label beside the pad says who has it --
         `disabled` alone would be a chip that stopped working for no stated
         reason, which is the failure this whole block is written against. */
      disabled: sweepBusy || yielded,
      onSelect: () => void cycleSweep(),
    });

    if (sweeping || paused) {
      controls.push({
        id: "sweep-stop",
        label: yielded ? `Sweep held by ${control?.holder_site ?? "another site"}` : "Stop sweep",
        disabled: yielded,
        icon: "/icons/ctl-stop.svg",
        /* `critical` and not `alarm`: this ends motion on a real site, which is
           consequential, but it is not a speaker sounding in a yard. The siren
           keeps `alarm` to itself. */
        tone: "critical",
        onSelect: () => void endSweep(),
      });
    }
  }

  /* ── THREE OF THESE CONTROLS ACT ON NOTHING ─────────────────────────────

     `siren` plays a two-tone wail in THIS BROWSER (see useSiren — it is a
     synthesised AudioContext, not a command). `talk` sets a boolean and opens no
     channel. `record` flips a boolean; App's `toggleRecord` awaits no request.
     All three are labelled as though they reach the site: "Sound alarm", "Hold
     to talk", and a record switch.

     The talk-down is the one that matters most. A guard holds it, believes they
     are audible in the yard, and speaks to somebody who cannot hear them — and
     unlike a dead button, that failure is invisible to the person relying on it.

     REMOVED, not disabled. A disabled control says "not right now"; these are
     not coming for an account that does not have them, and a permanently greyed
     alarm button on a monitoring tile is worse than no alarm button.

     `fullscreen`, `screenshot`, `zoom` and `overlays` are NOT gated: the first
     three are real client-side actions (a frame really is captured, the zoom is
     the camera's own and already gated on `feed.ptz`) and the last is a render
     toggle. Gating something real would be the opposite mistake. */
  const needed: Partial<Record<string, Feature>> = {
    siren: "siren",
    talk: "two_way_audio",
    record: "record_toggle",
  };
  const allowed = controls.filter((c) => {
    const feature = needed[c.id];
    return feature === undefined || features.has(feature);
  });

  return {
    controls: allowed,
    view,
    scale,
    limit,
    jogStart,
    jogEnd,
    goHome,
    realPtz,
    /** Which tilt end the head is at, or null. "max" = up-stop, "min" = down-stop.
        Pan is never limited, so this only marks the up/down arrows. */
    tiltLimit,
    /** The camera's measured magnification, or null when nothing measured it. */
    zoomRatio,
    ptzError,
    dismissPtzError: () => setPtzError(null),
    /** The camera's sweep as the DEVICE last reported it, or `null` for "we have
        not been told" -- which is not idle, and must not be drawn as idle. */
    sweep,
    /** Who is driving this camera when it is not you, ready to render, or
        `null` whenever the controls are live. Already accounts for a free
        camera, your own hold, and a deployment that does not arbitrate. */
    controlledBy,
    /** Somebody else has the camera. The one flag a control gates on. */
    yielded,
    flash,
    siren,
    alarming,
    talking,
    talkSec,
    overlays,
  };
}
