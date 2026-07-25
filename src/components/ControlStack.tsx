import { MaskIcon } from "./Icon";

export interface TileControl {
  id: string;
  label: string;
  icon: string;
  size?: number;
  /**
   * How loudly an engaged control announces itself. Never just "on".
   *
   * `critical` keeps the ordinary chip and reddens the glyph: right for
   * recording and talk-down, which are consequential but local to the operator.
   *
   * `alarm` takes a saturated fill. Reserved for the siren, which is the one
   * control that acts on the physical site: a speaker is sounding in a real
   * yard, and it should be impossible to leave that running without noticing.
   */
  tone?: "neutral" | "critical" | "alarm";
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
        const alarm = c.active && c.tone === "alarm";
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
            /* An engaged critical control keeps the ordinary chip and reddens
               only its glyph: a 32px block of solid red on top of live video
               competes with the frame it is annotating. The alarm tone is the
               deliberate exception, because a siren audible at the site should
               cost the operator's attention until it is silenced. */
            className={`chip-blur relative flex size-[32px] items-center justify-center rounded-[5.818px] transition-colors ${
              alarm
                ? "bg-critical text-white"
                : critical
                  ? "bg-black/45 text-critical hover:bg-black/65"
                  : c.active
                    ? "bg-white/20 text-white"
                    : "bg-black/45 text-white hover:bg-black/65"
            } ${c.persistent ? "" : REVEAL} ${
              c.disabled ? "cursor-not-allowed opacity-40" : ""
            }`}
          >
            {/* Two heartbeats, both on the 2s cadence the recording and live
                dots already use. Critical pulses a halo hugging the glyph,
                round so it traces the circular record and stop shapes. Alarm
                pulses the whole chip, which is the louder of the two and the
                point of the tone. */}
            {alarm && (
              <span
                aria-hidden
                className="pulse-dot pointer-events-none absolute inset-0 rounded-[5.818px] ring-2 ring-critical/70"
              />
            )}
            <span className="relative flex items-center justify-center">
              <MaskIcon src={c.icon} size={c.size ?? 20} />
              {critical && (
                <span
                  aria-hidden
                  className="pulse-dot pointer-events-none absolute inset-0 rounded-full ring-2 ring-critical/70"
                />
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
