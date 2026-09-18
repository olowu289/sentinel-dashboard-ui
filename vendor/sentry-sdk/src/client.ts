/**
 * The viewer ↔ coordination client (§4.2).
 *
 * ## Scope: signaling, not media
 *
 * This client speaks the documented HTTPS endpoints of §4.2 and nothing else:
 * sessions (§4.2.1), PTZ (§4.2.2) and tower inventory/health (§4.2.3). It
 * does **not** create an `RTCPeerConnection`, and it should not: §4.1 puts the
 * peer connection between the viewer and MediaMTX, with coordination as a
 * signaling relay that "MUST NOT rewrite SDP". The dashboard owns the peer
 * connection; the SDK owns the conversation that sets it up. v1's SDK drew the
 * same line and it was the right one.
 *
 * A complete viewer flow using this client:
 *
 * ```ts
 * const client = new SentryClient({ baseUrl, token });
 * const session = await client.createSession({ device_id, camera: 1 });
 *
 * const pc = new RTCPeerConnection({ iceServers: session.ice_servers });
 * pc.addTransceiver("video", { direction: "recvonly" });
 * const offer = await pc.createOffer();
 * await pc.setLocalDescription(offer);
 * await waitForIceGathering(pc);           // §4.5 non-trickle is the baseline
 *
 * const answer = await client.sendOffer(session, pc.localDescription!.sdp);
 * await pc.setRemoteDescription({ type: "answer", sdp: answer });
 * // ... later
 * await client.closeSession(session);
 * ```
 */

import { HttpTransport } from "./http.js";
import type { AbortSignalLike, HttpOptions, RequestOptions } from "./http.js";
import { PtzError, SentryError } from "./errors.js";
import {
  PTZ_KEEPALIVE_MS,
  RECORDING_MAX_CLIP_SEC,
  RECORDING_MAX_SLICE_SEC,
  type CameraIndex,
  type DeviceId,
  type CreateSessionRequest,
  type IceCandidate,
  type IceCandidatesResponse,
  type PtzCommand,
  type PtzMoveMode,
  type PtzMoveParams,
  type PtzResult,
  type PtzStopParams,
  type RecordingWindow,
  type ArchivedSegment,
  type ArchivedRecordingList,
  type SessionCloseReason,
  type SessionId,
  type TowerDetail,
  type TowerInfo,
  type ViewerSession,
  type ViewerSessionStatus,
} from "./models.js";
import {
  parseIceCandidates,
  parsePtzResult,
  parseSessionStatus,
  parseTowerDetail,
  parseTowerInfo,
  parseTowerList,
  parseViewerSession,
} from "./validate.js";

/** Anything carrying a session id: the session object, or the id itself. */
export type SessionRef = SessionId | Pick<ViewerSession, "session_id" | "offer_url" | "ice_url">;

function refId(ref: SessionRef): SessionId {
  return typeof ref === "string" ? ref : ref.session_id;
}

/**
 * Server-supplied URL when we have the session object, derived path when we
 * only have an id. §4.2 supplies `offer_url`/`ice_url` precisely so a client
 * need not hardcode them; falling back to the documented shape keeps the
 * id-only convenience working.
 */
function refUrl(ref: SessionRef, kind: "offer" | "ice" | ""): string {
  if (typeof ref !== "string") {
    if (kind === "offer" && ref.offer_url) return ref.offer_url;
    if (kind === "ice" && ref.ice_url) return ref.ice_url;
  }
  const id = encodeURIComponent(refId(ref));
  return `/v1/viewer/sessions/${id}${kind ? "/" + kind : ""}`;
}

export interface SentryClientOptions extends HttpOptions {
  /**
   * Timeout for `sendOffer`, which blocks server-side (§4.2, §10.3).
   *
   * Coordination fails the viewer with `tower_timeout` at **10 s**, so the
   * client deadline must sit above that or the SDK gives up first and the
   * dashboard never learns *why* the tower was silent. Default 15 000 ms.
   */
  offerTimeoutMs?: number;
}

/** Options for `createSession`, mirroring §4.2's request body. */
export interface CreateSessionOptions extends CreateSessionRequest, RequestOptions {}

/**
 * Typed client for the viewer-facing coordination API.
 *
 * Every method maps 1:1 to an endpoint in §4.2, validates the response at the
 * boundary, and throws a typed {@link SentryError} subclass on failure.
 */
export class SentryClient {
  private readonly http: HttpTransport;
  private readonly offerTimeoutMs: number;

  constructor(opts: SentryClientOptions) {
    this.http = new HttpTransport(opts);
    this.offerTimeoutMs = opts.offerTimeoutMs ?? 15_000;
  }

  /* ---------------------------------------------------------------- *
   * §4.2.3 — tower inventory and health
   * ---------------------------------------------------------------- */

