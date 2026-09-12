/**
 * Data contract for the Sentry v2 viewer-facing API.
 *
 * Every shape here is derived from `sentry-core/docs/session-protocol.md`
 * (protocol v1). Each block cites the section it comes from. **The protocol is
 * the authority**: if a type here and the document disagree, the document is
 * right and this file is a bug.
 *
 * Nothing from the v1 (Bayana / sentinel-sdk) data model carries over. There is
 * no VPN, no WireGuard, no hub and no enrollment lifecycle in the viewer's
 * vocabulary. A viewer knows about towers, cameras, sessions, PTZ and health.
 */
/** RFC 3339 / ISO 8601 UTC timestamp, e.g. `2026-08-26T04:27:33Z`. */
export type Timestamp = string;
/** Tower identity, `kln_<slug>_NNNNNN` (architecture §6). */
export type DeviceId = string;
/** Opaque session handle, `ses_...` (§4.2). The only session token a viewer holds. */
export type SessionId = string;
/**
 * Camera index as it appears in the tower inventory (§3.1 `cameras[].index`).
 * 1-based, and never a wildcard — a grant carries an explicit allow-list (§6.1).
 */
export type CameraIndex = number;
/**
 * Request body for `POST /v1/viewer/sessions` (§4.2.1).
 *
 * **Exactly two fields, and no more.** §4.2.1 and §6.5 make this a security
 * boundary rather than a convention: a viewer MUST NOT be able to request its
 * own `permissions`, `role`, `lifetime_sec` or `viewer_ref`. Coordination
 * derives every one of them from the viewer's authenticated role, and a
 * conforming service ignores or `422`s any that appear in the body.
 *
 * So this interface has no field for them — not an optional one. An optional
 * field would invite a call site to set it, and the request would then either
 * be silently ignored or rejected, with the caller believing it had asked for
 * something. There is nothing to ask for.
 *
 * `device_id` is required even against a single-tower deployment: a request
 * that does not name its tower becomes ambiguous the day a second one exists.
 */
export interface CreateSessionRequest {
    device_id: DeviceId;
    camera: CameraIndex;
    /**
     * §3.1 — which stream profile to open, by NAME. Optional: omitted means the
     * camera's default, which is what every caller wanted before profiles
     * existed and still is.
     *
     * A viewer names a profile; it is never handed a path. The tower maps the id
     * to its own MediaMTX path (`camN` / `camN_main`) internally, and §A.6 keeps
     * `path` and `whep_path` off the wire entirely — so this is the only way to
     * ask for the higher-resolution stream, and the mapping stays one codebase's
     * business.
     *
     * Coordination validates it and signs it into the grant, so an unrecognised
     * value is refused up front rather than reaching a tower that would have to
     * decide what to do with it.
     */
    profile?: StreamProfileId;
}
/**
 * One ICE server, in the shape `RTCPeerConnection` expects for
 * `RTCConfiguration.iceServers` (§4.2 `ice_servers`).
 *
 * SUPERSEDED 2026-09-10 — this said "phase one is direct-only: `urls` carries
 * STUN and nothing else", and named ephemeral TURN as a later
 * configuration-only change. It was exactly that, and it has been made:
 * coordination now mints a per-session TURN REST credential
 * (`username: "<expiry>:<session>"`, `credential` an HMAC over it) and returns
 * the relay here. No SDK change was needed to carry it, which is what
 * "configuration-only" was predicting.
 *
 * ⚠ PASS THE WHOLE ARRAY THROUGH UNTOUCHED. `username` and `credential` are
 * time-limited and meaningless without each other and their `urls`; splitting
 * or reordering the entries is how a viewer ends up with a relay it cannot
 * authenticate against. The array is already in `RTCConfiguration.iceServers`
 * shape — hand it over as it arrives.
 *
 * A viewer whose network permits a direct path never uses the relay; ICE
 * prefers a direct candidate and only falls back. An empty array is still a
 * valid answer and means direct-only.
 */
export interface IceServer {
    urls: string[];
    username?: string;
    credential?: string;
}
/**
 * `201 Created` body of `POST /v1/viewer/sessions` (§4.2).
 *
 * > The viewer never receives the grant. Coordination mints it and sends it to
 * > the tower (§4.2, §16.3). The viewer holds only `session_id`.
 *
 * `offer_url` / `ice_url` are server-supplied paths relative to the API origin.
 * Prefer them over reconstructing paths client-side — they are the server's own
 * statement of where this session lives.
 */
