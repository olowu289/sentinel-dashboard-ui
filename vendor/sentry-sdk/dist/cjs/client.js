"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.SentryClient = void 0;
exports.clampStep = clampStep;
exports.clampMove = clampMove;
const http_js_1 = require("./http.js");
const sites_js_1 = require("./sites.js");
const errors_js_1 = require("./errors.js");
const models_js_1 = require("./models.js");
const validate_js_1 = require("./validate.js");
function refId(ref) {
    return typeof ref === "string" ? ref : ref.session_id;
}
/**
 * Server-supplied URL when we have the session object, derived path when we
 * only have an id. §4.2 supplies `offer_url`/`ice_url` precisely so a client
 * need not hardcode them; falling back to the documented shape keeps the
 * id-only convenience working.
 */
function refUrl(ref, kind) {
    if (typeof ref !== "string") {
        if (kind === "offer" && ref.offer_url)
            return ref.offer_url;
        if (kind === "ice" && ref.ice_url)
            return ref.ice_url;
    }
    const id = encodeURIComponent(refId(ref));
    return `/v1/viewer/sessions/${id}${kind ? "/" + kind : ""}`;
}
/**
 * Typed client for the viewer-facing coordination API.
 *
 * Every method maps 1:1 to an endpoint in §4.2, validates the response at the
 * boundary, and throws a typed {@link SentryError} subclass on failure.
 */
