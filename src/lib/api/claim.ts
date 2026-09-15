import { getCoordinationBaseUrl, webFetch } from "./client";
import { markSessionEnded } from "./auth";
import { getSessionRef } from "./session";

/**
 * Registering a tower.
 *
 * ⚠ HAND-ROLLS `fetch`, AND THAT IS A DOCUMENTED EXCEPTION — the same one
 * `api/auth.ts` carries. The SDK has no claim methods, so there is nothing to
 * call; rather than pretend, the exception is quarantined in this one file and
 * marked, so moving it into the SDK later is a deletion rather than a hunt.
 * Both calls still go through `webFetch`, the single bound helper.
 *
 * ── WHAT ENROLMENT ACTUALLY IS ─────────────────────────────────────────
 *
 * A CLAIM, not a create. The tower is already bolted to a mast and powered on;
 * this says "the tower behind this code is ours, and here is what we call the
 * site". The tower then proves itself against the code over its own enrolment
 * channel, and the claim flips `open` → `consumed`.
 *
 * There is no serial anywhere in this. The pairing code IS the identifier — it
 * is derived from the tower's public key, and it is the thing the tower proves
 * possession of.
 */

/** `enrollment.CLAIM_*`, as coordination reports them. */
export type ClaimStatus =
  /** Registered, waiting for the tower to enrol. */
  | "open"
  /** The tower enrolled. The claim is spent and the tower is now real. */
  | "consumed"
  /** The 15-minute window closed with no enrolment. */
  | "expired"
  /**
   * The SAME account re-entered the code, so this older claim stepped aside.
   *
   * Coordination supersedes rather than refusing when the owner re-registers —
   * a typo in the label, a retry, a worry about the deadline — because blocking
   * somebody for the full TTL over their own mistake would be absurd.
   * `claim_conflict` is reserved for a DIFFERENT account, where refusing is the
   * safe answer.
   */
  | "superseded";

export interface Claim {
  claim_id: string;
  /** The site name, as typed. Set AT CLAIM TIME — see `createClaim`. */
  label: string;
  /** The deadline. What lets the UI show a countdown instead of a spinner. */
  expires_at: string;
  /**
   * The EFFECTIVE status — coordination computes expiry against its own clock
   * rather than waiting for a sweeper, so a lapsed claim reads `expired`
   * immediately instead of showing as pending forever.
   */
  status: ClaimStatus;
}

/* ------------------------------------------------------------------ *
 * The pairing code
 * ------------------------------------------------------------------ */

/**
 * Crockford base-32, mirroring the tower's own `pairing.py`.
 *
 * `I`, `L`, `O` and `U` are absent by construction: the first three because
 * they are indistinguishable from 1 and 0 on a console in a field, and `U`
 * because Crockford drops it to avoid producing unfortunate words by accident.
 * They are REJECTED here rather than remapped — silently turning a typed `O`
 * into `0` would authenticate a code the operator did not read.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 60 bits at 5 bits a character. Not a round number by taste — by arithmetic. */
export const CODE_CHARS = 12;

export class PairingCodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PairingCodeError";
  }
}

/**
 * Typed input → the canonical ungrouped form.
 *
 * Accepts any casing and any separator a human or a console might introduce:
 * `k7qm-4x8n-p2w3`, `K7QM4X8NP2W3` and `K7QM 4X8N P2W3` are the same code. This
 * mirrors the server's rule exactly, so the field can reject a bad code before
 * spending a round trip on it — but the server remains the authority, and this
 * never has the last word on a code it considers valid.
 */
export function normalisePairingCode(input: string): string {
  const text = input.trim().toUpperCase().replace(/[\s\-_.]/g, "");
  if (!text) throw new PairingCodeError("Enter the code shown on the tower.");
  for (const ch of text) {
    if (!ALPHABET.includes(ch)) {
      throw new PairingCodeError(
        `"${ch}" is not part of a pairing code. The letters I, L, O and U are never used — check for a 1 or a 0.`,
      );
    }
  }
  if (text.length !== CODE_CHARS) {
    throw new PairingCodeError(
      `A pairing code is ${CODE_CHARS} characters. That one is ${text.length}.`,
    );
  }
  return text;
}