export interface ViewerSession {
    session_id: SessionId;
    device_id: DeviceId;
    camera: CameraIndex;
    /** When the underlying grant expires. Grant expiry ends a live session (§10.1). */
    expires_at: Timestamp;
    ice_servers: IceServer[];
    offer_url: string;
    ice_url: string;
}
/**
 * `200` body of `GET /v1/viewer/sessions/{id}` (§4.2, §7.4).
 *
 * Exists because §7.4 renewal ADVANCES a session's expiry on the server, which
 * makes the `expires_at` handed out by `createSession` stale the moment the
 * first renewal lands. A viewer that kept counting down to the original value
 * would tear down a session coordination had just extended.
 *
 * Carries no grant, no nonce, no signature and no account identifier: those are
 * how the tower verifies a session, and §4.2.1 keeps them away from viewers.
 * This adds no secret to the viewer surface — only the expiry and the liveness
 * of a session the caller already holds.
 */
export interface ViewerSessionStatus {
    session_id: SessionId;
    camera: CameraIndex;
    /** The CURRENT expiry — the renewed one, not the one issued at creation. */
    expires_at: Timestamp;
    /**
     * `active` while coordination still holds the session.
     *
     * `ended` is synthesised by the client from a `404`: coordination removes a
     * session the instant it closes, so "absent" IS "ended" — and the same `404`
     * covers "not yours", deliberately, so the route cannot be used to discover
     * that another account's session exists.
     */
    status: "active" | "ended";
}
/**
 * A single ICE candidate, in the shape `RTCIceCandidateInit` uses (§4.5).
 *
 * Non-trickle is permitted and is the phase-one baseline (§4.5): a viewer may
 * send a complete offer and never touch the ICE endpoints at all.
 */
export interface IceCandidate {
    candidate: string;
    sdpMid?: string | null;
    sdpMLineIndex?: number | null;
    usernameFragment?: string | null;
}
/** Body of `PATCH /v1/viewer/sessions/{id}/ice` (§4.2, mirroring §4.5). */
export interface IceCandidatesRequest {
    candidates: IceCandidate[];
    end_of_candidates?: boolean;
}
/** `200 OK` body of `GET /v1/viewer/sessions/{id}/ice` (§4.2). */
export interface IceCandidatesResponse {
    candidates: IceCandidate[];
    end_of_candidates?: boolean;
}
/**
 * Why a session ended (§4.6). Coordination and the tower both use this enum. A
 * viewer normally only originates `viewer_left`, but may be *told* any of the
 * others.
 */
export type SessionCloseReason = "viewer_left" | "grant_expired" | "superseded" | "tower_shutdown" | "mediamtx_failure" | "reaped" | "admin_revoked" | "timeout";
/**
 * Grant permissions (§6.1). `recordings` and `arm` are **DEFERRED** (§9):
 * defined in the vocabulary, unused in phase one. §8.2 is explicit that every
 * added permission widens what a compromised coordination host can command, so
 * these are listed rather than invented.
 */
export type GrantPermission = "view" | "ptz" | "recordings" | "arm";
/** Coarse audit label (§6.1). `permissions` is authoritative, not this. */
export type GrantRole = "viewer" | "operator";
/**
 * PTZ movement mode (§5.1).
 *
 * - `absolute`   — requires `pan` + `tilt`.
 * - `continuous` — requires `pan`, `tilt`, `zoom`; optional `seconds`
 *                  (omitted = unbounded hold, which must be kept alive).
 * - `jog`        — hold-to-move; takes the camera CGI path where available.
 */
export type PtzMoveMode = "absolute" | "continuous" | "jog";
/**
 * Normalized PTZ axes (§5.1).
 *
 * `pan` and `tilt` are the daemon's normalized **-1.0 … 1.0**. `zoom` is
 * likewise normalized: treat **0 … 1** as the meaningful range for an absolute
 * zoom position and **-1 … 1** as a signed rate under `continuous` / `jog`.
 *
 * The tower converts to degrees and coordination MUST NOT do PTZ maths — the
 * verified mapping (`pan_deg = 180 − 180 × onvif_pan`,
 * `tilt_deg = 35 − 55 × onvif_tilt`) lives on the tower and nowhere else. This
 * SDK therefore normalizes and clamps, and never converts.
 */
