import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchivedSegment, RecordingSpan } from "@kallon/sentry-sdk";
import {
  describeRecordingFailure,
  listHubRecordings,
} from "@/lib/api/recordings";

/**
 * Recorded footage for one camera, read from the HUB archive.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE HUB SERVES WHOLE SEGMENTS; THE PLAYER SEEKS INSIDE THEM.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The old tower-direct player fetched 5-second slices up the tower's uplink and
 * played each as a blob, because that link was the constraint. The hub is not:
 * it holds complete ~15-minute segments in the configured storage backend and
 * hands back, per segment, a URL that is directly playable and seekable over HTTP
 * Range. So the model is simpler and there is nothing to fetch here —
 *
 *   THE TIMELINE      is the segments the hub holds (merged into contiguous
 *                     spans, so adjacent files read as one stretch, not a row of
 *                     false gaps).
 *   THE PICTURE       is the segment under the playhead, played straight from its
 *                     URL. Scrubbing within a segment moves the video's own time;
 *                     scrubbing across a boundary swaps to the next segment.
 *   STORAGE-AGNOSTIC  the URL is presigned-bucket or ticketed-local and this hook
 *                     never looks — it plays whatever the hub returned.
 *
 * ── THE WALL CLOCK IS THE FOOTAGE'S OWN TIME ───────────────────────────
 *
 * `positionAt` is an absolute instant, not an offset into a file. "14:32:06" is
 * the only thing an operator can put in a handover; an offset into a segment is
 * not. The current segment's start turns the video element's own time into that
 * wall clock, and back.
 */

export type ReviewPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "ready" }
  /** Scrubbed to an instant no segment covers — an ANSWER, not a fault. */
  | { kind: "no_footage" }
  | { kind: "error"; message: string };

export interface ReviewState {
  phase: ReviewPhase;
  /** Contiguous stretches the hub holds, for the timeline. Empty = no archive. */
  spans: RecordingSpan[];
  /** The raw segments behind those spans — the playable, downloadable units. */
  segments: ArchivedSegment[];
  /** Epoch ms of the earliest and latest footage, or null when there is none. */
  bounds: { from: number; to: number } | null;
  /** Epoch ms the playhead is at. */
  positionAt: number | null;
  /** The segment under the playhead — its `url` is the `<video src>`. */
  current: ArchivedSegment | null;
  /** Epoch ms the current segment starts, for turning video time into wall time. */
  currentStartAt: number | null;
  /** Whether archiving is on at all. false → an honest empty timeline. */
  archiveEnabled: boolean;
  /** `immediate` is accepted for call-site symmetry; seeking never defers now. */
  seek: (toEpochMs: number, immediate?: boolean) => void;
  /** Move the playhead WITHOUT re-choosing the segment (the video is playing). */
  seekQuiet: (toEpochMs: number) => void;
  /** Play off the end of a segment: advance into the next one. */
  advance: () => void;
  retry: () => void;
}

function spanEnd(s: RecordingSpan): number {
  return Date.parse(s.start) + s.duration * 1000;
}

function segStart(s: ArchivedSegment): number {
  return s.startEpoch * 1000;
}
function segEnd(s: ArchivedSegment): number {
  return segStart(s) + s.duration * 1000;
}

/** Whether the archive holds footage covering this instant. */
export function covered(spans: RecordingSpan[], atMs: number): boolean {
  return spans.some((s) => atMs >= Date.parse(s.start) && atMs < spanEnd(s));
}

/** The segment whose footage covers this instant, or null. */
function segmentAt(segments: ArchivedSegment[], atMs: number): ArchivedSegment | null {
  return segments.find((s) => atMs >= segStart(s) && atMs < segEnd(s)) ?? null;
}

/**
 * Merge segments into contiguous spans for the timeline.
 *
 * Adjacent segments are separate FILES but continuous FOOTAGE; drawing each as
 * its own bar would print a false gap every 15 minutes. Two segments join when
 * the next begins within a small tolerance of the previous one's end. A real gap
 * (the tower was down, the hub missed footage) stays a gap.
 */
