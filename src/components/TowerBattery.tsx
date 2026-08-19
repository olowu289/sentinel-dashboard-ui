import { useId, type CSSProperties } from "react";

/**
 * The battery cell on the tower mast, drawn as a level rather than picked from
 * a set of pictures.
 *
 * The design shipped three exports of the mast and they turned out not to be
 * colour variants at all — they are the same cell drawn full, half and nearly
 * empty, differing only in where the top edge of the fill sits. The code was
 * choosing between them by `tower.status`, so a site at 87% showed a full cell
 * because it happened to be `online` and one at 34% showed a half cell because
 * it happened to be `degraded`. The two agreed by luck.
 *
 * So the fill is reconstructed here from the full-level geometry and a clip,
 * and the three drawn states become three samples of one gauge: the numbers
 * below put the design's own half and empty exports at ~53% and ~6%.
 *
 * It renders *under* `twr-mast.svg`, not over it. In the export the fill is the
 * first thing painted and all 133 mast strokes come after, so the cage struts
 * cross in front of the cell — an overlay would paint them out.
 */

/* All in the export's own 59×101 user space, measured off the full-level path.
   FLOOR/TOP are read at CORNER_X, the fill's top-right corner, because that is
   the one point both faces share and therefore the one that has to stay put. */
const CORNER_X = 51.09;
const FLOOR_Y = 74.49;
const TOP_Y = 54.3749;
/* Slope of the drawn liquid surface. The cell is in oblique projection, so a
   horizontal cut would read as the fill tipping forward. */
const SURFACE_SLOPE = -0.1389;

/** The fill at rest, full: front face then the receding right face. */
const FRONT =
  "M46.8303 75.0955L45.8797 69.7829L43.2629 55.462L51.09 54.3749L54.794 73.7255L54.4818 74.1417L46.8303 74.9333V75.0955Z";
const SIDE =
  "M51.0902 54.4302L54.794 73.7249L54.8756 74.3456L55.3893 74.1411L58.2753 69.994L54.8569 53.0078L51.0902 54.4302Z";

/* Front face, then the receding face at 81% of each channel — the step the
   design's own amber export uses (#f3cf58 → #c4a749), applied to all three so
   the cell is lit the same way at every level. Thresholds are this repo's
   existing battery tiers, and the hues are the house grammar: a charge is a
   reading, and readings get green, amber or red. */
const TIERS = [
  { min: 40, front: "#409421", side: "#34781a" },
  { min: 20, front: "#f3cf58", side: "#c4a749" },
  { min: 0, front: "#c44949", side: "#9e3b3b" },
] as const;

/**
 * The charge tier as a text colour, for everything that names a battery beside
 * the cell — the fleet card's hover panel, the settings identity, the tower
 * bar. It lives here because this file already owns `TIERS`, and three copies
 * of the same two thresholds is how a product ends up disagreeing with itself
 * about when a battery is low.
 */
export function batteryTone(pct: number) {
  return pct < 20 ? "text-critical" : pct < 40 ? "text-warn" : "text-terra";
}

/* Where the battery's body starts and ends as a fraction of the icon's box —
   0.8→16.4 of 19.2 in `twr-battery.svg`, 1→20.5 of 24 in `set-battery.svg`, the
   same proportions in both. The charge is read across the body alone, so the
   whole 0–100 range is spent on the part that can show it. Run the gradient
   across the raw box instead and everything from 86% up draws an identical
   full body, with only the terminal nub left to distinguish them.

   The nub is the exception, and it is what 100% looks like: it lights only when
   the tower is topped off, which is the frame at 194:2565 — glyph fully green,
   nothing left dim. Below that it stays in the empty tone, where the real
   cell's contact sits anyway. */
const BODY_START = 4.17;
const BODY_END = 85.42;

/* Same tiers `TowerBattery` paints the cell with, so the glyph beside the mast
   and the charge inside it can never disagree. Tokens rather than class names,
   because a gradient cannot read a Tailwind text colour. */
const BATTERY_HEX = {
  critical: "var(--color-critical)",
  warn: "var(--color-warn)",
  ok: "var(--color-terra)",
} as const;

/**
 * The battery glyph, filled to the charge.
 *
 * The export is a single path with no separable outline and fill — it draws a
 * solid battery, so there is nothing inside it to reveal. But `MaskIcon` paints
 * *behind* the mask, and the glyph is effectively a hole: a hard-stop gradient
 * at the charge level fills the body left to right and leaves the rest dim,
 * without a second export or a hand-drawn icon.
 *
 * The charge is read across the *body*, `BODY_START` to `BODY_END` above — not
 * across the glyph's box, which also contains the gap and the terminal. The
 * whole nub is the 100% case and nothing else: at full the gradient runs the
 * entire width and lights it with the body, and below that it stays in the
 * empty tone, which is where the real cell's contact sits anyway.
 *
 * No transition on it. The tower climbs 1% a second, which on a 19.2px glyph is
 * 0.19px a step — the level already moves smoothly because the number does, and
 * animating a sub-pixel change would only add lag between the figure beside it
 * and the bar.
 */
export function batteryFill(pct: number) {
  const level = Math.min(100, Math.max(0, pct));
  const lit = BATTERY_HEX[pct < 20 ? "critical" : pct < 40 ? "warn" : "ok"];
  const stop =
    level >= 100 ? 100 : BODY_START + (BODY_END - BODY_START) * (level / 100);
  return `linear-gradient(to right, ${lit} 0 ${stop}%, rgba(255,255,255,0.16) ${stop}% 100%)`;
}

export function TowerBattery({
  pct,
  charging = false,
  className = "",
}: {
  /** Charge, 0–100. */
  pct: number;
  /** Solar is putting charge in. Adds the only motion here. */
  charging?: boolean;
  className?: string;
}) {
  /* `useId` returns a string with colons in it, which is legal in an id and
     legal inside url(#…) but a trap for anything that later tries to select it. */
  const clipId = `battery-${useId().replace(/:/g, "")}`;

  const level = Math.min(100, Math.max(0, pct));
  const tier = TIERS.find((t) => level >= t.min) ?? TIERS[TIERS.length - 1];

  const travel = FLOOR_Y - TOP_Y;
  const y = FLOOR_Y - travel * (level / 100);
  /* How far this cell has left to go. The charge sweep runs from where the
     battery actually is up to full and back, the way a phone shows it, so the
     distance is different on every card — a keyframe cannot hold it and a
     custom property can. At 100% it is zero and the animation is a no-op,
     which is right: there is nothing left to fill. */
  const gap = travel * (1 - level / 100);
  /* The clip's top edge, carried out past both faces so only its height and
     its slope matter. Below it everything is kept. */
  const x0 = 40;
  const x1 = 60;
  const surface = `M${x0},${(y + (CORNER_X - x0) * -SURFACE_SLOPE).toFixed(3)}L${x1},${(
    y -
    (x1 - CORNER_X) * -SURFACE_SLOPE
  ).toFixed(3)}L${x1},110L${x0},110Z`;

  return (
    <svg
      viewBox="0 0 59 101"
      aria-hidden
      focusable="false"
      className={className}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          {/* The charging animation moves the clip, not the fill: the cell's
              own outline must not breathe, only what is inside it. */}
          <path
            d={surface}
            className={charging ? "battery-charge" : undefined}
            style={
              charging
                ? ({ "--charge-gap": `${(-gap).toFixed(3)}px` } as CSSProperties)
                : undefined
            }
          />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <path className="battery-fill" d={FRONT} fill={tier.front} />
        <path className="battery-fill" d={SIDE} fill={tier.side} />
      </g>
    </svg>
  );
}