export interface PtzAxes {
    pan?: number;
    tilt?: number;
    zoom?: number;
}
/** `params` for `action: "move"` (§5.1). */
export interface PtzMoveParams extends PtzAxes {
    mode: PtzMoveMode;
    /** `continuous` only; omitted means an unbounded hold. */
    seconds?: number;
}
/** `params` for `action: "stop"` (§5.1). */
export interface PtzStopParams {
    /** Default `false`. */
    home?: boolean;
}
export type PtzAction = "move" | "stop" | "keepalive" | "status" | "set_home";
/** `payload` of `ptz.command` (§5.1), as a viewer submits it. */
export type PtzCommand = {
    camera: CameraIndex;
    action: "move";
    params: PtzMoveParams;
} | {
    camera: CameraIndex;
    action: "stop";
    params?: PtzStopParams;
} | {
    camera: CameraIndex;
    action: "keepalive";
    params?: Record<string, never>;
} | {
    camera: CameraIndex;
    action: "status";
    params?: Record<string, never>;
} | {
    camera: CameraIndex;
    action: "set_home";
    params?: Record<string, never>;
};
/**
 * Where a camera's home comes from. The tower resolves these in order, most
 * specific first, and reports which one won.
 *
 * `calibration` is the one that matters to a caller: it wins unconditionally,
 * so {@link SentryClient.ptzSetHome} REFUSES on such a camera rather than
 * writing a value that would be ignored.
 */
export type HomeSource = "calibration" | "operator" | "tower_config" | "builtin";
/**
 * `result` of `action: "set_home"` — the home as it was actually saved.
 *
 * ⚠ `zoom` IS NOT THE CAMERA'S CURRENT ZOOM. Home is where the camera points,
 * at the widest view the lens has, so the tower reads the live zoom and
 * discards it. An operator framing a shot at 12× and pressing "set home" means
 * "point here", not "and come back at 12×". Note the axis is normalized, where
 * `0` is fully wide and `1` is fully telephoto — the opposite sense to the
 * magnification a viewer reads.
 */
export interface PtzSetHomeResult {
    done?: boolean;
    home?: {
        pan: number;
        tilt: number;
        zoom: number;
    };
    /** Always `"operator"` on success — the source this write becomes. */
    source?: HomeSource;
    /** What the home resolved from before this call. */
    previous_source?: HomeSource;
    [key: string]: unknown;
}
/**
 * The daemon's safety deadman (§5.1): a held `jog` or unbounded `continuous`
 * must be refreshed more often than every 4 s or the mount stops itself.
 */
export declare const PTZ_DEADMAN_MS = 4000;
/**
 * Recommended keepalive cadence (§5.1): "the viewer SHOULD send at ~1.5 s
 * intervals", because over a WAN the 4 s budget includes round-trip time.
 */
export declare const PTZ_KEEPALIVE_MS = 1500;
/**
 * Result body of a PTZ command — the `ptz.result` payload (§5.2), relayed to
 * the viewer.
 *
 * On failure `ok` is `false` and `error` is populated. Note §5.2: `SUPERSEDED`
 * is a **normal** outcome for a rapid tap or direction change and MUST NOT be
 * surfaced as a fault.
 */
export interface PtzResult {
    session_id: SessionId;
    ok: boolean;
    result?: PtzStatusResult | Record<string, unknown>;
    error?: ApiError;
}
/**
 * `result` of `action: "status"` (§5.1): current pan/tilt/zoom, plus
 * bearing/elevation **when the camera is calibrated** (§3.1 `calibrated`).
 * Extra transport/diagnostic keys are passed through untouched.
 */
