import { useCallback, useRef } from "react";
import { MaskIcon } from "./Icon";
import type { JogDirection } from "@/lib/api/ptz";

/* Figma rotated a single chevron instance for each arm, so all four exported
   assets are the same right-pointing glyph. One asset, four rotations. */
const BUTTONS: {
  dir: JogDirection;
  label: string;
  position: string;
  rotate: string;
}[] = [
  { dir: "up", label: "Tilt up", position: "left-[29px] top-0", rotate: "-rotate-90" },
  { dir: "down", label: "Tilt down", position: "left-[29px] bottom-0", rotate: "rotate-90" },
  { dir: "left", label: "Pan left", position: "left-0 top-[28px]", rotate: "rotate-180" },
  { dir: "right", label: "Pan right", position: "right-0 top-[28px]", rotate: "rotate-0" },
];

/**
 * Pointing the camera head.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  PRESS AND RELEASE. NOT A REPEATING TICK.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This used to fire a step on pointerdown and then repeat it every 125ms — 8
 * commands a second at a CGI endpoint — because it was driving a local CSS
 * transform, where a repeat is how you get continuous movement out of a
 * discrete nudge. That is also why it "only moved a little": each tick shifted
 * the ON-SCREEN IMAGE by 2.5%, clamped so the frame's own edge never showed.
 * The camera never moved at all.
 *
 * A real head jogs. One command starts it, one stops it, and the tower keeps it
 * alive in between. So: `onJogStart` on pointerdown, `onJogEnd` on pointerup,
 * leave and cancel. The repeat is gone, and with it the stream of SUPERSEDED
 * results a rapid tick produces when each move displaces the last.
 *
 * ⚠ THERE IS NO TIMER IN THIS FILE, and there must never be one. The keepalive
 * belongs to the SDK's `ptzHold` (~1.5s, inside the daemon's 4s deadman) and a
 * second one here would be two timers racing to refresh one move.
 *
 * ⚠ EVERY WAY A PRESS CAN END CALLS `onJogEnd`. pointerup, pointerleave and
 * pointercancel — the last because a touch device fires it when the system
 * takes the pointer back mid-gesture, and a missed release there is a camera
 * that keeps turning.
 */
export function PtzPad({
  onJogStart,
  onJogEnd,
  onHome,
  disabled = false,
}: {
  onJogStart?: (dir: JogDirection) => void;
  onJogEnd?: () => void;
  onHome?: () => void;
  disabled?: boolean;
}) {
  /* Guards a release arriving without a press — a pointerup after the pad has
     been disabled mid-gesture, say. Sending a stop for a move we never started
     is harmless on the tower but would muddy the failure reporting here. */
  const held = useRef(false);

  const start = useCallback(
    (dir: JogDirection) => {
      if (disabled || held.current) return;
      held.current = true;
      onJogStart?.(dir);
    },
    [disabled, onJogStart],
  );

  const end = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    onJogEnd?.();
  }, [onJogEnd]);

  const press = (dir: JogDirection) => ({
    onPointerDown: () => start(dir),
    onPointerUp: end,
    onPointerLeave: end,
    onPointerCancel: end,
  });

  return (
    <div
      role="group"
      aria-label="Pan and tilt"
      className="relative size-[80px] rounded-full bg-black/45"
    >
      {BUTTONS.map((b) => (
        <button
          key={b.dir}
          type="button"
          aria-label={b.label}
          disabled={disabled}
          {...press(b.dir)}
          className={`absolute flex size-[24px] items-center justify-center text-[#e0dfdf]/85 transition-[color,transform] hover:text-white active:scale-90 disabled:opacity-40 ${b.position}`}
        >
          {/* Rotation must sit on the glyph, not a wrapper — MaskIcon renders
              display:block, and transforms are ignored on inline elements. */}
          <MaskIcon src="/icons/ptz-arrow.svg" size={24} className={b.rotate} />
        </button>
      ))}

      {/* Home is a single command, not a hold: it is an absolute recall, and
          the tower decides how long it takes to arrive. */}
      <button
        type="button"
        aria-label="Recentre"
        disabled={disabled}
        onClick={() => onHome?.()}
        className="absolute left-[28px] top-[28px] flex size-[24px] items-center justify-center text-[#e0dfdf]/85 transition-[color,transform] hover:text-white active:scale-90 disabled:opacity-40"
      >
        <MaskIcon src="/icons/ptz-home.svg" size={24} />
      </button>
    </div>
  );
}
