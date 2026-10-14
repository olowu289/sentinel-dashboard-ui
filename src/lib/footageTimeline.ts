import type { ArchivedSegment } from "@kallon/sentry-sdk";

/**
 * A day of archived segments, read as ONE CONTINUOUS TIMELINE per camera.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE ARCHIVE IS SEGMENTS. AN OPERATOR IS LOOKING FOR A MOMENT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The hub stores complete ~15-minute files, and the screen that browsed them
 * made that the operator's problem: a list of clips, played one at a time,
 * stopping dead every quarter of an hour. Nobody investigating an incident
 * thinks in fifteen-minute files. They think "about ten past nine", and they
 * expect to scrub across it.
 *
 * So this module turns a camera's segments into a timeline addressed by WALL
 * CLOCK TIME, and answers the four questions a player actually asks:
 *
 *   where am I          {@link segmentAt} -- which file, and how far into it
 *   what comes next     {@link nextSegment} / {@link prevSegment}
 *   is there a hole     {@link gapAt}, and {@link nextFootageAfter} to leave it
 *   what does a day     {@link coverage}, for the bar you click to jump
 *   look like
 *
 * ── EVERYTHING IS EPOCH SECONDS ───────────────────────────────────────
 *
 * `ArchivedSegment.startEpoch` is given precisely so a timeline needs no date
 * parsing, and nothing here parses one. Rendering a time is the caller's job
 * and belongs in the site's timezone (`lib/time.ts`), never the viewer's.
 *
 * ── NOTHING HERE FETCHES ──────────────────────────────────────────────
 *
 * Pure functions over a list. That is deliberate: the awkward parts of a
 * continuous player -- seaming, gap skipping, preloading the next file,
 * stepping backwards over a boundary -- are all decisions about WHICH segment
 * and WHAT OFFSET, and a decision that can be made without a network is a
 * decision that can be tested without one.
 */

/**
 * How much daylight between two segments counts as a real gap, in seconds.
 *
 * ⚠ IT IS NOT ZERO, AND THAT IS THE WHOLE POINT. Segments are cut by a
 * recorder on a tower, so consecutive files abut with jitter -- a fraction of a
 * second of overlap or shortfall, from encoder timing rather than from anything
 * missing. Treating that as a gap would draw a day of continuous footage as
 * hundreds of holes and make a player "skip" across seams that have nothing
 * missing in them.
 *
 * Two seconds is comfortably above that jitter and well below the shortest
 * absence anybody would call a gap.
 */
export const GAP_TOLERANCE_SEC = 2;

/** A stretch with no footage, between two runs that have some. */
export interface FootageGap {
  /** Epoch seconds. The first moment with nothing. */
  from: number;
  /** Epoch seconds. The next moment that has footage again. */
  to: number;
  /** `to - from`, for a caller that wants to say how long it is. */
  seconds: number;
}

/** An unbroken run of footage, seams and all. */
export interface FootageRun {
  from: number;
  to: number;
  seconds: number;
}

/** Where a moment falls inside the archive. */
export interface Position {
  segment: ArchivedSegment;
  /** Seconds into that segment's own media. Never negative. */
  offset: number;
}

export interface FootageTimeline {
  /** Oldest first, overlaps resolved. Empty is a valid timeline. */
  segments: ArchivedSegment[];
  /** Unbroken runs, oldest first. */
  runs: FootageRun[];
  /** The holes between those runs. Never includes the ends of the day. */
  gaps: FootageGap[];
  /** Epoch seconds of the first and last footage, or `null` when there is none. */
  from: number | null;
  to: number | null;
  /** Seconds of footage actually held, gaps excluded. */
  seconds: number;
}

const endOf = (s: ArchivedSegment): number => s.startEpoch + s.duration;

/**
 * Build the timeline for ONE camera.
 *
 * ⚠ THE INPUT IS NOT TRUSTED TO BE SORTED OR SANE. The API documents
 * oldest-first and in practice delivers it, but a timeline that quietly
 * mis-seeks because one row arrived out of order is the kind of bug nobody
 * finds for a month. Sorting costs nothing on a day's worth of segments.
 *
 * A segment with a non-positive duration is DROPPED rather than kept at zero
 * length: it can never be seeked into, it cannot be played, and leaving it in
 * would put a seam in the middle of a run that has no hole in it.
 */