export interface PtzStatusResult extends PtzAxes {
    transport?: string;
    camera?: CameraIndex;
    bearing_deg?: number;
    elevation_deg?: number;
    /**
     * True optical magnification, as the CAMERA reports it — `1.2` is 1.2×.
     *
     * ⚠ NEVER DERIVE THIS. The tower reads it from the camera's own CGI
     * (`status.AbsPosition[2]`, magnification ×100) and refuses to compute it
     * from the normalized {@link PtzAxes.zoom} position, because that mapping is
     * steeply non-linear on this lens — 0.056 normalized is already ~1.3× — and
     * guessing it once produced "1.34×" on a lens sitting at 1.20×.
     *
     * **Absent when the camera did not answer**, and absence is the honest
     * reading: render nothing rather than `1.0×` or a value carried over from an
     * earlier poll. A consumer must not be able to mistake a guess for a
     * measurement.
     */
    zoom_ratio?: number;
    /**
     * Focal length in millimetres, also the camera's own (`status.Postion[2]`).
     *
     * Absent under exactly the same conditions as {@link zoom_ratio}, and with
     * the same rule: no substitute, no default.
     */
    focal_mm?: number;
    [key: string]: unknown;
}
/**
 * One stretch of recording the tower actually has on disk (§12.6).
 *
 * ⚠ THIS IS WHAT SURVIVED, NOT WHAT RETENTION INTENDED. `recordDeleteAfter`
 * says what the tower means to keep; a power cut, a full disk or an agent that
 * was down all say otherwise. A scrubber drawn from the retention setting would
 * offer hours that are not there and let the operator discover it by scrubbing
 * into nothing. These spans come from the disk, which is also where the
 * "older footage is archived" boundary comes from — the edge of the earliest
 * span is the edge of what this tower can show.
 */
export interface RecordingSpan {
    /** RFC 3339. When this stretch begins. */
    start: Timestamp;
    /** Seconds. MediaMTX reports this per continuous stretch, not per file. */
    duration: number;
}
/** The timespans one camera holds, as {@link SentryClient.listRecordings} returns them. */
export interface RecordingWindow {
    camera: CameraIndex;
    /** Ordered oldest-first. EMPTY means this camera has no footage at all — an
     *  honest answer that a UI must render as "no recordings" rather than as an
     *  empty timeline the operator will try to scrub. */
    spans: RecordingSpan[];
}
/**
 * The longest slice a single request may ask for (§12.6), in seconds.
 *
 * Coordination refuses more with `slice_too_long`, and the reason is the link:
 * at the reference tower's measured ~7.4 Mbps a 30s slice is ~28MB, while a
 * whole 15-minute segment would be ~830MB — which the tower's control link
 * also carries heartbeats and PTZ keepalives on. The bound is the feature, not
 * a limitation of it.
 */
export declare const RECORDING_MAX_SLICE_SEC = 30;
/**
 * The longest CLIP a viewer may download (§12.6), in seconds.
 *
 * Larger than a review slice because it answers a different question. A slice
 * is speculative and frequent — dragged past, mostly unwatched — so it is kept
 * small enough that a wasted one costs nothing. A clip is asked for once,
 * deliberately, by somebody who means to keep the file.
 *
 * ⚠ THE LARGER BOUND DOES NOT RELAX THE PACING. A clip is the same 64KB chunks
 * through the same priority writer as a slice; there are simply more of them,
 * and the tower's control-plane guarantee is a property of that writer rather
 * than of the transfer's size. At this fleet's ~7.4 Mbps main stream five
 * minutes is ~275MB, which neither side buffers.
 */
export declare const RECORDING_MAX_CLIP_SEC = 300;
/** Daemon-level PTZ failure codes (§5.2). */
export type PtzErrorCode = "BUSY" | "SUPERSEDED" | "ZONE_NOT_FOUND" | "BAD_REQUEST";
/**
 * Optical class of a camera (§3.1 `lens`). Tower 2's inventory reports `ptz`
 * for both optics; `fixed` is the other value the fleet uses.
 */
/** §A.2 `lens` — physical lens kind. A closed set of two. */
export type CameraLens = "ptz" | "fixed";
/**
 * §A.2 `status` — per-camera liveness, served **directly**.
 *
 * This replaces the old `path` → `health.feeds[]` join (§A.12 #4). There is no
 * matching step any more, so a camera can never silently read healthy for lack
 * of a `feeds[]` entry — which is what the join did.
 *
 * `"unknown"` is the honest value before the tower has reported, and it is
 * **valid**, not an error. §A.3.2: it is never rendered as good. Until §A.10.5
 * lands a per-camera liveness field on `tower.state`, a conforming coordination
 * service serves `"unknown"` rather than inferring — so expect to see it.
 */
export type CameraStatus = "live" | "down" | "unknown";
/**
 * §A.2 `role` — meaningful only within an `enclosure`. Absent → `"primary"`.
 * Presentation only: §A.7 forbids it from any session, PTZ or grant call.
 */
export type CameraRole = "primary" | "secondary";
/**
 * §3.1 — a stream profile's id.
 *
 * `"sub"` and `"main"` are the two the tower serves today. Typed as an open
 * union rather than a closed one: the set is the TOWER's to grow, a viewer that
 * refuses to render an id it has not been taught is a viewer that breaks on the
 * next firmware, and §A.12 settled the same question the same way for `link`.
 * Compare against the ids you were served, not against a literal.
 */
