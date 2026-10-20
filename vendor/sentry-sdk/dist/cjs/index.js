"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PROTOCOL_VERSION = exports.SWEEP_SECONDS_MIN = exports.SWEEP_SECONDS_MAX = exports.PTZ_STEP_DEG_MIN = exports.PTZ_STEP_DEG_MAX = exports.PTZ_KEEPALIVE_MS = exports.PTZ_DEADMAN_MS = exports.PTZ_CLICK_MS = exports.ValidationCheck = exports.parseViewerSession = exports.parseSessionStatus = exports.parseTowerList = exports.parseTowerInfo = exports.parseTowerHealth = exports.parseTowerDetail = exports.sweepOf = exports.parseSweepStatus = exports.parsePtzResult = exports.parseIceCandidates = exports.parseCameraInfo = exports.assertNoProjectionLeak = exports.isSessionEnded = exports.isSentryErrorCode = exports.isPtzYielded = exports.isPtzPermissionDenied = exports.isNormalPtzOutcome = exports.errorFromEnvelope = exports.describeError = exports.ValidationError = exports.TowerTimeoutError = exports.TowerOfflineError = exports.SessionConflictError = exports.ServerError = exports.SentryError = exports.RequestTimeoutError = exports.RequestAbortedError = exports.RateLimitedError = exports.PtzYieldedError = exports.PtzError = exports.ProjectionLeakError = exports.NotFoundError = exports.NetworkError = exports.MediaError = exports.InvalidRequestError = exports.GrantError = exports.AuthError = exports.HttpTransport = exports.clampStep = exports.clampMove = exports.SentryClient = void 0;
exports.parseSiteList = exports.parseSiteDetail = exports.parseShareList = exports.parseShare = exports.parseRemoveTower = exports.parsePeopleList = exports.parseMoveCell = exports.parseCellList = exports.parseCellDetail = exports.parseCapabilities = exports.parseAudit = exports.parseAddDevice = exports.isShareLive = exports.isAdminRole = exports.SHARE_MESSAGE_MAX = exports.SHARE_DEFAULT_SEC = exports.API_PREFIX = void 0;
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "SentryClient", { enumerable: true, get: function () { return client_js_1.SentryClient; } });
Object.defineProperty(exports, "clampMove", { enumerable: true, get: function () { return client_js_1.clampMove; } });
Object.defineProperty(exports, "clampStep", { enumerable: true, get: function () { return client_js_1.clampStep; } });
var http_js_1 = require("./http.js");
Object.defineProperty(exports, "HttpTransport", { enumerable: true, get: function () { return http_js_1.HttpTransport; } });
var errors_js_1 = require("./errors.js");
Object.defineProperty(exports, "AuthError", { enumerable: true, get: function () { return errors_js_1.AuthError; } });
Object.defineProperty(exports, "GrantError", { enumerable: true, get: function () { return errors_js_1.GrantError; } });
Object.defineProperty(exports, "InvalidRequestError", { enumerable: true, get: function () { return errors_js_1.InvalidRequestError; } });
Object.defineProperty(exports, "MediaError", { enumerable: true, get: function () { return errors_js_1.MediaError; } });
Object.defineProperty(exports, "NetworkError", { enumerable: true, get: function () { return errors_js_1.NetworkError; } });
Object.defineProperty(exports, "NotFoundError", { enumerable: true, get: function () { return errors_js_1.NotFoundError; } });
Object.defineProperty(exports, "ProjectionLeakError", { enumerable: true, get: function () { return errors_js_1.ProjectionLeakError; } });
Object.defineProperty(exports, "PtzError", { enumerable: true, get: function () { return errors_js_1.PtzError; } });
Object.defineProperty(exports, "PtzYieldedError", { enumerable: true, get: function () { return errors_js_1.PtzYieldedError; } });
Object.defineProperty(exports, "RateLimitedError", { enumerable: true, get: function () { return errors_js_1.RateLimitedError; } });
Object.defineProperty(exports, "RequestAbortedError", { enumerable: true, get: function () { return errors_js_1.RequestAbortedError; } });
Object.defineProperty(exports, "RequestTimeoutError", { enumerable: true, get: function () { return errors_js_1.RequestTimeoutError; } });
Object.defineProperty(exports, "SentryError", { enumerable: true, get: function () { return errors_js_1.SentryError; } });
Object.defineProperty(exports, "ServerError", { enumerable: true, get: function () { return errors_js_1.ServerError; } });
Object.defineProperty(exports, "SessionConflictError", { enumerable: true, get: function () { return errors_js_1.SessionConflictError; } });
Object.defineProperty(exports, "TowerOfflineError", { enumerable: true, get: function () { return errors_js_1.TowerOfflineError; } });
Object.defineProperty(exports, "TowerTimeoutError", { enumerable: true, get: function () { return errors_js_1.TowerTimeoutError; } });
Object.defineProperty(exports, "ValidationError", { enumerable: true, get: function () { return errors_js_1.ValidationError; } });
Object.defineProperty(exports, "describeError", { enumerable: true, get: function () { return errors_js_1.describeError; } });
Object.defineProperty(exports, "errorFromEnvelope", { enumerable: true, get: function () { return errors_js_1.errorFromEnvelope; } });
Object.defineProperty(exports, "isNormalPtzOutcome", { enumerable: true, get: function () { return errors_js_1.isNormalPtzOutcome; } });
Object.defineProperty(exports, "isPtzPermissionDenied", { enumerable: true, get: function () { return errors_js_1.isPtzPermissionDenied; } });
Object.defineProperty(exports, "isPtzYielded", { enumerable: true, get: function () { return errors_js_1.isPtzYielded; } });
Object.defineProperty(exports, "isSentryErrorCode", { enumerable: true, get: function () { return errors_js_1.isSentryErrorCode; } });
Object.defineProperty(exports, "isSessionEnded", { enumerable: true, get: function () { return errors_js_1.isSessionEnded; } });
var validate_js_1 = require("./validate.js");
Object.defineProperty(exports, "assertNoProjectionLeak", { enumerable: true, get: function () { return validate_js_1.assertNoProjectionLeak; } });
Object.defineProperty(exports, "parseCameraInfo", { enumerable: true, get: function () { return validate_js_1.parseCameraInfo; } });
Object.defineProperty(exports, "parseIceCandidates", { enumerable: true, get: function () { return validate_js_1.parseIceCandidates; } });
Object.defineProperty(exports, "parsePtzResult", { enumerable: true, get: function () { return validate_js_1.parsePtzResult; } });
Object.defineProperty(exports, "parseSweepStatus", { enumerable: true, get: function () { return validate_js_1.parseSweepStatus; } });
Object.defineProperty(exports, "sweepOf", { enumerable: true, get: function () { return validate_js_1.sweepOf; } });
Object.defineProperty(exports, "parseTowerDetail", { enumerable: true, get: function () { return validate_js_1.parseTowerDetail; } });
Object.defineProperty(exports, "parseTowerHealth", { enumerable: true, get: function () { return validate_js_1.parseTowerHealth; } });
Object.defineProperty(exports, "parseTowerInfo", { enumerable: true, get: function () { return validate_js_1.parseTowerInfo; } });
Object.defineProperty(exports, "parseTowerList", { enumerable: true, get: function () { return validate_js_1.parseTowerList; } });
Object.defineProperty(exports, "parseSessionStatus", { enumerable: true, get: function () { return validate_js_1.parseSessionStatus; } });
Object.defineProperty(exports, "parseViewerSession", { enumerable: true, get: function () { return validate_js_1.parseViewerSession; } });
Object.defineProperty(exports, "ValidationCheck", { enumerable: true, get: function () { return validate_js_1.ValidationCheck; } });
var models_js_1 = require("./models.js");
Object.defineProperty(exports, "PTZ_CLICK_MS", { enumerable: true, get: function () { return models_js_1.PTZ_CLICK_MS; } });
Object.defineProperty(exports, "PTZ_DEADMAN_MS", { enumerable: true, get: function () { return models_js_1.PTZ_DEADMAN_MS; } });
Object.defineProperty(exports, "PTZ_KEEPALIVE_MS", { enumerable: true, get: function () { return models_js_1.PTZ_KEEPALIVE_MS; } });
Object.defineProperty(exports, "PTZ_STEP_DEG_MAX", { enumerable: true, get: function () { return models_js_1.PTZ_STEP_DEG_MAX; } });
Object.defineProperty(exports, "PTZ_STEP_DEG_MIN", { enumerable: true, get: function () { return models_js_1.PTZ_STEP_DEG_MIN; } });
Object.defineProperty(exports, "SWEEP_SECONDS_MAX", { enumerable: true, get: function () { return models_js_1.SWEEP_SECONDS_MAX; } });
Object.defineProperty(exports, "SWEEP_SECONDS_MIN", { enumerable: true, get: function () { return models_js_1.SWEEP_SECONDS_MIN; } });
/** Protocol version this SDK is written against (§2.2 `v`). */
exports.PROTOCOL_VERSION = 1;
/** Base path of the viewer-facing API (§4.2). One versioned base URL, as v1 had. */
exports.API_PREFIX = "/v1";
/* ------------------------------------------------------------------ *
 * Sites, people and sharing
 * ------------------------------------------------------------------ */
