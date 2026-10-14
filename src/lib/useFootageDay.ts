import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ArchivedSegment } from "@kallon/sentry-sdk";
import { describeRecordingFailure, listTowerRecordings } from "@/lib/api/recordings";
import { buildTimeline, type FootageTimeline } from "@/lib/footageTimeline";
import { siteDayEnd, siteDayOf, siteDayStart } from "@/lib/time";

/**
 * One tower's whole archive, grouped by camera and sliced into site days.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE CALL, EVERY CAMERA.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The screen shows a tower's cameras SIDE BY SIDE, so they have to arrive
 * together. Four per-camera calls would be four round trips answering at four
 * different moments, and it would be visible: panes populating one at a time
 * and a day bar redrawing under the operator as each one landed.
 *
 * ── THE WHOLE ARCHIVE, THEN FILTERED HERE ─────────────────────────────
 *
 * No date range is sent, and that is the same bargain the per-camera screen
 * struck before it: one fetch, then changing day is instant. A day that cost a
 * round trip would make the calendar feel like a search, and an operator
 * stepping back through a week would wait seven times.
 *
 * ⚠ `archiveEnabled: false` IS AN ANSWER, NOT AN EMPTY. It means this site does
 * not archive at all, which is a different sentence from "nothing recorded
 * yet", and the screen must say the different sentence.
 */

export type FootagePhase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

/** A camera, addressed the way the archive addresses it. */
export type CameraKey = number | string;

export interface FootageDay {
  phase: FootagePhase;
  /** false -> this site does not archive. An honest state, never an empty list. */
  archiveEnabled: boolean;
  /** Every camera with footage, in a stable order. */
  cameras: CameraKey[];
  /** Site days (`YYYY-MM-DD`) that hold any footage, for the calendar. */
  daysWithFootage: ReadonlySet<string>;
  /** One camera's continuous timeline for `isoDay`. Never null -- an empty
   *  timeline is a valid answer and the pane renders it as "no footage". */
  timelineFor: (camera: CameraKey) => FootageTimeline;
  /** Every camera's footage for the day, merged: what the day bar draws and
   *  what the shared clock skips by. */
  union: FootageTimeline;
  /** The site day's bounds, epoch seconds. */
  dayFrom: number;
  dayTo: number;
  reload: () => void;
}

const sortCameras = (a: CameraKey, b: CameraKey): number => {
  const na = typeof a === "number" ? a : Number.NaN;
  const nb = typeof b === "number" ? b : Number.NaN;
  if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
  /* A non-`camN` custom name sorts after the numbered ones rather than being
     interleaved by string order, so cam1/cam2 keep their positions on the wall
     when a tower also has an oddly-named camera. */
  if (Number.isFinite(na)) return -1;
  if (Number.isFinite(nb)) return 1;
  return String(a).localeCompare(String(b));
};

export function useFootageDay(
  deviceId: string | null,
  isoDay: string,
): FootageDay {
  const [phase, setPhase] = useState<FootagePhase>({ kind: "idle" });
  const [segments, setSegments] = useState<ArchivedSegment[]>([]);
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const generation = useRef(0);

  const load = useCallback((dev: string) => {
    const gen = ++generation.current;
    setPhase({ kind: "loading" });
    setSegments([]);
    void (async () => {
      try {
        const list = await listTowerRecordings(dev);
        if (gen !== generation.current) return;
        setArchiveEnabled(list.archiveEnabled);
        setSegments(list.segments);
        setPhase({ kind: "ready" });
      } catch (err) {
        if (gen !== generation.current) return;
        setArchiveEnabled(false);
        setPhase({ kind: "error", message: describeRecordingFailure(err) });
      }
    })();
  }, []);

  useEffect(() => {
    if (!deviceId) {
      generation.current++;      // abandon anything in flight for the old tower
      setPhase({ kind: "idle" });
      setSegments([]);
      setArchiveEnabled(false);
      return;
    }
    load(deviceId);
  }, [deviceId, load]);

  const cameras = useMemo(() => {
    const seen = new Map<string, CameraKey>();
    for (const s of segments) seen.set(String(s.camera), s.camera);
    return [...seen.values()].sort(sortCameras);
  }, [segments]);

  const daysWithFootage = useMemo(() => {
    const days = new Set<string>();
    for (const s of segments) {
      /* A segment that STRADDLES midnight belongs to both days, and the day it
         ends on is the one an operator looking at an overnight incident will
         open. Marking only its start would leave that day looking empty. */
      days.add(siteDayOf(s.startEpoch));
      days.add(siteDayOf(s.startEpoch + Math.max(0, s.duration) - 1));
    }
    return days;
  }, [segments]);

  const dayFrom = useMemo(() => siteDayStart(isoDay), [isoDay]);
  const dayTo = useMemo(() => siteDayEnd(isoDay), [isoDay]);

  /* Segments touching this day, per camera. A segment is kept if any part of it
     falls inside the day -- an overnight file is playable from either side. */
  const byCamera = useMemo(() => {
    const out = new Map<string, ArchivedSegment[]>();
    for (const s of segments) {
      if (s.startEpoch >= dayTo) continue;
      if (s.startEpoch + s.duration <= dayFrom) continue;
      const k = String(s.camera);
      const list = out.get(k);
      if (list) list.push(s);
      else out.set(k, [s]);
    }
    return out;
  }, [segments, dayFrom, dayTo]);

  const timelines = useMemo(() => {
    const out = new Map<string, FootageTimeline>();
    for (const [k, list] of byCamera) out.set(k, buildTimeline(list));
    return out;
  }, [byCamera]);

  const union = useMemo(
    () => buildTimeline([...byCamera.values()].flat()),
    [byCamera],
  );

  const timelineFor = useCallback(
    (camera: CameraKey) =>
      timelines.get(String(camera)) ?? buildTimeline([]),
    [timelines],
  );

  return {
    phase,
    archiveEnabled,
    cameras,
    daysWithFootage,
    timelineFor,
    union,
    dayFrom,
    dayTo,
    reload: () => { if (deviceId) load(deviceId); },
  };
}