  /**
   * List the towers this viewer may access — `GET /v1/viewer/towers` (§4.2.3),
   * in the projected shape of §A.3.
   *
   * The response is a **projection** of `tower.hello`, not a forward of it
   * (§A.1). `path`, `whep_path` and `boot_id` are in §A.6's MUST-NOT tier and
   * this method **throws {@link ProjectionLeakError} if any of them appears** —
   * a leak is a coordination bug and §A.6 requires it to be loud at the door.
   *
   * A viewer with no authorized towers gets `{towers: []}` and a `200` — an
   * empty list, never a `403`. Do not treat empty as an error.
   *
   * Two fields have **different freshness guarantees** and conflating them
   * recreates the silent failure the contract was written to remove (§A.3.2):
   *
   * - `link` is **always current** — coordination watches the WSS link itself.
   * - `cameras[].status` is **last-known, as of `as_of`** — the tower reports
   *   liveness and coordination can only know what it was last told.
   *
   * So a camera reading `"live"` under `link: "down"` with an ageing `as_of` is
   * true only in the past tense, and must render as stale. This SDK surfaces
   * `as_of` faithfully and does not interpret it: applying a freshness
   * threshold is the dashboard's call, not the SDK's.
   *
   * A tower that has never connected comes back with every `status` as
   * `"unknown"`, `as_of: null` and `cameras: []`. `"unknown"` is valid and
   * expected — until §A.10.5 puts per-camera liveness on `tower.state`, a
   * conforming service serves it rather than inferring, because a guessed
   * `"live"` is exactly the reading §A.3.2 forbids.
   */
  async listTowers(opts: RequestOptions = {}): Promise<TowerInfo[]> {
    const path = "/v1/viewer/towers";
    const { status, body } = await this.http.send({
      method: "GET",
      path,
      accept: "json",
      ...pick(opts),
    });
    return parseTowerList(body, { status, path }).towers;
  }

  /**
   * One tower with its health — `GET /v1/viewer/towers/{device_id}` (§4.2.3).
   *
   * `health` is coordination's **merged** view: `tower.hello` carries a full
   * block and `tower.state` (§3.4) pushes only what changed, and §4.2.3 puts
   * the merge on the server so a viewer never reassembles fleet state from
   * fragments it did not receive.
   *
   * **Read `health_as_of` before rendering anything.** For a tower with
   * `link: "down"` the block holds the *last reported* values, and that
   * timestamp is the only thing stopping a stale reading from being drawn as a
   * current one.
   *
   * This document carries **two** stamps, and §A.3.2 keeps them distinct:
   * `as_of` covers the camera statuses, `health_as_of` covers the sensor block
   * (door · cover · impact · thermal · disk). Usually the same instant, but
   * served by different endpoints and refreshable independently — so read the
   * one that stamps what you are about to draw.
   *
   * @throws {NotFoundError} `404 tower_unknown` — no such tower, **or** not
   *   this viewer's. §4.2.3 requires these to be indistinguishable so the
   *   endpoint cannot enumerate the fleet, so a UI must say "unavailable",
   *   never "does not exist".
   */
  async getTower(deviceId: DeviceId, opts: RequestOptions = {}): Promise<TowerDetail> {
    const path = `/v1/viewer/towers/${encodeURIComponent(deviceId)}`;
    const { status, body } = await this.http.send({
      method: "GET",
      path,
      accept: "json",
      ...pick(opts),
    });
    return parseTowerDetail(body, { status, path });
  }

  /**
   * Rename a tower — `PATCH /v1/viewer/towers/{device_id}` with `{label}`.
   *
   * `label` is **account-layer metadata** (§A.3.1): what a customer *calls* a
   * tower, owned by coordination's account data and keyed by `device_id`. It
   * "may change freely" — nothing on the wire depends on it. The tower does not
   * know its own label, it is not in `tower.hello`, and `device_id` remains the
   * identity everywhere. So a rename touches the registry and nothing else: no
   * envelope, no WSS relay, no tower involvement, and **a tower that is offline
   * can still be renamed.**
   *
   * Returns the **updated projected tower** (§A.3), not a bare acknowledgement,
   * so a caller re-renders from the server's answer rather than from the string
   * it just sent. That response is validated exactly like `listTowers`, leak
   * scan included — a write's response is a projection too, and §A.6 does not
   * stop applying because the verb changed.
   *
   * **The label is passed through verbatim.** No trim, no case-folding, no
   * emptiness check: the server validates it (rejecting empty, over-long or
   * control-character labels) and its `422` says *why*. A client-side rule here
   * would be a second copy of that policy, free to drift from it, and silently
   * mangling what a user typed is worse than a clear refusal. Leading spaces
   * are the user's business, not the SDK's.
   *
   * > **Route caveat, flagged rather than hidden.** §A.3.1 grounds the *shape* —
   * > `label` is account-layer and mutable — but **§4.2.3 documents no PATCH
   * > route** for it. This path is the one coordination implements today
   * > (`sentry-core/coordination/stub/server.py`, `do_PATCH`). Same situation
   * > the PTZ endpoint was in before §4.2.2 was written: worth closing in the
   * > spec, and if the documented route differs only this URL changes.
   *
   * @throws {NotFoundError} `404 tower_unknown` — no such tower, **or** not this
   *   viewer's. Deliberately indistinguishable (§4.2.3): a rename endpoint that
   *   said "not yours" would be a fleet enumerator with a side effect. Surface
   *   it as *unavailable*, never as *does not exist*.
   * @throws {InvalidRequestError} `422 invalid_label` — the server refused the
   *   label (empty, too long, control characters). `err.message` carries the
   *   reason; show it. Note this is **not** {@link ValidationError}, which means
   *   "the *response* did not match the contract" — here the request was
   *   rejected, and the server is working correctly.
   * @throws {AuthError} `401 unauthorized` — no or bad viewer credential.
   */
  async renameTower(
    deviceId: DeviceId,
    label: string,
    opts: RequestOptions = {},
  ): Promise<TowerInfo> {
    const path = `/v1/viewer/towers/${encodeURIComponent(deviceId)}`;
    const { status, body } = await this.http.send({
      method: "PATCH",
      path,
      json: { label },
      accept: "json",
      ...pick(opts),
    });
    return parseTowerInfo(body, { status, path });
  }

