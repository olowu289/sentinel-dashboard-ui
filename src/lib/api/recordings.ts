import { saidQuiet } from "@/lib/said";
import type {
  ArchivedRecordingList,
  ArchivedSegment,
  FreshSegmentUrl,
  ReviewableTower,
} from "@kallon/sentry-sdk";
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
/**
 * The towers that have footage to review, online or not.
 *
 * NOT the live fleet. `listFleet` projects each tower from its live hello, so an
 * OFFLINE tower arrives with an empty camera list and Playback had nothing to offer
 * for it: 270 segments on the hub's disk with no way to ask for them. This asks the
 * archive instead, and reports `online` for a badge rather than as a filter.
 */
export async function listReviewableTowers(
  signal?: AbortSignal,
): Promise<ReviewableTower[]> {
  try {
    return await getClient().listReviewableTowers(signal ? { signal } : {});
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * EVERY camera's footage for one tower, in a single call.
 *
 * The per-camera call above is what a one-pane screen needed. A screen that
 * shows a tower's cameras SIDE BY SIDE needs them together, and asking four
 * times would be four round trips whose answers arrive at four different
 * moments -- which is visible, because the panes would populate one by one and
 * the day bar would redraw under the operator each time.
 *
 * The camera argument is simply omitted, which the archive reads as "the whole
 * tower". Grouping by camera is the caller's job ({@link useFootageDay}).
 */
export async function listTowerRecordings(
  deviceId: string,
  range: { from?: number; to?: number } = {},
): Promise<ArchivedRecordingList> {
  try {
    return await getClient().listArchivedRecordings(deviceId, null, range);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

export function segmentDownloadUrl(segment: ArchivedSegment): string {
  return segment.downloadUrl;
}

/**
 * A freshly minted pair of URLs for ONE segment, asked for when it is opened.
 *
 * The list's URLs are presigned on a bucket backend and their lifetime starts when
 * the LIST was built, so a clip opened some minutes later can stop part-way through
 * with nothing in the console. Callers fall back to the list's URL when this fails:
 * an older hub does not serve the endpoint, and a failed refresh is not a reason to
 * refuse to play something that may well still work.
 */
export async function freshSegmentUrl(
  deviceId: string,
  camera: number,
  key: string,
): Promise<FreshSegmentUrl> {
  try {
    return await getClient().getSegmentUrl(deviceId, camera, key);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Turn a recording failure into a line an operator can act on.
 *
 * The hub's failures are few and account-shaped: not permitted, tower gone, or a
 * misconfigured/absent archive. Each names a cause; none leaks an endpoint.
 */
export function describeRecordingFailure(err: unknown): string {
  /* ⚠ PLAIN SENTENCES, NOT SHOUTED SUMMARIES, and through the one mapper.
     This read "NOT PERMITTED TO REVIEW THIS CAMERA" and "THE HUB'S ARCHIVE IS
     NOT CONFIGURED": the first is a security decision stated as a slogan, and
     the second names a piece of software the customer has never heard of. The
     words live in `lib/said.ts` with every other code the video seam can
     produce, so the footage timeline and the camera tile say the same thing
     about the same refusal. */
  if (err instanceof RecordingUnavailableError) {
    return saidQuiet({ code: err.reason, message: err.reason },
                     "Footage isn't available for this camera right now.");
  }
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  if (status === 401 || status === 403 || code === "forbidden" || code === "unauthorized") {
    return "Recorded footage wasn't included in what was shared with you.";
  }
  if (status === 404 || code === "tower_unknown" || code === "not_found") {
    return "This camera is no longer available.";
  }
  if (code === "archive_misconfigured" || status === 501) {
    return "Recording isn't set up on this tower yet.";
  }
  if (status === 0 || code === "network_error") {
    return "Couldn't reach the site for footage. Check the connection.";
  }
  if (typeof status === "number" && status >= 500) {
    return "The site couldn't serve that footage. Try again in a moment.";
  }
  /* ⚠ THE CODE USED TO BE IN THIS SENTENCE: `PLAYBACK FAILED —
     RESPONSE_INVALID`, on a tile, in front of somebody whose job is cameras.
     A machine code is for the console; the tile gets the only thing it can
     act on. */
  if (code) console.error("[footage] playback failed:", code, err);
  return saidQuiet(err, "That footage didn't play. Try again.");
}