export type StreamProfileId = "sub" | "main" | (string & {});
/**
 * §3.1 — one stream profile a camera is served at.
 *
 * Three fields cross to a viewer and no more. There is deliberately no path
 * here: §A.6 forbids `path`/`whep_path` reaching a viewer at all, and a session
 * is opened by NAMING a profile rather than by being handed somewhere to POST.
 */
export interface StreamProfile {
    id: StreamProfileId;
    /** Whether this is the profile a session gets when none is named. */
    default: boolean;
    /**
     * SHOULD, per §A.2's rule for resolution generally — **absent rather than
     * guessed**. The tower DECLARES these from config and does not probe them, so
     * a profile whose resolution was never configured reports none. A consumer
     * cannot tell a guess from a measurement, which is why an unmeasured profile
     * says nothing instead of saying something plausible.
     */
    resolution?: CameraResolution;
}
/**
 * §A.2 `resolution` — display hint only.
 *
 * The **object** form is authoritative. §A.12 #1 records that the addition's
 * proposed `"WIDTHxHEIGHT"` string lost: the object is already specified in two
 * sections and already emitted by `inventory.py`, and renaming a working shape
 * buys nothing. A string here is a contract violation, and the validator says
 * so rather than coercing it.
 */
export interface CameraResolution {
    width: number;
    height: number;
}
/**
 * One camera of the **projected** inventory (§A.2), as coordination serves it
 * to a viewer.
 *
 * §A.1 is the thing to hold onto: there are **two shapes, one hop apart**. The
 * tower's `tower.hello` is its full business card, including media-plane
 * internals; the projection is that card *narrowed* for the dashboard. This SDK
 * consumes the projection and only the projection.
 *
 * A camera is **one addressable lens** — the unit a session and a grant name. A
 * dual-lens body is therefore two `CameraInfo` entries sharing an `enclosure`
 * (§A.4), not one camera with sub-feeds. The protocol never had a sub-feed and
 * §A.7 explains why it must not gain one: a grant names whole cameras by
 * integer, and a key whose vocabulary could name something *inside* a camera is
 * a key that can ask for more.
 *
 * **Absent by contract**, and named so nobody adds them back: `path` and
 * `whep_path` are loopback media-plane addresses in the §A.6 MUST-NOT tier and
 * the validator rejects a document containing either. `codec` and `calibrated`
 * are the §A.6 SHOULD-omit tier — tolerated silently if present, but not typed
 * here, because a field with no consumer is a field that ossifies (§A.3.3).
 */
export interface CameraInfo {
    /**
     * §A.2 — the protocol address, integer ≥ 1, unique within a tower. **The only
     * camera name a session, PTZ command or grant may carry** (§A.7). The
     * tower-agent maps it to a Dahua channel internally and the channel-inversion
     * quirk stays hidden in there.
     */
    index: CameraIndex;
    lens: CameraLens;
    /**
     * §A.8 — **capability, not permission.** Whether the hardware can move.
     * Whether *this viewer* may move it lives in the grant, which the viewer
     * never receives; the only way to learn that is to issue a command and catch
     * `403 grant_permission` (see `isPtzPermissionDenied`).
     */
    ptz_capable: boolean;
    status: CameraStatus;
    /** SHOULD per §A.2 — absent rather than guessed when unknown. */
    resolution?: CameraResolution;
    /**
     * §A.4/§A.5 — presentation grouping. Cameras sharing an `enclosure` compose
     * into one tile; absent means the camera is its own tile. **MUST NOT appear
     * in any session, PTZ or grant call** (§A.7).
     */
    enclosure?: string;
    /** §A.5 — main view vs swappable inset within a tile. Absent → primary. */
    role?: CameraRole;
    /**
     * §3.1 — the stream profiles this camera can be opened at, default first.
     *
     * **Absent means the tower said nothing**, not that there is one profile.
     * An older agent reports no `profiles` array at all while still serving its
     * default stream perfectly well, so a consumer must treat absence as "no
     * choice to offer" and open sessions without naming one — never as an error,
     * and never as grounds to invent a list.
     */
    profiles?: StreamProfile[];
}
/**
 * §A.3 `link` — presence, as a **word rather than a boolean**.
 *
 * §A.12 #2 settled this: a word admits a further state (`"reconnecting"`)
 * without a breaking change, and it names the same thing the viewer's LINK
 * light shows. The semantics are unchanged — presence is §3.3's link signal and
 * nothing else.
 *
 * The open arm is the point, not an escape hatch: the validator accepts any
 * string here on purpose, because rejecting a third state would make the
 * forward-compatibility this field was reshaped for impossible to use.
 */
