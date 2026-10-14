/**
 * Turning a sweep's PROGRESS into a needle angle.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE NEEDLE SHOWS WHAT THE DEVICE REPORTED. IT NEVER GUESSES.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `percent` comes from the device's own `sweepStatus`, measured in degrees of
 * pan actually observed — not from a timer here. So the needle is a reading,
 * and these functions do nothing but convert and smooth it.
 *
 * Pure on purpose: an angle is the one part of a radar that can be wrong in a
 * way nobody notices by looking, so it is the part that gets tested.
 */

/** How long the afterglow is, in degrees. The classic radar trail. */
export const TRAIL_DEGREES = 72;

/**
 * How many slices the trail is drawn in.
 *
 * ⚠ SIX BANDED VISIBLY at 120px -- twelve degrees a step is wide enough to
 * read as stripes rather than as a glow, which is the one thing an afterglow
 * must not do. Fourteen is about four degrees a step and reads as continuous at
 * every size this renders, from a 20px chip to the bench.
 */
export const TRAIL_STEPS = 14;

/**
 * The needle's angle for a progress percentage.
 *
 * ⚠ ZERO IS THE TOP, and clockwise from there, because that is where a radar
 * starts and which way it turns. The SVG is drawn with the needle already
 * pointing up, so this is a pure rotation and nothing else has to agree about
 * where north is.
 *
 * 25 -> 90, 50 -> 180, 100 -> 360 (back at the start, having gone all the way
 * round rather than never having left).
 */
export function sweepAngle(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  const clamped = percent < 0 ? 0 : percent > 100 ? 100 : percent;
  return (clamped / 100) * 360;
}

/**
 * A backwards step no larger than this is read as measurement noise, and the
 * needle holds rather than moving.
 *
 * Sized against what the device actually does: progress is degrees of pan
 * OBSERVED on a camera mid-turn, so a reading can land a hair behind the last
 * one. A real new sweep drops by tens of points, nowhere near this bound.
 */
export const JITTER_HOLD_PERCENT = 1;

/**
 * The angle to animate TO, from where the needle is and how far progress moved.
 *
 * ⚠ IT IS DRIVEN BY THE CHANGE IN PROGRESS, NOT BY PROGRESS ITSELF, and that is
 * not a stylistic choice — it is the only formulation that survives the two
 * things this value really does.
 *
 *   THE WRAP. 100% and 0% are THE SAME ANGLE: a sweep ends where it began. Map
 *   progress straight to an angle and the two are indistinguishable, so the
 *   needle either rewinds a whole turn at the start of a second sweep or, if
 *   you compensate by counting laps, advances one every time the same reading
 *   arrives twice. The 120px bench render caught exactly that: a steady 100%
 *   reported 720 degrees, two full turns for one sweep.
 *
 *   THE JITTER. Two polls can report 41 then 40.6, because the camera is moving
 *   while it is being read. A needle that twitches back half a degree every
 *   couple of seconds looks broken in a way a smoothly wrong one does not.
 *
 * So: a forward step advances by its own size, a small backward step holds, and
 * a large backward step is a new sweep and advances through the wrap. The
 * result is a CONTINUOUS angle that only ever grows — the caller rotates by it
 * directly, and `motion` is happy to rotate past a full turn, which is what
 * makes a second lap carry on rather than rewind.
 *
 * Idempotent: the same reading twice does not move the needle at all.
 */
export function advanceAngle(
  current: number,
  lastPercent: number,
  percent: number,
): number {
  const from = clampPercent(lastPercent);
  const to = clampPercent(percent);
  const base = Number.isFinite(current) ? current : 0;

  let delta = to - from;
  if (delta < 0) {
    if (-delta <= JITTER_HOLD_PERCENT) return base;   // noise: hold
    delta += 100;                                     // a new sweep: through the wrap
  }
  return base + (delta / 100) * 360;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 100 ? 100 : value;
}

/**
 * The trail's slices, leading edge first.
 *
 * Each is a wedge of `TRAIL_DEGREES / TRAIL_STEPS` degrees with its own
 * opacity, fading from just behind the needle to nothing. Drawn as discrete
 * steps rather than an angular gradient because SVG has no conic gradient, and
 * at the sizes this renders (20px on a chip, 120px on a bench) six steps read
 * as a fade rather than as bands.
 *
 * Opacity never reaches 1: the needle itself is the solid thing, and a trail
 * that started at full strength would make the leading edge look two strokes
 * wide instead of one.
 */
export function trailSlices(): { from: number; to: number; opacity: number }[] {
  const step = TRAIL_DEGREES / TRAIL_STEPS;
  const out: { from: number; to: number; opacity: number }[] = [];
  for (let i = 0; i < TRAIL_STEPS; i++) {
    out.push({
      // Degrees BEHIND the needle: 0 is at the needle, growing backwards.
      from: i * step,
      to: (i + 1) * step,
      /* Peaks well below solid. The needle is the solid thing; a trail that
         started near full strength made the leading edge look like a pie slice
         with a bright rim rather than a fading wake. */
      opacity: 0.32 * (1 - i / TRAIL_STEPS),
    });
  }
  return out;
}
