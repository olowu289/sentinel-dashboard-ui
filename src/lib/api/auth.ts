/**
 * Login, logout, and where the session lives.
 *
 * ⚠ TWO CALLS HERE HAND-ROLL `fetch`, AND THAT IS A DOCUMENTED EXCEPTION.
 * Everything else in this app reaches coordination through `@kallon/sentry-sdk`,
 * and if something needs an endpoint the SDK does not expose the fix belongs in
 * the SDK or the protocol. The SDK has a `TokenProvider` — so *carrying* a
 * session is supported — but no auth methods at all, and there is nothing to
 * call. Rather than pretend, the exception is quarantined in this one file and
 * marked, so moving it into the SDK later is a deletion rather than an
 * excavation. Both calls still go through `webFetch`, the single bound helper.
 *
 * `resolveSession` is NOT an exception: it goes through the SDK, against a route
 * that already exists.
 *
 * ── THE FAILURE TAXONOMY IS THE POINT OF THIS FILE ─────────────────────
 *
 * Three outcomes that must never be confused:
 *
 *   AuthRejectedError     the credentials did not authenticate. UNIFORM — it
 *                         carries no reason field, because the server carries
 *                         none either.
 *   AuthUnreachableError  coordination is down, unreachable, or answered
 *                         something that was not a verdict. NOT an auth
 *                         failure, and it must never be shown as one.
 *   anything else         a bug. Let it surface.
 *
 * Telling an operator their password is wrong when the service is simply down
 * sends them to reset a credential that was fine, and hides an outage.
 */

import { getCoordinationBaseUrl, getClient, webFetch } from "./client";
import { setSessionRef } from "./session";

/* ------------------------------------------------------------------ *
 * The contract — field by field from coordination's own dataclasses
 * ------------------------------------------------------------------ */

/**
 * `POST /v1/auth/login` request body. Exactly two fields.
 *
 * `login` is THE ORGANIZATION NAME, VERBATIM. `accounts._normalise_login` is
 * the identity function on purpose, and its docstring says the instinct to
 * lowercase and trim is wrong. So this client must not trim either:
 * `"Terra"` and `" Terra"` are two different logins, and a client that quietly
 * trimmed would disagree with the server's exact-match rule — the operator
 * would type something that works in one place and not the other, with nothing
 * on screen to explain why.
 */
interface LoginRequest {
  login: string;
  password: string;
}

/**
 * The account, as a client may see it.
 *
 * Never carries `password_hash` — that is an scrypt digest and has no business
 * leaving the server. Coordination lists these four fields explicitly rather
 * than dumping the record, so a field added to the dataclass later cannot leak.
 *
 * Note what is NOT here: any per-person identity. `login` is the ORGANIZATION
 * name. Coordination authenticates an organization, not an individual — see the
 * note on `operatorName()` below.
 */
export interface AuthAccount {
  account_id: string;
  /** The organization name, as stored. */
  login: string;
  role: string;
  status: string;
}

/** `POST /v1/auth/login` → 200. */
interface LoginResponse {
  /** `SessionRef.raw` — `"ses_" + urlsafe_b64(32 bytes)`. Returned ONCE;
   *  coordination stores only `sha256(ref)`. */
  session_ref: string;
  expires_at: string;
  account: AuthAccount;
}

/** What is kept on the client between reloads. Never the password. */
export interface StoredSession {
  /** The credential. */
  ref: string;
  expiresAt: string;
  account: AuthAccount;
}

/** Why a stored session stopped being valid. */
export type SessionEndReason = "expired" | "revoked" | "unknown" | "logged_out";

/**
 * THE one message shown for any credential failure.
 *
 * Exported as a constant so the uniformity is testable: two different failures
 * cannot drift into two different strings if there is only one string.
 */
export const UNIFORM_AUTH_MESSAGE = "Wrong organization name or password";