export type LinkState = "up" | "down" | (string & {});
/**
 * §A.9 — a reserved inventory item. `sensors` is present (possibly empty) now;
 * **no sensor UI is built yet.**
 *
 * Every future inventory item carries a `type`/`kind` discriminator the UI
 * switches on, and consumers MUST tolerate unknown item types — degrade to a
 * labelled placeholder or render nothing, never crash.
 */
export interface SensorInfo {
    type?: string;
    kind?: string;
    [key: string]: unknown;
}
/**
 * The **projected inventory** for one tower (§A.3) — the shape the dashboard
 * and this SDK consume, served by `GET /v1/viewer/towers`.
 *
 * §A.1: this is the hello *projected*, not the hello. Coordination strips the
 * media-plane internals (§A.6) and folds in the account-layer fields, and it
 * MUST NOT widen the projection with anything the tower did not report beyond
 * those. §4.2.3 remains explicit that it MUST NOT be implemented by forwarding
 * `tower.hello`.
 *
 * Absent by contract, named so nobody adds them back: `path`, `whep_path` and
 * `boot_id` (§A.6 MUST-NOT tier — the validator rejects a document carrying
 * any of them, see §A.13 for why `boot_id` sits here), plus `link_id`,
 * `active_sessions`, `grant_public_key`, source IP and the `os` block. Also
 * absent because v2 has none: every v1 transport field (`vpn_ip`,
 * `wg_public_key`, `hub_*`).
 */
export interface TowerInfo {
    /**
     * §A.3.1 — machine identity, `kln_<slug>_NNNNNN`. **Display MUST NOT be
     * derived from it** except as a last-resort cosmetic fallback: parsing a slug
     * for a name couples display to an identifier format, and breaks the day a
     * `device_id` does not match the pattern (the "Tower 1" trap).
     */
    device_id: DeviceId;
    /**
     * §A.3.1 — the human name, owned by coordination's **account layer** and
     * keyed by `device_id`. The tower does not know its own label; it is not in
     * the hello, and it MAY change without touching hardware.
     */
    label: string;
    /** §A.3.2 — **always current.** Coordination watches the WSS link itself. */
    link: LinkState;
    /**
     * §A.3.2 — when the camera `status` values were last confirmed. **Not** when
     * the request was served, and `null` before the first `tower.hello`.
     *
     * This SDK surfaces it faithfully and **does not interpret it**: computing
     * staleness, or applying a freshness threshold, is the dashboard's job. What
     * the SDK guarantees is that the field is present and parseable, so the
     * dashboard is never left deciding how old a reading is with nothing to go on.
     */
    as_of: Timestamp | null;
    /** §A.3 — per §A.2, projected. MAY be empty. */
    cameras: CameraInfo[];
    /** §A.9 — reserved. MAY be empty, but is **present even when empty**. */
    sensors: SensorInfo[];
    /**
     * §A.3.3 — narrowed out of the required set, **not forbidden**. §4.2.3 still
     * serves these; the dashboard has no use for them today, and a required field
     * with no consumer is a field that ossifies. Read them if they are there.
     */
    agent_version?: string;
    capabilities?: string[];
    last_seen?: Timestamp | null;
    health?: TowerHealth;
    /**
     * §A.3.2 — when the CURRENT link came up.
     *
     * Not the enrolment date and not a cumulative total. Coordination builds a
     * link object per connection, so a tower that drops and reconnects gets a
     * fresh one — which means a SHORT value here is itself the reading: it says
     * the tower is flapping, and a cumulative uptime would hide exactly that.
     *
     * **Absent while the tower is offline**, because there is no current link to
     * have started. A consumer must show that as "not connected" rather than
     * carrying the last known value forward, which would report a link that is
     * not up.
     */
    connected_at?: Timestamp;
}
/** `200` body of `GET /v1/viewer/towers` (§4.2.3). */
export interface TowerListResponse {
    /**
     * Only the towers this viewer is permitted (§8). A viewer with none gets an
     * empty list and a `200` — never a `403`.
     */
    towers: TowerInfo[];
}
/**
 * `200` body of `GET /v1/viewer/towers/{device_id}` (§4.2.3) — one tower with
 * its health.
 *
 * `health` is the **merged** view: `tower.hello` carries a full block and
 * `tower.state` (§3.4) pushes only what changed, and §4.2.3 requires
 * coordination to merge rather than make a viewer reassemble fleet state from
 * fragments it never received.
 */
