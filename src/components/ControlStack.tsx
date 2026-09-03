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
  /**
   * A control that is held rather than switched.
   *
   * Talk-down was a click toggle wearing a hold label: it said "Release to
   * stop talking" and releasing did nothing, so an operator who let go and
   * walked away left a microphone open into a live yard. A control whose
   * consequence is *ongoing transmission* has to end when the hand does, which
   * means it cannot be an `onSelect` — the browser has no click event for
   * letting go. Keyboard gets the same shape through keydown/keyup, and blur
   * ends it too, because focus can leave without a key ever coming back up.
   */
  hold?: { onStart: () => void; onEnd: () => void };
  /** Survives the hover reveal — the tile's one permanent affordance. */
  persistent?: boolean;
  /**
   * The command is in flight.
   *
   * Distinct from `disabled`, which it usually accompanies: disabled says "you
   * cannot", busy says "you already did, wait". On a control that reaches a
   * physical site — a siren, a talk-down, a recording — those are different
   * things to tell somebody, and only one of them is temporary.
   */
  busy?: boolean;
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
  "tile-reveal max-lg:visible invisible " +
  "group-hover:visible group-focus-within:visible";

/* Opacity is kept apart from visibility above so the disabled ceiling can be a
   different utility rather than a competing value for the same one. It was
   written as a bare `opacity-40` alongside `group-hover:opacity-100`, and a
   variant beats a base utility — so the one control that had something to say
   about itself lost the ability to say it at exactly the moment it appeared.
   `zoom-out` is disabled on every tile at rest, so this was every tile. */
const REVEAL_OPACITY =
  "max-lg:opacity-100 opacity-0 " +
  "group-hover:opacity-100 group-focus-within:opacity-100";

const REVEAL_OPACITY_DISABLED =
  "max-lg:opacity-40 opacity-0 " +
  "group-hover:opacity-40 group-focus-within:opacity-40";

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
            aria-busy={c.busy || undefined}
            onClick={c.hold ? undefined : c.onSelect}
            onPointerDown={
              c.hold &&
              ((e) => {
                /* Capture so the release still lands here when the pointer has
                   wandered off a 32px button mid-sentence. */
                try {
                  e.currentTarget.setPointerCapture(e.pointerId);
                } catch {
                  /* no capture; onPointerLeave below is the backstop */
                }
                c.hold?.onStart();
              })
            }
            onPointerUp={c.hold && (() => c.hold?.onEnd())}
            onPointerCancel={c.hold && (() => c.hold?.onEnd())}
            onPointerLeave={c.hold && (() => c.hold?.onEnd())}
            onKeyDown={
              c.hold &&
              ((e) => {
                if (e.repeat) return;
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  c.hold?.onStart();
                }
              })
            }
            onKeyUp={
              c.hold &&
              ((e) => {
                if (e.key === " " || e.key === "Enter") c.hold?.onEnd();
              })
            }
            onBlur={c.hold && (() => c.hold?.onEnd())}
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
              c.disabled ? "cursor-not-allowed" : ""
            } ${
              c.persistent
                ? c.disabled
                  ? "opacity-40"
                  : ""
                : c.disabled
                  ? REVEAL_OPACITY_DISABLED
                  : REVEAL_OPACITY
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
              {/* Busy replaces the glyph rather than sitting beside it: a
                  32px chip has room for one mark, and while a command is in
                  flight the useful mark is that it is in flight. */}
              {c.busy ? (
                <svg
                  width={c.size ?? 20}
                  height={c.size ?? 20}
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden
                  className="animate-spin [animation-duration:800ms]"
                >
                  <circle cx="10" cy="10" r="8" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
                  <path d="M18 10a8 8 0 0 0-8-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
                </svg>
              ) : (
                <MaskIcon src={c.icon} size={c.size ?? 20} />
              )}
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
