/**
 * The three-bar signal meter, wherever an uplink reading is drawn.
 *
 * Lifted out of `TowersView`, unchanged in shape, because tower settings now
 * draws the same instrument beside its Radio link row and a second copy is a
 * second set of heights to keep in step. It is built from three spans rather
 * than an exported asset for the reason it always was: it is a METER, not a
 * symbol, and its whole job is to be at a height.
 *
 * ⚠ THE LIT BARS AND THE WORD COME FROM ONE PLACE. `uplinkDisplay` decides
 * how many light and in which colour, and the caller passes that straight in.
 * The board and the settings row cannot show different meters for one record,
 * which is the bug this was extracted to close.
 *
 * Nothing is drawn when the reading has no meter -- a hub's way out has no
 * signal strength, and three dark bars beside "Satellite" would read as a
 * satellite link with no signal.
 */

import type { UplinkDisplay } from "@/lib/uplinkDisplay";

/** The bar heights, shortest first. The design's, and they are the asset. */
const HEIGHTS = [5, 8.5, 12];

/**
 * The lit colour for a reading's tone.
 *
 * A `bg-` for every `text-` in the reserved set, resolved here so neither
 * caller writes the mapping out. An unlit bar, and a reading with no status
 * at all, stays the dim grey the board uses for an instrument with nothing in
 * it.
 */
function fillFor(tone?: string): string {
  if (tone === "text-terra") return "bg-terra";
  if (tone === "text-warn") return "bg-warn";
  if (tone === "text-critical") return "bg-critical";
  return "bg-overlay/45";
}

export function UplinkBars({ display, className = "" }: {
  display: UplinkDisplay;
  className?: string;
}) {
  if (!display.meter) return null;
  const fill = fillFor(display.tone);
  return (
    <span
      data-bars={display.bars}
      aria-hidden
      className={`flex h-[12px] shrink-0 items-end gap-[1.5px] ${className}`}
    >
      {HEIGHTS.map((h, i) => (
        <span
          key={h}
          style={{ height: h }}
          className={`w-[3px] rounded-[1px] ${i < display.bars ? fill : "bg-overlay/15"}`}
        />
      ))}
    </span>
  );
}