export interface TowerDetail extends TowerInfo {
    health: TowerHealth;
    /**
     * When the **sensor** values were last updated — not when the request was
     * served.
     *
     * §A.3.2 keeps this distinct from `as_of`: `as_of` stamps the camera
     * statuses, `health_as_of` stamps the sensor block (door · cover · impact ·
     * thermal · disk). In practice both are set from the same tower report and
     * will usually carry the same instant. They stay separate because the two
     * payloads are served by different endpoints and one may be refreshed without
     * the other — merging them is a reasonable future simplification, not
     * something to assume today.
     */
    health_as_of: Timestamp | null;
}
/** §3.1 `health.door` — tamper sensor. */
export interface DoorHealth {
    open: boolean;
    since?: Timestamp;
}
/** §3.1 `health.cover` — tamper sensor. */
export interface CoverHealth {
    exposed: boolean;
    since?: Timestamp;
}
/** §3.1 `health.impact` — `last_delta_mg` is `null` when nothing is recorded. */
export interface ImpactHealth {
    last_delta_mg: number | null;
    at?: Timestamp;
}
export type ThermalState = "ok" | "warn" | "critical" | (string & {});
/** §3.1 `health.thermal` — SoC temperature. */
export interface ThermalHealth {
    soc_c: number | null;
    state?: ThermalState;
}
/**
 * §3.1 `health.disk` — the tower's recordings volume.
 *
 * `free_pct` is the protocol's field and is always present when a tower reports
 * a disk at all. The gigabyte pair is ADDITIVE and optional: an agent that
 * predates it sends only the percentage, and a consumer must keep working on
 * that alone.
 *
 * ⚠ THEY ARE NOT SUBSTITUTES FOR ONE ANOTHER. "68% free" and "41 of 128 GB"
 * answer different questions, and a percentage of an unknown total cannot be
 * rendered where a reading in gigabytes was promised. Show whichever you have;
 * never convert one into a claim about the other.
 */
export interface DiskHealth {
    free_pct: number;
    /** Used space, gigabytes. Absent from an agent that reports only a percentage. */
    used_gb?: number;
    /** Total capacity, gigabytes. Absent likewise. */
    total_gb?: number;
}
/**
 * §3.1 `health.feeds[]` / §3.4 — per-path liveness. `since` appears on the
 * unsolicited `tower.state` push when a feed changes state.
 */
export interface FeedHealth {
    path: string;
    live: boolean;
    since?: Timestamp;
}
/**
 * The Bayana sensor set, carried into v2 unchanged (§3.1 `health`,
 * architecture §7). Every member is optional: `tower.state` (§3.4) pushes
 * **partial** health — only what changed — so a consumer must merge, not
 * replace.
 */
/**
 * §3.1 — how good the tower's link to the world is.
 *
 * ⚠ A READING, NOT A GRADE. `signal_dbm` is a raw RSSI in dBm, always negative,
 * exactly as the tower measured it. Neither the tower nor coordination computes
 * Great/Fair/Poor, and neither should: a grade decided upstream freezes one
 * opinion of "acceptable" into every viewer in the fleet and needs a firmware
 * change to revise. **The consumer interprets** — the same split this SDK
 * already applies to `as_of`, which it surfaces without deciding what is stale.
 *
 * The three absences are separate claims and must not be collapsed:
 *
 *  - `type: "ethernet"` — wired. There is no RSSI to have, and a grade here
 *    would be a lie about hardware that is working perfectly.
 *  - `associated: false` — a radio that is up but joined to nothing. Not wired,
 *    and not a signal.
 *  - the whole object absent — not measured. Never render a grade for this.
 *
 * There is deliberately no `iface`: coordination strips the interface name as a
 * routing internal (§A.6), so it never arrives and is not typed here.
 */