/**
 * The credentials did not authenticate.
 *
 * ⚠ UNIFORM BY CONSTRUCTION. `accounts.login()` returns `None` for an unknown
 * organization, a wrong password AND a disabled account — deliberately
 * indistinguishable, so the endpoint cannot be used to enumerate customers. It
 * also hashes on an unknown login so the three do not answer at measurably
 * different speeds; a uniform body would be worthless next to a timing oracle.
 *
 * This class carries no reason field, so the UI has nothing to leak even if
 * somebody later wanted it to.
 */
export class AuthRejectedError extends Error {
  constructor() {
    super(UNIFORM_AUTH_MESSAGE);
    this.name = "AuthRejectedError";
  }
}

const REACH_MESSAGE = {
  network: "Can't reach coordination",
  no_endpoint: "Coordination has no login endpoint",
  server_error: "Coordination returned an error",
  bad_response: "Coordination returned an unexpected response",
} as const;

/**
 * Coordination could not be reached, or answered something that was not an
 * authentication verdict. NOT an auth failure.
 */
export class AuthUnreachableError extends Error {
  /** Short machine reason, so the UI can vary its wording honestly. */
  readonly reason: keyof typeof REACH_MESSAGE;

  constructor(reason: AuthUnreachableError["reason"], detail?: string) {
    super(REACH_MESSAGE[reason] + (detail ? ` (${detail})` : ""));
    this.name = "AuthUnreachableError";
    this.reason = reason;
  }
}

const LOGIN_PATH = "/v1/auth/login";
const LOGOUT_PATH = "/v1/auth/logout";

function requireBaseUrl(): string {
  const base = getCoordinationBaseUrl();
  if (!base) {
    throw new AuthUnreachableError("network", "VITE_COORDINATION_URL is unset");
  }
  return base;
}

/* ------------------------------------------------------------------ *
 * The three calls
 * ------------------------------------------------------------------ */

/**
 * Exchange an organization name and a password for a session.
 *
 * ⚠ `organizationName` IS SENT VERBATIM. There is no `.trim()` and no
 * `.toLowerCase()` anywhere on this path, and there must never be one — see
 * `LoginRequest` above.
 *
 * @throws {AuthRejectedError}    uniform; carries no hint as to which half was wrong.
 * @throws {AuthUnreachableError} coordination is down or answered a non-verdict.
 */
export async function login(
  organizationName: string,
  password: string,
  signal?: AbortSignal,
): Promise<StoredSession> {
  const url = requireBaseUrl() + LOGIN_PATH;
  const body: LoginRequest = { login: organizationName, password };

  let response: Response;
  try {
    response = await webFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* The password lives here and nowhere else: not in the URL, not in state
         that outlives this call, not in a log line. */
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    /* DNS failure, refused connection, CORS, offline — and an untrusted CA,
       which is the likeliest of them on a local deployment and presents as a
       bare "Failed to fetch" with no status at all. Not an auth verdict. */
    throw new AuthUnreachableError(
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }

  // 401/403 are the ONLY statuses that mean "these credentials are wrong".
  if (response.status === 401 || response.status === 403) {
    throw new AuthRejectedError();
  }
  if (response.status === 404 || response.status === 405) {
    throw new AuthUnreachableError("no_endpoint");
  }
  if (!response.ok) {
    throw new AuthUnreachableError("server_error", `HTTP ${response.status}`);
  }

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AuthUnreachableError("bad_response", "body was not JSON");
  }

  const result = parsed as Partial<LoginResponse>;
  if (
    typeof result?.session_ref !== "string" ||
    !result.session_ref ||
    typeof result.account !== "object" ||
    result.account === null
  ) {
    /* A 200 without a usable session is not a success. Failing loudly here
       beats storing `undefined` and 401-ing on every later call. */
    throw new AuthUnreachableError("bad_response", "no session_ref in the response");
  }

  return {
    ref: result.session_ref,
    expiresAt: typeof result.expires_at === "string" ? result.expires_at : "",
    account: result.account as AuthAccount,
  };
}

