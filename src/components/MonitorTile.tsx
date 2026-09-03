import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENTER, EXIT } from "@/lib/motion";
import type { CameraFeed } from "@/lib/types";
import { useTileControls } from "@/lib/useTileControls";
import { ControlStack } from "./ControlStack";
import { DEAD_STATES, FeedChip } from "./FeedChip";
import { SirenOverlay } from "./SirenOverlay";
import {
  ConnectingFallback,
  ErrorFallback,
  OfflineFallback,
  UnknownFallback,
  lastSeenLabel,
} from "./TileFallback";

/**
 * A fleet-wall tile: picture, one chip, one button.
 *
 * Still not `CameraTile` — that one wraps the picture in a PTZ pad, a talk
 * timer and a zoom readout, and a 380px cell in a grid of four has room for
 * none of it. What the two now share is the *actuators*: both walls carry the
 * same eight controls, from the same `useTileControls`, revealed by the same
 * cascade. Two walls showing the same four cameras must not offer two
 * vocabularies for acting on them.
 *
 * This was a single expand button until 2026-08-19, on the argument that a
 * talk-down one stray click from four different yards is a reflex worth not
 * training. That was overruled deliberately: the controls are here, and the
 * guard is the one the tower wall already relies on — nothing but the expand
 * button exists until the pointer is on the tile, the siren keeps its
 * saturated fill and its pulse, and a dead feed disables everything that
 * reaches the site.
 *
 * This used to be a 40px header bar bolted above the picture, on the argument
 * that four bars in a grid read as a column of labels a chip could not. The
 * design has since settled the other way and both walls now wear the same
 * chip — which is the stronger argument, because the two walls show the same
 * cameras and an operator moving between them was reading two different
 * layouts of the same four facts. The bar also cost every tile 40px of picture,
 * four times over, on the screen whose entire job is picture.
 *
 * It renders `FeedChip` itself rather than restating the state word and dot,
 * so the six feed states cannot fork between the two walls.
 *
 * It carries no drag handle. Rearranging is a band gesture now — the handle on
 * a band header moves a whole site — and a second handle inside every picture
 * offered a second grammar for the same job while spending a corner of the
 * frame on it. The wall is arranged by site; the cameras under a site stay in
 * the order the site lists them.
 */
