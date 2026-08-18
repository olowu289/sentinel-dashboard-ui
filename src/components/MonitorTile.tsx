import { motion } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
} from "react";
import { ENTER, EXIT } from "@/lib/motion";
import type { CameraFeed } from "@/lib/types";
import { FeedChip } from "./FeedChip";
import { MaskIcon } from "./Icon";
import {
  ConnectingFallback,
  ErrorFallback,
  OfflineFallback,
} from "./TileFallback";

const DEAD_STATES = new Set(["connecting", "offline"]);

/**
 * A fleet-wall tile: picture, one chip, one button.
 *
 * Deliberately not `CameraTile`. That one carries the actuators — PTZ, record,
 * talk-down, siren — and they are guarded there by a hover reveal on a wall the
 * operator has already drilled into. This wall shows four cameras across two
 * sites at once, and putting a talk-down button one stray click from four
 * different yards is exactly the reflex the tower view is careful not to train.
 * The picture is the whole job here; the actuators live one level in.
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
 */
export function MonitorTile({
  feed,
  towerId,
  index,
  count,
  columns,
  fullscreen = false,
  dragging = false,
  dragActive = false,
  layoutKey = "",
  onToggleFullscreen,
  onRetry,
  onDragStart,
  onDragEnd,
  onDragOverTile,
  onMove,
}: {
  feed: CameraFeed;
  /** Shown dim in the bar. The fleet wall mixes sites, so a tile that names
   *  only its camera leaves "whose north gate?" unanswered. */
  towerId: string;
  /** Position on the wall, 0-based — spoken in the drag handle's label. */
  index: number;
  count: number;
  /** Grid columns, so Up/Down on the handle move a full row rather than one
   *  place. A handle that only walks the flat order is unusable on a grid. */
  columns: number;
  fullscreen?: boolean;
  /** This tile is the one being dragged. */
  dragging?: boolean;
  /** Some tile is being dragged — gates the drop targets, so an image or a
   *  file dragged in from the desktop never reshuffles the wall. */
  dragActive?: boolean;
  /** Changes only when something actually reflows the wall. See the README's
   *  note on `layoutKey` — the latency walk re-renders every tile mid-animation
   *  and motion cuts an in-flight layout animation that reports no change. */
  layoutKey?: string;
  onToggleFullscreen?: () => void;
  onRetry?: () => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDragOverTile?: () => void;
  /** Move this tile `delta` places along the wall order. */
  onMove?: (delta: number) => void;
}) {
  const expandRef = useRef<HTMLButtonElement>(null);
  const [firstFrame, setFirstFrame] = useState(false);
  /* Exiting drops `z-100` immediately, but the tile still covers the viewport
     for the length of the animation and later siblings would paint through it. */
  const [exiting, setExiting] = useState(false);

  /* Set on the handle's pointerdown and read in `dragstart`, rather than
     toggling `draggable` from state. The browser decides draggability at the
     moment the gesture crosses its threshold, which is a race with a React
     re-render; vetoing an already-started drag is not. It also blocks the
     browser's own image drag for free — the <img> below starts a dragstart
     that never went through the handle, and gets cancelled here. */
  const handleHeld = useRef(false);

  const hasError = Boolean(feed.error);
  const isDead = hasError || DEAD_STATES.has(feed.state);
  const reconnecting =
    feed.state === "connecting" && feed.elapsedSec !== undefined;
  // A wall of one has nothing to rearrange, so it gets no handle.
  const reorderable = count > 1 && !fullscreen;

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

  /* The keyboard route through the same reordering. Dragging is a pointer
     gesture with no keyboard equivalent, and this wall is desktop-only, so
     without this the arrangement is simply unavailable to anyone not using a
     mouse. Arrows on a focused handle, one place sideways or a full row up
     and down; focus rides with the tile because React keys it by feed id. */
  const onHandleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const delta =
      e.key === "ArrowLeft"
        ? -1
        : e.key === "ArrowRight"
          ? 1
          : e.key === "ArrowUp"
            ? -columns
            : e.key === "ArrowDown"
              ? columns
              : 0;
    if (!delta) return;
    e.preventDefault();
    onMove?.(delta);
  };

  const transition = fullscreen ? ENTER : EXIT;

  return (
    /* The drag plumbing sits on a plain wrapper rather than the animated
       section: motion replaces the native onDragStart/onDragEnd with its own
       pan handlers, which know nothing about dataTransfer. The wrapper also
       holds the grid cell open while the tile is a fullscreen takeover, so the
       wall does not reflow underneath it and the exit lands back in its slot. */
    <div
      draggable={reorderable}
      onDragStart={(e: DragEvent<HTMLDivElement>) => {
        if (!handleHeld.current) {
          e.preventDefault();
          return;
        }
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", feed.id);
        onDragStart?.();
      }}
      onDragEnd={() => {
        handleHeld.current = false;
        onDragEnd?.();
      }}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        if (!dragActive) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        onDragOverTile?.();
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        if (!dragActive) return;
        e.preventDefault();
        onDragEnd?.();
      }}
      className="relative min-h-0 min-w-0"
    >
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
              } ${
                /* The picked-up tile fades rather than moving with the pointer
                   — the browser is already dragging a snapshot of it, and two
                   copies travelling together reads as a rendering fault. */
                dragging ? "opacity-40" : ""
              }`
        }`}
      >
        {/* The picture is the tile. Everything else floats over it. */}
        <div className="absolute inset-0 overflow-hidden">
          {isDead ? (
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

        <motion.div
          layout="position"
          layoutDependency={layoutKey}
          transition={transition}
          className="absolute right-[16px] top-[7px] flex items-center gap-[4px]"
        >
          {/* Not drawn on the frame, and it does not need to be: a drag handle
              is only ever wanted by a pointer that is already over the tile,
              and this wall is desktop-only. It stays mounted and merely
              transparent rather than `invisible`, so Tab can still reach it —
              landing on it is what reveals it for keyboard reordering. */}
          {reorderable && (
            <button
              type="button"
              onPointerDown={() => {
                handleHeld.current = true;
              }}
              onPointerUp={() => {
                handleHeld.current = false;
              }}
              onKeyDown={onHandleKey}
              aria-label={`Rearrange ${feed.name}, position ${index + 1} of ${count}. Use the arrow keys to move it.`}
              title="Drag to rearrange, or use the arrow keys"
              className="flex size-[24px] cursor-grab items-center justify-center rounded-[4.364px] bg-black/64 text-white opacity-0 transition-[opacity,background-color] group-hover:opacity-100 group-focus-within:opacity-100 hover:bg-black/80 active:cursor-grabbing"
            >
              {/* 18, not the 20 the header used: this glyph carries a 1/6 ink
                  margin where the expand arrows bleed to their box edge, so
                  matching boxes would put 13.3px of ink beside 11.6px. Sized
                  to its neighbour's ink, not its neighbour's box. */}
              <MaskIcon src="/icons/tile-grid.svg" size={18} />
            </button>
          )}

          <button
            ref={expandRef}
            type="button"
            onClick={onToggleFullscreen}
            aria-label={
              fullscreen
                ? `Exit fullscreen, ${feed.name}`
                : `Fullscreen ${feed.name}`
            }
            title={fullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
            className="flex size-[24px] items-center justify-center rounded-[4.364px] bg-black/64 text-white transition-colors hover:bg-black/80"
          >
            <MaskIcon src="/icons/tile-expand.svg" size={11.589} />
          </button>
        </motion.div>
      </motion.section>
    </div>
  );
}
