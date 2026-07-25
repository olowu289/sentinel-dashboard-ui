import { useCallback, useRef } from "react";
import { MaskIcon } from "./Icon";

type Direction = "up" | "down" | "left" | "right" | "home";

/* Figma rotated a single chevron instance for each arm, so all four exported
   assets are the same right-pointing glyph. One asset, four rotations. */
const BUTTONS: {
  dir: Direction;
  label: string;
  position: string;
  rotate: string;
}[] = [
  {
    dir: "up",
    label: "Tilt up",
    position: "left-[29px] top-0",
    rotate: "-rotate-90",
  },
  {
    dir: "down",
    label: "Tilt down",
    position: "left-[29px] bottom-0",
    rotate: "rotate-90",
  },
  {
    dir: "left",
    label: "Pan left",
    position: "left-0 top-[28px]",
    rotate: "rotate-180",
  },
  {
    dir: "right",
    label: "Pan right",
    position: "right-0 top-[28px]",
    rotate: "rotate-0",
  },
];

export function PtzPad({
  onMove,
  disabled = false,
  atLimit = false,
}: {
  onMove?: (dir: Direction) => void;
  disabled?: boolean;
  /** No travel left in the frame — the arms go dim but Recentre stays live. */
  atLimit?: boolean;
}) {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stop = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  /* Single press steps the head; holding repeats at 8Hz for a continuous move. */
  const start = useCallback(
    (dir: Direction) => {
      if (disabled) return;
      onMove?.(dir);
      if (dir === "home") return;
      stop();
      timer.current = setInterval(() => onMove?.(dir), 125);
    },
    [disabled, onMove, stop],
  );

  const press = (dir: Direction) => ({
    onPointerDown: () => start(dir),
    onPointerUp: stop,
    onPointerLeave: stop,
    onPointerCancel: stop,
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
          disabled={disabled || atLimit}
          {...press(b.dir)}
          className={`absolute flex size-[24px] items-center justify-center text-[#e0dfdf]/85 transition-[color,transform] hover:text-white active:scale-90 disabled:opacity-40 ${b.position}`}
        >
          {/* Rotation must sit on the glyph, not a wrapper — MaskIcon renders
              display:block, and transforms are ignored on inline elements. */}
          <MaskIcon src="/icons/ptz-arrow.svg" size={24} className={b.rotate} />
        </button>
      ))}

      <button
        type="button"
        aria-label="Recentre"
        disabled={disabled}
        {...press("home")}
        className="absolute left-[28px] top-[28px] flex size-[24px] items-center justify-center text-[#e0dfdf]/85 transition-[color,transform] hover:text-white active:scale-90 disabled:opacity-40"
      >
        <MaskIcon src="/icons/ptz-home.svg" size={24} />
      </button>
    </div>
  );
}