export function buildTimeline(input: readonly ArchivedSegment[]): FootageTimeline {
  const segments = input
    .filter((s) => Number.isFinite(s.startEpoch) && s.duration > 0)
    .slice()
    .sort((a, b) => a.startEpoch - b.startEpoch);

  if (segments.length === 0) {
    return { segments, runs: [], gaps: [], from: null, to: null, seconds: 0 };
  }

  const runs: FootageRun[] = [];
  let runFrom = segments[0].startEpoch;
  let runTo = endOf(segments[0]);

  for (let i = 1; i < segments.length; i++) {
    const s = segments[i];
    /* A segment that starts before the current run ends OVERLAPS it (or abuts
       within the jitter tolerance); either way the run continues. `Math.max`
       rather than assignment, because a short segment wholly inside a longer
       one must not pull the run's end backwards. */
    if (s.startEpoch - runTo <= GAP_TOLERANCE_SEC) {
      runTo = Math.max(runTo, endOf(s));
      continue;
    }
    runs.push({ from: runFrom, to: runTo, seconds: runTo - runFrom });
    runFrom = s.startEpoch;
    runTo = endOf(s);
  }
  runs.push({ from: runFrom, to: runTo, seconds: runTo - runFrom });

  const gaps: FootageGap[] = [];
  for (let i = 1; i < runs.length; i++) {
    const from = runs[i - 1].to;
    const to = runs[i].from;
    gaps.push({ from, to, seconds: to - from });
  }

  return {
    segments,
    runs,
    gaps,
    from: runs[0].from,
    to: runs[runs.length - 1].to,
    seconds: runs.reduce((n, r) => n + r.seconds, 0),
  };
}

/**
 * Which segment holds this moment, and how far into it.
 *
 * `null` when the moment is in a gap or outside the day's footage -- which the
 * caller must render as "No footage at this time" rather than as a stalled
 * player. A pane with nothing to show says so; it does not sit on a black
 * rectangle looking broken.
 *
 * ⚠ THE LAST SEGMENT THAT CONTAINS IT WINS. Overlapping segments are rare but
 * real (a recorder restarting mid-file), and taking the later one means a seek
 * lands in the newer recording rather than the tail of a superseded one.
 */
export function segmentAt(
  timeline: FootageTimeline,
  epoch: number,
): Position | null {
  let found: ArchivedSegment | null = null;
  for (const s of timeline.segments) {
    if (s.startEpoch > epoch) break;        // sorted: nothing later can contain it
    if (epoch < endOf(s)) found = s;
  }
  return found ? { segment: found, offset: Math.max(0, epoch - found.startEpoch) } : null;
}

/** Index of a segment by key, or -1. Keys are the archive's own identity. */
function indexOf(timeline: FootageTimeline, segment: ArchivedSegment): number {
  return timeline.segments.findIndex((s) => s.key === segment.key);
}

/**
 * The segment that plays after this one, or `null` at the end of the day.
 *
 * ⚠ IT RETURNS THE NEXT SEGMENT EVEN ACROSS A GAP. Whether to glide into it or
 * to announce a jump is a different question, answered by {@link isSeam} -- and
 * keeping the two apart is what lets a player preload the next file while still
 * telling the operator that twenty minutes are missing.
 */
export function nextSegment(
  timeline: FootageTimeline,
  segment: ArchivedSegment,
): ArchivedSegment | null {
  const i = indexOf(timeline, segment);
  if (i < 0 || i + 1 >= timeline.segments.length) return null;
  return timeline.segments[i + 1];
}

/** The segment that plays before this one, or `null` at the start of the day. */
export function prevSegment(
  timeline: FootageTimeline,
  segment: ArchivedSegment,
): ArchivedSegment | null {
  const i = indexOf(timeline, segment);
  if (i <= 0) return null;
  return timeline.segments[i - 1];
}

/**
 * Do these two run together with nothing missing?
 *
 * True means the player may roll straight from one into the other and say
 * nothing. False means there is a hole, and an operator who is not told about
 * it will read the jump as footage that simply does not exist -- or worse, will
 * not notice the clock moved.
 */
export function isSeam(a: ArchivedSegment, b: ArchivedSegment): boolean {
  return b.startEpoch - endOf(a) <= GAP_TOLERANCE_SEC;
}

/**
 * The gap containing this moment, or `null` when there is footage.
 *
 * Only ever a gap BETWEEN runs. Before the first segment and after the last one
 * is not a gap, it is the edge of the day, and conflating the two would have a
 * player announce "skipping 9 hours" every time somebody opened a morning.
 */
export function gapAt(timeline: FootageTimeline, epoch: number): FootageGap | null {
  for (const g of timeline.gaps) {
    if (epoch >= g.from && epoch < g.to) return g;
  }
  return null;
}

/**
 * The next moment that HAS footage, at or after `epoch`.
 *
 * This is what a player jumps to when it runs into a hole, and what a click on
 * an empty stretch of the day bar resolves to. `null` when nothing follows --
 * the end of the day, where a player stops rather than wrapping.
 */
export function nextFootageAfter(
  timeline: FootageTimeline,
  epoch: number,
): number | null {
  if (segmentAt(timeline, epoch)) return epoch;
  for (const r of timeline.runs) {
    if (r.from >= epoch) return r.from;
  }
  return null;
}

