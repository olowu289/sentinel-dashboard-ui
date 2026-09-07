import type { RecordingWindow, ViewerSession } from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * Recent recorded footage, from the tower's own disk.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THIS OPENS A SESSION AND NEVER POSTS AN OFFER. THAT IS THE POINT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A session is two things in this protocol: an authorization, and the thing an
 * SDP offer is posted to. Review needs the first and not the second. So this
 * creates a session for the chosen camera and stops there — no peer
 * connection, no WHEP, no second RTSP pull off the camera. The session exists
 * only so coordination can answer "may this viewer see this camera" at the
 * same choke point live media and PTZ use.
 *
 * The cost of getting that wrong would be real: negotiating a WebRTC peer here
 * would put a second consumer on a camera that is already serving the live
 * wall, on a tower whose documented limit is one main and one sub per camera.
 *
 * ── WHY A SEPARATE SESSION AT ALL ──────────────────────────────────────
 *
 * Reusing the live tile's session would couple review to whatever the wall is
 * doing: the shell tears live sessions down and rebuilds them when the
 * operator drills into a site, and a review player holding one of those would
 * lose its footage mid-scrub because somebody clicked a different screen.
 * Its own session is what makes review independent of the wall.
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
 * Open a review session for one camera.
 *
 * Deliberately NOT `openPlayback` from `./media` — that one negotiates a peer.
 */
export async function openReviewSession(
  deviceId: string,
  camera: number,
): Promise<ViewerSession> {
  try {
    return await getClient().createSession({ device_id: deviceId, camera });
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

export async function closeReviewSession(session: ViewerSession): Promise<void> {
  try {
    // `viewer_left` is the truth: the operator navigated away or picked a
    // different camera. There is no "done" in the protocol's reason set, and
    // inventing one would put a word in an audit log that nothing else uses.
    await getClient().closeSession(session, { reason: "viewer_left" });
  } catch {
    /* A session that cannot be closed expires on its own with the grant. The
       operator has already left the screen, and an error about tidying up is
       not something they can act on. */
  }
}

/**
 * Which stretches of footage the tower actually holds for this camera.
 *
 * ⚠ THE DISK, NOT THE POLICY. Retention says what the tower MEANS to keep; a
 * power cut, a full disk or an agent that was down all say otherwise. This is
 * also where the "older is archived" boundary comes from — the start of the
 * earliest span is the edge of what this tower can show, and everything before
 * it is a question for a bucket that does not exist yet.
 */
export async function listRecordings(session: ViewerSession): Promise<RecordingWindow> {
  try {
    return await getClient().listRecordings(session);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * One bounded slice, as an object URL a `<video>` can play.
 *
 * The caller MUST revoke the URL when it is done with it — an object URL holds
 * its blob alive for the life of the document, and a scrubbing operator
 * generates one per slice. `useReviewPlayer` owns that.
 */
export async function fetchSliceUrl(
  session: ViewerSession,
  start: string,
  durationSec: number,
): Promise<string> {
  try {
    const bytes = await getClient().fetchRecordingSlice(session, start, durationSec);
    return URL.createObjectURL(new Blob([bytes], { type: "video/mp4" }));
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Turn a recording failure into a line an operator can act on, or `null`.
 *
 * ⚠ `no_recording` IS NOT A FAULT. It is the tower answering that nothing
 * covers that moment — the operator scrubbed into a gap, or past the edge of
 * what the disk holds. Rendering it as an error would teach them to distrust a
 * screen that is working correctly, so it gets its own words and the caller
 * shows it as a boundary rather than a failure.
 */
export function describeRecordingFailure(err: unknown): string {
  if (err instanceof RecordingUnavailableError) return err.reason;
  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    if (code === "no_recording") return "NO FOOTAGE FOR THIS MOMENT";
    if (code === "recording_unsupported") {
      return "THIS TOWER'S AGENT IS TOO OLD FOR PLAYBACK";
    }
    if (code === "too_many_relays") return "THE TOWER IS ALREADY SENDING FOOTAGE — TRY AGAIN";
    if (code === "slice_too_long") return "THAT WINDOW IS TOO LONG TO FETCH";
    if (code === "tower_offline") return "TOWER OFFLINE — NO FOOTAGE UNTIL IT RECONNECTS";
    if (code === "tower_timeout") return "THE TOWER DID NOT ANSWER";
    if (code === "grant_permission" || code === "not_authorized") {
      return "NOT PERMITTED TO REVIEW THIS CAMERA";
    }
    return `PLAYBACK FAILED — ${code.toUpperCase()}`;
  }
  return "PLAYBACK FAILED";
}

/** Whether a failure is the honest "nothing here", not a fault. */
export function isNoFootage(err: unknown): boolean {
  return Boolean(
    err && typeof err === "object" && "code" in err &&
    String((err as { code: unknown }).code) === "no_recording",
  );
}
