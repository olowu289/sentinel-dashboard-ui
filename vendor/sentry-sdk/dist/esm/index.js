/**
 * `@kallon/sentry-sdk` — typed client and data contract for the Sentry v2
 * coordination service.
 *
 * Source of truth: `sentry-core/docs/session-protocol.md` (protocol v1).
 * Scope: the viewer-facing HTTPS API of §4.2, plus the shapes a viewer needs.
 * Out of scope, deliberately: WebRTC itself (the dashboard drives the peer
 * connection), the tower WSS link (§1–§3 is tower ↔ coordination), and
 * recording/playback (§9 — deferred, and unspecified).
 */
export { SentryClient, clampMove, clampStep } from "./client.js";
export { HttpTransport } from "./http.js";
export { AuthError, GrantError, InvalidRequestError, MediaError, NetworkError, NotFoundError, ProjectionLeakError, PtzError, PtzYieldedError, RateLimitedError, RequestAbortedError, RequestTimeoutError, SentryError, ServerError, SessionConflictError, TowerOfflineError, TowerTimeoutError, ValidationError, describeError, errorFromEnvelope, isNormalPtzOutcome, isPtzPermissionDenied, isPtzYielded, isSentryErrorCode, isSessionEnded, } from "./errors.js";
export { assertNoProjectionLeak, parseCameraInfo, parseIceCandidates, parsePtzResult, parseSweepStatus, sweepOf, parseTowerDetail, parseTowerHealth, parseTowerInfo, parseTowerList, parseSessionStatus, parseViewerSession, ValidationCheck, } from "./validate.js";
export { PTZ_CLICK_MS, PTZ_DEADMAN_MS, PTZ_KEEPALIVE_MS, PTZ_STEP_DEG_MAX, PTZ_STEP_DEG_MIN, SWEEP_SECONDS_MAX, SWEEP_SECONDS_MIN, } from "./models.js";
/** Protocol version this SDK is written against (§2.2 `v`). */
export const PROTOCOL_VERSION = 1;
/** Base path of the viewer-facing API (§4.2). One versioned base URL, as v1 had. */
export const API_PREFIX = "/v1";
/* ------------------------------------------------------------------ *
 * Sites, people and sharing
 * ------------------------------------------------------------------ */
export { isAdminRole, isShareLive, parseAudit, parseCapabilities, parsePeopleList, parseShare, parseShareList, parseSiteDetail, parseSiteList, } from "./sites.js";
//# sourceMappingURL=index.js.map