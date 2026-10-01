import { useCallback, useEffect, useRef, useState } from "react";
import { formatZoom, useZoomReadout } from "@/lib/useZoomReadout";
import { getClient } from "@/lib/api/client";
import { captureFrame, downloadBlob, snapshotFilename } from "@/lib/snapshot";
import type { TileControl } from "@/components/ControlStack";
import type { CameraFeed } from "@/lib/types";
import type { MutationPhase } from "@/lib/useMutation";
import { useSiren } from "@/lib/useSiren";
import { useMutation } from "@/lib/useMutation";
import {
  MIN_PRESS_MS,
  CONTINUOUS_AXES,
  beginHold,
  describePtzFailure,
  stopOrHome,
  type JogDirection,
  type PtzHold,
} from "@/lib/api/ptz";
import type { ViewerSession } from "@kallon/sentry-sdk";

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
  const [ptzError, setPtzError] = useState<string | null>(null);

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
      void (async () => {
        try {
          /* CONTINUOUS hold: ONE ContinuousMove, kept alive by the SDK's
             keepalive (which only refreshes the tower's ~3s link-death deadman —
             no per-tick movement, so nothing piles up at any latency). Release
             is bounded by the prompt Stop (jogEnd), NOT the deadman; the deadman
             only bites if the link genuinely drops. */
          const held = await beginHold(feed, session, {
            mode: "continuous",
            ...CONTINUOUS_AXES[dir],
          });
          /* The release may already have happened while this was in flight.
             Stop it immediately rather than storing a hold nobody will end —
             the same late-success discipline the video seam uses. */
          if (pressedAt.current === 0) {
            void held.stop();
            return;
          }
          holdRef.current = held;
        } catch (err) {
          setPtzError(describePtzFailure(err));
        }
      })();
    },
    [feed, localNudge, realPtz, session, tiltLimit],
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
    const heldFor = Date.now() - pressedAt.current;
    pressedAt.current = 0;
    const wait = Math.max(0, MIN_PRESS_MS - heldFor);

    setTimeout(() => {
      const held = holdRef.current;
      holdRef.current = null;
      void (async () => {
        try {
          /* THE PROMPT STOP — this is what bounds the release coast, not the
             deadman. `held.stop()` sends an explicit Stop that the tower
             expedites (it preempts the queue), stopping the head in ~1 link-
             latency; the generous deadman is only a link-death backstop.
             The second path covers a hold that never registered — a failure, or
             a release that beat the round trip — because the tower may still
             have started moving. Either way, always a real stop. */
          if (held) await held.stop();
          else await stopOrHome(feed, session, false);
        } catch (err) {
          const said = describePtzFailure(err);
          if (said) setPtzError(said);
        }
      })();
    }, wait);
  }, [feed, realPtz, session]);

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
        const res = await getClient().ptzStatus(ref, cam);
        if (cancelled) return;
        const lim = res.result?.["tilt_limit"];
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
    void (async () => {
      try {
        await stopOrHome(feed, session, true);
      } catch (err) {
        setPtzError(describePtzFailure(err));
      }
    })();
  }, [feed, localNudge, realPtz, session]);

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

  return {
    controls,
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
    flash,
    siren,
    alarming,
    talking,
    talkSec,
    overlays,
  };
}
