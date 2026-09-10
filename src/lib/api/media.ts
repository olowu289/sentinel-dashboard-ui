/**
 * ══════════════════════════════════════════════════════════════════════
 *  THE PEER CONNECTION — the video seam.
 * ══════════════════════════════════════════════════════════════════════
 *
 * THE APP OWNS THE PEER. The SDK speaks §4.2 to coordination and has no
 * `RTCPeerConnection` on purpose: §4.1 puts the peer between the viewer and the
 * tower's MediaMTX, with coordination as a signaling relay that "MUST NOT
 * rewrite SDP". So the SDK owns the conversation that sets a stream up, and
 * this module is the half it deliberately leaves to us. The signaling still
 * goes through the SDK, every time — there is no hand-rolled fetch here.
 *
 * ⚠ MEDIA FLOWS DIRECT FROM THE TOWER, NOT THROUGH COORDINATION. That is the
 * single most important thing to hold onto when reading a failure: the
 * offer/answer can round-trip perfectly over TLS while not one media packet
 * ever arrives, because the packets take a completely different path. Hence
 * `media_unreachable` below, which exists so a permanently black `<video>`
 * cannot sit there looking like a dark scene.
 *
 * ── WHAT IS DELIBERATELY ABSENT ────────────────────────────────────────
 *
 * NO RETRY LOOP. §7.7 is explicit that retry storms here wedged a camera in v1.
 * One attempt; a failure is reported and the operator retries deliberately.
 *
 * NO DRIFT WATCHDOG, and specifically no `buffered.end()` seek. A live
 * `MediaStream` does not buffer like a file, so the seek silently does nothing
 * — the reference implementation shipped one and it was dead code wearing a
 * feature's clothes. Correcting drift on a live feed is a make-before-break
 * peer replacement, which is not this.
 *
 * NO SIMULATION. If any step fails there is no stream, and the caller shows its
 * honest placeholder. Nothing in this file can produce a frame.
 */

import type { ViewerSession } from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * How long to wait for ICE gathering before sending what we have.
 *
 * §4.5 makes non-trickle the phase-one baseline: gather fully, then offer. But
 * "fully" has no guaranteed end on some networks — a host that never emits the
 * null candidate would hang the offer forever. Sending what has been gathered
 * so far is still a valid non-trickle offer, and on a LAN they are all present
 * within a few hundred milliseconds anyway.
 */
export const ICE_GATHER_TIMEOUT_MS = 8_000;

/** How often to re-read the session's expiry from coordination. */
export const STATUS_POLL_MS = 60_000;

/**
 * Consecutive poll FAILURES tolerated before a feed is given up on.
 *
 * A network blip is not an authorization answer, and tearing down a healthy
 * feed because one request failed is exactly the wrong reflex. Three misses at
 * 60s still leaves the real expiry as the backstop: if the session genuinely
 * ended, the local clock runs out and the feed stops anyway.
 */
export const STATUS_POLL_TOLERANCE = 3;

/** Why playback is not showing a picture. Each maps to honest on-screen copy. */
export type PlaybackFailure =
  /**
   * Signaling succeeded and MEDIA NEVER CONNECTED — ICE failed.
   *
   * The failure mode the direct-media architecture makes likely, and invisible
   * without a state of its own. A tower installed with the default empty ICE
   * server list advertises only HOST candidates — its own LAN address — and a
   * browser that cannot route there will negotiate perfectly and then receive
   * nothing at all. Without this the operator sees a `<video>` that simply
   * stays black, which is indistinguishable from a dark scene.
   */
  | "media_unreachable"
  /** A real refusal: the grant does not cover this camera. Never "connecting". */
  | "not_permitted"
  | "tower_offline"
  | "tower_timeout"
  | "camera_unavailable"
  | "session_expired"
  | "negotiation_failed"
  | "unreachable";

export class PlaybackError extends Error {
  readonly failure: PlaybackFailure;
  constructor(failure: PlaybackFailure, message: string) {
    super(message);
    this.name = "PlaybackError";
    this.failure = failure;
  }
}

export interface PlaybackHandle {
  session: ViewerSession;
  pc: RTCPeerConnection;
  /** Idempotent. Safe to call from a cleanup that may run twice. */
  close: () => Promise<void>;
}

