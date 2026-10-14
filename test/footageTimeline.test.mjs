/**
 * The continuous timeline: seams, gaps, and stepping in both directions.
 *
 *   npm run test:lib
 *
 * `node --test` against an esbuild of `src/lib/footageTimeline.ts`. The module
 * is pure on purpose -- every awkward part of a continuous player is a decision
 * about WHICH segment and WHAT OFFSET, and a decision that needs no network is
 * a decision that can be tested without one.
 *
 * The archive hands out ~15-minute files. An operator is looking for a moment.
 * Everything here is about keeping those two facts from being the operator's
 * problem:
 *
 *   A SEAM IS NOT A GAP. Consecutive files abut with encoder jitter -- a
 *   fraction of a second either way, with nothing missing. Read literally that
 *   is hundreds of holes in a continuous day, and a player that "skips" across
 *   joins where nothing was lost.
 *
 *   A GAP IS NOT THE END OF THE DAY. Before the first file and after the last
 *   one there is no footage either, but announcing "skipping 9 hours" to
 *   somebody who just opened the morning is noise, not honesty.
 *
 *   BACKWARDS IS NOT FORWARDS REVERSED. Stepping back out of a hole should land
 *   on the last thing recorded before it -- where "what happened just before the
 *   camera stopped" lives -- not on the start of that earlier run.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GAP_TOLERANCE_SEC,
  buildTimeline,
  coverage,
  gapAt,
  isSeam,
  nextFootageAfter,
  nextSegment,
  prevFootageBefore,
  prevSegment,
  rangeCrossesGap,
  resolve,
  segmentAt,
  segmentsCovering,
} from "../node_modules/.cache/footage-test/footageTimeline.mjs";

const T0 = 1_790_000_000;          // an arbitrary, stable midnight-ish epoch
const MIN = 60;
const SEG = 15 * MIN;              // the archive's ~15 minute file

/** A segment, as the hub reports one. */
const seg = (startEpoch, duration = SEG, extra = {}) => ({
  key: `k_${startEpoch}_${duration}`,
  camera: 1,
  deviceId: "twr-alpha",
  start: new Date(startEpoch * 1000).toISOString(),
  startEpoch,
  duration,
  size: 1000,
  url: `https://x/${startEpoch}.mp4`,
  downloadUrl: `https://x/${startEpoch}.mp4?dl=1`,
  filename: `cam1_${startEpoch}.mp4`,
  ...extra,
});

/** Four files back to back: one unbroken hour. */
const hour = () => [seg(T0), seg(T0 + SEG), seg(T0 + 2 * SEG), seg(T0 + 3 * SEG)];

/* ======================================================================
 *  BUILDING
 * ====================================================================== */

test("an empty archive is a valid timeline, not an error", () => {
  const t = buildTimeline([]);
  assert.deepEqual(t.runs, []);
  assert.deepEqual(t.gaps, []);
  assert.equal(t.from, null);
  assert.equal(t.to, null);
  assert.equal(t.seconds, 0);
});

test("back-to-back segments are ONE run with no gaps", () => {
  const t = buildTimeline(hour());
  assert.equal(t.runs.length, 1);
  assert.equal(t.gaps.length, 0);
  assert.equal(t.from, T0);
  assert.equal(t.to, T0 + 4 * SEG);
  assert.equal(t.seconds, 4 * SEG);
});

test("encoder jitter at a seam is NOT a gap", () => {
  /* The failure this prevents: a day of continuous footage drawn as hundreds of
     holes, and a player announcing a skip at every join. */
  const jitter = GAP_TOLERANCE_SEC - 0.5;
  const t = buildTimeline([seg(T0), seg(T0 + SEG + jitter)]);
  assert.equal(t.gaps.length, 0);
  assert.equal(t.runs.length, 1);
});

test("a real absence IS a gap", () => {
  const t = buildTimeline([seg(T0), seg(T0 + SEG + 20 * MIN)]);
  assert.equal(t.runs.length, 2);
  assert.equal(t.gaps.length, 1);
  assert.equal(t.gaps[0].from, T0 + SEG);
  assert.equal(t.gaps[0].to, T0 + SEG + 20 * MIN);
  assert.equal(t.gaps[0].seconds, 20 * MIN);
});

test("out-of-order input is sorted rather than trusted", () => {
  const t = buildTimeline([seg(T0 + 2 * SEG), seg(T0), seg(T0 + SEG)]);
  assert.equal(t.runs.length, 1);
  assert.equal(t.from, T0);
  assert.deepEqual(t.segments.map((s) => s.startEpoch), [T0, T0 + SEG, T0 + 2 * SEG]);
});