  /* ---------------------------------------------------------------- *
   * §4.2.1 — POST /v1/viewer/sessions
   * ---------------------------------------------------------------- */

  /**
   * Open a viewing session for one camera on one tower.
   *
   * Returns `session_id`, the ICE servers to build the peer connection with,
   * and the URLs for the rest of the flow. The viewer **never** receives the
   * grant — coordination mints it and sends it straight to the tower (§4.2.1,
   * §16.3), so there is nothing credential-shaped in this response to protect.
   *
   * **There is no way to request permissions or a lifetime, by design** (§4.2.1,
   * §6.5). Coordination derives both from the viewer's authenticated role. The
   * request body is `{device_id, camera}` and nothing else.
   *
   * `expires_at` is the grant's expiry and it ends the live session when it
   * passes (§10.1, a confirmed decision): treat it as the session's wall clock,
   * not a hint.
   *
   * @throws {TowerOfflineError} `503` — the tower is not ONLINE (§7.6). Show it;
   *   do not queue behind it.
   * @throws {AuthError} `403 not_authorized` — the viewer may not view this
   *   tower or camera.
   * @throws {NotFoundError} `404 tower_unknown` — no such tower, **or** not
   *   this viewer's. §4.2.3 makes the two indistinguishable on purpose; do not
   *   tell a user the tower does not exist.
   */
  async createSession(opts: CreateSessionOptions): Promise<ViewerSession> {
    // Exactly the fields §4.2.1 defines, constructed explicitly rather than
    // spread from `opts` — `opts` also carries transport options, and a spread
    // here is how a `permissions` field would one day reach the wire.
    const body: CreateSessionRequest = { device_id: opts.device_id, camera: opts.camera };
    // §3.1 — named only when asked for. Omitting the key entirely is not the
    // same as sending null: coordination reads absence as "the camera's
    // default", and every caller written before profiles existed keeps working
    // without having learned about them.
    if (opts.profile !== undefined) body.profile = opts.profile;

    const path = "/v1/viewer/sessions";
    const { status, body: raw } = await this.http.send({
      method: "POST",
      path,
      json: body,
      accept: "json",
      ...pick(opts),
    });
    return parseViewerSession(raw, { status, path });
  }

  /* ---------------------------------------------------------------- *
   * §4.2 — POST /v1/viewer/sessions/{id}/offer
   * ---------------------------------------------------------------- */

