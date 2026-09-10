/**
 * Typed exception hierarchy over the `{error:{code,message}}` envelope (§4.2,
 * §7.1).
 *
 * The pattern is carried over from v1 — one envelope, one exception class per
 * meaningful failure mode — because it is the part of v1's SDK that consistently
 * paid off: `catch (e) { if (e instanceof TowerOfflineError) ... }` beats
 * inspecting status codes at every call site.
 *
 * Every error carries the raw `code` and the HTTP `status`, so a consumer can
 * always fall back to the wire values when a new code appears that this file
 * predates.
 */

import type { ApiError, ApiErrorCode, SessionId } from "./models.js";

/** Base class. Every failure this SDK raises is an instance of this. */
export class SentryError extends Error {
  /** The wire code from `{error:{code}}`, or a synthetic client-side code. */
  readonly code: ApiErrorCode;
  /** HTTP status, or `0` for a failure that never reached a response. */
  readonly status: number;
  /** Request path that produced this, for logs. Never contains credentials. */
  readonly path?: string;
  /** The parsed envelope, when the server sent one. */
  readonly apiError?: ApiError;

  constructor(
    message: string,
    opts: {
      code: ApiErrorCode;
      status?: number;
      path?: string;
      apiError?: ApiError;
      cause?: unknown;
    },
  ) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = opts.code;
    this.status = opts.status ?? 0;
    this.path = opts.path;
    this.apiError = opts.apiError;
    // Preserve `instanceof` across the ES5 downlevel some bundlers still apply.
    Object.setPrototypeOf(this, new.target.prototype);
  }

  /**
   * True when retrying the same call unchanged could plausibly succeed.
   *
   * Deliberately narrow. §7.6 is emphatic that an absent tower is an *answer,
   * not a wait* — so `tower_offline` is **not** retryable here, and a UI should
   * surface it rather than spin. v1 lost eight days to exactly that mistake.
   */
  get retryable(): boolean {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Transport / client-side failures (never reached a response)
 * ------------------------------------------------------------------ */

/** `fetch` itself failed: DNS, TLS, connection refused, CORS. */
export class NetworkError extends SentryError {
  constructor(message: string, opts: { path?: string; cause?: unknown } = {}) {
    super(message, { code: "network_error", status: 0, ...opts });
  }
  override get retryable(): boolean {
    return true;
  }
}

/**
 * The SDK's own `AbortController` fired before the server answered.
 *
 * Distinct from {@link TowerTimeoutError}, which is the server telling you the
 * *tower* did not answer within its 10 s budget (§4.2).
 */
export class RequestTimeoutError extends SentryError {
  readonly timeoutMs: number;
  constructor(message: string, opts: { timeoutMs: number; path?: string; cause?: unknown }) {
    super(message, { code: "request_timeout", status: 0, path: opts.path, cause: opts.cause });
    this.timeoutMs = opts.timeoutMs;
  }
  override get retryable(): boolean {
    return true;
  }
}

/** The caller's own `AbortSignal` was aborted. Not a fault; not retryable. */
export class RequestAbortedError extends SentryError {
  constructor(message = "request aborted by caller", opts: { path?: string; cause?: unknown } = {}) {
    super(message, { code: "request_aborted", status: 0, ...opts });
  }
}

/**
 * A response was received but did not match the documented shape.
 *
 * v1 had no runtime validation at all — types were erased and every body was a
 * blind cast, so a contract drift surfaced as `undefined` somewhere deep in the
 * dashboard. This error is what replaces that silence.
 */
export class ValidationError extends SentryError {
  /** Human-readable field paths that failed, e.g. `ice_servers[0].urls`. */
  readonly issues: string[];
  constructor(
    message: string,
    opts: { issues: string[]; status?: number; path?: string; code?: ApiErrorCode },
  ) {
    super(message, {
      code: opts.code ?? "response_invalid",
      status: opts.status ?? 0,
      path: opts.path,
    });
    this.issues = opts.issues;
  }
}

/**
 * A projected inventory document carried a field §A.6 says MUST NOT ever reach
 * a viewer: `path`, `whep_path` or `boot_id`, anywhere in the document.
 *
 * **This is the one deliberate exception to unknown-field tolerance.** The SDK
 * otherwise passes unknown fields through untouched, because §2.2 and §A.9 make
 * forward compatibility explicit and a validator that rejects a field added
 * last week turns a compatible change into an outage. These three are
 * different: §A.6 puts them in a hard MUST-NOT tier and requires the consumer
 * to **reject a projection containing any of them** — a leak is a coordination
 * bug, and §A.6's words are that it "must be loud at the door, never silently
 * ignored".
 *
 * `path` and `whep_path` are loopback media-plane addresses a viewer that never
 * speaks WHEP has no use for. `boot_id` is link-layer plumbing that leaks
 * restart timing for a physical asset in the field, and §A.13 records the
 * ruling that moved it out of the SHOULD tier into this one.
 *
 * Subclasses {@link ValidationError}, so a handler that already catches
 * validation failures still catches this — while code that wants to page
 * someone about a contract violation can catch it specifically.
 */
export class ProjectionLeakError extends ValidationError {
  /** The leaked field paths, e.g. `towers[0].cameras[1].path`. */
  readonly leaked: string[];
  constructor(message: string, opts: { leaked: string[]; status?: number; path?: string }) {
    super(message, {
      issues: opts.leaked,
      status: opts.status,
      path: opts.path,
      code: "projection_leak",
    });
    this.leaked = opts.leaked;
  }
}

/* ------------------------------------------------------------------ *
 * Server-side failures, by envelope code
 * ------------------------------------------------------------------ */

/** `unauthorized` · `not_authorized` — bad/absent viewer credential, or no grant for this tower+camera. */
export class AuthError extends SentryError {}

/** `invalid_request` · `malformed` · `unsupported_version` — the request was wrong. */
export class InvalidRequestError extends SentryError {}

/**
 * `session_unknown` · `camera_unknown` · `tower_unknown` · `not_found` — the
 * addressed thing does not exist.
 *
 * Note `tower_unknown` (§4.2.3) deliberately conflates "no such tower" with
 * "not yours", so that the inventory endpoints cannot be used to enumerate the
 * fleet. Do not tell a user the tower is missing — say it is unavailable.
 */
export class NotFoundError extends SentryError {}

/** `session_duplicate` (§7.5). */
export class SessionConflictError extends SentryError {}

/**
 * `tower_offline` (§4.2 `503`, §7.6).
 *
 * Not retryable on purpose: "A request to an absent tower is an answer, not a
 * wait." Surface it; do not queue behind it.
 */
export class TowerOfflineError extends SentryError {}

/**
 * `tower_timeout` (§4.2 `504`) — the tower did not answer within 10 s.
 *
 * Retryable, but note §7.5: a retried session **must** get a freshly-minted
 * grant, which is coordination's job. From the SDK's side that means retrying
 * the *offer*, not fabricating a new session id.
 */
export class TowerTimeoutError extends SentryError {
  override get retryable(): boolean {
    return true;
  }
}

/**
 * Any `grant_*` refusal (§6.3), relayed to the viewer as a `session.error`.
 *
 * The viewer never holds the grant, so these are never the viewer's fault to
 * fix: they are coordination or clock problems, and `grant_expired` in
 * particular means "start a new session" (§10.1).
 */
export class GrantError extends SentryError {}

/**
 * `mediamtx_unavailable` · `whep_failed` · `camera_offline` (§7.7) — the media
 * path on the tower failed. §7.7 forbids retry storms at this layer: one
 * attempt, one honest error.
 */
export class MediaError extends SentryError {}

/**
 * `ptz_unavailable`, and daemon-level PTZ failures (§5.2).
 *
 * `SUPERSEDED` is a **normal** outcome for a rapid tap or direction change and
 * MUST NOT be surfaced as a fault — check {@link isNormalPtzOutcome} before
 * showing anything to a user.
 */
export class PtzError extends SentryError {}

/** `rate_limited` (§7.8). Bound your PTZ command rate; the limit is per session. */
export class RateLimitedError extends SentryError {
  override get retryable(): boolean {
    return true;
  }
}

/** `internal`, or any 5xx without a recognised code. */
export class ServerError extends SentryError {
  override get retryable(): boolean {
    return true;
  }
}

/* ------------------------------------------------------------------ *
 * Mapping
 * ------------------------------------------------------------------ */

type ErrorCtor = new (message: string, opts: {
  code: ApiErrorCode;
  status?: number;
  path?: string;
  apiError?: ApiError;
  cause?: unknown;
}) => SentryError;

/** Wire code → exception class (§7.1 registry, plus the viewer-facing three). */
const BY_CODE: Record<string, ErrorCtor> = {
  // auth
  unauthorized: AuthError,
  not_authorized: AuthError,
  // request
  invalid_request: InvalidRequestError,
  // The rename route refuses a bad label with its own code. Mapped explicitly
  // rather than left to the 422 status fallback, so the class stays right even
  // if the server ever answers it with a different status.
  invalid_label: InvalidRequestError,
  malformed: InvalidRequestError,
  unsupported_version: InvalidRequestError,
  unknown_type: InvalidRequestError,
  // addressing
  session_unknown: NotFoundError,
  camera_unknown: NotFoundError,
  tower_unknown: NotFoundError,
  not_found: NotFoundError,
  session_duplicate: SessionConflictError,
  // tower reachability
  tower_offline: TowerOfflineError,
  tower_timeout: TowerTimeoutError,
  // grants (§6.3)
  grant_invalid: GrantError,
  grant_wrong_tower: GrantError,
  grant_expired: GrantError,
  grant_scope: GrantError,
  grant_permission: GrantError,
  grant_replay: GrantError,
  // media (§7.7)
  mediamtx_unavailable: MediaError,
  whep_failed: MediaError,
  camera_offline: MediaError,
  // ptz (§5.2)
  ptz_unavailable: PtzError,
  BUSY: PtzError,
  SUPERSEDED: PtzError,
  ZONE_NOT_FOUND: PtzError,
  BAD_REQUEST: PtzError,
  // misc
  rate_limited: RateLimitedError,
  internal: ServerError,
};

/** Status fallback for a response whose code this SDK does not know. */
function ctorForStatus(status: number): ErrorCtor {
  if (status === 401 || status === 403) return AuthError;
  if (status === 404) return NotFoundError;
  if (status === 409) return SessionConflictError;
  if (status === 422 || status === 400) return InvalidRequestError;
  if (status === 429) return RateLimitedError;
  if (status === 503) return TowerOfflineError;
  if (status === 504) return TowerTimeoutError;
  if (status >= 500) return ServerError;
  return SentryError as ErrorCtor;
}

/**
 * Build the right exception for a parsed error envelope.
 *
 * `code` wins over `status`, because the code is the protocol's own vocabulary
 * and the status is HTTP's approximation of it. A `502` carrying
 * `grant_expired` is a {@link GrantError}, not a {@link ServerError} — and the
 * stub does exactly that when it relays a tower's `session.error`.
 */
export function errorFromEnvelope(
  apiError: ApiError,
  opts: { status: number; path?: string },
): SentryError {
  const Ctor = BY_CODE[apiError.code] ?? ctorForStatus(opts.status);
  return new Ctor(apiError.message || apiError.code, {
    code: apiError.code,
    status: opts.status,
    path: opts.path,
    apiError,
  });
}

/**
 * `SUPERSEDED` is what a rapid tap or a direction change produces, and §5.2
 * says plainly it "MUST NOT be surfaced as a fault". Anything driving a PTZ UI
 * should route through this before it renders an error.
 */
export function isNormalPtzOutcome(err: unknown): boolean {
  return err instanceof SentryError && err.code === "SUPERSEDED";
}

/** True when `err` is this SDK's error carrying the given wire code. */
export function isSentryErrorCode(err: unknown, code: ApiErrorCode): boolean {
  return err instanceof SentryError && err.code === code;
}

/**
 * True for the specific PTZ refusal of §A.8 — `403 grant_permission`.
 *
 * §A.8's behaviour of record: controls **render** on `ptz_capable` (a hardware
 * capability, safe to read from inventory), and flip to a disabled "view only"
 * state for the session when a command comes back `grant_permission`. Whether
 * this viewer may drive PTZ lives in the grant, which the viewer never
 * receives, so issuing a command and catching this is the only way to learn it.
 *
 * Narrower than `err instanceof GrantError` on purpose: that class also covers
 * `grant_expired` and `grant_replay`, and flipping a camera to view-only
 * because a grant aged out would be wrong — that case wants a new session
 * ({@link isSessionEnded}), not a disabled control.
 */
export function isPtzPermissionDenied(err: unknown): boolean {
  return err instanceof SentryError && err.code === "grant_permission";
}

/**
 * Convenience for the §10.1 rule — grant expiry ends a live session. A viewer
 * that sees this must create a new session, not renew client-side.
 */
export function isSessionEnded(err: unknown): err is SentryError {
  return (
    err instanceof SentryError &&
    (err.code === "grant_expired" || err.code === "session_unknown")
  );
}

/** Attach a session id to an error's message context without losing its type. */
export function describeError(err: SentryError, sessionId?: SessionId): string {
  const where = err.path ? ` [${err.path}]` : "";
  const ses = sessionId ? ` (session ${sessionId})` : "";
  return `${err.name}: ${err.code} — ${err.message}${ses}${where}`;
}
