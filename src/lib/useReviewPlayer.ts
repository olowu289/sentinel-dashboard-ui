import { useCallback, useEffect, useRef, useState } from "react";
import type { RecordingSpan, ViewerSession } from "@kallon/sentry-sdk";
import {
  closeReviewSession,
  describeRecordingFailure,
  fetchSliceUrl,
  isNoFootage,
  listRecordings,
  openReviewSession,
} from "@/lib/api/recordings";

/**
 * Recent recorded footage for one camera: the window, and the slice under the
 * playhead.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  IT FETCHES WHAT IS BEING WATCHED, NOT WHAT MIGHT BE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Every slice is a real round trip to a real tower, relayed up the same link
 * that carries PTZ keepalives and heartbeats. The cap is 30s per request and
 * coordination allows two relays per tower, so the failure mode to design
 * against is not a slow screen — it is a scrubber that fires a request per
 * pointer move and starves the control plane of the site it is reviewing.
 *
 * Three things prevent that:
 *
 *   ONE IN FLIGHT     a fetch already running is not joined by another; the
 *                     newest wanted position wins when it lands.
 *   SETTLE FIRST      a scrub does not fetch until the pointer stops, so
 *                     dragging across an hour costs one slice, not two hundred.
 *   A SMALL CACHE     slices already fetched are reused, so scrubbing back and
 *                     forth over the same moment does not re-ask the tower.
 *
 * ── THE WALL CLOCK IS THE FOOTAGE'S OWN TIME ───────────────────────────
 *
 * `positionAt` is an absolute instant, not an offset into a clip. The player
 * shows when the footage was RECORDED, because "14:32:06" is the only thing an
 * operator can put in a handover, and an offset into an arbitrary slice is not.
 */

/** How long a scrub must settle before it costs a fetch. */
const SETTLE_MS = 350;

/** Seconds per slice. Under the SDK's 30s cap, and the unit the player plays. */
export const SLICE_SEC = 20;

/** Slices kept. Small: each holds a multi-megabyte blob alive. */
const CACHE_MAX = 6;

export type ReviewPhase =
  | { kind: "idle" }
  | { kind: "opening" }
  | { kind: "ready" }
  /** The tower answered honestly that nothing covers this moment. */
  | { kind: "no_footage" }
  | { kind: "error"; message: string };

export interface ReviewState {
  phase: ReviewPhase;
  /** What the tower actually holds. Empty = this camera has no recordings. */
  spans: RecordingSpan[];
  /** Epoch ms of the earliest and latest footage, or null when there is none. */
  bounds: { from: number; to: number } | null;
  /** Epoch ms the playhead is at. */
  positionAt: number | null;
  /** Object URL for the slice under the playhead, or null. */
  sliceUrl: string | null;
  /** Epoch ms the current slice starts at, for turning video time into wall time. */
  sliceStartAt: number | null;
  loading: boolean;
  seek: (toEpochMs: number) => void;
  /**
   * Move the playhead WITHOUT fetching.
   *
   * This is what `timeupdate` calls as the slice plays: the footage is already
   * on screen, so the readout has to follow it, and routing that through
   * `seek` would make every frame schedule a fetch for a slice we are already
   * watching. Scrubbing is a request; playing is not.
   */
  seekQuiet: (toEpochMs: number) => void;
  /** Fetch the slice that follows the current one — playing off the end. */
  advance: () => void;
  retry: () => void;
}

function spanEnd(s: RecordingSpan): number {
  return Date.parse(s.start) + s.duration * 1000;
}

/** Whether the tower holds footage covering this instant. */
export function covered(spans: RecordingSpan[], atMs: number): boolean {
  return spans.some((s) => atMs >= Date.parse(s.start) && atMs < spanEnd(s));
}