export interface PlaybackHandlers {
  /** A real `MediaStream` arrived on the peer. */
  onStream: (stream: MediaStream) => void;
  /**
   * ICE gave up, or the session ended. Fired AFTER `openPlayback` has already
   * resolved, because a connection can fail long after negotiation succeeded.
   */
  onFailure: (error: PlaybackError) => void;
  /**
   * THE TRANSPORT WENT AWAY, AND IT MAY COME BACK.
   *
   * ⚠ THIS IS NOT `onFailure`, AND THE DIFFERENCE IS THE WHOLE POINT. A failure
   * is a statement about the world that the operator has to act on — the grant
   * was refused, the tower is offline, the session ended. A drop is a statement
   * about the PATH: a phone changed cell, a laptop moved between access points,
   * a tab was suspended in the background. Those are normal on a mobile network
   * and abnormal on the LAN this was written on, which is why the code only
   * ever had the first kind.
   *
   * Fired for `disconnected` as well as `failed`. `disconnected` was previously
   * ignored on the reasoning that ICE often recovers on its own — true, and it
   * still gets the chance: the CALLER waits out a grace period before acting.
   * What it must not do is stay silent, because a `disconnected` that never
   * recovers is a frozen picture nobody is told about.
   */
  onDropped: (state: RTCPeerConnectionState) => void;
}

/**
 * Map a coordination failure onto something an operator can act on.
 *
 * The distinction that matters most: `not_permitted` is a REAL refusal — the
 * grant does not cover this camera — and must never read as "connecting".
 * Telling somebody to wait for a stream they are not allowed to see is the app
 * lying about a security decision.
 */
function classify(err: unknown): PlaybackError {
  const code = (err as { code?: unknown })?.code;
  const status = (err as { status?: unknown })?.status;

  if (code === "grant_permission" || code === "not_authorized" || status === 403) {
    return new PlaybackError("not_permitted", "This account may not view this camera");
  }
  if (code === "tower_offline" || status === 503) {
    return new PlaybackError("tower_offline", "The tower is not connected");
  }
  if (code === "tower_timeout" || status === 504) {
    return new PlaybackError("tower_timeout", "The tower did not answer");
  }
  if (code === "camera_offline" || code === "mediamtx_unavailable" || code === "whep_failed") {
    return new PlaybackError("camera_unavailable", "The camera's media path failed");
  }
  if (code === "grant_expired" || code === "session_unknown") {
    return new PlaybackError("session_expired", "The viewing session ended");
  }
  return new PlaybackError(
    "unreachable",
    err instanceof Error ? err.message : "Could not start playback",
  );
}

/**
 * Wait for ICE gathering to finish, or time out.
 *
 * Listens for BOTH the state change and the null candidate: browsers are not
 * consistent about which fires first, and waiting on only one of them works
 * until it does not.
 */
function waitForIceGathering(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onState);
      pc.removeEventListener("icecandidate", onCandidate);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const onState = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    // A null candidate is the end-of-candidates signal.
    const onCandidate = (e: RTCPeerConnectionIceEvent) => {
      if (!e.candidate) finish();
    };

    const timer = setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener("icegatheringstatechange", onState);
    pc.addEventListener("icecandidate", onCandidate);
    signal.addEventListener("abort", finish);
  });
}

/**
 * Open a session and negotiate a peer connection for one camera.
 *
 * ⚠ EVERY `await` IS AN ABORT POINT. `signal` is checked after each one,
 * because a StrictMode unmount — or a navigation — can land between any two
 * steps, and a peer created after the caller has torn down is a leak that keeps
 * a tower session alive and a camera busy. On abort, whatever has been built so
 * far is closed here rather than handed back for somebody else to remember.
 */