/** `K7QM-4X8N-P2W3` — how the tower's console prints it, for display only. */
export function groupPairingCode(code: string): string {
  return (code.match(/.{1,4}/g) ?? [code]).join("-");
}

/** True when the input could be sent. Cheap enough for a keystroke. */
export function isCompleteCode(input: string): boolean {
  try {
    normalisePairingCode(input);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Failures — each gets a real message and a real next step
 * ------------------------------------------------------------------ */

/**
 * `409 claim_conflict` — somebody else already holds an open claim on this code.
 *
 * A REAL, reachable outcome rather than an edge case: anyone who glimpsed the
 * code on a console can open a claim, and the legitimate owner is then blocked
 * until it lapses. That deserves an explanation and a next step, not "error".
 */
export class ClaimConflictError extends Error {
  constructor() {
    super(
      "That code is already being claimed by another account. Wait for it to " +
        "lapse, or check the code on the tower's console.",
    );
    this.name = "ClaimConflictError";
  }
}

/** `422`/`400` — the code did not survive coordination's own normalisation. */
export class ClaimRejectedError extends Error {
  constructor(detail?: string) {
    super(
      detail ||
        "That does not look like a valid pairing code. Check the code on the " +
          "tower's console and re-enter it.",
    );
    this.name = "ClaimRejectedError";
  }
}

/** Not a bad code, and must never be shown as one. */
export class ClaimUnreachableError extends Error {
  readonly reason: "network" | "no_endpoint" | "server_error" | "bad_response";
  /** The specifics. For the console and for callers — never for the screen. */
  readonly detail: string | undefined;
  constructor(reason: ClaimUnreachableError["reason"], detail?: string) {
    /* Same rule as `AuthUnreachableError`: the message is read by whoever is
       registering a tower, the detail by whoever is fixing it. */
    super(REACH[reason]);
    this.name = "ClaimUnreachableError";
    this.reason = reason;
    this.detail = detail;
    console.debug("[claim] registration could not complete:", reason, detail ?? "");
  }
}

const REACH = {
  network: "Can't connect right now",
  no_endpoint: "Registering a tower isn't available right now",
  server_error: "Something went wrong at our end",
  bad_response: "Something went wrong at our end",
} as const;

/** The session lapsed mid-flow. The app drops to login; the wizard says why. */
export class ClaimSessionEndedError extends Error {
  constructor() {
    super("Your session ended. Sign in again to finish registering this tower.");
    this.name = "ClaimSessionEndedError";
  }
}

const CLAIMS_PATH = "/v1/viewer/claims";

function requireBaseUrl(): string {
  const base = getCoordinationBaseUrl();
  if (!base) throw new ClaimUnreachableError("network", "VITE_COORDINATION_URL is unset");
  return base;
}

function authHeader(): Record<string, string> {
  const ref = getSessionRef();
  return ref ? { Authorization: `Bearer ${ref}` } : {};
}

/** A 401 anywhere means the session is gone. One path, as everywhere else. */
function handleUnauthorized(): never {
  markSessionEnded("expired");
  throw new ClaimSessionEndedError();
}

function parseClaim(raw: unknown): Claim {
  const c = raw as Partial<Claim>;
  return {
    claim_id: String(c.claim_id ?? ""),
    label: String(c.label ?? ""),
    expires_at: String(c.expires_at ?? ""),
    /* An unrecognised status is reported as itself rather than coerced to
       something healthy — a claim in a state we do not know about must not be
       drawn as one that is progressing. */
    status: (c.status as ClaimStatus) ?? "expired",
  };
}

/* ------------------------------------------------------------------ *
 * The two calls
 * ------------------------------------------------------------------ */

/**
 * Register a tower — `POST /v1/viewer/claims`.
 *
 * ⚠ THE PAIRING CODE IS A LIVE SECRET AND IS NOT RETAINED. It is a parameter,
 * it goes into the request body, and this function keeps no reference to it.
 * Coordination omits it from the 201 response and from its audit ledger for the
 * same reason: a response body is no safer than a log line — it reaches a
 * browser, a proxy, and whatever devtools are recording. The caller clears its
 * input on success.
 *
 * ⚠ THE LABEL IS SET HERE, NOT AFTER. `create_pending_claim` takes it
 * alongside the code and carries it into the tower record at enrolment, and
 * there is no route to change it afterwards — coordination's `do_PATCH` serves
 * only session ICE. So the site name is asked for BEFORE the wait, not after
 * the tower reports itself. See the note in `AddTowerView`.
 */
export async function createClaim(
  pairingCode: string,
  label: string,
  signal?: AbortSignal,
): Promise<Claim> {
  const url = requireBaseUrl() + CLAIMS_PATH;

  let response: Response;
  try {
    response = await webFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ pairing_code: pairingCode, label }),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    throw new ClaimUnreachableError(
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }

  if (response.status === 401) handleUnauthorized();
  if (response.status === 409) throw new ClaimConflictError();
  if (response.status === 422 || response.status === 400) {
    let detail: string | undefined;
    try {
      const body = (await response.json()) as { error?: { message?: string } };
      detail = body?.error?.message;
    } catch {
      /* keep the default wording */
    }
    throw new ClaimRejectedError(detail);
  }
  if (response.status === 403) {
    throw new ClaimUnreachableError("server_error", "this account may not register towers");
  }
  if (response.status === 404 || response.status === 405) {
    throw new ClaimUnreachableError("no_endpoint");
  }
  if (!response.ok) {
    throw new ClaimUnreachableError("server_error", `HTTP ${response.status}`);
  }

  try {
    return parseClaim(await response.json());
  } catch {
    throw new ClaimUnreachableError("bad_response", "body was not a claim");
  }
}

/**
 * The account's claims — `GET /v1/viewer/claims`.
 *
 * ⚠ THIS IS WHAT MAKES THE WAITING STATE SURVIVE A RELOAD, and it is the whole
 * reason the old flow's local timer had to go. The pending window is invisible
 * in `/v1/viewer/towers` — no tower record exists until enrolment binds one —
 * so without this route a registered-but-not-yet-online tower would simply not
 * be anywhere, and a refresh would lose it.
 */
export async function listClaims(signal?: AbortSignal): Promise<Claim[]> {
  const url = requireBaseUrl() + CLAIMS_PATH;

  let response: Response;
  try {
    response = await webFetch(url, {
      method: "GET",
      headers: authHeader(),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    throw new ClaimUnreachableError(
      "network",
      err instanceof Error ? err.message : undefined,
    );
  }

  if (response.status === 401) handleUnauthorized();
  if (response.status === 404 || response.status === 405) {
    throw new ClaimUnreachableError("no_endpoint");
  }
  if (!response.ok) throw new ClaimUnreachableError("server_error", `HTTP ${response.status}`);

  try {
    const body = (await response.json()) as { claims?: unknown[] };
    return Array.isArray(body.claims) ? body.claims.map(parseClaim) : [];
  } catch {
    throw new ClaimUnreachableError("bad_response", "body was not a claim list");
  }
}

/* ------------------------------------------------------------------ *
 * The countdown
 * ------------------------------------------------------------------ */

/** Milliseconds until a claim lapses. Negative once it has. */
export function msUntilExpiry(claim: Claim, now: number = Date.now()): number {
  const at = Date.parse(claim.expires_at);
  return Number.isNaN(at) ? 0 : at - now;
}

/**
 * `14:32` — minutes and seconds remaining.
 *
 * Shows `0:00` rather than a negative once the window closes; `status` is what
 * the UI branches on, so this never has to represent "overdue".
 */
export function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
