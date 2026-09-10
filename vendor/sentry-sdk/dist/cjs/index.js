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
exports.API_PREFIX = exports.PROTOCOL_VERSION = exports.PTZ_KEEPALIVE_MS = exports.PTZ_DEADMAN_MS = exports.ValidationCheck = exports.parseViewerSession = exports.parseSessionStatus = exports.parseTowerList = exports.parseTowerInfo = exports.parseTowerHealth = exports.parseTowerDetail = exports.parsePtzResult = exports.parseIceCandidates = exports.parseCameraInfo = exports.assertNoProjectionLeak = exports.isSessionEnded = exports.isSentryErrorCode = exports.isPtzPermissionDenied = exports.isNormalPtzOutcome = exports.errorFromEnvelope = exports.describeError = exports.ValidationError = exports.TowerTimeoutError = exports.TowerOfflineError = exports.SessionConflictError = exports.ServerError = exports.SentryError = exports.RequestTimeoutError = exports.RequestAbortedError = exports.RateLimitedError = exports.PtzError = exports.ProjectionLeakError = exports.NotFoundError = exports.NetworkError = exports.MediaError = exports.InvalidRequestError = exports.GrantError = exports.AuthError = exports.HttpTransport = exports.clampMove = exports.SentryClient = void 0;
var client_js_1 = require("./client.js");
Object.defineProperty(exports, "SentryClient", { enumerable: true, get: function () { return client_js_1.SentryClient; } });
Object.defineProperty(exports, "clampMove", { enumerable: true, get: function () { return client_js_1.clampMove; } });
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
Object.defineProperty(exports, "isSentryErrorCode", { enumerable: true, get: function () { return errors_js_1.isSentryErrorCode; } });
Object.defineProperty(exports, "isSessionEnded", { enumerable: true, get: function () { return errors_js_1.isSessionEnded; } });
var validate_js_1 = require("./validate.js");
Object.defineProperty(exports, "assertNoProjectionLeak", { enumerable: true, get: function () { return validate_js_1.assertNoProjectionLeak; } });
Object.defineProperty(exports, "parseCameraInfo", { enumerable: true, get: function () { return validate_js_1.parseCameraInfo; } });
Object.defineProperty(exports, "parseIceCandidates", { enumerable: true, get: function () { return validate_js_1.parseIceCandidates; } });
Object.defineProperty(exports, "parsePtzResult", { enumerable: true, get: function () { return validate_js_1.parsePtzResult; } });
Object.defineProperty(exports, "parseTowerDetail", { enumerable: true, get: function () { return validate_js_1.parseTowerDetail; } });
Object.defineProperty(exports, "parseTowerHealth", { enumerable: true, get: function () { return validate_js_1.parseTowerHealth; } });
Object.defineProperty(exports, "parseTowerInfo", { enumerable: true, get: function () { return validate_js_1.parseTowerInfo; } });
Object.defineProperty(exports, "parseTowerList", { enumerable: true, get: function () { return validate_js_1.parseTowerList; } });
Object.defineProperty(exports, "parseSessionStatus", { enumerable: true, get: function () { return validate_js_1.parseSessionStatus; } });
Object.defineProperty(exports, "parseViewerSession", { enumerable: true, get: function () { return validate_js_1.parseViewerSession; } });
Object.defineProperty(exports, "ValidationCheck", { enumerable: true, get: function () { return validate_js_1.ValidationCheck; } });
var models_js_1 = require("./models.js");
Object.defineProperty(exports, "PTZ_DEADMAN_MS", { enumerable: true, get: function () { return models_js_1.PTZ_DEADMAN_MS; } });
Object.defineProperty(exports, "PTZ_KEEPALIVE_MS", { enumerable: true, get: function () { return models_js_1.PTZ_KEEPALIVE_MS; } });
/** Protocol version this SDK is written against (§2.2 `v`). */
exports.PROTOCOL_VERSION = 1;
/** Base path of the viewer-facing API (§4.2). One versioned base URL, as v1 had. */
exports.API_PREFIX = "/v1";
//# sourceMappingURL=index.js.map