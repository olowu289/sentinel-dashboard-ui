import { motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ENTER, EXIT } from "@/lib/motion";
import type { CameraFeed } from "@/lib/types";
import { useTileControls, ZOOM_MIN } from "@/lib/useTileControls";
import { ControlStack } from "./ControlStack";
import { FeedChip, formatElapsed } from "./FeedChip";
import { PtzPad } from "./PtzPad";
import { SirenOverlay } from "./SirenOverlay";
import {
  ConnectingFallback,
  ErrorFallback,
  OfflineFallback,
} from "./TileFallback";

const DEAD_STATES = new Set(["connecting", "offline"]);

export function CameraTile({
  feed,
  towerId,
  focused = false,
  fullscreen = false,
  layoutKey = "",
  canSwitch = false,
  onFocus,
  onRetry,
  onToggleRecord,
  onToggleFullscreen,
  onSwitchCamera,
}: {
  feed: CameraFeed;
  towerId?: string;
  focused?: boolean;
  fullscreen?: boolean;
  /** Changes only when something that actually reflows the wall changes — the
      takeover or the landscape/portrait split. See `layoutDependency` below. */
  layoutKey?: string;
  canSwitch?: boolean;
  onFocus?: () => void;
  onRetry?: () => void;
  onToggleRecord?: () => void;
  onToggleFullscreen?: () => void;
  onSwitchCamera?: (delta: 1 | -1) => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const fsBtnRef = useRef<HTMLButtonElement>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  /* Exiting the takeover drops `z-100` immediately, but the tile still covers
     the viewport for the length of the animation — and the alerts panel is a
     later sibling, so it would paint straight through the closing frame. */
  const [exiting, setExiting] = useState(false);

  const hasError = Boolean(feed.error);
  const isDead = hasError || DEAD_STATES.has(feed.state);
  const reconnecting =
    feed.state === "connecting" && feed.elapsedSec !== undefined;

  /* Always fill, in the wall and in the takeover. Contain would collapse a 4:3
     source to a strip in a tile, and letterbox ~350px a side on an ultrawide
     in fullscreen. A fit toggle is drafted (ctl-fit/ctl-fill live in
     public/icons) but deliberately not wired up yet. */
  const objectFit = "object-cover";

  /* The actuators, shared with the fleet tile — see `useTileControls`. */
  const {
    controls,
    view,
    scale,
    limit,
    move,
    flash,
    alarming,
    talking,
    talkSec,
  } = useTileControls({
    feed,
    isDead,
    fullscreen,
    fsBtnRef,
    onToggleFullscreen,
    onToggleRecord,
  });

  useEffect(() => {
    if (isDead) setFirstFrame(false);
  }, [isDead]);

  /* Handlers live in a ref because the parent rebuilds them on every latency
     tick. Depending on them directly would tear this effect down and re-run it
     once a second, restealing focus each time. */
  const keyHandlers = useRef({ onToggleFullscreen, onSwitchCamera });
  keyHandlers.current = { onToggleFullscreen, onSwitchCamera };

  /* Entering hands focus to the close button; leaving hands it back to the
     control that opened the takeover, because the top bar holding `closeRef`
     unmounts and focus would otherwise fall to <body> — the operator loses
     their place on the wall.

     The activeElement guard is what makes arrow-key camera switching safe:
     that commits an exit on this tile and an entry on the next in the same
     render, and effects fire in tree order, so either tile can go first.
     Checking for the orphaned state rather than "was focus mine" is correct
     in both orderings — whoever focuses first wins and the other stands down.

     A layout effect so no frame is ever painted with the wrong stacking. */
  const prevFullscreen = useRef(fullscreen);
  useLayoutEffect(() => {
    const was = prevFullscreen.current;
    prevFullscreen.current = fullscreen;
    if (fullscreen) {
      closeRef.current?.focus();
      return;
    }
    if (!was) return;
    setExiting(true);
    if (document.activeElement === document.body) fsBtnRef.current?.focus();
  }, [fullscreen]);

  /* onLayoutAnimationComplete clears this normally. The timeout covers the
     cases it cannot fire in — a backgrounded tab, reduced motion resolving out
     of order — because a stuck `exiting` leaves a tile parked at z-100. */
  useEffect(() => {
    if (!exiting) return;
    const id = setTimeout(() => setExiting(false), 400);
    return () => clearTimeout(id);
  }, [exiting]);

  /* Fullscreen keys. `F` toggles and `Esc` exits — both are universal player
     conventions, and an operator who cannot find the way out of a takeover has
     lost the whole wall. Arrows move between cameras without exiting. Bound to
     the window, so the way out survives focus being anywhere at all. */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      const h = keyHandlers.current;
      if (e.key === "Escape" || e.key === "f" || e.key === "F") {
        e.preventDefault();
        h.onToggleFullscreen?.();
      } else if (e.key === "ArrowRight" && canSwitch) {
        e.preventDefault();
        h.onSwitchCamera?.(1);
      } else if (e.key === "ArrowLeft" && canSwitch) {
        e.preventDefault();
        h.onSwitchCamera?.(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, canSwitch]);

  const mediaStyle = {
    transform: `scale(${scale}) translate(${view.x}%, ${view.y}%)`,
  };

  /* One transition object for the section and every child that moves with it.
     A mismatch here is worse than either animation alone — the chrome visibly
     drifts against the box it is anchored to. */
  const transition = fullscreen ? ENTER : EXIT;

  /* Gates motion's layout measurement. Without it the 1s recording tick and
     the 1.4s latency walk re-render this tile mid-animation, and motion cuts
     an in-flight layout animation to its end state when a re-render reports no
     layout change — roughly one in three toggles would snap, at random. */
  const layoutDep = layoutKey;

  /* Position-only for every text- and icon-bearing overlay. These are all
     content-sized, so animating position alone means no scale is ever applied
     and nothing stretches — and they glide to their new corner rather than
     teleporting, which is most of what sells the takeover. */
  const chrome = {
    layout: "position",
    layoutDependency: layoutDep,
    transition,
  } as const;

  return (
    <motion.section
      layout
      layoutDependency={layoutDep}
      transition={transition}
      onLayoutAnimationComplete={() => setExiting(false)}
      aria-label={`${feed.name} camera`}
      aria-modal={fullscreen || undefined}
      role={fullscreen ? "dialog" : undefined}
      onClick={onFocus}
      /* `fixed` positioning here relies on nothing above this tile scrolling or
         carrying a transform/filter/backdrop-filter — true today (the app root
         is h-screen overflow-hidden). If that changes, fullscreen breaks with
         or without the animation. */
      className={`group overflow-hidden ${
        fullscreen
          ? "fixed inset-0 z-100 bg-black"
          : `relative min-h-0 min-w-0 flex-1 ${
              exiting ? "z-100 bg-black" : isDead ? "bg-tile-dead" : "bg-tile"
            } ${focused ? "ring-2 ring-terra/70 ring-inset" : ""}`
      }`}
    >
      {/* The media sits in its own frame so the two transform systems never
          share an element: this wrapper is what animates between tile and
          fullscreen, while the media below keeps the PTZ transform. */}
      {!isDead && (
        <motion.div
          layout="preserve-aspect"
          layoutDependency={layoutDep}
          transition={transition}
          className="absolute inset-0 overflow-hidden"
        >
          {feed.video ? (
            <video
              src={feed.video}
              poster={feed.poster}
              autoPlay
              muted
              loop
              playsInline
              onLoadedData={() => setFirstFrame(true)}
              style={mediaStyle}
              className={`absolute inset-0 size-full transition-[opacity,transform] duration-300 ease-out ${objectFit} ${
                firstFrame ? "opacity-100" : "opacity-0"
              }`}
            />
          ) : (
            <img
              src={feed.poster}
              alt=""
              /* A cached frame can finish decoding before React attaches onLoad,
               so the ref also settles anything already complete — otherwise the
               tile stays black with the image sitting right there. */
              ref={(el) => {
                if (el?.complete && el.naturalWidth > 0) setFirstFrame(true);
              }}
              onLoad={() => setFirstFrame(true)}
              style={mediaStyle}
              className={`absolute inset-0 size-full transition-[opacity,transform] duration-300 ease-out ${objectFit} ${
                firstFrame ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
        </motion.div>
      )}

      {alarming && <SirenOverlay />}

      {/* Shutter confirmation — a still capture is evidence, and evidence that
          gives no feedback gets taken twice. */}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 bg-white transition-opacity ${
          flash ? "opacity-70 duration-0" : "opacity-0 duration-300"
        }`}
      />

      {/* Transmitting paints a hairline border around the whole captured region
          so it is unmistakable which tile is carrying your voice. */}
      {talking && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 border border-critical"
        />
      )}

      {isDead && (
        <div className="absolute inset-0 flex items-center justify-center">
          {hasError ? (
            <ErrorFallback error={feed.error!} onRetry={onRetry} />
          ) : feed.state === "offline" ? (
            <OfflineFallback lastSeen="14:02" />
          ) : (
            <ConnectingFallback
              name={feed.name}
              attempt={reconnecting ? 3 : undefined}
              maxAttempts={reconnecting ? 5 : undefined}
            />
          )}
        </div>
      )}

      {/* Scrims rather than solid bars: the chrome must stay legible over any
          frame without stealing pixels from a 16:9 feed. */}
      {fullscreen && (
        <>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-[96px] bg-gradient-to-b from-black/75 to-transparent"
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 h-[120px] bg-gradient-to-t from-black/80 to-transparent"
          />
        </>
      )}

      {/* Identity + state chip is invariant across every state — it is the
          operator's anchor, and it is the only thing that asserts liveness.
          It keeps the same shape in fullscreen so the camera you are looking
          at never becomes a question. */}
      {fullscreen ? (
        <motion.div
          {...chrome}
          className="absolute inset-x-0 top-0 flex h-[56px] items-center gap-[12px] px-[20px]"
        >
          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label="Exit fullscreen"
            className="flex size-[40px] shrink-0 items-center justify-center rounded-[8px] text-white/85 transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden
            >
              <path
                d="M12 4 6 10l6 6"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className="min-w-0">
            <p className="truncate font-display text-[1.25rem] leading-[24px] tracking-[0.2px] text-[#f5f7fa]">
              {feed.name}
            </p>
            {towerId && (
              <p className="truncate text-[0.8125rem] leading-[16px] text-white/60">
                {towerId} · Sentry camera
              </p>
            )}
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-[8px]">
            <FeedChip
              state={feed.state}
              name={feed.name}
              elapsedSec={feed.elapsedSec}
              latencyMs={isDead ? undefined : feed.latencyMs}
              error={hasError}
            />
            <button
              ref={closeRef}
              type="button"
              onClick={onToggleFullscreen}
              aria-label="Exit fullscreen"
              title="Exit fullscreen (Esc)"
              className="flex size-[40px] items-center justify-center rounded-[8px] text-white/85 transition-colors hover:bg-white/10 hover:text-white"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="m3 3 8 8M11 3l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </motion.div>
      ) : (
        <motion.div
          {...chrome}
          /* Bounded so the chip truncates instead of running under the control
             stack: 16px gutter + 32px stack + 9px inset + breathing room. */
          className="absolute left-[16px] top-[10px] max-w-[calc(100%-73px)]"
        >
          <FeedChip
            state={feed.state}
            name={feed.name}
            elapsedSec={feed.elapsedSec}
            latencyMs={isDead ? undefined : feed.latencyMs}
            error={hasError}
          />
        </motion.div>
      )}

      {/* Other cameras stay reachable without leaving the takeover. */}
      {/* Centred by a flex wrapper rather than -translate-y-1/2: these become
          motion nodes, and motion owns `transform` — a Tailwind translate on
          the same element gets overwritten the first time it animates. */}
      {fullscreen && canSwitch && (
        <>
          <motion.div
            {...chrome}
            className="pointer-events-none absolute inset-y-0 left-0 flex items-center px-[16px]"
          >
            <button
              type="button"
              onClick={() => onSwitchCamera?.(-1)}
              aria-label="Previous camera"
              className="pointer-events-auto invisible flex size-[48px] items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 transition-[opacity,visibility] group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 max-lg:visible max-lg:opacity-100 hover:text-white"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
              >
                <path
                  d="M12 4 6 10l6 6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </motion.div>
          <motion.div
            {...chrome}
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-[16px]"
          >
            <button
              type="button"
              onClick={() => onSwitchCamera?.(1)}
              aria-label="Next camera"
              className="pointer-events-auto invisible flex size-[48px] items-center justify-center rounded-full bg-black/50 text-white/80 opacity-0 transition-[opacity,visibility] group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 max-lg:visible max-lg:opacity-100 hover:text-white"
            >
              <svg
                width="20"
                height="20"
                viewBox="0 0 20 20"
                fill="none"
                aria-hidden
              >
                <path
                  d="M8 4l6 6-6 6"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </motion.div>
        </>
      )}

      {talking && (
        <motion.div
          {...chrome}
          className="chip-blur absolute right-[49px] top-[10px] flex items-center gap-[6px] rounded-[4px] bg-black/50 px-[8px] py-[4px]"
        >
          <span
            aria-hidden
            className="pulse-dot size-[6px] rounded-full bg-critical"
          />
          <p className="font-display text-[0.75rem] lg:text-[0.6875rem] tracking-[0.11px] text-white tabular-nums">
            TRANSMITTING {formatElapsed(talkSec)}
          </p>
        </motion.div>
      )}

      {/* Zoom level only exists once you have left 1× — a permanent "1.0×" is
          noise on a wall of tiles. */}
      {!isDead && view.zoom > ZOOM_MIN && (
        <motion.div
          {...chrome}
          className="chip-blur absolute bottom-[18px] right-[9px] rounded-[4px] bg-black/50 px-[8px] py-[4px]"
        >
          <p className="font-display text-[0.75rem] lg:text-[0.6875rem] tracking-[0.11px] text-white tabular-nums">
            {view.zoom.toFixed(1)}×
          </p>
        </motion.div>
      )}

      {/* Pointing a real camera head is not something to trigger in passing, so
          the pad only exists while the operator is actually on this tile. */}
      {feed.ptz && !isDead && (
        <motion.div
          {...chrome}
          className="invisible absolute bottom-[18px] left-[16px] opacity-0 transition-[opacity,visibility] duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100 max-lg:visible max-lg:opacity-100"
        >
          <PtzPad onMove={move} atLimit={limit === 0} />
        </motion.div>
      )}

      <motion.div
        {...chrome}
        className={`absolute transition-opacity ${
          // Clears the fullscreen top bar rather than colliding with it.
          fullscreen ? "right-[20px] top-[76px]" : "right-[9px] top-[10px]"
        } ${isDead ? "pointer-events-none opacity-40" : "opacity-100"}`}
      >
        <ControlStack controls={controls} />
      </motion.div>
    </motion.section>
  );
}