  /**
   * Relay the viewer's SDP offer and block until the tower answers.
   *
   * This is the synchronous relay of §10.3, a confirmed decision: the request
   * is held open while coordination pushes `session.request` down the tower's
   * WSS link and waits for `session.answer`. Content type in and out is
   * `application/sdp`; the offer is relayed **verbatim** and coordination must
   * not rewrite it (§4.3).
   *
   * @param sdp The raw offer. Pass `pc.localDescription.sdp`, not the
   *   `RTCSessionDescription` object.
   * @returns The raw SDP answer, ready for `setRemoteDescription`.
   *
   * @throws {TowerTimeoutError} `504` — no answer within 10 s (§4.2).
   * @throws {TowerOfflineError} `503` — the tower went offline (§7.6).
   * @throws {GrantError} the tower refused the grant (§6.3), relayed as a
   *   `session.error`.
   * @throws {MediaError} `mediamtx_unavailable` / `whep_failed` /
   *   `camera_offline` — the tower's media path failed (§7.7). Do not retry in
   *   a loop; §7.7 is explicit that retry storms here wedged a camera in v1.
   */
  async sendOffer(ref: SessionRef, sdp: string, opts: RequestOptions = {}): Promise<string> {
    const path = refUrl(ref, "offer");
    const { body } = await this.http.send({
      method: "POST",
      path,
      sdp,
      accept: "sdp",
      timeoutMs: opts.timeoutMs ?? this.offerTimeoutMs,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
    if (typeof body !== "string" || body.trim() === "") {
      throw new SentryError("offer relay returned an empty SDP answer", {
        code: "response_invalid",
        status: 200,
        path,
      });
    }
    return body;
  }

  /* ---------------------------------------------------------------- *
   * §4.2 / §4.5 — trickle ICE
   * ---------------------------------------------------------------- */

  /**
   * Trickle viewer candidates up (`PATCH .../ice`).
   *
   * Optional: §4.5 states non-trickle "is permitted and is the phase-one
   * baseline" — on a LAN with no ICE servers it costs nothing, and a viewer may
   * simply gather fully before calling {@link sendOffer} and never touch this.
   * Sending an empty array is a no-op and is not sent.
   */
  async sendIceCandidates(
    ref: SessionRef,
    candidates: IceCandidate[],
    opts: RequestOptions & { end_of_candidates?: boolean } = {},
  ): Promise<void> {
    if (candidates.length === 0 && !opts.end_of_candidates) return;
    const path = refUrl(ref, "ice");
    await this.http.send({
      method: "PATCH",
      path,
      json: {
        candidates,
        ...(opts.end_of_candidates !== undefined
          ? { end_of_candidates: opts.end_of_candidates }
          : {}),
      },
      accept: "none",
      ...pick(opts),
    });
  }

  /** Single-candidate convenience over {@link sendIceCandidates}. */
  async sendIceCandidate(
    ref: SessionRef,
    candidate: IceCandidate,
    opts: RequestOptions = {},
  ): Promise<void> {
    return this.sendIceCandidates(ref, [candidate], opts);
  }

  /**
   * Poll for the tower's candidates (`GET .../ice`).
   *
   * §4.2 allows SSE on this endpoint as well as polling; this client polls,
   * because polling works identically in every runtime and the phase-one
   * baseline does not trickle at all. An SSE subscription belongs in the
   * dashboard if and when trickle becomes the default.
   */
  async getIceCandidates(
    ref: SessionRef,
    opts: RequestOptions = {},
  ): Promise<IceCandidatesResponse> {
    const path = refUrl(ref, "ice");
    const { status, body } = await this.http.send({
      method: "GET",
      path,
      accept: "json",
      ...pick(opts),
    });
    return parseIceCandidates(body, { status, path });
  }

  /* ---------------------------------------------------------------- *
   * §4.2 — DELETE /v1/viewer/sessions/{id}
   * ---------------------------------------------------------------- */

  /**
   * Tear the session down. **Idempotent** — §4.2: "an already-gone session
   * still returns `204`".
   *
   * This also drives the tower's `DELETE <Location>` against MediaMTX (§4.6),
   * which is what actually frees the media session, so a viewer that navigates
   * away without calling this leaves the tower waiting on a reap. Call it from
   * `beforeunload` as well as from the UI path.
   *
   * A `404` from a server that did not implement the idempotency is swallowed
   * here: the caller's intent — "this session should not exist" — is satisfied
   * either way.
   */
  async closeSession(
    ref: SessionRef,
    opts: RequestOptions & { reason?: SessionCloseReason } = {},
  ): Promise<void> {
    const path = refUrl(ref, "");
    try {
      await this.http.send({ method: "DELETE", path, accept: "none", ...pick(opts) });
    } catch (err) {
      if (err instanceof SentryError && (err.status === 404 || err.code === "session_unknown")) {
        return;
      }
      throw err;
    }
  }

  /**
   * The session's CURRENT state — `GET /v1/viewer/sessions/{id}` (§4.2, §7.4).
   *
   * SIGNALING/CONTROL ONLY, like everything else here: it touches no peer and
   * moves no media. It exists so a viewer can keep an accurate clock.
   *
   * §7.4 renewal advances `expires_at` on the server. The value from
   * {@link createSession} is a snapshot that goes stale at the first renewal,
   * so a viewer holding a long-lived session MUST re-read it rather than count
   * down to the original — otherwise it tears down a session coordination has
   * just extended, and the operator loses a feed that was never in trouble.
   *
   * A `404` is RETURNED as `{status: "ended"}` rather than thrown. Coordination
   * removes a session the instant it closes, so absent IS ended — that is an
   * ANSWER the caller must act on (stop playing, say why), not a failure. The
   * same `404` also covers "not yours", deliberately, so this cannot enumerate
   * other accounts' sessions; a caller only ever asks about a session it opened,
   * so for it the meaning is unambiguous.
   *
   * Everything else — a network failure, a 5xx — still THROWS, because those are
   * not evidence the session ended and must never stop a working feed.
   */
  async getSessionStatus(
    ref: SessionRef,
    opts: RequestOptions = {},
  ): Promise<ViewerSessionStatus> {
    const id = refId(ref);
    const path = `/v1/viewer/sessions/${encodeURIComponent(id)}`;
    try {
      const { status, body } = await this.http.send({
        method: "GET",
        path,
        accept: "json",
        ...pick(opts),
      });
      return parseSessionStatus(body, { status, path });
    } catch (err) {
      if (err instanceof SentryError && (err.status === 404 || err.code === "session_unknown")) {
        return { session_id: id, camera: 0, expires_at: "", status: "ended" };
      }
      throw err;
    }
  }

  /* ---------------------------------------------------------------- *
   * PTZ — §5.1/§5.2 payloads over an endpoint §4.2 does not document
   * ---------------------------------------------------------------- */

  /**
   * Send a PTZ command for a live session — `POST .../ptz` (§4.2.2).
   *
   * PTZ is session-scoped: the session *is* the authorization, and §4.2.2
   * defines no PTZ endpoint outside one. The body is the §5.1 `ptz.command`
   * payload minus `session_id`, which is in the path. This adds no vocabulary
   * over §5.1 — coordination relays it verbatim and does no PTZ maths.
   *
   * Coordination checks `ptz` ∈ `permissions` and `camera` ∈ `cameras` before
   * touching the link (`403 grant_permission` / `grant_scope`), and the tower
   * checks both again on arrival (§6.2 steps 6–7) — the tower's check is the
   * authoritative one.
   *
   * @throws {PtzError} on a `409` carrying the tower's `ptz.result`, and on a
   *   `200` whose body is `ok: false`. Check {@link isNormalPtzOutcome} first:
   *   `SUPERSEDED` is the *expected* result of a rapid tap or direction change
   *   and §5.2 forbids surfacing it as a fault.
   * @throws {GrantError} `403` — the session's grant does not cover this.
   * @throws {TowerTimeoutError} `504` — no `ptz.result` within 8 s (§4.2.2,
   *   deliberately tighter than the offer relay's 10 s).
   * @throws {RateLimitedError} `429` — past the per-session ceiling (§7.8).
   */
  async sendPtz(ref: SessionRef, command: PtzCommand, opts: RequestOptions = {}): Promise<PtzResult> {
    const id = encodeURIComponent(refId(ref));
    const path = `/v1/viewer/sessions/${id}/ptz`;
    const { status, body } = await this.http.send({
      method: "POST",
      path,
      json: {
        camera: command.camera,
        action: command.action,
        params: command.params ?? {},
      },
      accept: "json",
      ...pick(opts),
    });
    const result = parsePtzResult(body, { status, path });
    if (!result.ok && result.error) {
      // §4.2.2 returns `409` with the ptz.result body when the tower answered
      // `ok:false`, and its `error` sits in the standard envelope position — so
      // the transport has already thrown a typed error for that path. This
      // branch catches a `200 {ok:false}`. Both end up as the same exception so
      // a caller never has to check two places for one condition.
      throw new PtzError(result.error.message || result.error.code, {
        code: result.error.code,
        status,
        path,
        apiError: result.error,
      });
    }
    return result;
  }

  /**
   * Move (§5.1). Axes are clamped to the normalized ranges before they leave
   * the process — the tower does the maths, but there is no reason to send it
   * a `pan` of `1.4` and find out on the wire.
   */
  async ptzMove(
    ref: SessionRef,
    camera: CameraIndex,
    params: PtzMoveParams,
    opts: RequestOptions = {},
  ): Promise<PtzResult> {
    return this.sendPtz(ref, { camera, action: "move", params: clampMove(params) }, opts);
  }

  /**
   * Stop (§5.1, §5.3).
   *
   * §5.3 makes stop unconditional on the tower: it is dispatched before any
   * grant scope check that could refuse it, and is accepted even under an
   * expired grant, because "refusing a stop can only leave a camera moving;
   * accepting one can only leave it still". Client-side that means: always send
   * it, never gate it behind your own permission check, and do not skip it
   * because the session looks expired.
   */
  async ptzStop(
    ref: SessionRef,
    camera: CameraIndex,
    params: PtzStopParams = {},
    opts: RequestOptions = {},
  ): Promise<PtzResult> {
    return this.sendPtz(ref, { camera, action: "stop", params }, opts);
  }

  /**
   * Save the camera's CURRENT pan/tilt as its home (§5.1).
   *
   * The tower reads the live position itself, so there is nothing to pass and
   * nothing a caller could aim wrongly. The zoom is decided by the tower and
   * is always the widest view — see {@link PtzSetHomeResult}.
   *
   * ⚠ IT CAN REFUSE, AND THE REFUSAL IS THE USEFUL PART. A camera whose home
   * comes from a calibration bundle reads it from there unconditionally, so a
   * write would be silently ignored; the tower answers `HOME_NOT_SETTABLE`
   * instead of reporting a success that changed nothing. Show that message —
   * it tells the operator why, and it is not a fault.
   *
   * Authorized exactly like a move: it needs the session's grant to carry
   * `ptz`, and there is no other address to send it to.
   */
  async ptzSetHome(
    ref: SessionRef,
    camera: CameraIndex,
    opts: RequestOptions = {},
  ): Promise<PtzResult> {
    return this.sendPtz(ref, { camera, action: "set_home" }, opts);
  }

  /**
   * Which stretches of recording this session's camera actually holds (§12.6).
   *
   * The camera comes from the SESSION, never from a parameter — the same choke
   * point live media and PTZ use, so a viewer cannot ask about a camera they
   * were not granted.
   *
   * ⚠ THE ANSWER IS THE DISK, NOT THE POLICY. See {@link RecordingSpan}. An
   * empty `spans` is a real answer meaning this camera has no footage, and must
   * be shown as that rather than as an empty scrubber.
   *
   * @throws {ApiError} `501 recording_unsupported` — the tower's agent predates
   *   §12.6 and does not advertise `recording.v1`. Not a fault: an older agent
   *   correctly rejects these messages, and coordination declines to provoke it.
   * @throws {ApiError} `503 tower_offline` — the tower is not connected.
   */
  async listRecordings(
    ref: SessionRef,
    opts: RequestOptions = {},
  ): Promise<RecordingWindow> {
    const id = encodeURIComponent(refId(ref));
    const path = `/v1/viewer/sessions/${id}/recordings`;
    const { body } = await this.http.send({
      method: "GET",
      path,
      accept: "json",
      ...pick(opts),
    });
    const raw = (body ?? {}) as Record<string, unknown>;
    const spans = Array.isArray(raw.spans) ? raw.spans : [];
    return {
      camera: Number(raw.camera ?? 1) as CameraIndex,
      spans: spans
        .map((sp) => sp as Record<string, unknown>)
        .filter((sp) => typeof sp.start === "string")
        .map((sp) => ({
          start: String(sp.start),
          duration: Number(sp.duration ?? 0),
        })),
    };
  }

  /**
   * List HUB-ARCHIVED footage for a tower·camera — `GET /v1/viewer/recordings`.
   *
   * This is the LONG-TERM store, distinct from {@link listRecordings} (the
   * tower's own on-disk ring, session-scoped). It is ACCOUNT-scoped: the caller
   * is authorized by its login (the same Bearer every viewer route uses) plus
   * ownership of the tower and the `recordings` permission — no viewing session
   * is opened, because browsing an archive negotiates no media.
   *
   * ⚠ STORAGE-AGNOSTIC. Each segment's `url` is ready to play and self-authorizing
   * (presigned bucket URL, or a ticketed coordination stream for local disk); the
   * caller plays it and never learns where the footage lives. Switching the hub's
   * STORAGE_BACKEND moves the footage AND these URLs with no change here.
   *
   * `archiveEnabled: false` with an empty `segments` is the honest "this hub does
   * not archive", not a transient empty — render it as such, never as a scrubber.
   *
   * @param deviceId the tower.
   * @param camera the storage camera name (e.g. `cam1`), or omit for the whole tower.
   * @param range optional `from`/`to` as epoch SECONDS — segments overlapping the
   *   window are returned, so a window landing mid-segment still sees its segment.
   */
  async listArchivedRecordings(
    deviceId: DeviceId,
    camera?: string | null,
    range: { from?: number; to?: number } & RequestOptions = {},
  ): Promise<ArchivedRecordingList> {
    const { from, to, ...opts } = range;
    // Hand-built query (no URLSearchParams dependency, matching the rest of this
    // file). Only the parameters that are set are sent.
    const parts = [`device_id=${encodeURIComponent(deviceId)}`];
    if (camera) parts.push(`camera=${encodeURIComponent(camera)}`);
    if (from !== undefined) parts.push(`from=${encodeURIComponent(String(from))}`);
    if (to !== undefined) parts.push(`to=${encodeURIComponent(String(to))}`);
    const { body } = await this.http.send({
      method: "GET",
      path: `/v1/viewer/recordings?${parts.join("&")}`,
      accept: "json",
      ...pick(opts),
    });
    const raw = (body ?? {}) as Record<string, unknown>;
    const segs = Array.isArray(raw.segments) ? raw.segments : [];
    // The hub returns the camera as a NUMBER (its stored `camN` mapped back to the
    // number the rest of the app uses); keep it numeric when it is, else the raw
    // string for a non-`camN` custom name.
    const coerceCamera = (v: unknown): number | string => {
      if (typeof v === "number") return v;
      const s = String(v ?? "");
      const n = Number(s);
      return s !== "" && Number.isFinite(n) ? n : s;
    };
    return {
      deviceId: String(raw.device_id ?? deviceId),
      camera: raw.camera == null ? null : coerceCamera(raw.camera),
      archiveEnabled: Boolean(raw.archive_enabled),
      segments: segs
        .map((s) => s as Record<string, unknown>)
        .filter((s) => typeof s.start === "string" && typeof s.url === "string")
        .map((s): ArchivedSegment => ({
          key: String(s.key ?? ""),
          camera: coerceCamera(s.camera ?? camera ?? ""),
          deviceId: String(s.device_id ?? deviceId),
          start: String(s.start),
          startEpoch: Number(s.start_epoch ?? 0),
          duration: Number(s.duration ?? 0),
          size: Number(s.size ?? 0),
          // Resolve to absolute against the coordination base: a relative local
          // stream path becomes a full coordination URL; an absolute presigned
          // bucket URL passes through untouched. Either is a valid <video src>.
          url: this.http.url(String(s.url)),
          downloadUrl: this.http.url(String(s.download_url ?? s.url)),
        })),
    };
  }

  /**
   * One bounded slice of recorded video, as bytes a `<video>` can play (§12.6).
   *
   * Returns fMP4 as an ArrayBuffer. The tower fetches it from its own loopback playback server
   * and streams it up the link it already dialled, so this opens no inbound
   * path and reuses the authorization the session already carries.
   *
   * ⚠ ASK FOR WHAT YOU WILL SHOW. `duration` is capped at
   * {@link RECORDING_MAX_SLICE_SEC} and coordination refuses more. That is not
   * a limitation to work around by looping requests: the tower's control link
   * carries PTZ keepalives and heartbeats too, and a caller that pulls a whole
   * segment in slices as fast as it can is the failure the cap exists to
   * prevent. Fetch the window the operator is looking at.
   *
   * @throws {ApiError} `422 slice_too_long` — over the cap.
   * @throws {ApiError} `404 no_recording` — nothing covers that window. An
   *   ANSWER, not a fault: the operator scrubbed past what the disk holds, and
   *   the honest render is "older footage is archived".
   * @throws {ApiError} `429 too_many_relays` — this tower already has the
   *   maximum number of slices in flight.
   */
  async fetchRecordingSlice(
    ref: SessionRef,
    start: string,
    durationSec: number,
    opts: RequestOptions = {},
  ): Promise<ArrayBuffer> {
    if (!(durationSec > 0)) {
      throw new RangeError("durationSec must be positive");
    }
    if (durationSec > RECORDING_MAX_SLICE_SEC) {
      // Refused here as well as on the server, so a caller learns the rule
      // without spending a round trip and a relay slot to be told.
      throw new RangeError(
        `durationSec ${durationSec} exceeds the ${RECORDING_MAX_SLICE_SEC}s cap`,
      );
    }
    const id = encodeURIComponent(refId(ref));
    // Hand-built rather than URLSearchParams: that is a DOM/Node global this
    // package does not otherwise depend on, and two encodeURIComponent calls
    // are the whole of what it would do here.
    const q = `start=${encodeURIComponent(start)}&duration=${encodeURIComponent(String(durationSec))}`;
    const path = `/v1/viewer/sessions/${id}/recording?${q}`;
    const { body } = await this.http.send({
      method: "GET",
      path,
      accept: "blob",
      ...pick(opts),
    });
    return body as ArrayBuffer;
  }

  /**
   * Download a CLIP: one continuous range of recorded video (§12.6).
   *
   * ONE REQUEST FOR THE WHOLE RANGE, and no stitching. MediaMTX's playback
   * server concatenates across segment boundaries itself, so a five-minute
   * clip spanning twenty stored files arrives as one valid fMP4 with one init
   * segment and continuous timestamps. Reassembling that client-side would
   * mean rewriting fMP4 headers and rebasing timestamps — work that is subtly
   * wrong for months.
   *
   * ⚠ IT TRUNCATES AT A RECORDING GAP RATHER THAN SPANNING ONE. If the tower
   * was not recording for part of the range, the returned clip STOPS at that
   * discontinuity and is shorter than requested. That is deliberate and it is
   * the honest behaviour: a file that welded two sides of a gap together would
   * be evidence of something that never happened continuously. Compare the
   * result's duration against what you asked for and say so.
   *
   * @throws {ApiError} `422 slice_too_long` — over {@link RECORDING_MAX_CLIP_SEC}.
   * @throws {ApiError} `404 no_recording` — nothing covers the start of the range.
   * @throws {ApiError} `429 too_many_relays` — the tower is already sending.
   */
  async fetchClip(
    ref: SessionRef,
    start: string,
    durationSec: number,
    opts: RequestOptions = {},
  ): Promise<ArrayBuffer> {
    if (!(durationSec > 0)) throw new RangeError("durationSec must be positive");
    if (durationSec > RECORDING_MAX_CLIP_SEC) {
      throw new RangeError(
        `durationSec ${durationSec} exceeds the ${RECORDING_MAX_CLIP_SEC}s clip cap`,
      );
    }
    const id = encodeURIComponent(refId(ref));
    const q = `start=${encodeURIComponent(start)}&duration=${encodeURIComponent(String(durationSec))}`;
    const { body } = await this.http.send({
      method: "GET",
      path: `/v1/viewer/sessions/${id}/clip?${q}`,
      accept: "blob",
      ...pick(opts),
    });
    return body as ArrayBuffer;
  }

  /** Refresh the daemon's 4 s deadman during a held move (§5.1). */
  async ptzKeepalive(
    ref: SessionRef,
    camera: CameraIndex,
    opts: RequestOptions = {},
  ): Promise<PtzResult> {
    return this.sendPtz(ref, { camera, action: "keepalive" }, opts);
  }

  /**
   * Current pan/tilt/zoom, plus bearing/elevation when the camera is
   * calibrated (§5.1). Not a movement command.
   */
  async ptzStatus(
    ref: SessionRef,
    camera: CameraIndex,
    opts: RequestOptions = {},
  ): Promise<PtzResult> {
    return this.sendPtz(ref, { camera, action: "status" }, opts);
  }

  /**
   * Start a held move and keep it alive until the returned function is called.
   *
   * This exists because getting it wrong is a *safety* bug, not a cosmetic one.
   * §5.1: an unbounded `continuous` move must be refreshed by a keepalive, or the
   * tower's deadman ({@link PTZ_DEADMAN_MS}, a GENEROUS ~3s link-death net) stops
   * it. The keepalive runs at {@link PTZ_KEEPALIVE_MS} (~0.6s), WELL inside the
   * deadman with headroom for RTT and jitter, so a held move never false-stops
   * over a high-latency link; it only refreshes the deadman (no per-tick
   * movement, nothing piles up). The release coast is bounded not by the deadman
   * but by the returned `stop()`, which issues a prompt, preempting `stop` (§5.3)
   * — always, even if the keepalives were failing, the one thing that must not
   * be conditional.
   *
   * ```ts
   * const held = await client.ptzHold(session, 1, { mode: "jog", pan: 0.5 });
   * // ...on pointer-up:
   * await held.stop();
   * ```
   */
  async ptzHold(
    ref: SessionRef,
    camera: CameraIndex,
    params: PtzMoveParams,
    opts: RequestOptions & { keepaliveMs?: number } = {},
  ): Promise<{ stop: (stopParams?: PtzStopParams) => Promise<PtzResult>; started: PtzResult }> {
    const started = await this.ptzMove(ref, camera, params, opts);
    const every = opts.keepaliveMs ?? PTZ_KEEPALIVE_MS;

    const timer = setInterval(() => {
      // A failed keepalive is not worth surfacing: the deadman is the backstop
      // and the next tick may well succeed. Swallow, do not throw into a timer.
      void this.ptzKeepalive(ref, camera).catch(() => {});
    }, every);
    (timer as unknown as { unref?: () => void }).unref?.();

    let stopped = false;
    const stop = async (stopParams: PtzStopParams = {}): Promise<PtzResult> => {
      if (!stopped) {
        stopped = true;
        clearInterval(timer);
      }
      return this.ptzStop(ref, camera, stopParams);
    };
    return { stop, started };
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

function pick(opts: RequestOptions): { timeoutMs?: number; signal?: AbortSignalLike } {
  const out: { timeoutMs?: number; signal?: AbortSignalLike } = {};
  if (opts.timeoutMs !== undefined) out.timeoutMs = opts.timeoutMs;
  if (opts.signal !== undefined) out.signal = opts.signal;
  return out;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Clamp to the §5.1 normalized ranges.
 *
 * `pan`/`tilt` are -1…1 in every mode. `zoom` is 0…1 as an absolute position
 * and a signed -1…1 rate under `continuous`/`jog`, so the bound depends on the
 * mode — which is exactly the kind of detail a call site should not have to
 * remember.
 */
export function clampMove(params: PtzMoveParams): PtzMoveParams {
  const mode: PtzMoveMode = params.mode;
  const out: PtzMoveParams = { mode };
  if (params.pan !== undefined) out.pan = clamp(params.pan, -1, 1);
  if (params.tilt !== undefined) out.tilt = clamp(params.tilt, -1, 1);
  if (params.zoom !== undefined) {
    out.zoom = mode === "absolute" ? clamp(params.zoom, 0, 1) : clamp(params.zoom, -1, 1);
  }
  if (params.seconds !== undefined) out.seconds = params.seconds;
  return out;
}