export interface UplinkHealth {
    /** Raw RSSI in dBm. Negative. Absent for a wired or unassociated link. */
    signal_dbm?: number;
    /** e.g. `"ethernet"`. Open, because the set of link types is the tower's. */
    type?: string;
    /** `false` when the radio is up but joined to nothing. */
    associated?: boolean;
}
/**
 * §3.1 `health.battery` — the tower's LiFePO4 pack, read over BLE.
 *
 * ⚠ `reachable` IS THE ONLY REQUIRED FIELD, and that is deliberate rather than
 * lax. The pack accepts exactly ONE BLE connection, so a tower is regularly
 * unable to read its own battery — an operator with the vendor's phone app open
 * is enough. That is a normal state, not an error, and it has to be
 * representable without any readings at all.
 *
 * ⚠ THE READINGS ARE PRESENT ONLY WHEN `reachable` IS TRUE. When it is false
 * they are ABSENT, not stale, not zero, not last-known-good. Do not fall back
 * to a previous value behind this flag: "the battery was 40% the last time
 * anyone could ask" is not a charge level, and drawing it as one is the exact
 * failure this shape exists to prevent.
 *
 * ⚠ `soc_pct` IS STATE OF CHARGE. `ThermalHealth.soc_c` three fields up is the
 * System-on-Chip's die TEMPERATURE. Two unrelated quantities, one abbreviation,
 * in the same health block.
 */
export interface BatteryHealth {
    /** Whether the tower could read the pack at all. Always present. */
    reachable: boolean;
    /** When the reading was taken. Staleness is the consumer's to judge. */
    as_of?: string;
    /** State of charge, percent. Absent unless `reachable`. */
    soc_pct?: number;
    /** Pack voltage. Absent unless `reachable`. */
    voltage_v?: number;
    /** Amps; positive is charging, negative is discharging. Absent unless `reachable`. */
    current_a?: number;
    /** Pack temperature, °C — NOT the processor's (`thermal.soc_c`). */
    temp_c?: number;
}
export interface TowerHealth {
    door?: DoorHealth;
    cover?: CoverHealth;
    impact?: ImpactHealth;
    thermal?: ThermalHealth;
    disk?: DiskHealth;
    feeds?: FeedHealth[];
    uplink?: UplinkHealth;
    battery?: BatteryHealth;
}
/** §3.4 `tower.state.reason` — why an unsolicited health push was sent. */
export type TowerStateReason = "feed_lost" | "feed_restored" | "tamper" | "thermal" | "disk" | "mediamtx_restart" | "ptz_unavailable" | "manual";
/** §3.4 — an unsolicited state change, as it would reach a fleet board. */
export interface TowerStateEvent {
    device_id?: DeviceId;
    reason: TowerStateReason;
    health: TowerHealth;
    ts?: Timestamp;
}
/**
 * Wire-level error codes (§7.1 registry, plus the three the viewer-facing HTTPS
 * layer adds). The `(string & {})` arm keeps an unknown future code assignable
 * without losing autocomplete on the known ones.
 */
export type ApiErrorCode = "unknown_type" | "unsupported_version" | "malformed" | "unauthorized" | "invalid_request" | "grant_invalid" | "grant_wrong_tower" | "grant_expired" | "grant_scope" | "grant_permission" | "grant_replay" | "session_unknown" | "session_duplicate" | "camera_unknown" | "camera_offline" | "mediamtx_unavailable" | "whep_failed" | "ptz_unavailable" | "rate_limited" | "internal" | "tower_offline" | "tower_timeout" | "not_authorized" | "tower_unknown" | "invalid_label" | (string & {});
/** The `error` object inside the envelope (§4.2, §7.1). */
export interface ApiError {
    code: ApiErrorCode;
    message: string;
}
/**
 * The one error envelope used everywhere (§4.2):
 * `{ "error": { "code": "tower_offline", "message": "..." } }`
 */
export interface ApiErrorEnvelope {
    error: ApiError;
}
/**
 * **DEFERRED — not built.** Recording and playback have no shapes here on
 * purpose.
 *
 * §9 lists `recording.request` / `recording.chunk` as *reserved, rejected at
 * v1*, and `permissions: ["recordings","arm"]` as *defined, unused*. The
 * architecture addendum (§15) records that egress transport is unresolved and
 * that `RECORD_ENABLE=0` on both towers, so **no segments exist yet**.
 *
 * Modelling a playback API against a protocol that rejects its messages would
 * be inventing a contract, not implementing one. When §17 is specified the
 * shapes land here, and `GrantPermission` already has the word for them.
 */
export type RecordingPlaybackDeferred = never;
//# sourceMappingURL=models.d.ts.map