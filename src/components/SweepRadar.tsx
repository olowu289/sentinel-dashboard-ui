import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { TRACK } from "@/lib/motion";
import { advanceAngle, trailSlices } from "@/lib/sweepAngle";

/**
 * The 360 sweep's glyph, turning with the sweep.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE NEEDLE IS A READING, NOT AN ANIMATION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Its angle is the device's own `percent` — degrees of pan actually observed —
 * so a camera that stalls has a needle that stalls with it. Nothing here runs
 * a clock of its own, and that is the point: a radar spinning at a constant
 * rate while the head was stuck would be the prettiest lie on the screen.
 *
 * What IS interpolated is the gap between polls. Status arrives on the
 * caller's poll interval (`trackMs`); between readings the needle glides
 * linearly to the last one it was told, arriving about as the next one lands.
 * Linear, because the
 * thing being tracked turns at a constant rate — an eased needle would read as
 * a head that speeds up and slows down twice a second.
 *
 * ── WHY IT IS NOT A `MaskIcon` ────────────────────────────────────────
 *
 * Every other glyph here is an exported Figma mask taking `currentColor`. This
 * one has a moving part and an angular fade, so it is drawn inline — but it
 * keeps the same contract: everything is `currentColor`, so it inherits the
 * chip's `text-body-ink` and inverts with the theme exactly like a mask would.
 * No hex anywhere in this file.
 */

/** Geometry shared with `public/icons/nav-sweep.svg`, so the two agree. */
const C = 12;          // centre
const RING = 8.8;      // the ring's radius
const TRAIL_R = 8.0;   // just inside the stroke, so the wedge never overlaps it
/* The needle stops SHORT of the ring by its own cap radius. Drawn to `RING` it
   reached the stroke's centreline and the round cap then sat half outside the
   dish -- visible at 120px as a needle poking through the rim. */
const NEEDLE = RING - 0.9;

/** A point on the trail circle, `deg` clockwise from the top. */
function point(deg: number): string {
  const rad = (deg * Math.PI) / 180;
  const x = C + TRAIL_R * Math.sin(rad);
  const y = C - TRAIL_R * Math.cos(rad);
  return `${x.toFixed(3)} ${y.toFixed(3)}`;
}

/**
 * One wedge of the afterglow, `from`..`to` degrees BEHIND the needle.
 *
 * The needle sits at 0 and the trail runs anticlockwise behind it, so both
 * angles are negated. Every slice is well under 180 degrees, which is why the
 * large-arc flag is 0; the sweep flag is 0 because the arc runs anticlockwise
 * from the leading edge to the trailing one.
 */
function wedge(from: number, to: number): string {
  return `M ${C} ${C} L ${point(-from)} A ${TRAIL_R} ${TRAIL_R} 0 0 0 ${point(-to)} Z`;
}

const SLICES = trailSlices();

export function SweepRadar({
  percent,
  paused = false,
  size = 20,
  trackMs = 2000,
}: {
  /** The device's reported progress, 0..100. */
  percent: number;
  /** A paused sweep holds its angle and dims its trail. */
  paused?: boolean;
  size?: number;
  /**
   * How long the needle takes to travel between readings. The caller passes
   * the interval it POLLS on, so the glide ends about as the next reading
   * lands.
   *
   * ⚠ A PROP RATHER THAN AN IMPORT, and not for testability. Reaching into
   * `api/ptz` for this one number made a presentational glyph depend on the
   * whole API layer -- the SDK, the client, the config -- which is a lot of
   * module for a duration, and it meant the thing could not be rendered
   * anywhere the app was not already booted. The default is the same order as
   * the poll it is used with, so a caller that forgets is close rather than
   * wrong.
   */
  trackMs?: number;
}) {
  const reduced = useReducedMotion();
  /* The CONTINUOUS angle, which keeps growing past 360 so a second lap carries
     on rather than rewinding. */
  const [angle, setAngle] = useState(() => advanceAngle(0, 0, percent));
  const current = useRef(angle);
  current.current = angle;
  /* The last reading the needle was moved BY. The angle is driven by the change
     in progress, not by progress itself -- see `advanceAngle`. */
  const seen = useRef(percent);

  useEffect(() => {
    /* A PAUSED SWEEP DOES NOT MOVE, even if a late poll arrives after the
       pause landed. The device has stopped turning; the needle says so -- and
       the reading is still recorded, so resuming does not replay the gap. */
    if (paused) {
      seen.current = percent;
      return;
    }
    setAngle(advanceAngle(current.current, seen.current, percent));
    seen.current = percent;
  }, [percent, paused]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      style={{ display: "block" }}
    >
      {/* The dish. Static, and the only part that is not on the rotor. */}
      <circle cx={C} cy={C} r={RING} stroke="currentColor" strokeWidth="1.6" fill="none" />

      <motion.g
        animate={{ rotate: angle }}
        /* Reduced motion gets the SAME ANGLE with no travel: the needle is a
           reading and must still be readable, so it is placed rather than
           animated. Nothing here loops, so there is nothing else to switch
           off. */
        transition={reduced ? { duration: 0 } : TRACK(trackMs / 1000)}
        /* ⚠ `transformBox: view-box` IS LOAD-BEARING, and the 120px bench
           render is what caught its absence. Without it an SVG element's
           transform-origin resolves against its own bounding box (or the
           viewport, depending on the browser), so the rotor swung around a
           point that was not the dish's centre: the needle orbited OUTSIDE the
           ring and the trail scythed across it. `motion`'s `originX`/`originY`
           do not help here -- those are the HTML percentage shorthand, and this
           is SVG. */
        style={{ transformBox: "view-box", transformOrigin: `${C}px ${C}px` }}
      >
        {SLICES.map((s) => (
          <path
            key={s.from}
            d={wedge(s.from, s.to)}
            fill="currentColor"
            /* Dimmed while paused: the afterglow is still there — the sweep has
               not been abandoned — but it is plainly not being refreshed. */
            opacity={paused ? s.opacity * 0.45 : s.opacity}
          />
        ))}
        <path
          d={`M ${C} ${C} L ${C} ${C - NEEDLE}`}
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </motion.g>

      {/* The hub, over the rotor so the needle appears to emerge from it. */}
      <circle cx={C} cy={C} r="1.7" fill="currentColor" />
    </svg>
  );
}