const JOIN_TOLERANCE_MS = 2000;
function toSpans(segments: ArchivedSegment[]): RecordingSpan[] {
  const spans: RecordingSpan[] = [];
  for (const seg of segments) {
    const last = spans[spans.length - 1];
    if (last && segStart(seg) - spanEnd(last) <= JOIN_TOLERANCE_MS) {
      last.duration = (segEnd(seg) - Date.parse(last.start)) / 1000;
    } else {
      spans.push({ start: seg.start, duration: seg.duration });
    }
  }
  return spans;
}

export function useReviewPlayer(
  deviceId: string | null,
  camera: number | null,
): ReviewState {
  const [phase, setPhase] = useState<ReviewPhase>({ kind: "idle" });
  const [segments, setSegments] = useState<ArchivedSegment[]>([]);
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const [positionAt, setPositionAt] = useState<number | null>(null);
  const [current, setCurrent] = useState<ArchivedSegment | null>(null);
  const generation = useRef(0);
  /** The latest segments, readable synchronously inside seek/advance without
   *  making them depend on (and be rebuilt by) the segments array. */
  const segmentsRef = useRef<ArchivedSegment[]>([]);
  segmentsRef.current = segments;

  const spans = useMemo(() => toSpans(segments), [segments]);

  /* ── load the timeline for this camera ───────────────────────────────
     No session, no fetch loop: one account-scoped list call, and the picture
     is chosen from what it returns. */
  const load = useCallback((dev: string, cam: number) => {
    const gen = ++generation.current;
    setPhase({ kind: "opening" });
    setSegments([]);
    setCurrent(null);
    setPositionAt(null);
    void (async () => {
      try {
        const list = await listHubRecordings(dev, `cam${cam}`);
        if (gen !== generation.current) return;
        setArchiveEnabled(list.archiveEnabled);
        const segs = list.segments;
        setSegments(segs);
        setPhase({ kind: "ready" });
        if (segs.length) {
          /* Open at the NEWEST footage: "what just happened" is the case this
             screen exists for, and starting a week back would make every visit
             begin with a scrub. Sit a moment inside the last segment rather than
             on its very edge, so there is something to play. */
          const newest = segs[segs.length - 1];
          const at = Math.max(segStart(newest), segEnd(newest) - 5000);
          setPositionAt(at);
          setCurrent(segmentAt(segs, at));
        }
      } catch (err) {
        if (gen !== generation.current) return;
        setPhase({ kind: "error", message: describeRecordingFailure(err) });
      }
    })();
  }, []);

  useEffect(() => {
    if (!deviceId || camera === null) {
      generation.current++;
      setPhase({ kind: "idle" });
      setSegments([]);
      setCurrent(null);
      setPositionAt(null);
      return;
    }
    load(deviceId, camera);
  }, [deviceId, camera, load]);

  /* ── seeking ─────────────────────────────────────────────────────────
     Choosing the segment under the playhead is the whole of it: the <video>
     progressively loads and seeks over HTTP Range, so there is nothing to fetch
     and nothing to debounce. A moment no segment covers is an answer, shown as a
     boundary rather than a fault. */
  const seek = useCallback((toEpochMs: number) => {
    setPositionAt(toEpochMs);
    const seg = segmentAt(segmentsRef.current, toEpochMs);
    setCurrent(seg);
    setPhase(seg ? { kind: "ready" } : { kind: "no_footage" });
  }, []);

  const seekQuiet = useCallback((toEpochMs: number) => {
    setPositionAt(toEpochMs);
  }, []);

  const advance = useCallback(() => {
    const cur = current;
    if (!cur) return;
    // Just past this segment's end: the next segment if footage continues, else
    // a gap (no_footage), the honest end of this stretch.
    seek(segEnd(cur) + 1);
  }, [current, seek]);

  const retry = useCallback(() => {
    if (deviceId && camera !== null) load(deviceId, camera);
  }, [deviceId, camera, load]);

  const bounds = spans.length
    ? {
        from: Math.min(...spans.map((s) => Date.parse(s.start))),
        to: Math.max(...spans.map(spanEnd)),
      }
    : null;

  return {
    phase,
    spans,
    segments,
    bounds,
    positionAt,
    current,
    currentStartAt: current ? segStart(current) : null,
    archiveEnabled,
    seek,
    seekQuiet,
    advance,
    retry,
  };
}
