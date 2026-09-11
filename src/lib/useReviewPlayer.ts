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

/**
 * Seconds per slice — the unit the player fetches and plays.
 *
 * ⚠ FIVE, NOT TWENTY, AND THE REASON IS THE UPLINK. A slice comes off the
 * tower's own disk through the relay, and the relay is window-limited: four
 * 64KB chunks in flight, each waiting on an ack round trip. On the reference
 * tower's LAN that was fast. Over a WiFi uplink and the public internet it
 * measured ~0.14MB/s, and a 20s slice of main-stream footage (~15MB at
 * ~7.4Mbps) took ~105s to arrive — so every scrub sat on a spinner until the
 * request timed out and read as a failure.
 *
 * Five seconds is a quarter of the data. It does NOT make 2K footage arrive in
 * a second or two on that link — at that rate a 5s slice is still tens of
 * seconds — but it is the difference between arriving and timing out, and
 * the next-slice logic already fetches on demand, so more, smaller slices cost
 * nothing on the timeline. The real fixes for speed are on the tower (record
 * the sub stream, or widen the relay window) and are recorded as follow-ups.
 */
export const PLAYBACK_SLICE_SEC = 5;

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
  /**
   * The review session, for actions that need it — the clip download.
   *
   * Exposed rather than duplicated: opening a SECOND session for a clip would
   * mean a second grant for a camera this screen has already been granted, and
   * the two could disagree about which camera the operator is looking at.
   */
  session: ViewerSession | null;
  /** `immediate` skips the drag settle — pass it for a discrete click. */
  seek: (toEpochMs: number, immediate?: boolean) => void;
  /** Quietly fetch the slice after the current one, so playback does not
   *  stall at the boundary. One ahead only. */
  prefetchNext: () => void;
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
          setPositionAt(Math.max(Date.parse(newest.start), spanEnd(newest) - PLAYBACK_SLICE_SEC * 1000));
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

  /* ── fetching the slice under the playhead ─────────────────────────────
     `background` is a PRE-FETCH: fetch it, cache it, and do NOT move the
     picture. The operator is still watching the previous slice and must not
     have it swapped out from under them a few seconds early. */
  const load = useCallback(async (startMs: number, background = false) => {
    const session = sessionRef.current;
    if (!session) return;
    const cached = cache.current.get(startMs);
    if (cached) {
      if (!background) {
        setSliceUrl(cached);
        setSliceStartAt(startMs);
        setPhase({ kind: "ready" });
      }
      return;
    }
    if (inFlight.current) {
      /* ⚠ A PRE-FETCH NEVER QUEUES BEHIND ITSELF, AND NEVER OUTRANKS A PERSON.
         `wanted` is the operator's most recent request and is honoured when
         the current fetch lands; a speculative one must not overwrite it, or
         a scrub during playback would be discarded in favour of a slice
         nobody asked to see. */
      if (!background) wanted.current = startMs;
      return;
    }
    inFlight.current = true;
    // A pre-fetch is invisible: raising the spinner for it would flash
    // "loading" over footage that is playing perfectly well.
    if (!background) setLoading(true);
    const gen = generation.current;
    try {
      const url = await fetchSliceUrl(session, new Date(startMs).toISOString(), PLAYBACK_SLICE_SEC);
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
      if (!background) {
        setSliceUrl(url);
        setSliceStartAt(startMs);
        setPhase({ kind: "ready" });
      }
    } catch (err) {
      if (gen !== generation.current) return;
      if (background) {
        /* A pre-fetch that fails is not the operator's problem: they are still
           watching the current slice, and the boundary will simply fetch again
           and report properly then. Turning a speculative miss into an error
           banner over playing footage would be a lie about what is on screen. */
        return;
      }
      /* A gap is an ANSWER. The tower is telling us nothing covers that
         moment — it was down, or the disk lost it — and showing a fault for it
         would teach an operator to distrust a working screen. */
      setPhase(isNoFootage(err)
        ? { kind: "no_footage" }
        : { kind: "error", message: describeRecordingFailure(err) });
      setSliceUrl(null);
    } finally {
      inFlight.current = false;
      if (!background) setLoading(false);
      // Whatever the operator asked for most recently wins.
      const next = wanted.current;
      wanted.current = null;
      if (next !== null && next !== startMs) void load(next);
    }
  }, []);

  /**
   * Move the playhead and fetch.
   *
   * ⚠ A CLICK AND A DRAG ARE DIFFERENT REQUESTS AND THE DELAY IS ONLY RIGHT
   * FOR ONE OF THEM. The settle exists so dragging across an hour costs one
   * slice instead of two hundred — correct for a drag, and pure lag on a
   * click, where the operator has already told us exactly where they want to
   * be. `immediate` is what a discrete click passes, and it skips the wait
   * entirely rather than shortening it.
   */
  const seek = useCallback((toEpochMs: number, immediate = false) => {
    setPositionAt(toEpochMs);
    // Slices are aligned to a grid so scrubbing within one reuses it rather
    // than fetching a near-identical window one second over.
    const aligned = Math.floor(toEpochMs / (PLAYBACK_SLICE_SEC * 1000)) * PLAYBACK_SLICE_SEC * 1000;
    if (settle.current) clearTimeout(settle.current);
    settle.current = null;
    if (immediate) {
      wanted.current = null;
      void load(aligned);
      return;
    }
    wanted.current = aligned;
    settle.current = setTimeout(() => {
      const want = wanted.current;
      wanted.current = null;
      if (want !== null) void load(want);
    }, SETTLE_MS);
  }, [load]);

  /**
   * Fetch the slice AFTER the one playing, without disturbing it.
   *
   * The boundary between slices is the only place this screen can stall: the
   * current file ends, and the next one has not been asked for yet, so the
   * picture stops while a multi-megabyte relay runs. Starting that fetch a few
   * seconds early turns the stall into a hand-off.
   *
   * ONE AHEAD, NEVER MORE. The relay is capped at two per tower and shares a
   * link with the site's PTZ keepalives; speculatively pulling a minute of
   * video because somebody left a tab open is precisely the traffic the cap
   * exists to prevent. It is also silent — see `background` in `load`.
   */
  const prefetchNext = useCallback(() => {
    if (sliceStartAt === null) return;
    const next = sliceStartAt + PLAYBACK_SLICE_SEC * 1000;
    if (cache.current.has(next)) return;
    void load(next, true);
  }, [load, sliceStartAt]);

  const seekQuiet = useCallback((toEpochMs: number) => {
    setPositionAt(toEpochMs);
  }, []);

  const advance = useCallback(() => {
    if (sliceStartAt === null) return;
    // Immediate: reaching the end of a slice is not a drag, and waiting out a
    // settle here would put the stall back that pre-fetching removed.
    seek(sliceStartAt + PLAYBACK_SLICE_SEC * 1000, true);
  }, [sliceStartAt, seek]);

  const retry = useCallback(() => {
    if (positionAt !== null) seek(positionAt);
  }, [positionAt, seek]);

  /* The first load once a position exists. */
  useEffect(() => {
    if (phase.kind === "ready" && positionAt !== null && sliceUrl === null && !loading) {
      const aligned = Math.floor(positionAt / (PLAYBACK_SLICE_SEC * 1000)) * PLAYBACK_SLICE_SEC * 1000;
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
    session: sessionRef.current,
    seek, seekQuiet, prefetchNext, advance, retry,
  };
}
