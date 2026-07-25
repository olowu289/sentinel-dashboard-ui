import { MaskIcon } from "./Icon";

export interface TileControl {
  id: string;
  label: string;
  icon: string;
  size?: number;
  /** Saturated fill means an abnormal state worth noticing — never just "on". */
  tone?: "neutral" | "critical";
  active?: boolean;
  /** Survives the hover reveal — the tile's one permanent affordance. */
  persistent?: boolean;
  disabled?: boolean;
  onSelect?: () => void;
  /** Lets the tile hand focus back to a control after chrome unmounts. */
  buttonRef?: React.Ref<HTMLButtonElement>;
}

/* `invisible` rather than `opacity-0`: hidden controls must leave the tab order
   so they cannot be triggered blind, but must keep their box so the stack does
   not resize on hover. Focusing the persistent button fires focus-within on the
   tile, which reveals the rest — that is the keyboard route in. */
/* Touch devices fire neither hover nor focus-within on a tap, so a hover-only
   reveal makes every camera control unreachable on a phone. Below lg the
   controls are simply always present — there is no pointer to reveal them. */
const REVEAL =
  "max-lg:visible max-lg:opacity-100 " +
  "invisible opacity-0 transition-[opacity,visibility] duration-150 " +
  "group-hover:visible group-hover:opacity-100 " +
  "group-focus-within:visible group-focus-within:opacity-100";

export function ControlStack({
  controls,
  className = "",
}: {
  controls: TileControl[];
  className?: string;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Camera controls"
      aria-orientation="vertical"
      className={`flex flex-col items-start justify-center gap-[5.236px] ${className}`}
    >
      {controls.map((c) => {
        const critical = c.active && c.tone === "critical";
        return (
          <button
            key={c.id}
            ref={c.buttonRef}
            type="button"
            aria-label={c.label}
            aria-pressed={c.active}
            title={c.label}
            disabled={c.disabled}
            onClick={c.onSelect}
            className={`chip-blur relative flex size-[32px] items-center justify-center rounded-[5.818px] transition-colors ${
              critical
                ? "bg-critical text-white"
                : c.active
                  ? "bg-white/20 text-white"
                  : "bg-black/45 text-white hover:bg-black/65"
            } ${c.persistent ? "" : REVEAL} ${
              c.disabled ? "cursor-not-allowed opacity-40" : ""
            }`}
          >
            <MaskIcon src={c.icon} size={c.size ?? 20} />
            {critical && (
              <span
                aria-hidden
                className="pulse-dot pointer-events-none absolute inset-0 rounded-[5.818px] ring-2 ring-critical/70"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}
