import { useCallback, useEffect, useRef, useState } from "react";
import type { TileControl } from "@/components/ControlStack";
import type { CameraFeed } from "@/lib/types";
import type { MutationPhase } from "@/lib/useMutation";
import { useSiren } from "@/lib/useSiren";
import { useMutation } from "@/lib/useMutation";
import {
  MIN_PRESS_MS,
  JOG_AXES,
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
export const BASE_SCALE = 1.15;
export const PAN_STEP = 2.5;
export const ZOOM_STEP = 0.35;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;

export interface View {
  x: number;
  y: number;
  zoom: number;
}

export const HOME: View = { x: 0, y: 0, zoom: 1 };

/** Furthest the media can travel before its own edge enters the frame. */
export function maxPan(scale: number) {
  return ((scale - 1) / (2 * scale)) * 100;
}

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

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
  const scale = BASE_SCALE * view.zoom;
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
       daemon's deadman catches it. */
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
   * DIGITAL — the zoom buttons in the control stack. They crop the frame that
   * has already arrived, which is a legitimate thing to do to a picture and
   * costs the tower nothing. That stays exactly as it was: a transform on the
   * media element, clamped so the frame's own edge never shows.
   *
   * OPTICAL / MECHANICAL — the PTZ pad. It moves the actual head, and it is
   * already gated on `feed.ptz`, which the projection sets from `ptz_capable`.
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
        const bound = maxPan(BASE_SCALE * v.zoom);
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

  /** Whether this pad drives a real head or the old local nudge. */
  const realPtz = Boolean(feed.ptz && session && feed.index !== undefined);

  /* The open hold, and when it started. A ref because a pointerup can arrive
     before React has re-rendered from the pointerdown, and a hold tracked in
     state would be missed by the release that has to end it. */
  const holdRef = useRef<PtzHold | null>(null);
  const pressedAt = useRef(0);
  const [ptzError, setPtzError] = useState<string | null>(null);

  const jogStart = useCallback(
    (dir: JogDirection) => {
      setPtzError(null);
      if (!realPtz) {
        localNudge(dir === "in" || dir === "out" ? "home" : dir);
        return;
      }
      pressedAt.current = Date.now();
      void (async () => {
        try {
          const held = await beginHold(feed, session, {
            mode: "jog",
            ...JOG_AXES[dir],
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
    [feed, localNudge, realPtz, session],
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
    if (!realPtz) return;
    const heldFor = Date.now() - pressedAt.current;
    pressedAt.current = 0;
    const wait = Math.max(0, MIN_PRESS_MS - heldFor);

    setTimeout(() => {
      const held = holdRef.current;
      holdRef.current = null;
      void (async () => {
        try {
          /* Either path issues a real stop. The second exists for the case
             where the hold never registered — a failure, or a release that beat
             the round trip — because the tower may still have started moving. */
          if (held) await held.stop();
          else await stopOrHome(feed, session, false);
        } catch (err) {
          const said = describePtzFailure(err);
          if (said) setPtzError(said);
        }
      })();
    }, wait);
  }, [feed, realPtz, session]);

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

  const zoomBy = useCallback((delta: number) => {
    setView((v) => {
      const zoom = clamp(v.zoom + delta, ZOOM_MIN, ZOOM_MAX);
      // Zooming out shrinks the travel envelope, so pull the pan back inside it
      // rather than leaving the frame parked past its own edge.
      const bound = maxPan(BASE_SCALE * zoom);
      return {
        zoom,
        x: clamp(v.x, -bound, bound),
        y: clamp(v.y, -bound, bound),
      };
    });
  }, []);

  const captureStill = useCallback(
    () =>
      command.run(key("snap"), async () => {
        setFlash(true);
        setTimeout(() => setFlash(false), 180);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [command, feed.id],
  );

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
      disabled: isDead,
      busy: command.phase(key("snap")).kind === "pending",
      onSelect: captureStill,
    },
    {
      id: "zoom-in",
      label: "Zoom in",
      icon: "/icons/ctl-zoom-in.svg",
      disabled: isDead || view.zoom >= ZOOM_MAX,
      onSelect: () => zoomBy(ZOOM_STEP),
    },
    {
      id: "zoom-out",
      label: "Zoom out",
      icon: "/icons/ctl-zoom-out.svg",
      disabled: isDead || view.zoom <= ZOOM_MIN,
      onSelect: () => zoomBy(-ZOOM_STEP),
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