test("a zero-length segment is dropped, not kept as a seam", () => {
  const t = buildTimeline([seg(T0), seg(T0 + SEG, 0), seg(T0 + SEG)]);
  assert.equal(t.segments.length, 2);
  assert.equal(t.runs.length, 1);
});

test("a short segment inside a longer one does not pull the run's end back", () => {
  const t = buildTimeline([seg(T0, 2 * SEG), seg(T0 + MIN, MIN)]);
  assert.equal(t.runs.length, 1);
  assert.equal(t.runs[0].to, T0 + 2 * SEG);
});

/* ======================================================================
 *  WHERE AM I
 * ====================================================================== */

test("a moment resolves to its segment and an offset into it", () => {
  const t = buildTimeline(hour());
  const at = segmentAt(t, T0 + SEG + 90);
  assert.equal(at.segment.startEpoch, T0 + SEG);
  assert.equal(at.offset, 90);
});

test("the first moment of a segment is offset zero, not the previous file's end", () => {
  const t = buildTimeline(hour());
  assert.equal(segmentAt(t, T0 + SEG).segment.startEpoch, T0 + SEG);
  assert.equal(segmentAt(t, T0 + SEG).offset, 0);
});

test("a moment in a gap has no segment", () => {
  const t = buildTimeline([seg(T0), seg(T0 + SEG + 20 * MIN)]);
  assert.equal(segmentAt(t, T0 + SEG + 5 * MIN), null);
});

test("overlapping segments resolve to the LATER recording", () => {
  const a = seg(T0, 2 * SEG);
  const b = seg(T0 + SEG, SEG, { key: "restarted" });
  const t = buildTimeline([a, b]);
  assert.equal(segmentAt(t, T0 + SEG + 10).segment.key, "restarted");
});

/* ======================================================================
 *  AUTO-ADVANCE, FORWARD
 * ====================================================================== */

test("the end of a segment plays straight into the next one", () => {
  const t = buildTimeline(hour());
  const first = t.segments[0];
  const next = nextSegment(t, first);
  assert.equal(next.startEpoch, T0 + SEG);
  assert.equal(isSeam(first, next), true, "a back-to-back join must be a seam");
});

test("playing past the end of a segment lands at offset 0 of the next", () => {
  const t = buildTimeline(hour());
  const d = resolve(t, T0 + SEG);        // exactly the boundary
  assert.equal(d.kind, "play");
  assert.equal(d.position.segment.startEpoch, T0 + SEG);
  assert.equal(d.position.offset, 0);
});

test("the last segment has nothing after it", () => {
  const t = buildTimeline(hour());
  assert.equal(nextSegment(t, t.segments[3]), null);
});

test("running off the end of the day STOPS rather than wrapping", () => {
  const t = buildTimeline(hour());
  const d = resolve(t, T0 + 4 * SEG + 1);
  assert.equal(d.kind, "end");
});

/* ======================================================================
 *  AUTO-ADVANCE, BACKWARD
 * ====================================================================== */

test("seeking before a segment's start loads the previous one", () => {
  const t = buildTimeline(hour());
  const third = t.segments[2];
  const back = prevSegment(t, third);
  assert.equal(back.startEpoch, T0 + SEG);
  assert.equal(isSeam(back, third), true);
});

test("stepping back across a boundary lands inside the earlier segment", () => {
  const t = buildTimeline(hour());
  const d = resolve(t, T0 + 2 * SEG - 10);     // ten seconds before the join
  assert.equal(d.kind, "play");
  assert.equal(d.position.segment.startEpoch, T0 + SEG);
  assert.equal(d.position.offset, SEG - 10);
});

test("the first segment has nothing before it", () => {
  const t = buildTimeline(hour());
  assert.equal(prevSegment(t, t.segments[0]), null);
});

test("stepping back out of a gap lands on the LAST moment recorded, not the run's start", () => {
  /* Where "what happened just before the camera stopped" actually is. */
  const t = buildTimeline([seg(T0), seg(T0 + SEG + 20 * MIN)]);
  const back = prevFootageBefore(t, T0 + SEG + 5 * MIN);
  assert.equal(back, T0 + SEG - 1);
  assert.ok(segmentAt(t, back), "and it must be playable");
});

test("stepping back before the first footage finds nothing", () => {
  const t = buildTimeline(hour());
  assert.equal(prevFootageBefore(t, T0 - 1), null);
});

