import { useCallback, useEffect, useRef, useState } from "react";
import type { TileControl } from "@/components/ControlStack";
import type { CameraFeed } from "@/lib/types";
import { useSiren } from "@/lib/useSiren";

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
  onToggleFullscreen,
  onToggleRecord,
}: {
  feed: CameraFeed;
  /** No link, so nothing can be acted on and nothing can be sounding. */
  isDead: boolean;
  fullscreen?: boolean;
  /** Never unmounts, so the tile can hand focus back to it. */
  fsBtnRef?: React.Ref<HTMLButtonElement>;
  onToggleFullscreen?: () => void;
  onToggleRecord?: () => void;
}) {
  const [siren, setSiren] = useState(false);
  const [overlays, setOverlays] = useState(false);
  const [talking, setTalking] = useState(false);
  const [talkSec, setTalkSec] = useState(0);
  const [flash, setFlash] = useState(false);
  const [view, setView] = useState<View>(HOME);

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
  }, [isDead]);

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

  const move = useCallback((dir: "up" | "down" | "left" | "right" | "home") => {
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
  }, []);

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

  const captureStill = useCallback(() => {
    setFlash(true);
    setTimeout(() => setFlash(false), 180);
  }, []);

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
      disabled: isDead,
      onSelect: onToggleRecord,
    },
    {
      id: "talk",
      label: talking ? "Release to stop talking" : "Hold to talk",
      icon: "/icons/ctl-talk.svg",
      tone: "critical",
      active: talking,
      disabled: isDead,
      /* Held, not toggled — see `hold` on `TileControl`. The label has always
         said "release to stop"; it is now true. */
      hold: {
        onStart: () => setTalking(true),
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
      onSelect: () => setSiren((s) => !s),
    },
    {
      id: "screenshot",
      label: "Capture still",
      icon: "/icons/ctl-screenshot.svg",
      disabled: isDead,
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
    move,
    flash,
    siren,
    alarming,
    talking,
    talkSec,
    overlays,
  };
}