export async function openPlayback(
  feed: { towerId: string; index: number; profile?: string },
  handlers: PlaybackHandlers,
  signal: AbortSignal,
): Promise<PlaybackHandle> {
  const client = getClient();

  /* ── 1. The session. {device_id, camera} and at most a profile NAME — §4.2.1
        is a security boundary, and permissions, role and lifetime are derived
        by coordination from the authenticated account, never asked for here.
        `index` is the bare protocol address; no enclosure, no tile id, no feed
        id.

        A profile is the one thing that widened, and it widened by a name rather
        than a location: the tower maps an id to its own path, coordination
        refuses an id it does not recognise, and `path`/`whep_path` never reach
        a viewer at all. Asking for "main" is not the same kind of act as being
        handed somewhere to POST, which is why it is allowed through here. */
  let session: ViewerSession;
  try {
    session = await client.createSession({
      device_id: feed.towerId,
      camera: feed.index,
      /* Named only when the viewer chose one. Absence means "this camera's
         default", which is what every call did before profiles existed — so a
         tower that advertises no profiles is opened exactly as it always was
         rather than being sent a guess. */
      ...(feed.profile !== undefined ? { profile: feed.profile } : {}),
      signal,
    });
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw classify(err);
  }
  if (signal.aborted) {
    await client.closeSession(session).catch(() => {});
    throw new PlaybackError("unreachable", "aborted");
  }

  /* ── 2. The peer. ICE servers come from the SESSION, not a constant: phase
        one is direct-only STUN, and TURN arrives as configuration. */
  const pc = new RTCPeerConnection({ iceServers: session.ice_servers });

  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try {
      pc.getReceivers().forEach((r) => r.track?.stop());
    } catch {
      /* the peer may already be closed */
    }
    pc.close();
    /* §4.6: this is what drives the tower's DELETE against MediaMTX, which is
       what actually frees the media session. A viewer that skips it leaves the
       tower waiting on a reap. Idempotent server-side — an already-gone session
       still returns 204. */
    await client.closeSession(session).catch(() => {});
  };

  try {
    /* Registered BEFORE the answer is applied: `ontrack` can fire the moment
       `setRemoteDescription` resolves, so the handler has to already exist. */
    pc.ontrack = (event) => {
      const stream = event.streams[0];
      if (stream) handlers.onStream(stream);
    };

    /**
     * ICE outcome.
     *
     * ⚠ BOTH TRANSITIONS ARE REPORTED NOW, and which one it is decides what
     * happens next — upstream, where the retry budget lives.
     *
     * `failed` after media has been flowing is a DROP, not a verdict: the path
     * broke, and on a phone that is a lift, a tunnel, or a handover between
     * cells. `failed` before any media ever arrived is the original
     * `media_unreachable` case — a browser that cannot route to the tower at
     * all — and it stays worth saying plainly, but it is now said after the
     * reconnect budget is spent rather than on the first attempt, because the
     * two are indistinguishable at this layer and only time tells them apart.
     *
     * `disconnected` used to be swallowed entirely. It still gets its grace —
     * ICE does often recover unaided — but the caller is told, because a
     * `disconnected` that never recovers is a frozen picture nobody reports.
     */
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state !== "failed" && state !== "disconnected") return;
      handlers.onDropped(state);
    };

    // ── 3. Receive-only video, then a full gather before offering.
    pc.addTransceiver("video", { direction: "recvonly" });
    const offer = await pc.createOffer();
    if (signal.aborted) throw new PlaybackError("unreachable", "aborted");

    await pc.setLocalDescription(offer);
    if (signal.aborted) throw new PlaybackError("unreachable", "aborted");

    await waitForIceGathering(pc, signal);
    if (signal.aborted) throw new PlaybackError("unreachable", "aborted");

    const localSdp = pc.localDescription?.sdp;
    if (!localSdp) throw new PlaybackError("negotiation_failed", "no local description");

    /* ── 4. Relay the offer and apply the answer. Coordination holds this
          request open while the tower answers, and must not rewrite the SDP. */
    const answer = await client.sendOffer(session, localSdp, { signal });
    if (signal.aborted) throw new PlaybackError("unreachable", "aborted");

    await pc.setRemoteDescription({ type: "answer", sdp: answer });
    if (signal.aborted) throw new PlaybackError("unreachable", "aborted");

    return { session, pc, close };
  } catch (err) {
    await close();
    endSessionIfUnauthorized(err);
    throw err instanceof PlaybackError ? err : classify(err);
  }
}

/**
 * Re-read a session's CURRENT expiry from coordination.
 *
 * ⚠ THE VIEWER NEVER EXTENDS ITS OWN CLOCK. This returns what the SERVER says
 * and nothing else. §7.4 renewal is coordination re-asking whether this viewer
 * may still watch, and it only advances `expires_at` when that answer is yes —
 * so reading the field IS reading the authorization verdict. A client that
 * added time locally would turn a revocation into a feed that keeps playing,
 * which is the whole property this design exists to protect.
 *
 * Returns `null` when the session has ENDED: coordination removes a session the
 * instant it closes, so absent IS ended, and that is an answer to act on.
 * Throws on anything else — a network blip is NOT evidence a session is over
 * and must never tear down a working feed.
 */
export async function readSessionExpiry(
  session: ViewerSession,
  signal?: AbortSignal,
): Promise<string | null> {
  const status = await getClient().getSessionStatus(session, signal ? { signal } : {});
  return status.status === "active" ? status.expires_at : null;
}

/** Milliseconds until the grant expires. `expires_at` is a wall clock, not a hint. */
export function msUntilSessionExpiry(session: ViewerSession, now = Date.now()): number {
  const at = Date.parse(session.expires_at);
  return Number.isNaN(at) ? Number.POSITIVE_INFINITY : at - now;
}
