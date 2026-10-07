/**
 * Changing your own password and your own organization name.
 *
 * ⚠ THESE CALLS HAND-ROLL `fetch`, AND IT IS THE SAME DOCUMENTED EXCEPTION
 * `auth.ts` carries. The SDK has a `TokenProvider` but no account methods at
 * all, so there is nothing to call. The exception is quarantined in these two
 * files and marked, so moving it into the SDK later is a deletion rather than an
 * excavation. Every call still goes through `webFetch`, the single bound helper.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE FAILURE TAXONOMY, AND THE ONE STATUS THAT MATTERS
 * ══════════════════════════════════════════════════════════════════════
 *
 * `auth.ts` has three outcomes that must never be confused. This file has four,
 * and the fourth is the whole reason it needs its own error type:
 *
 *   AccountFieldError     the server refused something the person typed, and it
 *                         said WHICH FIELD. Shown under that field. Includes a
 *                         wrong current password, a too-short new password, and
 *                         an organization name somebody else already has.
 *   AuthUnreachableError  coordination is down or answered a non-verdict.
 *                         Reused from `auth.ts` — same fact, same wording.
 *   a 401-tagged Error    the SESSION is dead. Goes through
 *                         `endSessionIfUnauthorized` and the app drops to login.
 *   anything else         a bug. Let it surface.
 *
 * ── WHY A WRONG CURRENT PASSWORD IS 403 AND NOT 401 ────────────────────
 *
 * This is the trap, and it is a server decision this client depends on.
 * `isUnauthorized` in `auth.ts` treats 401 as "the login session is gone, drop
 * to the sign-in screen", and deliberately EXCLUDES 403 because a 403 is a
 * per-resource refusal that must leave the session intact.
 *
 * A mistyped current password is exactly a per-resource refusal: we know who
 * this is, and they may not do THIS. So coordination answers 403 with
 * `code: "bad_current_password"`, and the person is told they mistyped.
 *
 * Had it answered 401, the app would have signed them OUT — losing the form,
 * and presenting a typo as a failure of the login system. If somebody ever
 * "simplifies" that status on the server, this is the paragraph that says why
 * the tests refuse it.
 *
 * ── WHAT A SUCCESSFUL PASSWORD CHANGE DOES TO THIS SESSION ─────────────
 *
 * It kills it. The server revokes EVERY session of the account, the caller's
 * included, and says so with `reauthenticate: true`. The session this call was
 * made on is dead by the time the 200 is parsed — so the caller must clear the
 * local session rather than make another request with it, and `changePassword`
 * returns that flag rather than hiding it.
 */

import { getCoordinationBaseUrl, webFetch } from "./client";
import { AuthUnreachableError, type AuthAccount } from "./auth";
import { getSession } from "./auth";

const ACCOUNT_PATH = "/v1/account";
const PASSWORD_PATH = "/v1/account/password";
const LOGIN_PATH = "/v1/account/login";

/* ------------------------------------------------------------------ *
 * The contract — field by field from coordination's own routes
 * ------------------------------------------------------------------ */

/** `POST /v1/account/password` request body. */
interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}

/** `POST /v1/account/login` request body. */
interface ChangeLoginRequest {
  current_password: string;
  /** The organization name, VERBATIM. Never trimmed — see `accountPolicy`. */
  new_login: string;
}

/** `POST /v1/account/password` → 200. */
export interface ChangePasswordResult {
  account: AuthAccount;
  /** How many sessions the server revoked. Includes this one. */
  sessionsRevoked: number;
  /** Always true today. Read rather than assumed — the server decides. */
  reauthenticate: boolean;
}

/** Coordination's error body, as these routes write it. */
interface ErrorBody {
  error?: {
    code?: unknown;
    field?: unknown;
    message?: unknown;
  };
}

/**
 * The server refused a value the person typed, and named the field.
 *
 * ⚠ THE MESSAGE IS THE SERVER'S, VERBATIM. Not re-worded, not mapped through a
 * table of our own. These routes are the one place in this app where the server
 * knows something the client cannot — the exact policy, whether a name is taken
 * — and a client-side translation table would answer "use at least 12
 * characters" with a stale "use at least 8" the day the policy changes.
 *
 * `field` is what decides WHERE it is drawn, so a wrong current password lands
 * under the current-password box and a weak new one under the new-password box.
 * Without it both errors appear in the same place and the person cannot tell
 * which half of the form the server is complaining about.
 */
