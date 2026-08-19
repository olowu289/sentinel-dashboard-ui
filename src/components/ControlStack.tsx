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
  "tile-reveal max-lg:visible max-lg:opacity-100 invisible opacity-0 " +
  "group-hover:visible group-hover:opacity-100 " +
  "group-focus-within:visible group-focus-within:opacity-100";

/* One transition list for the whole button, and the order matters: `index.css`
   delays the first two and leaves the last two alone, so the stagger belongs to
   the reveal while the button's own hover colour still answers immediately.
   `visibility` rides along because it is what takes the hidden controls out of
   the tab order — as a discrete property it flips at the near end of the
   transition, so it appears at once on the way in and holds until the fade has
   finished on the way out.

   This was two competing declarations before: the reveal asked for
   `transition-[opacity,visibility]` and the chip asked for `transition-colors`,
   which is the same CSS property, and the colours won. The controls had been
   popping in with no fade at all. */
const TRANSITION =
  "transition-[opacity,visibility,color,background-color] duration-150";

/* How far apart the revealed controls start, in ms. Seven of them, so the
   cascade runs 144ms front to back and the last one has settled inside 300 —
   long enough to read as a stack unpacking downward, short enough that the
   control you were reaching for is already there when the pointer arrives.

   The delay is spent on the way in only. `index.css` hangs it off the tile's
   hover state, so dropping hover drops the delay with it and the stack leaves
   as one block. Staggering the exit reads as the chrome struggling to clear. */
const REVEAL_STEP_MS = 24;

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
      {controls.map((c, i) => {
        const critical = c.active && c.tone === "critical";
        const alarm = c.active && c.tone === "alarm";
        /* Counted over the revealed controls alone, so the cascade starts at
           zero under whichever one is pinned rather than leaving a gap where
           the persistent button sits. */
        const revealIndex = controls
          .slice(0, i)
          .filter((p) => !p.persistent).length;
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
            style={
              c.persistent
                ? undefined
                : ({
                    "--reveal-delay": `${revealIndex * REVEAL_STEP_MS}ms`,
                  } as React.CSSProperties)
            }
            /* An engaged critical control keeps the ordinary chip and reddens
               only its glyph: a 32px block of solid red on top of live video
               competes with the frame it is annotating. The alarm tone is the
               deliberate exception, because a siren audible at the site should
               cost the operator's attention until it is silenced. */
            className={`chip-blur relative flex size-[32px] items-center justify-center rounded-[5.818px] ${TRANSITION} ${
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