export function useReviewPlayer(
  deviceId: string | null,
  camera: number | null,
): ReviewState {
  const [phase, setPhase] = useState<ReviewPhase>({ kind: "idle" });
  const [spans, setSpans] = useState<RecordingSpan[]>([]);
  const [positionAt, setPositionAt] = useState<number | null>(null);
  const [sliceUrl, setSliceUrl] = useState<string | null>(null);
  const [sliceStartAt, setSliceStartAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const sessionRef = useRef<ViewerSession | null>(null);
  const inFlight = useRef(false);
  const wanted = useRef<number | null>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** start epoch ms -> object URL. Revoked on eviction and on unmount. */
  const cache = useRef<Map<number, string>>(new Map());
  const generation = useRef(0);

  const revokeAll = useCallback(() => {
    for (const url of cache.current.values()) URL.revokeObjectURL(url);
    cache.current.clear();
  }, []);

  /* ── the session and the window ──────────────────────────────────────
     Opened per camera. Closing on change is not tidiness: a session holds a
     grant on coordination, and leaving one open for every camera an operator
     clicked through would accumulate authorizations nobody is using. */
  useEffect(() => {
    if (!deviceId || camera === null) {
      setPhase({ kind: "idle" });
      return;
    }
    const gen = ++generation.current;
    let cancelled = false;
    setPhase({ kind: "opening" });
    setSpans([]);
    setPositionAt(null);
    setSliceUrl(null);
    revokeAll();

    void (async () => {
      try {
        const session = await openReviewSession(deviceId, camera);
        if (cancelled || gen !== generation.current) {
          void closeReviewSession(session);
          return;
        }
        sessionRef.current = session;
        const window = await listRecordings(session);
        if (cancelled || gen !== generation.current) return;
        setSpans(window.spans);
        setPhase({ kind: "ready" });
        /* Open at the NEWEST footage. "What just happened" is the case this
           screen exists for, and starting a week back would make every visit
           begin with a scrub. */
        if (window.spans.length) {
          const newest = window.spans.reduce((a, b) => (spanEnd(a) > spanEnd(b) ? a : b));
          // A slice back from the very end, so there is something to play
          // rather than a playhead sitting on the edge of what exists.
          setPositionAt(Math.max(Date.parse(newest.start), spanEnd(newest) - SLICE_SEC * 1000));
        }
      } catch (err) {
        if (cancelled || gen !== generation.current) return;
        setPhase({ kind: "error", message: describeRecordingFailure(err) });
      }
    })();

    return () => {
      cancelled = true;
      const s = sessionRef.current;
      sessionRef.current = null;
      if (s) void closeReviewSession(s);
      revokeAll();
    };
  }, [deviceId, camera, revokeAll]);

  /* ── fetching the slice under the playhead ───────────────────────────── */
  const load = useCallback(async (startMs: number) => {
    const session = sessionRef.current;
    if (!session) return;
    const cached = cache.current.get(startMs);
    if (cached) {
      setSliceUrl(cached);
      setSliceStartAt(startMs);
      setPhase({ kind: "ready" });
      return;
    }
    if (inFlight.current) return;          // the newest want is remembered below
    inFlight.current = true;
    setLoading(true);
    const gen = generation.current;
    try {
      const url = await fetchSliceUrl(session, new Date(startMs).toISOString(), SLICE_SEC);
      if (gen !== generation.current) {
        URL.revokeObjectURL(url);
        return;
      }
      cache.current.set(startMs, url);
      // Evict oldest, revoking as we go — an object URL pins its blob for the
      // life of the document, so forgetting one leaks a slice of 2K video.
      while (cache.current.size > CACHE_MAX) {
        const oldest = cache.current.keys().next().value as number;
        const dead = cache.current.get(oldest);
        if (dead) URL.revokeObjectURL(dead);
        cache.current.delete(oldest);
      }
      setSliceUrl(url);
      setSliceStartAt(startMs);
      setPhase({ kind: "ready" });
    } catch (err) {
      if (gen !== generation.current) return;
      /* A gap is an ANSWER. The tower is telling us nothing covers that
         moment — it was down, or the disk lost it — and showing a fault for it
         would teach an operator to distrust a working screen. */
      setPhase(isNoFootage(err)
        ? { kind: "no_footage" }
        : { kind: "error", message: describeRecordingFailure(err) });
      setSliceUrl(null);
    } finally {
      inFlight.current = false;
      setLoading(false);
      // Whatever the operator asked for most recently wins.
      const next = wanted.current;
      wanted.current = null;
      if (next !== null && next !== startMs) void load(next);
    }
  }, []);

  const seek = useCallback((toEpochMs: number) => {
    setPositionAt(toEpochMs);
    // Slices are aligned to a grid so scrubbing within one reuses it rather
    // than fetching a near-identical window one second over.
    const aligned = Math.floor(toEpochMs / (SLICE_SEC * 1000)) * SLICE_SEC * 1000;
    wanted.current = aligned;
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      const want = wanted.current;
      wanted.current = null;
      if (want !== null) void load(want);
    }, SETTLE_MS);
  }, [load]);

  const seekQuiet = useCallback((toEpochMs: number) => {
    setPositionAt(toEpochMs);
  }, []);

  const advance = useCallback(() => {
    if (sliceStartAt === null) return;
    seek(sliceStartAt + SLICE_SEC * 1000);
  }, [sliceStartAt, seek]);

  const retry = useCallback(() => {
    if (positionAt !== null) seek(positionAt);
  }, [positionAt, seek]);

  /* The first load once a position exists. */
  useEffect(() => {
    if (phase.kind === "ready" && positionAt !== null && sliceUrl === null && !loading) {
      const aligned = Math.floor(positionAt / (SLICE_SEC * 1000)) * SLICE_SEC * 1000;
      void load(aligned);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, positionAt]);

  useEffect(() => () => {
    if (settle.current) clearTimeout(settle.current);
  }, []);

  const bounds = spans.length
    ? {
        from: Math.min(...spans.map((s) => Date.parse(s.start))),
        to: Math.max(...spans.map(spanEnd)),
      }
    : null;

  return {
    phase, spans, bounds, positionAt, sliceUrl, sliceStartAt, loading,
    seek, seekQuiet, advance, retry,
  };
}