/**
 * Revoke the session server-side.
 *
 * Returns whether coordination confirmed it. **The caller clears the client
 * session either way**: refusing to sign out locally because the server could
 * not be reached would strand the operator in a session they have asked to
 * leave. The return value exists so the UI can be honest that the server-side
 * revoke is unconfirmed, not so it can block.
 */
export async function logout(ref: string, signal?: AbortSignal): Promise<boolean> {
  let base: string;
  try {
    base = requireBaseUrl();
  } catch {
    return false;
  }
  try {
    const response = await webFetch(base + LOGOUT_PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${ref}` },
      ...(signal ? { signal } : {}),
    });
    return response.ok || response.status === 204;
  } catch {
    return false;
  }
}

/**
 * Does the stored session still authenticate?
 *
 * Uses `GET /v1/viewer/towers` through the SDK — a real, already-served,
 * account-scoped route. No `whoami` endpoint is invented, because inventing a
 * second route would double the blockage for no gain.
 *
 * ⚠ AN EMPTY TOWER LIST IS A VALID 200 AND MEANS THE SESSION IS GOOD. §4.2.3 is
 * explicit that a viewer with no authorized towers gets `{towers: []}`, never a
 * 403. Treating empty as unauthenticated would sign out every new account.
 *
 * Returns `false` only for a real 401/403. Anything else — coordination down, a
 * contract mismatch — is NOT proof the session is bad, and is rethrown so the
 * caller can say "can't reach coordination" instead of silently signing a valid
 * operator out.
 */
export async function resolveSession(signal?: AbortSignal): Promise<boolean> {
  try {
    await getClient().listTowers(signal ? { signal } : {});
    return true;
  } catch (err) {
    if (isUnauthorized(err)) return false;
    throw err;
  }
}

/**
 * True when an error from any coordination call means "not authenticated".
 *
 * Reads the status structurally rather than instance-checking the SDK's
 * `AuthError`, so it stays correct if the SDK renames a class.
 */
export function isUnauthorized(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  if (status === 401 || status === 403) return true;
  const code = (err as { code?: unknown }).code;
  return code === "unauthorized" || code === "not_authorized";
}

/**
 * THE single 401 guard, for every authenticated call in the app.
 *
 * A 401/403 on any coordination call means the session is gone — expired,
 * revoked, or never valid. Handled in one place so the whole app drops to login
 * in one move rather than leaving a half-authenticated screen or an endless
 * spinner, and so a second call site cannot grow a subtly different expiry
 * behaviour.
 *
 * Does NOT swallow: the caller still failed, and still has to stop.
 * Every `api/*` module that talks to coordination calls this in its catch.
 */
export function endSessionIfUnauthorized(err: unknown): void {
  if (isUnauthorized(err)) markSessionEnded("expired");
}

/* ------------------------------------------------------------------ *
 * The session store
 * ------------------------------------------------------------------ */

/**
 * ── THE STORAGE DECISION, AND WHY IT IS NOT AN httpOnly COOKIE ─────────
 *
 * An httpOnly cookie is the better answer in general and it is NOT AVAILABLE to
 * this architecture, for a concrete reason: the browser talks to coordination
 * DIRECTLY, and every call carries `Authorization: Bearer <ref>` set by the SDK
 * in page JavaScript. A cookie the JS cannot read cannot be put into that
 * header. Making httpOnly work would mean routing every coordination call
 * through a server proxy — a real architecture change, and its own piece of
 * work, not something to smuggle into a login screen.
 *
 * So: `sessionStorage`, chosen over the alternatives on purpose.
 *
 *   vs. localStorage  Both are JS-readable and equally exposed to XSS. The
 *                     difference is lifetime: sessionStorage dies with the tab,
 *                     localStorage persists until cleared. The requirement is
 *                     surviving a RELOAD, not surviving days on a shared
 *                     control-room machine. Shorter is strictly better here and
 *                     costs nothing.
 *   vs. memory only   Would not survive a reload, which was a requirement.
 *   vs. httpOnly      Incompatible with a direct browser→coordination call.
 *
 * STORED: the reference, its expiry, the account.
 * NEVER STORED: the password. It exists only as a local in the login handler
 * and in the POST body.
 *
 * TODO(bff): if a server layer ever exists, move the reference to an httpOnly
 * SameSite=Strict cookie and have the server attach the bearer. That change is
 * confined to this section and `api/client.ts`.
 */

/** Namespaced so it cannot collide with anything else on the origin. */
const STORAGE_KEY = "sentinel.session.v1";

export type SessionListener = (
  session: StoredSession | null,
  reason?: SessionEndReason,
) => void;

const listeners = new Set<SessionListener>();

/**
 * The in-memory mirror.
 *
 * Read synchronously by the SDK's token provider, which cannot be async at
 * every call site. Hydrated once, on mount, by {@link loadSession}.
 */
let current: StoredSession | null = null;

function canUseStorage(): boolean {
  /* A locked-down browser can throw on the property access itself, so this is a
     try/catch rather than a truthiness check. */
  try {
    return typeof window !== "undefined" && !!window.sessionStorage;
  } catch {
    return false;
  }
}

function notify(reason?: SessionEndReason): void {
  for (const listener of listeners) listener(current, reason);
}

export function subscribeToSession(listener: SessionListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live session, or `null`. Synchronous. */
export function getSession(): StoredSession | null {
  return current;
}

/**
 * Hydrate from storage. Call once, on mount.
 *
 * An expired-by-the-clock session is dropped here rather than sent to
 * coordination to be rejected: we already hold `expiresAt`, and a request we
 * know will 401 is a round trip that buys nothing. Coordination remains the
 * authority — this only skips the obviously-dead case.
 */
export function loadSession(): StoredSession | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as StoredSession).ref !== "string" ||
      !(parsed as StoredSession).ref
    ) {
      /* Corrupt, or from an older shape. Drop it; do not try to salvage a
         credential we cannot vouch for. */
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    const session = parsed as StoredSession;
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }

    current = session;
    setSessionRef(session.ref);
    return session;
  } catch {
    return null;
  }
}

