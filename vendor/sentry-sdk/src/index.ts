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

export { SentryClient, clampMove } from "./client.js";
export type {
  CreateSessionOptions,
  SentryClientOptions,
  SessionRef,
} from "./client.js";

export { HttpTransport } from "./http.js";
export type {
  AbortSignalLike,
  FetchInitLike,
  FetchLike,
  FetchResponseLike,
  HttpOptions,
  RequestOptions,
  TokenProvider,
} from "./http.js";

export {
  AuthError,
  GrantError,
  InvalidRequestError,
  MediaError,
  NetworkError,
  NotFoundError,
  ProjectionLeakError,
  PtzError,
  RateLimitedError,
  RequestAbortedError,
  RequestTimeoutError,
  SentryError,
  ServerError,
  SessionConflictError,
  TowerOfflineError,
  TowerTimeoutError,
  ValidationError,
  describeError,
  errorFromEnvelope,
  isNormalPtzOutcome,
  isPtzPermissionDenied,
  isSentryErrorCode,
  isSessionEnded,
} from "./errors.js";

export {
  assertNoProjectionLeak,
  parseCameraInfo,
  parseIceCandidates,
  parsePtzResult,
  parseTowerDetail,
  parseTowerHealth,
  parseTowerInfo,
  parseTowerList,
  parseSessionStatus,
  parseViewerSession,
  ValidationCheck,
} from "./validate.js";
export type { ValidateContext } from "./validate.js";

export { PTZ_DEADMAN_MS, PTZ_KEEPALIVE_MS } from "./models.js";
export type {
  ApiError,
  ApiErrorCode,
  ApiErrorEnvelope,
  CameraIndex,
  CameraInfo,
  CameraLens,
  CameraResolution,
  CameraRole,
  CameraStatus,
  CoverHealth,
  CreateSessionRequest,
  DeviceId,
  DiskHealth,
  DoorHealth,
  FeedHealth,
  GrantPermission,
  GrantRole,
  IceCandidate,
  IceCandidatesRequest,
  IceCandidatesResponse,
  IceServer,
  ImpactHealth,
  LinkState,
  PtzAction,
  PtzAxes,
  PtzCommand,
  PtzErrorCode,
  PtzMoveMode,
  PtzMoveParams,
  PtzResult,
  PtzSetHomeResult,
  RecordingSpan,
  RecordingWindow,
  ArchivedSegment,
  ArchivedRecordingList,
  PtzStatusResult,
  HomeSource,
  PtzStopParams,
  RecordingPlaybackDeferred,
  SensorInfo,
  SessionCloseReason,
  SessionId,
  ThermalHealth,
  ThermalState,
  Timestamp,
  TowerDetail,
  TowerHealth,
  TowerInfo,
  TowerListResponse,
  TowerStateEvent,
  TowerStateReason,
  ViewerSession,
  ViewerSessionStatus,
} from "./models.js";

/** Protocol version this SDK is written against (§2.2 `v`). */
export const PROTOCOL_VERSION = 1;

/** Base path of the viewer-facing API (§4.2). One versioned base URL, as v1 had. */
export const API_PREFIX = "/v1";