/**
 * The last moment that HAS footage, at or before `epoch`.
 *
 * The backwards twin, for skipping back over a hole. ⚠ It answers the END of
 * the earlier run, not its start: stepping back from a gap should land on the
 * last thing that was recorded, which is where somebody looking for "what
 * happened just before the camera stopped" wants to be.
 */
export function prevFootageBefore(
  timeline: FootageTimeline,
  epoch: number,
): number | null {
  if (segmentAt(timeline, epoch)) return epoch;
  for (let i = timeline.runs.length - 1; i >= 0; i--) {
    /* A run's `to` is one second past its last playable moment, so step inside
       it -- landing exactly on `to` is landing in the gap we are leaving. */
    if (timeline.runs[i].to <= epoch) return timeline.runs[i].to - 1;
  }
  return null;
}

/**
 * Where playback should go when it reaches `epoch`, having been playing.
 *
 * One function so every caller -- the ticker, a seek, a skip button -- resolves
 * a destination the same way, and a player never has to decide for itself what
 * a hole means.
 *
 *   `play`  there is footage; carry on at this moment
 *   `jump`  a hole; the UI says so briefly and continues at `to`
 *   `end`   nothing more today; stop, and stay put rather than rewinding
 */
export type Destination =
  | { kind: "play"; at: number; position: Position }
  | { kind: "jump"; from: number; to: number; gap: FootageGap; position: Position }
  | { kind: "end"; at: number };

export function resolve(timeline: FootageTimeline, epoch: number): Destination {
  const here = segmentAt(timeline, epoch);
  if (here) return { kind: "play", at: epoch, position: here };

  const gap = gapAt(timeline, epoch);
  const next = nextFootageAfter(timeline, epoch);
  if (next === null) return { kind: "end", at: epoch };

  const landing = segmentAt(timeline, next);
  if (!landing) return { kind: "end", at: epoch };
  /* Before the first segment there is no GAP -- see gapAt -- but there is still
     somewhere to go, so it resolves as a jump with a synthesised span rather
     than as an end. An operator who opened a day at midnight gets taken to the
     first footage, which is what they meant. */
  const span: FootageGap = gap ?? { from: epoch, to: next, seconds: next - epoch };
  return { kind: "jump", from: epoch, to: next, gap: span, position: landing };
}

/**
 * The day bar: every run and gap across a window, as fractions of it.
 *
 * Returned as 0..1 offsets rather than pixels so the bar can be any width and
 * the caller needs no layout maths. Runs and gaps both come back, because a bar
 * that draws only the footage leaves the operator to infer the holes from
 * blank space -- and a hole has to be legible as a hole.
 */
export interface CoverageBand {
  kind: "footage" | "gap";
  /** 0..1 across the window. */
  start: number;
  end: number;
  /** The real moments, so a click can be turned back into a time. */
  from: number;
  to: number;
}

export function coverage(
  timeline: FootageTimeline,
  windowFrom: number,
  windowTo: number,
): CoverageBand[] {
  const span = windowTo - windowFrom;
  if (span <= 0 || timeline.runs.length === 0) return [];
  const at = (t: number) => Math.min(1, Math.max(0, (t - windowFrom) / span));

  const bands: CoverageBand[] = [];
  let cursor = windowFrom;
  for (const r of timeline.runs) {
    const from = Math.max(r.from, windowFrom);
    const to = Math.min(r.to, windowTo);
    if (to <= from) continue;              // wholly outside the window
    if (from > cursor) {
      bands.push({ kind: "gap", start: at(cursor), end: at(from), from: cursor, to: from });
    }
    bands.push({ kind: "footage", start: at(from), end: at(to), from, to });
    cursor = to;
  }
  if (cursor < windowTo) {
    bands.push({ kind: "gap", start: at(cursor), end: at(windowTo), from: cursor, to: windowTo });
  }
  return bands;
}

/**
 * Every segment overlapping a range, for a download.
 *
 * ⚠ WHOLE SEGMENTS, BECAUSE THAT IS WHAT THE ARCHIVE CAN GIVE. The hub stores
 * complete files and does no server-side transcode, so a marked range cannot be
 * cut into one trimmed file. What a caller can honestly offer is the files that
 * COVER the range -- which is more footage than was asked for, and must be
 * presented as that rather than as a clip of the marked length.
 */
export function segmentsCovering(
  timeline: FootageTimeline,
  from: number,
  to: number,
): ArchivedSegment[] {
  if (to <= from) return [];
  return timeline.segments.filter((s) => s.startEpoch < to && endOf(s) > from);
}

/** Does a range run across a hole? The export warns about this. */
export function rangeCrossesGap(
  timeline: FootageTimeline,
  from: number,
  to: number,
): FootageGap | null {
  for (const g of timeline.gaps) {
    if (g.from < to && g.to > from) return g;
  }
  return null;
}
