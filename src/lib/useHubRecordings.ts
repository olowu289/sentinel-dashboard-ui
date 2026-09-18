import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchivedSegment } from "@kallon/sentry-sdk";
import { describeRecordingFailure, listHubRecordings } from "@/lib/api/recordings";

/**
 * The hub's archived segments for one camera, as a browsable LIST (Option A).
 *
 * ══════════════════════════════════════════════════════════════════════
 *  LIST, DON'T SCRUB.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The hub holds complete ~15-minute segments; this fetches the lot for a camera
 * in one account-scoped call and hands them back for the UI to group by day and
 * play one at a time. There is no timeline, no slice fetching, no session — the
 * fetch is the whole of it, and each segment already carries a ready-to-play URL
 * the frontend never has to interpret (bucket-presigned or ticketed-local alike).
 *
 * ⚠ archiveEnabled distinguishes "nothing archived yet" (true, empty) from
 * "this site does not archive" (false) — two different honest empty states.
 */

export type RecordingsPhase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ready" }
  | { kind: "error"; message: string };

export interface HubRecordingsState {
  phase: RecordingsPhase;
  /** Ordered oldest-first as the API returns them; the view sorts for display. */
  segments: ArchivedSegment[];
  /** false → recording is not enabled for this site (an honest state, not empty). */
  archiveEnabled: boolean;
  reload: () => void;
}

export function useHubRecordings(
  deviceId: string | null,
  camera: number | null,
): HubRecordingsState {
  const [phase, setPhase] = useState<RecordingsPhase>({ kind: "idle" });
  const [segments, setSegments] = useState<ArchivedSegment[]>([]);
  const [archiveEnabled, setArchiveEnabled] = useState(false);
  const generation = useRef(0);

  const load = useCallback((dev: string, cam: number) => {
    const gen = ++generation.current;
    setPhase({ kind: "loading" });
    setSegments([]);
    void (async () => {
      try {
        // Pass the camera by NUMBER — this app's convention everywhere; the hub
        // maps it to the stored `camN`. No date range: fetch what the camera
        // holds and let the view filter by day, so switching dates is instant.
        const list = await listHubRecordings(dev, String(cam));
        if (gen !== generation.current) return;
        setArchiveEnabled(list.archiveEnabled);
        setSegments(list.segments);
        setPhase({ kind: "ready" });
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
      setArchiveEnabled(false);
      return;
    }
    load(deviceId, camera);
  }, [deviceId, camera, load]);

  const reload = useCallback(() => {
    if (deviceId && camera !== null) load(deviceId, camera);
  }, [deviceId, camera, load]);

  return { phase, segments, archiveEnabled, reload };
}
