import type { ArchivedRecordingList, ArchivedSegment } from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * Recorded footage, read back through the HUB.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE HUB IS THE ARCHIVE, AND THE HUB IS STORAGE-AGNOSTIC.
 * ══════════════════════════════════════════════════════════════════════
 *
 * Playback used to talk to the tower directly: open a session, and pull 5-second
 * slices off the tower's own disk up its uplink. That still exists on the tower
 * as a 7-day safety ring, but it is no longer where this screen reads from. The
 * hub receives every tower's stream and archives it long-term through a pluggable
 * storage backend (local disk, or an S3-compatible bucket), and playback reads
 * from that SAME backend — one config drives write and read.
 *
 * ── WHY THIS SIDE KNOWS NOTHING ABOUT STORAGE ──────────────────────────
 *
 * Each segment the hub returns carries a `url` that is ready to play and carries
 * its OWN authorization: a presigned URL straight to the bucket, or a coordination
 * stream URL with a short-lived signed ticket for local disk. This module — and
 * the player above it — never inspects which. Switching the hub's STORAGE_BACKEND
 * moves the footage and these URLs together, with no change here. That is the
 * whole point: the frontend is storage-agnostic by construction, not by branching.
 *
 * ── NO SESSION ─────────────────────────────────────────────────────────
 *
 * Browsing an archive negotiates no live media, so it opens no viewing session.
 * The call is account-scoped: coordination authorizes it by the login the app
 * already holds, plus ownership of the tower and the `recordings` permission. A
 * viewer who cannot see the tower is told the tower does not exist — the same
 * indistinguishable answer the fleet routes give.
 */

/** Raised when review cannot even be attempted. Never a fake success. */
export class RecordingUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "RecordingUnavailableError";
    this.reason = reason;
  }
}

/**
 * The archived segments the hub holds for one tower·camera.
 *
 * ⚠ THE STORE, NOT THE POLICY. These are the segments actually written to the
 * configured backend — a hub that was down, or archiving that was off, means
 * fewer than retention claims. `archiveEnabled: false` is the honest "this hub
 * does not archive", to be shown as that rather than as an empty scrubber.
 *
 * @param camera the storage camera name (e.g. `cam1`).
 * @param range optional epoch-SECONDS window; segments overlapping it are returned.
 */
export async function listHubRecordings(
  deviceId: string,
  camera: string,
  range: { from?: number; to?: number } = {},
): Promise<ArchivedRecordingList> {
  try {
    return await getClient().listArchivedRecordings(deviceId, camera, range);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Save one archived segment as a file.
 *
 * ⚠ A WHOLE SEGMENT, NOT A TRIMMED CLIP. The archive stores complete segments
 * (~15 min each); cutting a precise sub-range out of one would need a server-side
 * transcode the hub does not do. So this offers the segment the operator is
 * looking at, in full, and the UI says so — an honest file rather than a trimmed
 * one that quietly wasn't. The URL sets its own Content-Disposition, so a
 * navigation downloads it with no CORS dance and no bytes proxied through this app.
 */
export function segmentDownloadUrl(segment: ArchivedSegment): string {
  return segment.downloadUrl;
}

/**
 * Turn a recording failure into a line an operator can act on.
 *
 * The hub's failures are few and account-shaped: not permitted, tower gone, or a
 * misconfigured/absent archive. Each names a cause; none leaks an endpoint.
 */
export function describeRecordingFailure(err: unknown): string {
  if (err instanceof RecordingUnavailableError) return err.reason;
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  if (status === 401 || status === 403 || code === "forbidden" || code === "unauthorized") {
    return "NOT PERMITTED TO REVIEW THIS CAMERA";
  }
  if (status === 404 || code === "tower_unknown" || code === "not_found") {
    return "THIS TOWER IS NOT AVAILABLE FOR PLAYBACK";
  }
  if (code === "archive_misconfigured" || status === 501) {
    return "THE HUB'S ARCHIVE IS NOT CONFIGURED";
  }
  if (status === 0 || code === "network_error") {
    return "COULDN'T REACH THE HUB FOR FOOTAGE";
  }
  if (typeof status === "number" && status >= 500) {
    return "THE HUB COULDN'T SERVE THAT FOOTAGE";
  }
  if (code) return `PLAYBACK FAILED — ${String(code).toUpperCase()}`;
  return "PLAYBACK FAILED";
}
