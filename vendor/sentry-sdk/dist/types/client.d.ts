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
import type { AddDeviceResponse, AuditResponse, Capabilities, CellDetailResponse, CellListResponse, MoveCellResponse, PeopleListResponse, Person, RemoveCellResponse, RemovePersonResponse, RemoveSiteResponse, RemoveTowerResponse, Share, ShareListResponse, ShareScopeEntry, SiteDetailResponse, SiteListResponse } from "./sites.js";
import type { AbortSignalLike, HttpOptions, RequestOptions } from "./http.js";
import type { AckAllSiteAlertsRequest, AckAllSiteAlertsResult, AlertEvent, SiteAlert, SiteAlertCounts, SiteAlertList, SiteAlertQuery } from "./alerts.js";
import { type CameraIndex, type DeviceId, type CreateSessionRequest, type IceCandidate, type IceCandidatesResponse, type PtzCommand, type PtzMoveParams, type PtzResult, type PtzStepParams, type PtzStopParams, type RecordingWindow, type SweepStatus, type ArchivedRecordingList, type FreshSegmentUrl, type ReviewableTower, type SessionCloseReason, type SessionId, type TowerDetail, type TowerInfo, type TowerListResponse, type ViewerSession, type ViewerSessionStatus } from "./models.js";
/** Anything carrying a session id: the session object, or the id itself. */
export type SessionRef = SessionId | Pick<ViewerSession, "session_id" | "offer_url" | "ice_url">;
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
export interface CreateSessionOptions extends CreateSessionRequest, RequestOptions {
}
/**
 * Typed client for the viewer-facing coordination API.
 *
 * Every method maps 1:1 to an endpoint in §4.2, validates the response at the
 * boundary, and throws a typed {@link SentryError} subclass on failure.
 */