/** Store a freshly issued session. */
export function saveSession(session: StoredSession): void {
  current = session;
  setSessionRef(session.ref);
  if (canUseStorage()) {
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } catch {
      /* Storage can be full or blocked. The in-memory session still works for
         this page view; only reload-survival is lost. Not worth failing a
         login over. */
    }
  }
  notify();
}

/**
 * End the session locally.
 *
 * `reason` travels to the UI so an expiry can say "your session ended" while a
 * deliberate sign-out says nothing at all — the difference matters to somebody
 * who did not expect to be signed out.
 */
export function clearSession(reason: SessionEndReason = "logged_out"): void {
  current = null;
  setSessionRef(undefined);
  if (canUseStorage()) {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* Nothing useful to do; the in-memory session is already gone. */
    }
  }
  notify(reason);
}

/**
 * Called when an authenticated request comes back 401 mid-use.
 *
 * This is the path that keeps a revoked session from leaving the app in a
 * half-authenticated state: the store empties, every subscriber hears why, and
 * the gate drops to login.
 */
export function markSessionEnded(reason: SessionEndReason = "expired"): void {
  if (!current) return;
  clearSession(reason);
}

/**
 * Whose name goes on an authored act — `changedBy`, `addedBy`, `stoppedBy`.
 *
 * ⚠ THIS IS AN ORGANIZATION NAME, NOT A PERSON'S. Coordination authenticates an
 * organization: `AuthAccount` carries `account_id`, `login`, `role` and
 * `status`, and there is no per-user identity anywhere in the contract. So
 * provenance is org-level until the protocol grows individual accounts.
 *
 * That is a real reduction against what this app's design asked for — the
 * watchlist's whole position is that "enrolling somebody is an act with a name
 * on it", and an organization name is a weaker answer to "who did this" than a
 * person's. It is recorded here rather than papered over, because the fields
 * are already stamped and the day individual identity arrives this function is
 * the only thing that changes.
 */
export function operatorName(account: AuthAccount | null): string {
  return account?.login ?? "Unknown operator";
}