export class AccountFieldError extends Error {
  /** Coordination's own code: bad_current_password | weak_password |
   *  invalid_login | login_taken | invalid_request. */
  readonly code: string;

  /** The field it belongs to, as the server named it. */
  readonly field: string;

  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = "AccountFieldError";
    this.code = code;
    this.field = field;
  }
}

/**
 * Too many failed attempts. The credential-change lockout, not the sign-in one.
 *
 * Its own type rather than an `AuthUnreachableError("throttled")` because the
 * wording differs: on the sign-in screen "too many sign-in attempts" is the
 * whole story, while here the person is already signed in and needs to be told
 * that it is the CHANGE that is locked, not their account.
 */
export class AccountThrottledError extends Error {
  /** Whole minutes, rounded UP so the wording never promises a sooner retry
   *  than the lock allows. 0 when the server sent no usable Retry-After. */
  readonly minutes: number;

  constructor(minutes: number) {
    super(
      minutes > 0
        ? `Too many attempts. Try again in ${minutes} min`
        : "Too many attempts. Wait a few minutes and try again",
    );
    this.name = "AccountThrottledError";
    this.minutes = minutes;
  }
}

/* ------------------------------------------------------------------ *
 * Shared plumbing
 * ------------------------------------------------------------------ */

function requireBaseUrl(): string {
  const base = getCoordinationBaseUrl();
  if (!base) {
    throw new AuthUnreachableError("network", "VITE_COORDINATION_URL is unset");
  }
  return base;
}

function requireBearer(): string {
  const session = getSession();
  if (!session?.ref) {
    /* Tagged 401 so `isUnauthorized` recognises it and the app drops to login,
       exactly as a real 401 from the server would. Reaching here means the UI
       rendered an authenticated screen with no session, which is a bug — but
       the honest response to it is still "you are not signed in". */
    throw Object.assign(new Error("not signed in"), { status: 401 });
  }
  return session.ref;
}

/** Read the error body without ever letting a malformed one mask the status. */
async function errorBody(response: Response): Promise<ErrorBody["error"]> {
  try {
    const parsed = (await response.json()) as ErrorBody;
    return parsed?.error ?? {};
  } catch {
    return {};
  }
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value ? value : fallback;
}

/**
 * Turn a non-2xx into the right error type. Never returns.
 *
 * One function, for both routes, because the mapping is the contract and two
 * copies of it would drift — and the direction it would drift is the 401/403
 * distinction above, which is the one that signs people out by accident.
 */
async function raiseFor(response: Response, fallbackField: string): Promise<never> {
  if (response.status === 401) {
    /* THE SESSION IS DEAD — and this is the only status that means that.
       Tagged so `isUnauthorized` picks it up and the app returns to login. */
    throw Object.assign(new Error("session is no longer valid"), { status: 401 });
  }
  if (response.status === 429) {
    const seconds = Number(response.headers.get("Retry-After"));
    /* `Number.isFinite` and not `|| 0`: `Number(null)` is 0 and `Number("")` is
       0, but `Number("x")` is NaN, and NaN > 0 is false — so a junk header must
       not produce a promise of an immediate retry. */
    const minutes =
      Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds / 60) : 0;
    throw new AccountThrottledError(minutes);
  }
  if (response.status === 403 || response.status === 409 || response.status === 422) {
    /* The three statuses that mean "something you typed". The server names the
       code and the field; its message is shown verbatim. */
    const error = await errorBody(response);
    throw new AccountFieldError(
      str(error?.code, "invalid_request"),
      str(error?.field, fallbackField),
      str(error?.message, "That value was not accepted."),
    );
  }
  if (response.status === 404 || response.status === 405) {
    /* The route is not there. On this surface that means coordination is older
       than this dashboard — a real deployment state, and NOT something to show
       as "wrong password". */
    throw new AuthUnreachableError("no_endpoint");
  }
  if (response.status === 501) {
    /* Coordination running without a store answers 501 on every account route.
       Same class of fact as 404: the feature is not available here. */
    throw new AuthUnreachableError("no_endpoint", "HTTP 501 not_configured");
  }
  throw new AuthUnreachableError("server_error", `HTTP ${response.status}`);
}

