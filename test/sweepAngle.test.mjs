/**
 * The radar needle's angle follows the device's reported progress.
 *
 *   npm run test:lib
 *
 * An angle is the one part of a radar that can be wrong in a way nobody
 * notices by looking — a needle at 140 degrees when the head is at 144 looks
 * exactly as convincing as a correct one. So it is the part that gets tested,
 * and the two cases below are both ones the 120px bench render actually caught:
 *
 *   THE DOUBLE LAP. A steady 100% reported 720 degrees — two full turns for one
 *   sweep — because 100% and 0% are the SAME ANGLE and the lap counter could
 *   not tell "still finished" from "started again".
 *
 *   THE JITTER. Progress is degrees of pan OBSERVED on a camera that is moving
 *   while it is read, so two polls can report 41 then 40.6. A needle that
 *   twitches backwards every couple of seconds looks broken.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  JITTER_HOLD_PERCENT,
  TRAIL_DEGREES,
  TRAIL_STEPS,
  advanceAngle,
  sweepAngle,
  trailSlices,
} from "../node_modules/.cache/footage-test/sweepAngle.mjs";

const close = (a, b, tol = 1e-9) => Math.abs(a - b) < tol;

/* ======================================================================
 *  PROGRESS -> ANGLE
 * ====================================================================== */

test("a quarter of the way round is a quarter turn", () => {
  assert.equal(sweepAngle(25), 90);
});

test("the whole circle maps to a whole turn, from the top", () => {
  assert.equal(sweepAngle(0), 0);
  assert.equal(sweepAngle(50), 180);
  assert.equal(sweepAngle(75), 270);
  assert.equal(sweepAngle(100), 360);
});

test("the angle is proportional across the range", () => {
  for (const p of [0, 10, 33.3, 64, 87.5, 100]) {
    assert.ok(close(sweepAngle(p), (p / 100) * 360), `at ${p}%`);
  }
});

test("a reading outside 0..100 is clamped rather than spun past the dial", () => {
  assert.equal(sweepAngle(-20), 0);
  assert.equal(sweepAngle(140), 360);
});

test("a missing or junk reading parks the needle at the start", () => {
  /* Absence must not become a random angle: a needle somewhere plausible is a
     claim about where the camera is pointing. */
  assert.equal(sweepAngle(NaN), 0);
  assert.equal(sweepAngle(Infinity), 0);
  assert.equal(sweepAngle(undefined), 0);
});

/* ======================================================================
 *  FOLLOWING THE READING
 * ====================================================================== */

test("the needle advances by the progress it was told about", () => {
  assert.equal(advanceAngle(0, 0, 25), 90);
  assert.equal(advanceAngle(90, 25, 50), 180);
  assert.equal(advanceAngle(180, 50, 100), 360);
});

test("⭐ the SAME reading twice does not move the needle", () => {
  /* THE DOUBLE-LAP BUG. A steady 100% reported 720 degrees: the needle span a
     second full turn for a sweep that had not moved at all. */
  assert.equal(advanceAngle(360, 100, 100), 360);
  assert.equal(advanceAngle(144, 40, 40), 144);
  assert.equal(advanceAngle(0, 0, 0), 0);
});

test("⭐ a new sweep carries on forwards through the wrap, never rewinding", () => {
  /* 100% -> 10% is a sweep finishing and another starting, which is 10% of
     travel forwards, NOT 90% backwards. */
  const after = advanceAngle(360, 100, 10);
  assert.ok(after > 360, `expected past a full turn, got ${after}`);
  assert.ok(close(after, 360 + 36), after);
});

test("⭐ a wrap from part-way round still only moves forwards", () => {
  const after = advanceAngle(324, 90, 10);
  assert.ok(close(after, 324 + 72), after);      // 90->100 then 0->10 = 20% = 72deg
});

test("⭐ a small backwards reading is noise and the needle holds", () => {
  /* 41 then 40.6 is one camera read twice while it turns, not a reversal. */
  assert.equal(advanceAngle(147.6, 41, 40.6), 147.6);
  assert.equal(advanceAngle(147.6, 41, 40.0001), 147.6);
});

test("the jitter bound is a bound, not a shrug", () => {
  /* Just inside holds; just outside is treated as a real new sweep and goes
     forwards. Either way it never decreases. */
  const hold = advanceAngle(100, 50, 50 - JITTER_HOLD_PERCENT);
  assert.equal(hold, 100);
  const wrapped = advanceAngle(100, 50, 50 - JITTER_HOLD_PERCENT - 0.5);
  assert.ok(wrapped > 100, wrapped);
});

test("⭐ the needle NEVER decreases, over a noisy run of readings", () => {
  /* The property that matters, asserted over a walk that includes jitter, two
     wraps and repeated readings -- the three things that each broke it. */
  const readings = [
    0, 4, 4, 9, 8.6, 20, 41, 40.6, 55, 55, 78, 99, 100, 100,
    2, 18, 17.8, 40, 73, 99.5, 100, 0, 11, 11, 30,
  ];
  let angle = 0;
  let last = 0;
  for (const r of readings) {
    const next = advanceAngle(angle, last, r);
    assert.ok(next >= angle, `went backwards: ${angle} -> ${next} at reading ${r}`);
    angle = next;
    last = r;
  }
  assert.ok(angle > 360 * 2, `two wraps should pass two full turns, got ${angle}`);
});

test("a junk reading does not throw the needle somewhere", () => {
  assert.equal(advanceAngle(144, 40, NaN), advanceAngle(144, 40, 0));
  assert.equal(advanceAngle(NaN, 0, 25), 90);
});

/* ======================================================================
 *  THE AFTERGLOW
 * ====================================================================== */

test("the trail is drawn in the configured number of slices", () => {
  assert.equal(trailSlices().length, TRAIL_STEPS);
});

test("the slices tile the trail exactly, with no gap and no overlap", () => {
  const s = trailSlices();
  assert.equal(s[0].from, 0, "the first slice starts at the needle");
  assert.ok(close(s[s.length - 1].to, TRAIL_DEGREES), "the last ends at the trail's length");
  for (let i = 1; i < s.length; i++) {
    assert.ok(close(s[i].from, s[i - 1].to), `gap between slice ${i - 1} and ${i}`);
  }
});

test("the trail is 60-90 degrees long, as a radar's is", () => {
  assert.ok(TRAIL_DEGREES >= 60 && TRAIL_DEGREES <= 90, String(TRAIL_DEGREES));
});

test("⭐ it fades from the needle backwards, and never reaches solid", () => {
  const s = trailSlices();
  for (let i = 1; i < s.length; i++) {
    assert.ok(s[i].opacity < s[i - 1].opacity, `slice ${i} is not dimmer than ${i - 1}`);
  }
  assert.ok(s[0].opacity < 1, "the needle is the solid thing, not the trail");
  assert.ok(s[s.length - 1].opacity >= 0, "and it never goes negative");
  assert.ok(s[s.length - 1].opacity < 0.05, "the far end is effectively transparent");
});

test("enough slices that the fade does not band", () => {
  /* Six banded visibly at 120px: twelve degrees a step reads as stripes. */
  assert.ok(TRAIL_DEGREES / TRAIL_STEPS <= 6, "a slice is too wide to read as a glow");
});