class SentryClient {
    http;
    offerTimeoutMs;
    constructor(opts) {
        this.http = new http_js_1.HttpTransport(opts);
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
    async listTowers(opts = {}) {
        const path = "/v1/viewer/towers";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, validate_js_1.parseTowerList)(body, { status, path }).towers;
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
    async getTower(deviceId, opts = {}) {
        const path = `/v1/viewer/towers/${encodeURIComponent(deviceId)}`;
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, validate_js_1.parseTowerDetail)(body, { status, path });
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
    async renameTower(deviceId, label, opts = {}) {
        const path = `/v1/viewer/towers/${encodeURIComponent(deviceId)}`;
        const { status, body } = await this.http.send({
            method: "PATCH",
            path,
            json: { label },
            accept: "json",
            ...pick(opts),
        });
        return (0, validate_js_1.parseTowerInfo)(body, { status, path });
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
    async createSession(opts) {
        // Exactly the fields §4.2.1 defines, constructed explicitly rather than
        // spread from `opts` — `opts` also carries transport options, and a spread
        // here is how a `permissions` field would one day reach the wire.
        const body = { device_id: opts.device_id, camera: opts.camera };
        // §3.1 — named only when asked for. Omitting the key entirely is not the
        // same as sending null: coordination reads absence as "the camera's
        // default", and every caller written before profiles existed keeps working
        // without having learned about them.
        if (opts.profile !== undefined)
            body.profile = opts.profile;
        const path = "/v1/viewer/sessions";
        const { status, body: raw } = await this.http.send({
            method: "POST",
            path,
            json: body,
            accept: "json",
            ...pick(opts),
        });
        return (0, validate_js_1.parseViewerSession)(raw, { status, path });
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
    async sendOffer(ref, sdp, opts = {}) {
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
            throw new errors_js_1.SentryError("offer relay returned an empty SDP answer", {
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
    async sendIceCandidates(ref, candidates, opts = {}) {
        if (candidates.length === 0 && !opts.end_of_candidates)
            return;
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
    async sendIceCandidate(ref, candidate, opts = {}) {
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
    async getIceCandidates(ref, opts = {}) {
        const path = refUrl(ref, "ice");
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, validate_js_1.parseIceCandidates)(body, { status, path });
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
    async closeSession(ref, opts = {}) {
        const path = refUrl(ref, "");
        try {
            await this.http.send({ method: "DELETE", path, accept: "none", ...pick(opts) });
        }
        catch (err) {
            if (err instanceof errors_js_1.SentryError && (err.status === 404 || err.code === "session_unknown")) {
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
    async getSessionStatus(ref, opts = {}) {
        const id = refId(ref);
        const path = `/v1/viewer/sessions/${encodeURIComponent(id)}`;
        try {
            const { status, body } = await this.http.send({
                method: "GET",
                path,
                accept: "json",
                ...pick(opts),
            });
            return (0, validate_js_1.parseSessionStatus)(body, { status, path });
        }
        catch (err) {
            if (err instanceof errors_js_1.SentryError && (err.status === 404 || err.code === "session_unknown")) {
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
    async sendPtz(ref, command, opts = {}) {
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
        const result = (0, validate_js_1.parsePtzResult)(body, { status, path });
        if (!result.ok && result.error) {
            // §4.2.2 returns `409` with the ptz.result body when the tower answered
            // `ok:false`, and its `error` sits in the standard envelope position — so
            // the transport has already thrown a typed error for that path. This
            // branch catches a `200 {ok:false}`. Both end up as the same exception so
            // a caller never has to check two places for one condition.
            throw new errors_js_1.PtzError(result.error.message || result.error.code, {
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
    async ptzMove(ref, camera, params, opts = {}) {
        return this.sendPtz(ref, { camera, action: "move", params: clampMove(params) }, opts);
    }
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
    async ptzStep(ref, camera, params, opts = {}) {
        return this.sendPtz(ref, { camera, action: "step", params: clampStep(params) }, opts);
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
    async ptzStop(ref, camera, params = {}, opts = {}) {
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
    async ptzSetHome(ref, camera, opts = {}) {
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
    async listReviewableTowers(opts = {}) {
        const { body } = await this.http.send({
            method: "GET",
            path: "/v1/viewer/recordings/towers",
            accept: "json",
            ...pick(opts),
        });
        const raw = (body ?? {});
        const rows = Array.isArray(raw.towers) ? raw.towers : [];
        return rows
            .map((t) => t)
            .filter((t) => typeof t.device_id === "string" && t.device_id)
            .map((t) => ({
            deviceId: String(t.device_id),
            label: String(t.label ?? "") || String(t.device_id),
            online: t.online === true,
            cameras: (Array.isArray(t.cameras) ? t.cameras : []).map((c) => typeof c === "number" ? c : String(c)),
            hasRecordings: t.has_recordings === true,
            ...(typeof t.hub_id === "string" && t.hub_id ? { hubId: t.hub_id } : {}),
        }));
    }
    async getSegmentUrl(deviceId, camera, key, opts = {}) {
        // Hand-built, for the reason given on listArchivedRecordings below.
        const q = [
            `device_id=${encodeURIComponent(deviceId)}`,
            `camera=${encodeURIComponent(String(camera))}`,
            `key=${encodeURIComponent(key)}`,
        ].join("&");
        const { body } = await this.http.send({
            method: "GET",
            path: `/v1/viewer/recordings/segment-url?${q}`,
            accept: "json",
            ...pick(opts),
        });
        const raw = (body ?? {});
        const url = String(raw.url ?? "");
        if (!url) {
            throw new errors_js_1.SentryError("segment-url returned no url", {
                code: "invalid_response",
                path: "/v1/viewer/recordings/segment-url",
            });
        }
        return {
            key: String(raw.key ?? key),
            url: this.http.url(url),
            downloadUrl: this.http.url(String(raw.download_url ?? url)),
            filename: String(raw.filename ?? ""),
            expiresIn: Number(raw.expires_in ?? 0),
        };
    }
    async listRecordings(ref, opts = {}) {
        const id = encodeURIComponent(refId(ref));
        const path = `/v1/viewer/sessions/${id}/recordings`;
        const { body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        const raw = (body ?? {});
        const spans = Array.isArray(raw.spans) ? raw.spans : [];
        return {
            camera: Number(raw.camera ?? 1),
            spans: spans
                .map((sp) => sp)
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
    async listArchivedRecordings(deviceId, camera, range = {}) {
        const { from, to, ...opts } = range;
        // HAND-BUILT, NOT URLSearchParams. This package compiles against
        // `lib: ["ES2022"]` with no DOM and no `@types/node`, so that global does
        // not typecheck here. It only APPEARS to when this source is read from
        // inside an app whose node_modules supplies the types, which is how two
        // uses of it reached the vendored copy and left it unable to build in its
        // own repo.
        // Only the parameters that are set are sent, so an unfiltered call asks for
        // the whole range rather than for `from=undefined`.
        const parts = [`device_id=${encodeURIComponent(deviceId)}`];
        if (camera)
            parts.push(`camera=${encodeURIComponent(camera)}`);
        if (from !== undefined)
            parts.push(`from=${encodeURIComponent(String(from))}`);
        if (to !== undefined)
            parts.push(`to=${encodeURIComponent(String(to))}`);
        const { body } = await this.http.send({
            method: "GET",
            path: `/v1/viewer/recordings?${parts.join("&")}`,
            accept: "json",
            ...pick(opts),
        });
        const raw = (body ?? {});
        const segs = Array.isArray(raw.segments) ? raw.segments : [];
        // The hub returns the camera as a NUMBER (its stored `camN` mapped back to the
        // number the rest of the app uses); keep it numeric when it is, else the raw
        // string for a non-`camN` custom name.
        const coerceCamera = (v) => {
            if (typeof v === "number")
                return v;
            const s = String(v ?? "");
            const n = Number(s);
            return s !== "" && Number.isFinite(n) ? n : s;
        };
        return {
            deviceId: String(raw.device_id ?? deviceId),
            camera: raw.camera == null ? null : coerceCamera(raw.camera),
            archiveEnabled: Boolean(raw.archive_enabled),
            segments: segs
                .map((s) => s)
                .filter((s) => typeof s.start === "string" && typeof s.url === "string")
                .map((s) => ({
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
                // The readable name, from the hub. The fallback is the key's last
                // component rather than a name built here: one implementation, and an
                // older hub that does not send it still yields something usable.
                filename: String(s.filename ?? String(s.key ?? "").split("/").pop() ?? "segment"),
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
    async fetchRecordingSlice(ref, start, durationSec, opts = {}) {
        if (!(durationSec > 0)) {
            throw new RangeError("durationSec must be positive");
        }
        if (durationSec > models_js_1.RECORDING_MAX_SLICE_SEC) {
            // Refused here as well as on the server, so a caller learns the rule
            // without spending a round trip and a relay slot to be told.
            throw new RangeError(`durationSec ${durationSec} exceeds the ${models_js_1.RECORDING_MAX_SLICE_SEC}s cap`);
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
        return body;
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
    async fetchClip(ref, start, durationSec, opts = {}) {
        if (!(durationSec > 0))
            throw new RangeError("durationSec must be positive");
        if (durationSec > models_js_1.RECORDING_MAX_CLIP_SEC) {
            throw new RangeError(`durationSec ${durationSec} exceeds the ${models_js_1.RECORDING_MAX_CLIP_SEC}s clip cap`);
        }
        const id = encodeURIComponent(refId(ref));
        const q = `start=${encodeURIComponent(start)}&duration=${encodeURIComponent(String(durationSec))}`;
        const { body } = await this.http.send({
            method: "GET",
            path: `/v1/viewer/sessions/${id}/clip?${q}`,
            accept: "blob",
            ...pick(opts),
        });
        return body;
    }
    /** Refresh the daemon's 4 s deadman during a held move (§5.1). */
    async ptzKeepalive(ref, camera, opts = {}) {
        return this.sendPtz(ref, { camera, action: "keepalive" }, opts);
    }
    /**
     * Current pan/tilt/zoom, plus bearing/elevation when the camera is
     * calibrated (§5.1). Not a movement command.
     */
    async ptzStatus(ref, camera, opts = {}) {
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
    async ptzHold(ref, camera, params, opts = {}) {
        const started = await this.ptzMove(ref, camera, params, opts);
        const every = opts.keepaliveMs ?? models_js_1.PTZ_KEEPALIVE_MS;
        const timer = setInterval(() => {
            // A failed keepalive is not worth surfacing: the deadman is the backstop
            // and the next tick may well succeed. Swallow, do not throw into a timer.
            void this.ptzKeepalive(ref, camera).catch(() => { });
        }, every);
        timer.unref?.();
        let stopped = false;
        const stop = async (stopParams = {}) => {
            if (!stopped) {
                stopped = true;
                clearInterval(timer);
            }
            return this.ptzStop(ref, camera, stopParams);
        };
        return { stop, started };
    }
    /* ---------------------------------------------------------------- *
     * 360 SWEEP (docs/ptz-api.md section 5)
     *
     * IT RUNS ON THE DEVICE, not here. A closed tab, a dropped link or a
     * signed-out operator does not stall it -- which is the whole reason it is
     * not a loop in the browser, and why these five methods are thin: each is
     * one command, and the device owns the circle.
     *
     * ⚠ WHERE THE SWEEP BLOCK LIVES DIFFERS BY ACTION, and it is the one
     * trap in this contract. A `sweep` reply puts the block in `result` ITSELF;
     * every other reply nests it at `result.sweep`. So these methods parse
     * `result` directly and {@link sweepOf} is for the other case. Getting it
     * backwards yields an `undefined` that reads as "no sweep" on a camera that
     * is turning.
     * ---------------------------------------------------------------- */
    /**
     * Drive the sweep. One op per call; `status` changes nothing.
     *
     * Returns the sweep as it now stands, so a caller never has to poll to learn
     * what its own command did.
     */
    async sweep(ref, camera, params, opts = {}) {
        const res = await this.sendPtz(ref, { camera, action: "sweep", params }, opts);
        const path = `/v1/viewer/sessions/${refId(ref)}/ptz`;
        // The block IS `result` here -- see the note above. Validated rather than
        // cast: these numbers drive a progress indicator.
        return (0, validate_js_1.parseSweepStatus)(res.result, { path });
    }
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
    async sweepStart(ref, camera, params = {}, opts = {}) {
        const p = { op: "start" };
        // Carried only on start: on a pause it would imply it meant something.
        if (params.seconds !== undefined)
            p.seconds = params.seconds;
        return this.sweep(ref, camera, p, opts);
    }
    /** Suspend a sweep, keeping its place. It auto-resumes after the camera's quiet period. */
    async sweepPause(ref, camera, opts = {}) {
        return this.sweep(ref, camera, { op: "pause" }, opts);
    }
    /** Carry on from where a pause left it. */
    async sweepResume(ref, camera, opts = {}) {
        return this.sweep(ref, camera, { op: "resume" }, opts);
    }
    /**
     * End a sweep where the camera is. No return to the start angle.
     *
     * ⚠ ALWAYS SEND IT, exactly as with {@link SentryClient.ptzStop}, and
     * never gate it behind a client-side permission check: refusing a stop can
     * only leave a camera turning, accepting one can only leave it still.
     */
    async sweepStop(ref, camera, opts = {}) {
        return this.sweep(ref, camera, { op: "stop" }, opts);
    }
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
    async sweepStatus(ref, camera, opts = {}) {
        return this.sweep(ref, camera, { op: "status" }, opts);
    }
    /* ---------------------------------------------------------------- *
     * Sites, people and sharing
     * ---------------------------------------------------------------- */
    /**
     * What this node can do — `GET /v1/capabilities`. **No token needed.**
     *
     * **Call this before drawing anything that assumes sites exist.** The same
     * bundle serves a hub (no sites, every path below answers 404) and the cloud
     * (all of them), and this is the only honest way to tell them apart. Gating
     * an Administration area on a build flag puts it on the hub too.
     */
    async capabilities(opts = {}) {
        const path = "/v1/capabilities";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            // NO SPECIAL "unauthenticated" MODE, because none is needed: `token` is
            // optional on the transport and the header is only added when there is
            // one. The server ignores it on this path anyway.
            ...pick(opts),
        });
        return (0, sites_js_1.parseCapabilities)(body, { status, path });
    }
    /**
     * The sites this account may see — `GET /v1/sites`.
     *
     * An admin gets every site in the organization plus `unassigned_hubs`; a site
     * user gets the sites they are a member of and NO `unassigned_hubs` key at
     * all. Check for the key's presence, not its length.
     */
    async listSites(opts = {}) {
        const path = "/v1/sites";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseSiteList)(body, { status, path });
    }
    /**
     * One site with its cells — `GET /v1/sites/{site_id}`.
     *
     * @throws {NotFoundError} `404 site_unknown` — no such site, **or** not one
     *   of yours. Indistinguishable on purpose, the same rule §4.2.3 sets for
     *   towers, so a site id cannot be probed for existence.
     */
    async getSite(siteId, opts = {}) {
        const path = `/v1/sites/${encodeURIComponent(siteId)}`;
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseSiteDetail)(body, { status, path });
    }
    /** Incoming, outgoing, active and historical shares — `GET /v1/shares`. */
    async listShares(opts = {}) {
        const path = "/v1/shares";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseShareList)(body, { status, path });
    }
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
    async createShare(req, opts = {}) {
        const path = "/v1/shares";
        /* ⚠ BUILT PER SHAPE, NOT BY NARROWING AFTERWARDS. These are three
           different acts and the bodies differ in what they must NOT contain: a
           request sends no scope and no permissions, because what it is granted
           is the answering site's decision. Reading fields off the union and
           letting `undefined` sort it out is how a request ends up asserting
           `ptz: false` it had no business asserting. */
        let json;
        if (req.direction === "request") {
            json = {
                direction: "request",
                my_site_id: req.mySiteId,
                other_site_id: req.otherSiteId,
                scope: [],
                message: req.message,
                live: true,
                ptz: false,
                playback: false,
                duration_sec: req.durationSec,
            };
        }
        else {
            // An OFFER and an ADMIN share carry the same terms; they differ only in
            // who names the sites, and in who the server sees making the call. The
            // server decides `by_admin` from the SESSION, never from the body: a
            // client that said so could say it falsely.
            const from = req.direction === "admin" ? req.fromSiteId : req.mySiteId;
            const to = req.direction === "admin" ? req.toSiteId : req.otherSiteId;
            json = {
                direction: "offer",
                my_site_id: from,
                other_site_id: to,
                scope: req.scope,
                message: req.message,
                live: req.live ?? true,
                ptz: req.ptz ?? false,
                playback: req.playback ?? false,
                playback_from: req.playbackFrom,
                playback_to: req.playbackTo,
                duration_sec: req.durationSec,
            };
        }
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json,
            ...pick(opts),
        });
        return (0, sites_js_1.parseShare)(body, { status, path });
    }
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
    async acceptShare(shareId, changes = {}, opts = {}) {
        const path = `/v1/shares/${encodeURIComponent(shareId)}/accept`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: {
                scope: changes.scope,
                live: changes.live,
                ptz: changes.ptz,
                playback: changes.playback,
                playback_from: changes.playbackFrom,
                playback_to: changes.playbackTo,
                duration_sec: changes.durationSec,
            },
            ...pick(opts),
        });
        return (0, sites_js_1.parseShare)(body, { status, path });
    }
    /** Decline a pending share — `POST /v1/shares/{id}/decline`. */
    async declineShare(shareId, opts = {}) {
        const path = `/v1/shares/${encodeURIComponent(shareId)}/decline`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: {},
            ...pick(opts),
        });
        return (0, sites_js_1.parseShare)(body, { status, path });
    }
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
    async extendShare(shareId, durationSec, opts = {}) {
        const path = `/v1/shares/${encodeURIComponent(shareId)}/extend`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: { duration_sec: durationSec },
            ...pick(opts),
        });
        return (0, sites_js_1.parseShare)(body, { status, path });
    }
    async revokeShare(shareId, opts = {}) {
        const path = `/v1/shares/${encodeURIComponent(shareId)}/revoke`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: {},
            ...pick(opts),
        });
        return (0, sites_js_1.parseShare)(body, { status, path });
    }
    /* -------------------------- administration ---------------------- */
    /** Every share in the organization — `GET /v1/admin/shares`. Admins only. */
    async adminListShares(opts = {}) {
        const path = "/v1/admin/shares";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseShareList)(body, { status, path });
    }
    /** `POST /v1/admin/sites` with `{name}`. Admins only. */
    async adminCreateSite(name, opts = {}) {
        const path = "/v1/admin/sites";
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: { name },
            ...pick(opts),
        });
        const o = (body ?? {});
        return (0, sites_js_1.parseSiteDetail)({ site: o.site, cells: [] }, { status, path }).site;
    }
    /** Rename or archive a site — `PATCH /v1/admin/sites/{id}`. Admins only. */
    async adminUpdateSite(siteId, changes, opts = {}) {
        const path = `/v1/admin/sites/${encodeURIComponent(siteId)}`;
        const { status, body } = await this.http.send({
            method: "PATCH",
            path,
            accept: "json",
            json: changes,
            ...pick(opts),
        });
        const o = (body ?? {});
        return (0, sites_js_1.parseSiteDetail)({ site: o.site, cells: [] }, { status, path }).site;
    }
    /**
     * Set a site's hubs — `PUT /v1/admin/sites/{id}/hubs`. Admins only.
     *
     * **The whole set, not a delta.** A hub missing from the list is unassigned,
     * and a hub belongs to at most one site, so assigning one moves it.
     */
    async adminSetSiteHubs(siteId, hubs, opts = {}) {
        const path = `/v1/admin/sites/${encodeURIComponent(siteId)}/hubs`;
        const { status, body } = await this.http.send({
            method: "PUT",
            path,
            accept: "json",
            json: { hubs },
            ...pick(opts),
        });
        const o = (body ?? {});
        return (0, sites_js_1.parseSiteDetail)({ site: o.site, cells: [] }, { status, path }).site;
    }
    /** The organization's people — `GET /v1/admin/people`. Admins only. */
    async adminListPeople(opts = {}) {
        const path = "/v1/admin/people";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parsePeopleList)(body, { status, path });
    }
    /** `POST /v1/admin/people`. Admins only. The person can log in at once. */
    async adminCreatePerson(req, opts = {}) {
        const path = "/v1/admin/people";
        await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: {
                login: req.login,
                password: req.password,
                role: req.role ?? "site_user",
                sites: req.sites ?? [],
            },
            ...pick(opts),
        });
    }
    /**
     * Disable, enable, or set site membership — `PATCH /v1/admin/people/{id}`.
     *
     * `sites` is the WHOLE set when given. Disabling stops their live feeds
     * within one renewal window, because the server re-checks the account on
     * every renewal.
     */
    async adminUpdatePerson(accountId, changes, opts = {}) {
        const path = `/v1/admin/people/${encodeURIComponent(accountId)}`;
        await this.http.send({
            method: "PATCH",
            path,
            accept: "json",
            json: changes,
            ...pick(opts),
        });
    }
    /** `POST /v1/admin/people/{id}/password`. Admins only. */
    async adminResetPassword(accountId, password, opts = {}) {
        const path = `/v1/admin/people/${encodeURIComponent(accountId)}/password`;
        await this.http.send({
            method: "POST",
            path,
            accept: "json",
            json: { password },
            ...pick(opts),
        });
    }
    /**
     * The audit log — `GET /v1/admin/audit`. Admins only.
     *
     * Scoped to the organization by the server, row by row. `action` is a
     * PREFIX, so `"share."` matches every share action.
     */
    async adminAudit(filter = {}, opts = {}) {
        // BUILT BY HAND, not with URLSearchParams: this package targets
        // `lib: ES2022` with no DOM, so URLSearchParams is not in scope. Pulling
        // the DOM lib in for one query string would widen the type surface of a
        // package that deliberately has no runtime dependencies.
        const parts = [];
        const add = (k, v) => {
            if (v === undefined || v === "")
                return;
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
        };
        add("action", filter.action);
        add("account_id", filter.accountId);
        add("device_id", filter.deviceId);
        add("since", filter.since);
        add("until", filter.until);
        add("limit", filter.limit);
        add("offset", filter.offset);
        add("groups", filter.groups && filter.groups.length
            ? filter.groups.join(",")
            : undefined);
        const query = parts.join("&");
        const path = query ? `/v1/admin/audit?${query}` : "/v1/admin/audit";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseAudit)(body, { status, path });
    }
    /* ----------------------------------------------------------------- *
     * Cells and towers
     *
     * A CELL IS A HUB, NAMED, and the split below is the one rule worth
     * knowing: `/v1/cells` and `/v1/towers` are the ADD routes and a site user
     * may use them for their own sites. Everything under `/v1/admin/` is the
     * administrator's. The person at the site is the person holding the Jetson;
     * everything destructive stays with the office.
     * ----------------------------------------------------------------- */
    /**
     * The cells this account may see — `GET /v1/cells`.
     *
     * An admin gets every cell in the organization; a site user gets the cells
     * in their own sites. Same answer either way, scoped differently, so there is
     * one shape to draw.
     */
    async listCells(opts = {}) {
        const path = "/v1/cells";
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseCellList)(body, { status, path });
    }
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
    async getCell(hubId, opts = {}) {
        const path = `/v1/cells/${encodeURIComponent(hubId)}`;
        const { status, body } = await this.http.send({
            method: "GET",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseCellDetail)(body, { status, path });
    }
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
    async addCell(input, opts = {}) {
        const path = "/v1/cells";
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            json: {
                site_id: input.siteId,
                name: input.name,
                pairing_code: input.pairingCode,
            },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseAddDevice)(body, { status, path });
    }
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
    async addTower(input, opts = {}) {
        const path = "/v1/towers";
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            json: {
                hub_id: input.hubId,
                name: input.name,
                pairing_code: input.pairingCode,
            },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseAddDevice)(body, { status, path });
    }
    /**
     * Rename a cell — `PATCH /v1/admin/cells/{hub_id}` with `{name}`.
     *
     * A cell's name is account-layer metadata: the hub does not know it, nothing
     * on the wire depends on it, and **a cell that is offline can still be
     * renamed** — which is exactly when somebody is tidying up.
     *
     * Admin only (`403 forbidden` for a site user).
     */
    async adminRenameCell(hubId, name, opts = {}) {
        const path = `/v1/admin/cells/${encodeURIComponent(hubId)}`;
        const { status, body } = await this.http.send({
            method: "PATCH",
            path,
            json: { name },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseMoveCell)(body, { status, path });
    }
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
    async adminMoveCell(hubId, siteId, opts = {}) {
        const path = `/v1/admin/cells/${encodeURIComponent(hubId)}`;
        const { status, body } = await this.http.send({
            method: "PATCH",
            path,
            json: { site_id: siteId },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseMoveCell)(body, { status, path });
    }
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
    async adminRemoveCell(hubId, opts = {}) {
        const path = `/v1/admin/cells/${encodeURIComponent(hubId)}`;
        const { status, body } = await this.http.send({
            method: "DELETE",
            path,
            accept: "json",
            ...pick(opts),
        });
        const c = body;
        return {
            removed: typeof c.removed === "string" ? c.removed : hubId,
            name: typeof c.name === "string" ? c.name : "",
        };
    }
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
    async adminRenameTower(deviceId, name, opts = {}) {
        const path = `/v1/admin/towers/${encodeURIComponent(deviceId)}`;
        await this.http.send({
            method: "PATCH",
            path,
            json: { name },
            accept: "json",
            ...pick(opts),
        });
    }
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
    async adminMoveTower(deviceId, hubId, opts = {}) {
        const path = `/v1/admin/towers/${encodeURIComponent(deviceId)}`;
        const { status, body } = await this.http.send({
            method: "PATCH",
            path,
            json: { hub_id: hubId },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseAddDevice)(body, { status, path });
    }
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
    async adminReplaceTower(deviceId, pairingCode, opts = {}) {
        const path = `/v1/admin/towers/${encodeURIComponent(deviceId)}/replace`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            json: { pairing_code: pairingCode },
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseAddDevice)(body, { status, path });
    }
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
    async adminRemoveTower(deviceId, opts = {}) {
        const path = `/v1/admin/towers/${encodeURIComponent(deviceId)}`;
        const { status, body } = await this.http.send({
            method: "DELETE",
            path,
            accept: "json",
            ...pick(opts),
        });
        return (0, sites_js_1.parseRemoveTower)(body, { status, path });
    }
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
    async adminRemovePerson(accountId, opts = {}) {
        const path = `/v1/admin/people/${encodeURIComponent(accountId)}`;
        const { body } = await this.http.send({
            method: "DELETE",
            path,
            accept: "json",
            ...pick(opts),
        });
        const r = (body ?? {});
        return {
            removed: typeof r.removed === "string" ? r.removed : accountId,
            name: typeof r.name === "string" ? r.name : "",
        };
    }
    async adminRemoveSite(siteId, opts = {}) {
        const path = `/v1/admin/sites/${encodeURIComponent(siteId)}`;
        const { status, body } = await this.http.send({
            method: "DELETE",
            path,
            accept: "json",
            ...pick(opts),
        });
        const s = body;
        return {
            removed: typeof s.removed === "string" ? s.removed : siteId,
            name: typeof s.name === "string" ? s.name : "",
            archived: s.archived === true,
        };
    }
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
    async adminAddPerson(input, opts = {}) {
        const path = "/v1/admin/people";
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            json: {
                name: input.name,
                password: input.password,
                ...(input.role ? { role: input.role } : {}),
                ...(input.sites ? { sites: [...input.sites] } : {}),
            },
            accept: "json",
            ...pick(opts),
        });
        const o = (body ?? {});
        const [person] = (0, sites_js_1.parsePeopleList)({ people: [o.person ?? {}] }, { status, path }).people;
        if (!person) {
            throw new errors_js_1.ValidationError("no person in the answer from " + path, {
                issues: ["$.person: expected object, got nothing"],
                status,
                path,
            });
        }
        return person;
    }
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
    async adminRenamePerson(accountId, name, opts = {}) {
        const path = `/v1/admin/people/${encodeURIComponent(accountId)}/rename`;
        const { status, body } = await this.http.send({
            method: "POST",
            path,
            json: { name },
            accept: "json",
            ...pick(opts),
        });
        const o = (body ?? {});
        const [person] = (0, sites_js_1.parsePeopleList)({ people: [o.person ?? {}] }, { status, path }).people;
        if (!person) {
            throw new errors_js_1.ValidationError("no person in the answer from " + path, {
                issues: ["$.person: expected object, got nothing"],
                status,
                path,
            });
        }
        return person;
    }
}
exports.SentryClient = SentryClient;
/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
function pick(opts) {
    const out = {};
    if (opts.timeoutMs !== undefined)
        out.timeoutMs = opts.timeoutMs;
    if (opts.signal !== undefined)
        out.signal = opts.signal;
    return out;
}
function clamp(v, lo, hi) {
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
function clampStep(params) {
    const out = {};
    if (params.pan !== undefined)
        out.pan = clamp(params.pan, -1, 1);
    if (params.tilt !== undefined)
        out.tilt = clamp(params.tilt, -1, 1);
    if (params.degrees !== undefined) {
        out.degrees = clamp(params.degrees, models_js_1.PTZ_STEP_DEG_MIN, models_js_1.PTZ_STEP_DEG_MAX);
    }
    return out;
}
function clampMove(params) {
    const mode = params.mode;
    const out = { mode };
    if (params.pan !== undefined)
        out.pan = clamp(params.pan, -1, 1);
    if (params.tilt !== undefined)
        out.tilt = clamp(params.tilt, -1, 1);
    if (params.zoom !== undefined) {
        out.zoom = mode === "absolute" ? clamp(params.zoom, 0, 1) : clamp(params.zoom, -1, 1);
    }
    if (params.seconds !== undefined)
        out.seconds = params.seconds;
    return out;
}
//# sourceMappingURL=client.js.map