export function MonitorTile({
  feed,
  towerId,
  fullscreen = false,
  layoutKey = "",
  onToggleFullscreen,
  onToggleRecord,
  onRetry,
}: {
  feed: CameraFeed;
  /** Spoken in the tile's label. The fleet wall mixes sites, so a tile that
   *  names only its camera leaves "whose north gate?" unanswered. */
  towerId: string;
  fullscreen?: boolean;
  /** Changes only when something actually reflows the wall. See the README's
   *  note on `layoutKey` — the latency walk re-renders every tile mid-animation
   *  and motion cuts an in-flight layout animation that reports no change. */
  layoutKey?: string;
  onToggleFullscreen?: () => void;
  /** Owned by the shell, like every other piece of feed state — the tower wall
   *  and this one must not disagree about whether a camera is recording. */
  onToggleRecord?: () => void;
  onRetry?: () => void;
}) {
  const expandRef = useRef<HTMLButtonElement>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  /* Exiting drops `z-100` immediately, but the tile still covers the viewport
     for the length of the animation and later siblings would paint through it. */
  const [exiting, setExiting] = useState(false);

  const hasError = Boolean(feed.error);
  const isDead = hasError || DEAD_STATES.has(feed.state);
  const reconnecting =
    feed.state === "connecting" && feed.elapsedSec !== undefined;

  const { controls, view, scale, flash, alarming } = useTileControls({
    feed,
    isDead,
    fullscreen,
    fsBtnRef: expandRef,
    onToggleFullscreen,
    onToggleRecord,
  });

  useEffect(() => {
    if (isDead) setFirstFrame(false);
  }, [isDead]);

  /* Leaving the takeover hands focus back to the control that opened it; the
     activeElement guard means we only claim focus that was actually dropped. */
  const prevFullscreen = useRef(fullscreen);
  useLayoutEffect(() => {
    const was = prevFullscreen.current;
    prevFullscreen.current = fullscreen;
    if (fullscreen || !was) return;
    setExiting(true);
    if (document.activeElement === document.body) expandRef.current?.focus();
  }, [fullscreen]);

  /* onLayoutAnimationComplete clears this normally; the timeout covers the
     cases it cannot fire in, because a stuck `exiting` parks a tile at z-100. */
  useEffect(() => {
    if (!exiting) return;
    const id = setTimeout(() => setExiting(false), 400);
    return () => clearTimeout(id);
  }, [exiting]);

  /* Bound to the window so the way out survives focus being anywhere at all —
     an operator who cannot leave a takeover has lost the whole fleet. */
  const toggle = useRef(onToggleFullscreen);
  toggle.current = onToggleFullscreen;
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape" && e.key !== "f" && e.key !== "F") return;
      e.preventDefault();
      toggle.current?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  const transition = fullscreen ? ENTER : EXIT;

  return (
    /* A plain wrapper so the grid cell stays open while the tile is a
       fullscreen takeover — the wall must not reflow underneath it, and the
       exit has to land back in its own slot. */
    <div className="relative min-h-0 min-w-0">
      <motion.section
        layout
        layoutDependency={layoutKey}
        transition={transition}
        onLayoutAnimationComplete={() => setExiting(false)}
        aria-label={`${feed.name} camera, ${towerId}`}
        aria-modal={fullscreen || undefined}
        role={fullscreen ? "dialog" : undefined}
        className={`group overflow-hidden ${
          fullscreen
            ? "fixed inset-0 z-100 bg-black"
            : `absolute inset-0 ${
                exiting ? "z-100 bg-black" : isDead ? "bg-tile-dead" : "bg-tile"
              }`
        }`}
      >
        {/* The picture is the tile. Everything else floats over it. */}
        <div className="absolute inset-0 overflow-hidden">
          {isDead ? (
            <div className="absolute inset-0 flex items-center justify-center">
              {hasError ? (
                <ErrorFallback error={feed.error!} onRetry={onRetry} />
              ) : feed.state === "unknown" ? (
                <UnknownFallback since={lastSeenLabel(feed.lastSeenAt)} />
              ) : feed.state === "offline" ? (
                <OfflineFallback lastSeen={lastSeenLabel(feed.lastSeenAt)} />
              ) : (
                <ConnectingFallback
                  name={feed.name}
                  attempt={reconnecting ? 3 : undefined}
                  maxAttempts={reconnecting ? 5 : undefined}
                />
              )}
            </div>
          ) : (
            <>
              <img
                src={feed.poster}
                alt=""
                /* A cached frame can finish decoding before React attaches
                   onLoad, so the ref settles anything already complete —
                   otherwise the tile stays black with the image sitting there. */
                ref={(el) => {
                  if (el?.complete && el.naturalWidth > 0) setFirstFrame(true);
                }}
                onLoad={() => setFirstFrame(true)}
                style={{
                  transform: `scale(${scale}) translate(${view.x}%, ${view.y}%)`,
                }}
                className={`absolute inset-0 size-full object-cover transition-opacity duration-300 ease-out ${
                  firstFrame ? "opacity-100" : "opacity-0"
                }`}
              />
              {/* Per the design: a wash that settles the bottom of the frame so
                  four bright feeds in a grid do not read as one lit surface.
                  It also buys the chip a floor to sit on. */}
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent to-[rgba(26,26,26,0.35)]"
              />
            </>
          )}
        </div>

        {alarming && <SirenOverlay />}

        {/* The capture flash. Nothing is written anywhere, but the frame
            blanking is what tells an operator the still was taken. */}
        <span
          aria-hidden
          className={`pointer-events-none absolute inset-0 bg-white transition-opacity ${
            flash ? "opacity-70 duration-0" : "opacity-0 duration-300"
          }`}
        />

        {/* Position-only layout on both overlays, for the same reason
            `CameraTile` does it: the section animates its box with a transform,
            and a child that does not opt into the projection gets stretched
            with it for the length of the takeover. These are content-sized, so
            animating position alone means no scale is ever applied. */}
        <motion.div
          layout="position"
          layoutDependency={layoutKey}
          transition={transition}
          /* Bounded so the chip truncates rather than running under the
             buttons: 16px gutter each side, 52px of buttons, 8px of air. */
          className="absolute left-[16px] top-[8px] max-w-[calc(100%-92px)]"
        >
          <FeedChip
            state={feed.state}
            name={feed.name}
            elapsedSec={feed.elapsedSec}
            latencyMs={isDead ? undefined : feed.latencyMs}
            error={hasError}
          />
        </motion.div>

        {/* The same stack the tower wall carries, revealed by the same
            cascade — `ControlStack` owns both, so the reveal, the stagger and
            the tones cannot fork between the two walls. Only the expand button
            survives at rest, which is what the fleet screen looked like before
            the actuators arrived. */}
        <motion.div
          layout="position"
          layoutDependency={layoutKey}
          transition={transition}
          className={`absolute transition-opacity ${
            fullscreen ? "right-[20px] top-[76px]" : "right-[9px] top-[10px]"
          } ${isDead ? "pointer-events-none opacity-40" : "opacity-100"}`}
        >
          <ControlStack controls={controls} />
        </motion.div>
      </motion.section>
    </div>
  );
}