/* ======================================================================
 *  GAPS
 * ====================================================================== */

test("reaching a gap jumps to the next footage and says how much was missing", () => {
  const t = buildTimeline([seg(T0), seg(T0 + SEG + 20 * MIN)]);
  const d = resolve(t, T0 + SEG + 1);
  assert.equal(d.kind, "jump");
  assert.equal(d.to, T0 + SEG + 20 * MIN);
  assert.equal(d.gap.seconds, 20 * MIN);
  assert.equal(d.position.offset, 0, "it lands at the start of the next footage");
});

test("a gap is only ever BETWEEN runs", () => {
  const t = buildTimeline(hour());
  assert.equal(gapAt(t, T0 - 10 * MIN), null, "before the day is not a gap");
  assert.equal(gapAt(t, T0 + 10 * SEG), null, "after the day is not a gap");
});

test("opening before the first footage goes to it without calling it a gap", () => {
  /* Otherwise every morning opens with "skipping 9 hours". */
  const t = buildTimeline(hour());
  const d = resolve(t, T0 - 9 * 3600);
  assert.equal(d.kind, "jump");
  assert.equal(d.to, T0);
  assert.equal(gapAt(t, T0 - 9 * 3600), null);
});

test("nextFootageAfter returns the moment itself when there is footage", () => {
  const t = buildTimeline(hour());
  assert.equal(nextFootageAfter(t, T0 + 30), T0 + 30);
});

test("nextFootageAfter is null past the end of the day", () => {
  const t = buildTimeline(hour());
  assert.equal(nextFootageAfter(t, T0 + 99 * SEG), null);
});

/* ======================================================================
 *  THE DAY BAR
 * ====================================================================== */

test("the day bar reports footage and gaps as fractions of the window", () => {
  const dayFrom = T0;
  const dayTo = T0 + 4 * 3600;
  const t = buildTimeline([seg(T0, 3600), seg(T0 + 2 * 3600, 3600)]);
  const bands = coverage(t, dayFrom, dayTo);
  assert.deepEqual(bands.map((b) => b.kind), ["footage", "gap", "footage", "gap"]);
  assert.equal(bands[0].start, 0);
  assert.equal(bands[0].end, 0.25);
  assert.equal(bands[1].end, 0.5);
});

test("the bar carries real times, so a click becomes a moment", () => {
  const t = buildTimeline([seg(T0, 3600)]);
  const bands = coverage(t, T0, T0 + 2 * 3600);
  assert.equal(bands[0].from, T0);
  assert.equal(bands[0].to, T0 + 3600);
});

test("an empty archive draws no bar at all rather than a full-width gap", () => {
  /* A bar is a claim about a day. With nothing listed there is no claim to
     make, and a solid "gap" would assert that we KNOW there is no footage. */
  assert.deepEqual(coverage(buildTimeline([]), T0, T0 + 3600), []);
});

/* ======================================================================
 *  DOWNLOAD RANGE
 * ====================================================================== */

test("a marked range resolves to the WHOLE segments covering it", () => {
  /* The archive cannot trim -- there is no server-side transcode -- so the
     honest offer is the files that cover the range, never a clip pretending to
     be the marked length. */
  const t = buildTimeline(hour());
  const covering = segmentsCovering(t, T0 + SEG + 60, T0 + 2 * SEG + 60);
  assert.equal(covering.length, 2);
  assert.deepEqual(covering.map((s) => s.startEpoch), [T0 + SEG, T0 + 2 * SEG]);
});

test("a range inside one segment needs only that segment", () => {
  const t = buildTimeline(hour());
  assert.equal(segmentsCovering(t, T0 + 60, T0 + 120).length, 1);
});

test("an inverted or empty range covers nothing", () => {
  const t = buildTimeline(hour());
  assert.deepEqual(segmentsCovering(t, T0 + 100, T0 + 100), []);
  assert.deepEqual(segmentsCovering(t, T0 + 200, T0 + 100), []);
});

test("a range spanning a hole is reported so the export can warn", () => {
  const t = buildTimeline([seg(T0), seg(T0 + SEG + 20 * MIN)]);
  const crossed = rangeCrossesGap(t, T0 + 60, T0 + SEG + 25 * MIN);
  assert.ok(crossed);
  assert.equal(crossed.seconds, 20 * MIN);
});

test("a range inside one run crosses nothing", () => {
  const t = buildTimeline(hour());
  assert.equal(rangeCrossesGap(t, T0 + 60, T0 + 120), null);
});