var sites_js_1 = require("./sites.js");
Object.defineProperty(exports, "SHARE_DEFAULT_SEC", { enumerable: true, get: function () { return sites_js_1.SHARE_DEFAULT_SEC; } });
Object.defineProperty(exports, "SHARE_MESSAGE_MAX", { enumerable: true, get: function () { return sites_js_1.SHARE_MESSAGE_MAX; } });
Object.defineProperty(exports, "isAdminRole", { enumerable: true, get: function () { return sites_js_1.isAdminRole; } });
Object.defineProperty(exports, "isShareLive", { enumerable: true, get: function () { return sites_js_1.isShareLive; } });
Object.defineProperty(exports, "parseAddDevice", { enumerable: true, get: function () { return sites_js_1.parseAddDevice; } });
Object.defineProperty(exports, "parseAudit", { enumerable: true, get: function () { return sites_js_1.parseAudit; } });
Object.defineProperty(exports, "parseCapabilities", { enumerable: true, get: function () { return sites_js_1.parseCapabilities; } });
Object.defineProperty(exports, "parseCellDetail", { enumerable: true, get: function () { return sites_js_1.parseCellDetail; } });
Object.defineProperty(exports, "parseCellList", { enumerable: true, get: function () { return sites_js_1.parseCellList; } });
Object.defineProperty(exports, "parseMoveCell", { enumerable: true, get: function () { return sites_js_1.parseMoveCell; } });
Object.defineProperty(exports, "parsePeopleList", { enumerable: true, get: function () { return sites_js_1.parsePeopleList; } });
Object.defineProperty(exports, "parseRemoveTower", { enumerable: true, get: function () { return sites_js_1.parseRemoveTower; } });
Object.defineProperty(exports, "parseShare", { enumerable: true, get: function () { return sites_js_1.parseShare; } });
Object.defineProperty(exports, "parseShareList", { enumerable: true, get: function () { return sites_js_1.parseShareList; } });
Object.defineProperty(exports, "parseSiteDetail", { enumerable: true, get: function () { return sites_js_1.parseSiteDetail; } });
Object.defineProperty(exports, "parseSiteList", { enumerable: true, get: function () { return sites_js_1.parseSiteList; } });
//# sourceMappingURL=index.js.map