export declare class SentryClient {
    private readonly http;
    private readonly offerTimeoutMs;
    constructor(opts: SentryClientOptions);
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
    listTowers(opts?: RequestOptions): Promise<TowerInfo[]>;
    /**
     * The same call as {@link listTowers}, with the server's own facts kept —
     * `GET /v1/viewer/towers` in full.
     *
     * ⚠ WHY THERE ARE TWO. `listTowers` returns `.towers` and throws the rest of
     * the body away, which was free until the reply grew a fact that is not
     * about any one tower: `cloud`, whether the box that answered is reaching
     * Kallon Cloud (see {@link CloudHealth}). Every tower in the list shows the
     * same answer on its settings screen, so it rides at the top of the reply
     * rather than being copied into each tower's health — and a caller that
     * wants it needs the envelope, not the array.
     *
     * `listTowers` is unchanged and stays the common case. This is the one to
     * call when a screen reports the site's link to the cloud.
     */
    listFleet(opts?: RequestOptions): Promise<TowerListResponse>;
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
    getTower(deviceId: DeviceId, opts?: RequestOptions): Promise<TowerDetail>;
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
    renameTower(deviceId: DeviceId, label: string, opts?: RequestOptions): Promise<TowerInfo>;
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
    createSession(opts: CreateSessionOptions): Promise<ViewerSession>;
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
    sendOffer(ref: SessionRef, sdp: string, opts?: RequestOptions): Promise<string>;
    /**
     * Trickle viewer candidates up (`PATCH .../ice`).
     *
     * Optional: §4.5 states non-trickle "is permitted and is the phase-one
     * baseline" — on a LAN with no ICE servers it costs nothing, and a viewer may
     * simply gather fully before calling {@link sendOffer} and never touch this.
     * Sending an empty array is a no-op and is not sent.
     */
    sendIceCandidates(ref: SessionRef, candidates: IceCandidate[], opts?: RequestOptions & {
        end_of_candidates?: boolean;
    }): Promise<void>;
    /** Single-candidate convenience over {@link sendIceCandidates}. */
    sendIceCandidate(ref: SessionRef, candidate: IceCandidate, opts?: RequestOptions): Promise<void>;
    /**
     * Poll for the tower's candidates (`GET .../ice`).
     *
     * §4.2 allows SSE on this endpoint as well as polling; this client polls,
     * because polling works identically in every runtime and the phase-one
     * baseline does not trickle at all. An SSE subscription belongs in the
     * dashboard if and when trickle becomes the default.
     */
    getIceCandidates(ref: SessionRef, opts?: RequestOptions): Promise<IceCandidatesResponse>;
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
    closeSession(ref: SessionRef, opts?: RequestOptions & {
        reason?: SessionCloseReason;
    }): Promise<void>;
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
    getSessionStatus(ref: SessionRef, opts?: RequestOptions): Promise<ViewerSessionStatus>;
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
    sendPtz(ref: SessionRef, command: PtzCommand, opts?: RequestOptions): Promise<PtzResult>;
    /**
     * Move (§5.1). Axes are clamped to the normalized ranges before they leave
     * the process — the tower does the maths, but there is no reason to send it
     * a `pan` of `1.4` and find out on the wire.
     */
    ptzMove(ref: SessionRef, camera: CameraIndex, params: PtzMoveParams, opts?: RequestOptions): Promise<PtzResult>;
    /**
     * One fixed nudge -- a DISTANCE, not a duration (docs/ptz-api.md section 2).
     *
     * Executed as an ONVIF RelativeMove: the camera performs the translation and
     * stops itself, so link delay changes WHEN it happens and never HOW FAR it
     * goes. That is the whole reason to prefer this over a short held move, which
     * travelled a different distance on every press and furthest on the worst
     * link. Repeated clicks move the same amount every time.
     *
     * ⚠ CHECK `result.done`. A step blocked by the tilt limit answers HTTP
     * 200 with `ok: true` and `done: false` plus a `reason` -- a refusal, not an
     * error, so nothing is thrown. Read it as {@link PtzStepResult}. A caller
     * that treats 200 as "it moved" reports a step that never happened.
     *
     * ⚠ A STEP PAUSES A RUNNING SWEEP. The reply then carries the new sweep
     * block; read it with {@link sweepOf}.
     *
     * `pan`/`tilt` are signed multipliers in a jog's sense, clamped to -1..1, and
     * at least one must be non-zero or the device refuses it as
     * `invalid_request`. The optional `degrees` override is clamped here, because
     * its bounds are fixed by the contract rather than by a camera's config.
     */
    ptzStep(ref: SessionRef, camera: CameraIndex, params: PtzStepParams, opts?: RequestOptions): Promise<PtzResult>;
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
    ptzStop(ref: SessionRef, camera: CameraIndex, params?: PtzStopParams, opts?: RequestOptions): Promise<PtzResult>;
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
    ptzSetHome(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<PtzResult>;
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
    /**
     * A FRESH pair of URLs for one archived segment, minted now.
     *
     * `GET /v1/viewer/recordings/segment-url?device_id=&camera=&key=`
     *
     * The list's URLs start ageing when the list is BUILT. On a bucket backend they
     * are presigned and they expire, so a clip opened some minutes after the list was
     * loaded can stop part-way through with no error of any kind: the browser simply
     * stalls, which looks exactly like a slow start. Call this when a segment is
     * actually opened, and again if the media element reports an error.
     *
     * AUTHORIZATION IS THE LIST'S, not a weaker one. Same account, same owner-derived
     * `recordings` permission, same tower ownership, and the key must belong to the
     * tower named. A key for another tower or another site is a `404`, the same answer
     * an unknown segment gets, so this cannot be used to probe what exists.
     *
     * @throws {ApiError} `404` -- no such tower, or the key is not this tower's.
     * @throws {ApiError} `403 forbidden` -- the account may not view recordings.
     */
    /**
     * The towers that have footage to review -- `GET /v1/viewer/recordings/towers`.
     *
     * NOT {@link listTowers}. That one projects the live fleet, so an offline tower
     * arrives with no cameras and a review screen built from it offers nothing to
     * click for the tower an operator most often wants. This is the union of the
     * account's enrolled towers and whatever the archive actually holds, with
     * `online` reported for a badge rather than used to filter.
     *
     * @throws {ApiError} `403 forbidden` -- the account may not view recordings.
     */
    listReviewableTowers(opts?: RequestOptions): Promise<ReviewableTower[]>;
    getSegmentUrl(deviceId: string, camera: number | string, key: string, opts?: RequestOptions): Promise<FreshSegmentUrl>;
    listRecordings(ref: SessionRef, opts?: RequestOptions): Promise<RecordingWindow>;
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
    listArchivedRecordings(deviceId: DeviceId, camera?: string | null, range?: {
        from?: number;
        to?: number;
    } & RequestOptions): Promise<ArchivedRecordingList>;
    /**
     * The fields a timeline answer gained for footage that is not on the hub's
     * disk yet, or cannot be placed in time (footage-sync.md §3.5, §4.4.2).
     *
     * ⚠ ALL OF THESE ARE ABSENT ON A HEALTHY LINK, AND THAT IS THE NORMAL CASE.
     * So absence is never an error here: the arrays come back **empty** and
     * `towerTimesUnreliable` comes back `false`. A tower with none of this sends
     * nothing and nothing changes for it, which is the rule the server states for
     * these keys in its own words.
     */
    private timelineExtras;
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
    fetchRecordingSlice(ref: SessionRef, start: string, durationSec: number, opts?: RequestOptions): Promise<ArrayBuffer>;
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
    fetchClip(ref: SessionRef, start: string, durationSec: number, opts?: RequestOptions): Promise<ArrayBuffer>;
    /** Refresh the daemon's 4 s deadman during a held move (§5.1). */
    ptzKeepalive(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<PtzResult>;
    /**
     * Current pan/tilt/zoom, plus bearing/elevation when the camera is
     * calibrated (§5.1). Not a movement command.
     */
    ptzStatus(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<PtzResult>;
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
    ptzHold(ref: SessionRef, camera: CameraIndex, params: PtzMoveParams, opts?: RequestOptions & {
        keepaliveMs?: number;
    }): Promise<{
        stop: (stopParams?: PtzStopParams) => Promise<PtzResult>;
        started: PtzResult;
    }>;
    /**
     * Drive the sweep. One op per call; `status` changes nothing.
     *
     * Returns the sweep as it now stands, so a caller never has to poll to learn
     * what its own command did.
     */
    private sweep;
    /**
     * Start a sweep: from the current pan position, one full circle, stopping at
     * the pan angle it began on.
     *
     * ONE SWEEP PER CAMERA, and a second start is NOT an error -- two operators
     * can both press the button. It simply reports the sweep already running, so
     * a UI can treat start as idempotent.
     *
     * `seconds` is the duration for the full 360 (the camera's own default is
     * 90). ⚠ The device REFUSES it outside {@link SWEEP_SECONDS_MIN}..{@link
     * SWEEP_SECONDS_MAX} rather than clamping, and this does not pre-empt that:
     * check against those constants first if you want to refuse without a round
     * trip.
     */
    sweepStart(ref: SessionRef, camera: CameraIndex, params?: {
        seconds?: number;
    }, opts?: RequestOptions): Promise<SweepStatus>;
    /** Suspend a sweep, keeping its place. It auto-resumes after the camera's quiet period. */
    sweepPause(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<SweepStatus>;
    /** Carry on from where a pause left it. */
    sweepResume(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<SweepStatus>;
    /**
     * End a sweep where the camera is. No return to the start angle.
     *
     * ⚠ ALWAYS SEND IT, exactly as with {@link SentryClient.ptzStop}, and
     * never gate it behind a client-side permission check: refusing a stop can
     * only leave a camera turning, accepting one can only leave it still.
     */
    sweepStop(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<SweepStatus>;
    /**
     * Report the sweep, changing nothing.
     *
     * Needs the `ptz` permission, like every PTZ read -- a `view`-only session
     * gets `403 ptz_forbidden` and can learn nothing about a sweep. Render
     * NOTHING in that case rather than an idle state that would be a lie.
     *
     * A camera being watched for progress does not need this: the ordinary
     * `status` reply already carries the block at `result.sweep` ({@link
     * sweepOf}), so poll that and save a request.
     */
    sweepStatus(ref: SessionRef, camera: CameraIndex, opts?: RequestOptions): Promise<SweepStatus>;
    /**
     * What this node can do — `GET /v1/capabilities`. **No token needed.**
     *
     * **Call this before drawing anything that assumes sites exist.** The same
     * bundle serves a hub (no sites, every path below answers 404) and the cloud
     * (all of them), and this is the only honest way to tell them apart. Gating
     * an Administration area on a build flag puts it on the hub too.
     */
    capabilities(opts?: RequestOptions): Promise<Capabilities>;
    /**
     * The sites this account may see — `GET /v1/sites`.
     *
     * An admin gets every site in the organization plus `unassigned_hubs`; a site
     * user gets the sites they are a member of and NO `unassigned_hubs` key at
     * all. Check for the key's presence, not its length.
     */
    listSites(opts?: RequestOptions): Promise<SiteListResponse>;
    /**
     * One site with its cells — `GET /v1/sites/{site_id}`.
     *
     * @throws {NotFoundError} `404 site_unknown` — no such site, **or** not one
     *   of yours. Indistinguishable on purpose, the same rule §4.2.3 sets for
     *   towers, so a site id cannot be probed for existence.
     */
    getSite(siteId: string, opts?: RequestOptions): Promise<SiteDetailResponse>;
    /** Incoming, outgoing, active and historical shares — `GET /v1/shares`. */
    listShares(opts?: RequestOptions): Promise<ShareListResponse>;
    /**
     * Start a share - `POST /v1/shares`.
     *
     * ── THREE SHAPES, BECAUSE THEY ARE THREE DIFFERENT ACTS ───────────────
     *
     * A REQUEST is a question. It names NO cameras, because the site asking
     * cannot see what the other site has, which is the whole reason sharing
     * exists. It carries a message and how long it wants, and the owner
     * answering chooses the towers, the controls, the playback and the final
     * length.
     *
     * An OFFER is a complete sentence. The site sending it picks the cameras,
     * the controls, the playback window and how long; the receiving site only
     * answers. {@link acceptShare} on an offer therefore takes nothing, and the
     * server refuses a body that would change the terms.
     *
     * An ADMIN share is an offer made by the organization's administrator, of
     * one site's cameras to another. The administrator names BOTH sites: `from`
     * is where the cameras are and `to` is who gets to see them. The viewing
     * site accepts or declines it; the owning site is told, and cannot accept,
     * decline, end or extend it (`by_admin` on the resulting share says so).
     *
     * ⚠ AN ADMIN DOES NOT REQUEST ON A SITE'S BEHALF, AND THE SERVER REFUSES
     * ONE. That used to be possible, and it put a card in front of the owning
     * site reading "the other site is asking for yours" about a request that
     * site had never made; the admin could not answer it either, because nobody
     * answers their own, so it sat there until it expired.
     *
     * `durationSec` is required in all three, between {@link SHARE_MIN_SEC} and
     * {@link SHARE_MAX_SEC}. There is no silent default: a share is somebody
     * else's cameras, and how long for is a decision rather than a fallback.
     */
    createShare(req: {
        direction: "request";
        /**
         * Which of the caller's sites is asking. REQUIRED here: a request
         * names no cameras, so there is nothing to derive it from, and which
         * of your sites is asking is a choice rather than a fact.
         */
        mySiteId: string;
        /**
         * The site being asked. It must have cameras: the server refuses a
         * request to a site with none, because such a request can never
         * become anything.
         */
        otherSiteId: string;
        /** Required. The only thing the other site has to decide on. */
        message: string;
        /** How long the asker WANTS. The owner sets what it becomes. */
        durationSec: number;
    } | {
        direction: "offer";
        /**
         * ⚠ OPTIONAL ON AN OFFER. "Share this camera" starts from a
         * camera, and a client cannot know which of its sites owns it: the
         * fleet projection carries no site, by design. The server derives it
         * from the scope, which it has to validate anyway, and refuses when
         * none of your sites owns those cameras (`403`) or when more than
         * one does (`422`).
         */
        mySiteId?: string;
        otherSiteId: string;
        /** Required: an offer may only offer what the offering site owns. */
        scope: readonly ShareScopeEntry[];
        message?: string;
        live?: boolean;
        ptz?: boolean;
        playback?: boolean;
        playbackFrom?: string;
        playbackTo?: string;
        durationSec: number;
    } | {
        /**
         * The administrator sharing one site's cameras with another.
         *
         * On the wire this is an offer, because that is what it is: the
         * cameras travel from `fromSiteId` to `toSiteId` and the receiving
         * site answers. The separate shape exists so that an admin cannot
         * accidentally send the site-to-site one, where `mySiteId` means
         * "mine" and here it does not.
         */
        direction: "admin";
        /** Where the cameras ARE. The admin names it; it is not theirs. */
        fromSiteId: string;
        /** Who gets to see them, and who accepts or declines. */
        toSiteId: string;
        scope: readonly ShareScopeEntry[];
        message?: string;
        live?: boolean;
        ptz?: boolean;
        playback?: boolean;
        playbackFrom?: string;
        playbackTo?: string;
        durationSec: number;
    }, opts?: RequestOptions): Promise<Share>;
    /**
     * Accept a share - `POST /v1/shares/{id}/accept`.
     *
     * ⚠ WHAT MAY BE CHANGED HERE DEPENDS ON WHO STARTED IT, and the server
     * decides that, not this method.
     *
     * On a REQUEST the account answering is the one giving something up, so they
     * choose the scope (required: a request names none), the controls, the
     * playback window and the final `durationSec`, which may be less or more than
     * the share's {@link Share.asked_duration_sec}, within
     * {@link SHARE_MIN_SEC}..{@link SHARE_MAX_SEC}.
     *
     * On an OFFER, pass nothing. The offer already said what it lends and for how
     * long, and the server answers `422` to a body that would change any of it.
     * Sending the same values back is fine; sending different ones is refused
     * rather than ignored, so a client cannot believe it narrowed something it
     * did not.
     *
     * An ADMIN share is an offer, so the same applies: the viewing site accepts
     * it as sent or declines it. The OWNING site cannot answer it at all, and
     * `can_answer` on its copy says so.
     */
    acceptShare(shareId: string, changes?: {
        scope?: readonly ShareScopeEntry[];
        live?: boolean;
        ptz?: boolean;
        playback?: boolean;
        playbackFrom?: string;
        playbackTo?: string;
        durationSec?: number;
    }, opts?: RequestOptions): Promise<Share>;
    /** Decline a pending share — `POST /v1/shares/{id}/decline`. */
    declineShare(shareId: string, opts?: RequestOptions): Promise<Share>;
    /**
     * Cut a share off — `POST /v1/shares/{id}/revoke`.
     *
     * **This closes live sessions before it answers.** The server does not wait
     * for the next grant renewal, so by the time this resolves the other site's
     * open feeds on those cameras are gone. Either side may revoke, and so may
     * an admin; revoking twice is not an error.
     */
    /**
     * Give a live share longer — `POST /v1/shares/{id}/extend`.
     *
     * ⚠ FROM NOW, NOT FROM ITS OLD EXPIRY. "Another fifteen minutes" means
     * fifteen minutes from the moment somebody says it.
     *
     * Only the site that OWNS the cameras may extend, whichever direction the
     * share started in, and only while it is live. A share that has expired or
     * been revoked is finished: ask again instead, which leaves a record of
     * having asked.
     *
     * @throws {ApiError} `403 forbidden` — the borrowing site cannot extend its
     *   own access.
     * @throws {ApiError} `409 already_decided` — it is not live any more.
     */
    extendShare(shareId: string, durationSec: number, opts?: RequestOptions): Promise<Share>;
    revokeShare(shareId: string, opts?: RequestOptions): Promise<Share>;
    /** Every share in the organization — `GET /v1/admin/shares`. Admins only. */
    adminListShares(opts?: RequestOptions): Promise<ShareListResponse>;
    /** `POST /v1/admin/sites` with `{name}`. Admins only. */
    adminCreateSite(name: string, opts?: RequestOptions): Promise<SiteDetailResponse["site"]>;
    /** Rename or archive a site — `PATCH /v1/admin/sites/{id}`. Admins only. */
    adminUpdateSite(siteId: string, changes: {
        name?: string;
        status?: "archived" | "active";
    }, opts?: RequestOptions): Promise<SiteDetailResponse["site"]>;
    /**
     * Set a site's hubs — `PUT /v1/admin/sites/{id}/hubs`. Admins only.
     *
     * **The whole set, not a delta.** A hub missing from the list is unassigned,
     * and a hub belongs to at most one site, so assigning one moves it.
     */
    adminSetSiteHubs(siteId: string, hubs: readonly string[], opts?: RequestOptions): Promise<SiteDetailResponse["site"]>;
    /** The organization's people — `GET /v1/admin/people`. Admins only. */
    adminListPeople(opts?: RequestOptions): Promise<PeopleListResponse>;
    /** `POST /v1/admin/people`. Admins only. The person can log in at once. */
    adminCreatePerson(req: {
        login: string;
        password: string;
        role?: "admin" | "site_user";
        sites?: readonly string[];
    }, opts?: RequestOptions): Promise<void>;
    /**
     * Disable, enable, or set site membership — `PATCH /v1/admin/people/{id}`.
     *
     * `sites` is the WHOLE set when given. Disabling stops their live feeds
     * within one renewal window, because the server re-checks the account on
     * every renewal.
     */
    adminUpdatePerson(accountId: string, changes: {
        status?: "active" | "disabled";
        sites?: readonly string[];
    }, opts?: RequestOptions): Promise<void>;
    /** `POST /v1/admin/people/{id}/password`. Admins only. */
    adminResetPassword(accountId: string, password: string, opts?: RequestOptions): Promise<void>;
    /**
     * The audit log — `GET /v1/admin/audit`. Admins only.
     *
     * Scoped to the organization by the server, row by row. `action` is a
     * PREFIX, so `"share."` matches every share action.
     */
    adminAudit(filter?: {
        action?: string;
        accountId?: string;
        deviceId?: string;
        since?: string;
        until?: string;
        limit?: number;
        offset?: number;
        /**
         * The groups to show, e.g. `["people", "sharing"]`.
         *
         * ⚠ A SERVER FILTER, AND IT HAS TO BE. The ledger records every PTZ
         * nudge and every grant renewal, and it goes on doing so -- but a page
         * that asked for 200 rows and hid the technical ones would show four
         * sentences and a lot of nothing, because on a busy fleet those 200 rows
         * are almost all `ptz.command`. Asking for the groups asks for 200 OF
         * THOSE.
         */
        groups?: readonly string[];
    }, opts?: RequestOptions): Promise<AuditResponse>;
    /**
     * The cells this account may see — `GET /v1/cells`.
     *
     * An admin gets every cell in the organization; a site user gets the cells
     * in their own sites. Same answer either way, scoped differently, so there is
     * one shape to draw.
     */
    listCells(opts?: RequestOptions): Promise<CellListResponse>;
    /**
     * One cell and the towers in it — `GET /v1/cells/{hub_id}`.
     *
     * The towers come from the DC's own record of what the hub reported, so this
     * answers **while the cell is offline** — which is exactly when somebody is
     * looking at it.
     *
     * @throws {NotFoundError} `404 cell_unknown` — no such cell, **or** not one
     *   of yours. Indistinguishable on purpose: otherwise a hub id could be
     *   probed for existence.
     */
    getCell(hubId: string, opts?: RequestOptions): Promise<CellDetailResponse>;
    /**
     * Add a cell — `POST /v1/cells`.
     *
     * The hub's pairing code is what it printed at install. Nothing happens
     * immediately: the answer is a PENDING claim, and the cell appears when the
     * hub enrols itself against it, into the site named here.
     *
     * ⚠ THE CLAIM WINDOW IS FIFTEEN MINUTES. `pending.expires_at` is when it
     * closes, and after that the code has to be entered again.
     *
     * ⚠ NOTHING IN THIS FLOW CONFIGURES A RADIO. Radios are set up before a hub
     * ships; a UI should say so rather than leave somebody waiting for one.
     *
     * @throws {NotFoundError} `404 site_unknown` — no such site, or not one you
     *   may add to.
     */
    addCell(input: {
        /** One of your own sites. A site user may only use theirs. */
        readonly siteId: string;
        /** What to call it. "North Camp", not a slug. */
        readonly name: string;
        /** The code the hub printed at install. Dashes and case do not matter. */
        readonly pairingCode: string;
    }, opts?: RequestOptions): Promise<AddDeviceResponse>;
    /**
     * Add a tower to a cell — `POST /v1/towers`.
     *
     * The DC asks the CELL to expect this tower: a tower enrols on its hub, and
     * the hub holds its key. So two answers are normal and mean different things:
     *
     *   * **201** — the cell was asked and is waiting. `pending.status` is open.
     *   * **202** — the cell is OFFLINE, and this is queued. `pending.queued` is
     *     true, and the fifteen minute window starts when the cell receives it,
     *     not now: a link that was down must not cost somebody at a mast their
     *     window.
     *
     * @throws {ApiError} `409 cell_full` — the cell is at its ceiling. Refused
     *   HERE rather than discovered on the Jetson, so the person typing the code
     *   is told before they drive anywhere.
     * @throws {NotFoundError} `404 cell_unknown` — no such cell, or not one you
     *   may add to.
     */
    addTower(input: {
        /** The cell it joins. */
        readonly hubId: string;
        readonly name: string;
        /** The code the tower printed at install. */
        readonly pairingCode: string;
    }, opts?: RequestOptions): Promise<AddDeviceResponse>;
    /**
     * Rename a cell — `PATCH /v1/admin/cells/{hub_id}` with `{name}`.
     *
     * A cell's name is account-layer metadata: the hub does not know it, nothing
     * on the wire depends on it, and **a cell that is offline can still be
     * renamed** — which is exactly when somebody is tidying up.
     *
     * Admin only (`403 forbidden` for a site user).
     */
    adminRenameCell(hubId: string, name: string, opts?: RequestOptions): Promise<MoveCellResponse>;
    /**
     * Move a cell to another site — `PATCH /v1/admin/cells/{hub_id}`.
     *
     * ⚠ THIS ENDS EVERY LIVE SHARE INVOLVING THE CELL'S CAMERAS, and the ids come
     * back in `shares_ended`. A share is an agreement between two sites about
     * particular cameras; when the cameras leave, it no longer describes
     * anything, and both sides have to be told. Expect to notify them.
     *
     * Admin only.
     */
    adminMoveCell(hubId: string, siteId: string, opts?: RequestOptions): Promise<MoveCellResponse>;
    /**
     * Remove a cell — `DELETE /v1/admin/cells/{hub_id}`.
     *
     * @throws {ApiError} `409 cell_not_empty` — it still has towers. Taking the
     *   cell away revokes its hub's key, and a tower whose hub has no key cannot
     *   be reached by anybody, including whoever drives out to find out why. The
     *   towers come off first, one at a time, by somebody who decided that for
     *   each of them.
     *
     * Admin only.
     */
    adminRemoveCell(hubId: string, opts?: RequestOptions): Promise<RemoveCellResponse>;
    /**
     * Rename a tower — `PATCH /v1/admin/towers/{device_id}` with `{name}`.
     *
     * ⚠ THIS GOES THROUGH THE CELL, so it needs the cell to be reachable: the
     * hub owns a tower's label and its next inventory report would overwrite
     * anything written here instead. `503 hub_offline` means the rename has NOT
     * happened — not that it is pending.
     *
     * Admin only.
     */
    adminRenameTower(deviceId: string, name: string, opts?: RequestOptions): Promise<void>;
    /**
     * Move a tower to another cell — `PATCH /v1/admin/towers/{device_id}`.
     *
     * Its NAME AND HISTORY STAY, and nobody is asked for a pairing code: the old
     * cell derives it from the key it already holds. `pending.status` comes back
     * `waiting_for_tower`, because the mast still has to be aimed at the new
     * cell — that part is physical and nothing here can do it.
     *
     * Admin only.
     */
    adminMoveTower(deviceId: string, hubId: string, opts?: RequestOptions): Promise<AddDeviceResponse>;
    /**
     * Replace a dead board — `POST /v1/admin/towers/{device_id}/replace`.
     *
     * New hardware takes the old name and the old history; the old board's keys
     * are revoked in the same breath. A site does not lose its history because a
     * board died, and the old key does not stay valid because somebody forgot the
     * second step.
     *
     * Admin only.
     */
    adminReplaceTower(deviceId: string, pairingCode: string, opts?: RequestOptions): Promise<AddDeviceResponse>;
    /**
     * Remove a tower — `DELETE /v1/admin/towers/{device_id}`.
     *
     * ⚠ ITS RECORDINGS STAY, until normal retention, because they may be
     * evidence. `recordings_kept` is always true and `note` is a sentence for a
     * person; say it at the moment of removing rather than afterwards. This is
     * the only removal in the product that deliberately leaves data behind.
     *
     * Admin only.
     */
    adminRemoveTower(deviceId: string, opts?: RequestOptions): Promise<RemoveTowerResponse>;
    /**
     * Delete a site — `DELETE /v1/admin/sites/{site_id}`.
     *
     * @throws {ApiError} `409 site_not_empty` — it still has cells or people, and
     *   the error names them. Deleting a site with cells would orphan hubs whose
     *   footage is still in a bucket somebody is paying for; one with people
     *   would leave accounts that can see nothing and cannot be told why.
     *
     * The row is archived rather than dropped, so the audit log stays readable.
     *
     * Admin only.
     */
    /**
     * Remove a person from the organization — `DELETE /v1/admin/people/{id}`.
     *
     * They are gone from the People screen, signed out at once, out of every
     * site, and cannot sign in. The account ROW is kept, exactly as an archived
     * site's row is: every audit entry and every closed share still refers to it,
     * and the removal row carries their NAME so a year-old entry does not become
     * an id nobody can resolve.
     *
     * @throws {ApiError} `409 cannot_remove_self` — ask another administrator.
     * @throws {ApiError} `409 cannot_remove_organization` — that login is the
     *   customer's own credential, not a person on a list.
     */
    adminRemovePerson(accountId: string, opts?: RequestOptions): Promise<RemovePersonResponse>;
    adminRemoveSite(siteId: string, opts?: RequestOptions): Promise<RemoveSiteResponse>;
    /**
     * Add a person — `POST /v1/admin/people`.
     *
     * ⚠ A NAME, NOT A LOGIN. Their login is `name.organization`, and the
     * organization half is the caller's own, so nobody can be created into
     * somebody else's organization by typing one. The response carries the whole
     * login because an admin who has just added somebody has to be able to tell
     * them what to type.
     *
     * The name is lower case letters, digits and hyphens: no dots (the dot is the
     * separator) and no spaces (it is typed at a prompt).
     *
     * Admin only.
     */
    adminAddPerson(input: {
        readonly name: string;
        /** Their first password. They can change it; nobody else can read it. */
        readonly password: string;
        readonly role?: "admin" | "site_user";
        /** The sites they may see. Empty means none, which is a valid start. */
        readonly sites?: readonly string[];
    }, opts?: RequestOptions): Promise<Person>;
    /**
     * Correct a typo in a person's name — `POST /v1/admin/people/{id}/rename`.
     *
     * ⚠ THIS CHANGES THEIR LOGIN, so tell them. It does NOT change their
     * `account_id`, which is what the audit ledger holds, so every old entry
     * still resolves to them and a list can read `dele (was chi)`.
     *
     * ⚠ NOBODY RENAMES THEMSELVES, including an admin: a name is how the log and
     * a colleague refer to a person, and self-rename makes the log read as though
     * somebody else did the thing. `404` for your own id.
     *
     * Admin only.
     */
    adminRenamePerson(accountId: string, name: string, opts?: RequestOptions): Promise<Person>;
    /**
     * The alerts this account may see — `GET /v1/viewer/site-alerts`.
     *
     * Newest first, scoped from identity: **no account parameter is accepted
     * anywhere**, because the scope is computed through the same choke point every
     * other viewer route goes through. A second way to say "whose alerts" is how
     * one customer ends up reading another's.
     *
     * Returns the alerts **and the `colours` map**. Render a row's colour by
     * looking its `type` up in that map, not with a switch in your bundle: the map
     * is sent precisely so a type this build of the website has never heard of
     * still appears, in the colour the server picked for it.
     *
     * `since` is a **recovery tool**, not a pagination cursor. A client whose live
     * stream dropped re-reads from the last alert it saw; the stream itself
     * replays nothing, deliberately, because a replay buffer would be a second and
     * lossier answer to the same question. {@link subscribeSiteAlerts} does this
     * for you.
     */
    listSiteAlerts(query?: SiteAlertQuery & RequestOptions): Promise<SiteAlertList>;
    /**
     * One alert — `GET /v1/viewer/site-alerts/{id}`.
     *
     * Re-read it to get **fresh clip URLs**: `url` and `download_url` are minted
     * per request and a presigned bucket URL lives fifteen minutes, so a URL
     * cached in component state serves a dead link to whoever opens the alert an
     * hour later. `key` is the stable identity to cache against.
     *
     * @throws {NotFoundError} `404 alert_unknown` — no such alert, **or** not
     *   yours. One answer for both, as it is for a tower: otherwise the endpoint
     *   enumerates the fleet. Say *unavailable*, never *does not exist*.
     */
    getSiteAlert(alertId: string, opts?: RequestOptions): Promise<SiteAlert>;
    /**
     * Acknowledge an alert — `POST /v1/viewer/site-alerts/{id}/ack`. Returns the
     * updated alert.
     *
     * **No body is sent, and none is read.** Who acknowledged is the
     * authenticated caller and never a name in a request — a name in the body
     * would be an unverified claim about a person written into an audit fact.
     *
     * Acknowledging is **one-way and the first one wins**. There is no
     * un-acknowledge: "who noticed" is the fact, and a second person opening the
     * same alert has not re-noticed it. A one-way flag is also what makes the hub
     * and the data centre converge on the same answer whichever hears first.
     */
    ackSiteAlert(alertId: string, opts?: RequestOptions): Promise<SiteAlert>;
    /**
     * How many alerts nobody has answered — `GET /v1/viewer/site-alerts/counts`.
     *
     * **The badge on the tower card.** The website counted this for itself until
     * the route existed: one `GET /v1/viewer/site-alerts` with no limit — the
     * newest 100 across the whole fleet — grouped in JavaScript, acknowledged
     * ones included, with a literal `"+"` appended. So `"17+"` meant seventeen,
     * and would still have meant seventeen with four hundred outstanding.
     *
     * ⚠ `byDevice` OMITS A DEVICE WITH NONE rather than sending a zero. Read it
     * as `byDevice[deviceId] ?? 0`.
     *
     * Scoped from identity like every other viewer route, through the same choke
     * point the list uses — a count leaks perfectly well without ever naming a
     * row, so it must not have a second answer to "whose alerts".
     */
    siteAlertCounts(opts?: RequestOptions): Promise<SiteAlertCounts>;
    /**
     * Acknowledge a screenful at once — `POST /v1/viewer/site-alerts/ack-all`.
     * Returns how many rows changed.
     *
     * **THE SWEEP IS A WINDOW, and both ends are the operator's own screen.**
     * `upTo` is the **alert id** of the newest alert they have in front of them;
     * `from` is the near end of the date range that list was filtered to. Alerts
     * raised at or after `from` and no newer than `upTo` — within this account's
     * scope, narrowed further by `siteId` / `deviceId` — are the ones
     * acknowledged. Both bounds are inclusive.
     *
     * `upTo` is required and there is deliberately no "acknowledge everything":
     * as far back as the table goes is not something an operator can have
     * *seen*. `from` is optional, but **send it whenever the list is filtered by
     * date** — without it the button reaches back past everything the operator
     * had filtered out of view. ISO-8601, and no offset means UTC
     * ({@link AckAllSiteAlertsRequest.from}).
     *
     * One `alerts.acknowledged` frame goes out on the live channel for the whole
     * batch — never one `alert.updated` per row, which would close the stream of
     * every browser watching a busy site. {@link subscribeSiteAlerts} delivers it;
     * the reaction is a re-read, since the frame names no alerts. The frame
     * echoes the `from` it used.
     *
     * `0` is a normal answer: a second click changes nothing, and nothing changed
     * is not announced on the channel either.
     *
     * @throws {InvalidRequestError} `400 invalid_request` — **three different
     *   mistakes with three different remedies**, told apart by the message, so
     *   show the server's sentence rather than one of your own:
     *
     *   - *"That list is out of date. Reload the alerts and try again."* — the
     *     anchor could not be resolved: missing, or an id this account may not
     *     see, or one that no longer exists. One answer for all three, so the
     *     anchor cannot become a way to learn somebody else's alert exists.
     *   - *"Those dates could not be read. Choose the date range again."* —
     *     `from` is not a timestamp this route can parse.
     *   - *"That date range ends before it starts. Choose the dates again."* —
     *     `from` is later than the anchor's own alert. Nobody can have seen
     *     alerts from after the newest row on their screen, and answering `0`
     *     would look like a click that worked.
     *
     *   A refusal changes **nothing**: every alert is still outstanding after it.
     * @throws {AuthError} `401` / `403 not_authorized` — the write is gated
     *   exactly as the read of the same alert is.
     */
    ackAllSiteAlerts(req: AckAllSiteAlertsRequest & RequestOptions): Promise<AckAllSiteAlertsResult>;
    /**
     * Subscribe to the live alert channel — `GET /v1/viewer/events`.
     *
     * ⚠ THIS DOES NOT USE `EventSource`, AND THAT IS THE WHOLE REASON IT EXISTS.
     * `EventSource` cannot set an `Authorization` header, and this route is
     * authenticated like every other viewer route. So the stream is read with
     * `fetch()` and a body reader. The alternative would be a credential in the
     * query string — which is exactly what the clip ticket was invented to avoid,
     * and is only tolerable there because a `<video src>` cannot send a header.
     *
     * What it handles so a caller does not have to:
     *
     * - **Framing across reads.** A frame can arrive split in two; the network
     *   does not respect `\n\n`.
     * - **Keepalives.** A `: keepalive` comment arrives every 15 s and is ignored,
     *   never surfaced as an event.
     * - **Out-of-order updates**, dropped by `rev` ({@link AlertRevisionGate}).
     *   The live channel and the recovery read are two sources for one row and
     *   nothing orders them against each other, so without this a stale forward
     *   overwrites a fresh one and a recovered alert flips back to live on screen.
     * - **Recovery on any drop.** A slow reader is *dropped, not waited for* — the
     *   publisher is the loop watching the fleet and may never block on a socket —
     *   and a node holds at most 64 streams. So drops are expected, not
     *   exceptional. On every one this re-reads `listSiteAlerts({since})` from the
     *   last alert seen, emits whatever the gate accepts, and reconnects.
     *
     * - **Batch acknowledgements.** An `alerts.acknowledged` frame is delivered
     *   like any other event, ungated — it carries no row to order and no
     *   timestamp to move the watermark by. Narrow on `kind` before reaching for
     *   `alert`; the reaction is a re-read, since the frame names no alerts.
     *
     * Unknown event kinds are still ignored rather than thrown on: a new kind on
     * this channel is an additive server change, and a reader that threw would
     * turn it into a broken dashboard.
     *
     * ```ts
     * const sub = client.subscribeSiteAlerts({
     *   onAlert: (e) => {
     *     if (isAlertRowEvent(e)) store.upsert(e.alert);
     *     else void refreshCounts();        // a screenful was acknowledged
     *   },
     * });
     * // ...on teardown:
     * sub.stop();
     * ```
     *
     * @returns A handle. `stop()` is idempotent; `done` resolves when the loop has
     *   finished, which is only ever after `stop()` or an aborted signal.
     */
    subscribeSiteAlerts(handlers: {
        /**
         * Every accepted `alert.new` / `alert.updated`, every alert a recovery read
         * turned up, and every `alerts.acknowledged`. A union — narrow on `kind`,
         * or with `isAlertRowEvent`.
         */
        onAlert: (event: AlertEvent) => void;
        /**
         * Each drop and each failed reconnect. **Informational, not fatal** — the
         * loop keeps going. A dashboard should use it to show "reconnecting", not to
         * tear the subscription down.
         */
        onError?: (err: unknown) => void;
        /** Called once per successful (re)connection, after any recovery read. */
        onOpen?: () => void;
        /** Where to start a recovery read before the first frame has been seen. */
        since?: number;
        /** Backoff between attempts. Default 3000 ms, which is the server's own `retry:`. */
        retryMs?: number;
        /** Caller cancellation. Aborting it stops the loop as `stop()` does. */
        signal?: AbortSignalLike;
    }): {
        stop: () => void;
        done: Promise<void>;
    };
}
/**
 * Clamp to the §5.1 normalized ranges.
 *
 * `pan`/`tilt` are -1…1 in every mode. `zoom` is 0…1 as an absolute position
 * and a signed -1…1 rate under `continuous`/`jog`, so the bound depends on the
 * mode — which is exactly the kind of detail a call site should not have to
 * remember.
 */
/**
 * Clamp a step to the contract's bounds.
 *
 * `pan`/`tilt` are multipliers, -1..1 like a jog's velocity. `degrees` is an
 * ANGLE and is clamped to the contract's own 0.05..45, which exists so a caller
 * cannot ask for a sweep by sending a 300-degree step -- the device clamps it
 * too and reports the clamp, this merely saves the round trip.
 *
 * A zero-direction step is NOT rejected here. The device refuses it with a
 * message written for the purpose, and inventing a second refusal in this layer
 * would give two different errors for one mistake.
 */
export declare function clampStep(params: PtzStepParams): PtzStepParams;
export declare function clampMove(params: PtzMoveParams): PtzMoveParams;
//# sourceMappingURL=client.d.ts.map