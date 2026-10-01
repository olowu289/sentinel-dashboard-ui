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
 *  PRESS AND RELEASE. THIS FILE HOLDS NO TIMER.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The pad only reports intent: `onJogStart` on pointerdown, `onJogEnd` on
 * pointerup/leave/cancel. The HOLD itself — one continuous move kept alive by a
 * keepalive while held, and a prompt stop on release — lives in useTileControls
 * and the SDK's `ptzHold`, which own the one timer. A second timer here would be
 * two loops racing to move one head, so there must never be one.
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
  tiltLimit = null,
}: {
  onJogStart?: (dir: JogDirection) => void;
  onJogEnd?: () => void;
  onHome?: () => void;
  disabled?: boolean;
  /** Which TILT end the head is at, or null. "max" marks the UP arrow, "min" the
      DOWN arrow. PAN (left/right) is never limited — the camera rotates 360. */
  tiltLimit?: "max" | "min" | null;
}) {
  /* Only the tilt arm pushing INTO its stop is at the limit. Down (and pan) stay
     free while at the up-stop, so the operator can always tilt back. */
  const atLimit = (dir: JogDirection): boolean =>
    (dir === "up" && tiltLimit === "max") || (dir === "down" && tiltLimit === "min");
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
      {BUTTONS.map((b) => {
        const limited = atLimit(b.dir);
        return (
          <button
            key={b.dir}
            type="button"
            aria-label={limited ? `${b.label} (at tilt limit)` : b.label}
            aria-disabled={limited || undefined}
            title={limited ? "At tilt limit" : undefined}
            disabled={disabled || limited}
            {...press(b.dir)}
            className={`absolute flex size-[24px] items-center justify-center transition-[color,transform] hover:text-white active:scale-90 disabled:opacity-40 ${
              limited ? "text-amber-400/90" : "text-[#e0dfdf]/85"
            } ${b.position}`}
          >
            {/* Rotation must sit on the glyph, not a wrapper — MaskIcon renders
                display:block, and transforms are ignored on inline elements. */}
            <MaskIcon src="/icons/ptz-arrow.svg" size={24} className={b.rotate} />
          </button>
        );
      })}

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
