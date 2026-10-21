/**
 * A sign-in lockout, as something a screen can draw.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN, AND WHY IT WAS NOT ENOUGH
 * ══════════════════════════════════════════════════════════════════════
 *
 * An administrator mistyped the organization half of a person's login five
 * times -- which is what happens when the login is `guest2.terra-industries`
 * and every screen in the product says `Terra Industries` -- and was told:
 *
 *     Too many sign-in attempts. Wait a few minutes and try again
 *
 * "A few minutes" was a guess. The server knew the exact number and sent it in
 * `Retry-After`, which a cross-origin page is not allowed to read unless the
 * server exposes the header, and it did not. So the person waited, guessed,
 * tried again too early, and extended their own lockout.
 *
 * ── WHAT THIS MODULE IS ───────────────────────────────────────────────
 *
 * The arithmetic, kept out of the component so it can be tested without a
 * browser: an absolute DEADLINE (not a countdown), what is left of it, and how
 * to say that in words.
 *
 * ⚠ A DEADLINE, NOT A TIMER, and that is the whole design. A timer counting
 * down in a `setInterval` is wrong twice: it survives a refresh as nothing at
 * all, and a tab in the background has its timers throttled, so after ten
 * minutes asleep it would say four minutes remain. Every reading is
 * `until - now`, so being asleep, refreshed or restored costs nothing.
 *
 * The deadline comes from the server's own number and is remembered per login,
 * so refreshing the page while locked shows the right time remaining, and the
 * next refusal from the server replaces it.
 */

/** How the server's answer arrives: whole seconds left on the lock. */
export interface LockedAnswer {
  readonly retryAfterSec: number;
}

/** The deadline a screen counts down to, in epoch milliseconds. */
export function deadlineFor(answer: LockedAnswer, now = Date.now()): number {
  const sec = Number(answer.retryAfterSec);
  if (!Number.isFinite(sec) || sec <= 0) return 0;
  /* CAPPED AT A DAY. A nonsense `Retry-After` (a proxy's, a misconfiguration's)
     must not produce a button that is disabled until next week. */
  return now + Math.min(sec, 86_400) * 1_000;
}

/** Whole seconds left, never negative. 0 means the lock has lifted. */
export function secondsLeft(until: number, now = Date.now()): number {
  if (!Number.isFinite(until) || until <= 0) return 0;
  return Math.max(0, Math.ceil((until - now) / 1_000));
}

/**
 * `4:59`, and `1:04:59` over an hour.
 *
 * Never raw seconds: "try again in 299 seconds" is a number a person has to do
 * arithmetic on while they are already frustrated. mm:ss is a clock, which is
 * the thing they are actually waiting for.
 */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  if (mins < 60) return `${mins}:${String(secs).padStart(2, "0")}`;
  const hours = Math.floor(mins / 60);
  return `${hours}:${String(mins % 60).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

/**
 * The sentence shown while a lockout runs, without the time.
 *
 * Calm, and it does not accuse: somebody who has just been locked out of their
 * own account is usually the owner of the account, mistyping. It never says
 * "throttle", never names a limit, and never implies an attack.
 */
export const LOCKED_MESSAGE =
  "For your security, sign-in is paused after several unsuccessful attempts.";

/** What the Sign in button says while it is disabled. */
export function lockedButtonLabel(seconds: number): string {
  return `TRY AGAIN IN ${formatCountdown(seconds)}`;
}

/* ------------------------------------------------------------------ *
 * Remembering it across a refresh
 * ------------------------------------------------------------------ */

const KEY = "sentinel.signin.locked";

/** `localStorage` can throw on the property access itself. Guarded, always. */
function storage(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? window.localStorage
      : null;
  } catch {
    return null;
  }
}

/**
 * The login a lock belongs to, folded the way the server counts it.
 *
 * ⚠ THE SAME FOLDING THE SERVER DOES, for the same reason: it counts
 * `guest2.Terra Industries` and `guest2.terra-industries` as one login, so a
 * person who was locked out typing it one way must see the countdown when they
 * try the other. Otherwise the screen says "sign in" and the server says 429,
 * which reads as the countdown having been a lie.
 *
 * An ORGANIZATION login (no dot) is matched byte for byte by the server, so it
 * is keyed byte for byte here.
 */
export function lockKey(login: string): string {
  const typed = String(login ?? "");
  const dot = typed.indexOf(".");
  if (dot <= 0) return typed;
  const name = typed.slice(0, dot).trim().toLowerCase();
  const org = typed
    .slice(dot + 1)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${name}.${org}`;
}

/** Remember that this login is locked until `until`. Best effort. */
export function rememberLock(login: string, until: number): void {
  const store = storage();
  if (!store) return;
  try {
    const all = readAll();
    all[lockKey(login)] = until;
    store.setItem(KEY, JSON.stringify(prune(all)));
  } catch {
    /* A full or refusing store costs the countdown a refresh, nothing more. */
  }
}

/** Forget it: a successful sign-in, or a lock that has run out. */
export function forgetLock(login: string): void {
  const store = storage();
  if (!store) return;
  try {
    const all = readAll();
    delete all[lockKey(login)];
    store.setItem(KEY, JSON.stringify(prune(all)));
  } catch {
    /* ignored */
  }
}

/**
 * When this login's lock lifts, or 0 if it is not locked.
 *
 * This is what makes a refresh honest: the page comes back, reads the stored
 * deadline for whatever is in the login field, and draws the countdown it had.
 */
export function lockedUntil(login: string, now = Date.now()): number {
  const until = readAll()[lockKey(login)];
  if (typeof until !== "number" || !Number.isFinite(until)) return 0;
  return until > now ? until : 0;
}

function readAll(): Record<string, number> {
  const store = storage();
  if (!store) return {};
  try {
    const raw = store.getItem(KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/** Expired entries go, so this cannot grow for every login ever mistyped. */
function prune(all: Record<string, number>, now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(all)) {
    if (v > now) out[k] = v;
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * The sentence for a wrong password, which is a different thing
 * ------------------------------------------------------------------ */

/**
 * An example login in the shape of what they typed, for the refusal message.
 *
 * ⚠ IT MUST NOT BE A PLACEHOLDER. `name.<organization>` is what one screen
 * printed, angle brackets and all, and somebody typed it in. If the person
 * typed something after a dot, this echoes it folded -- which is both a real
 * example and, usually, the correction they need, because the folding is
 * exactly what the server does. With no dot at all there is nothing to echo
 * and the generic shape is the honest answer.
 */
export function loginExampleFor(typed: string): string {
  const key = lockKey(typed);
  const dot = key.indexOf(".");
  if (dot <= 0) return "name.your-organization";
  const org = key.slice(dot + 1);
  return org ? `name.${org}` : "name.your-organization";
}

/**
 * What to say for a refused credential, before any lockout.
 *
 * ⚠ IT SAYS NOTHING ABOUT WHETHER THE LOGIN EXISTS. The server answers one
 * uniform 401 for an unknown organization, an unknown person, a wrong password
 * and a disabled account, because a login form that tells them apart is a list
 * of a customer's staff. This sentence is the same for all four, and the only
 * help it offers is about SPELLING, which is the thing that is actually wrong
 * most of the time.
 */
export function wrongCredentialMessage(typed: string): string {
  return (
    "That login and password do not match. Check the spelling of your login "
    + `(for example ${loginExampleFor(typed)}) and try again.`
  );
}