async function send(
  path: string,
  body: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const ref = requireBearer();
  try {
    return await webFetch(requireBaseUrl() + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ref}`,
      },
      /* The passwords live here and nowhere else: not in the URL, not in state
         that outlives the call, not in a log line. */
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    /* DNS, refused connection, CORS, offline, an untrusted CA. Not a verdict. */
    throw new AuthUnreachableError(
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }
}

function requireAccount(parsed: unknown, what: string): AuthAccount {
  const account = (parsed as { account?: unknown } | null)?.account;
  if (typeof account !== "object" || account === null) {
    /* A 200 without the account block is not a success we can act on: the whole
       point of the response is the fresh copy to replace the stale one. */
    throw new AuthUnreachableError("bad_response", `no account in the ${what} response`);
  }
  return account as AuthAccount;
}

/* ------------------------------------------------------------------ *
 * The three calls
 * ------------------------------------------------------------------ */

/**
 * `GET /v1/account` — the account as the server currently has it.
 *
 * Worth a round trip even though sign-in already returned an account block,
 * because that block is a snapshot from sign-in time: after a rename it is
 * stale, and a settings page that renders a stale name in the box you rename
 * things with will be used to rename something back by accident.
 */
export async function getAccount(signal?: AbortSignal): Promise<AuthAccount> {
  const ref = requireBearer();
  let response: Response;
  try {
    response = await webFetch(requireBaseUrl() + ACCOUNT_PATH, {
      headers: { Authorization: `Bearer ${ref}` },
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new AuthUnreachableError(
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }
  if (!response.ok) await raiseFor(response, "account");
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AuthUnreachableError("bad_response", "body was not JSON");
  }
  return requireAccount(parsed, "account");
}

/**
 * `POST /v1/account/password`.
 *
 * ⚠ ON SUCCESS THIS SESSION IS ALREADY DEAD. The server revoked every session
 * of the account including this one, before answering. The caller must clear the
 * local session — any further request on it will 401.
 *
 * @throws {AccountFieldError}     wrong current password (403), or a new one the
 *                                policy refused (422). `field` says which.
 * @throws {AccountThrottledError} too many failed attempts (429).
 * @throws {AuthUnreachableError}  coordination is down or answered a non-verdict.
 */
export async function changePassword(
  currentPassword: string,
  newPassword: string,
  signal?: AbortSignal,
): Promise<ChangePasswordResult> {
  const body: ChangePasswordRequest = {
    current_password: currentPassword,
    new_password: newPassword,
  };
  const response = await send(PASSWORD_PATH, body, signal);
  if (!response.ok) await raiseFor(response, "new_password");

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AuthUnreachableError("bad_response", "body was not JSON");
  }
  const result = parsed as { sessions_revoked?: unknown; reauthenticate?: unknown };
  return {
    account: requireAccount(parsed, "password change"),
    sessionsRevoked:
      typeof result.sessions_revoked === "number" ? result.sessions_revoked : 0,
    /* READ, not assumed. It is the server's instruction, and a client that
       hardcoded `true` would quietly stop obeying the day the server changed. */
    reauthenticate: result.reauthenticate !== false,
  };
}

/**
 * `POST /v1/account/login` — change the organization name.
 *
 * ⚠ `newLogin` IS SENT VERBATIM. No `.trim()` and no `.toLowerCase()` anywhere
 * on this path, and there must never be one: coordination matches the name byte
 * for byte, so a client that trimmed would store a name other than the one
 * typed and the person would then type what they see and be refused.
 *
 * The session SURVIVES — the login is an identifier, not a credential.
 *
 * @throws {AccountFieldError}     wrong current password (403), a name that is
 *                                invalid (422), or one already taken (409).
 * @throws {AccountThrottledError} too many failed attempts (429).
 * @throws {AuthUnreachableError}  coordination is down or answered a non-verdict.
 */
export async function changeLogin(
  currentPassword: string,
  newLogin: string,
  signal?: AbortSignal,
): Promise<AuthAccount> {
  const body: ChangeLoginRequest = {
    current_password: currentPassword,
    new_login: newLogin,
  };
  const response = await send(LOGIN_PATH, body, signal);
  if (!response.ok) await raiseFor(response, "new_login");

  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    throw new AuthUnreachableError("bad_response", "body was not JSON");
  }
  return requireAccount(parsed, "rename");
}
