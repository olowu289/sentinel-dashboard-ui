/**
 * When a live view should try again, when it should wait, and when it is over.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS ONE FILE AND NOT A CONDITION IN THE PLAYER
 * ══════════════════════════════════════════════════════════════════════
 *
 * A camera that is still there has exactly one honest behaviour: come back by
 * itself. The product failed that in three different ways at once, and each
 * one was a separate reading of the same fact scattered through the player:
 *
 *   1. A REFUSED RENEWAL WAS READ AS ACCESS ENDING. `session_status` answers
 *      404 for "gone or not yours" -- one code for a share that was withdrawn
 *      and for a session the server simply no longer holds -- and the viewer
 *      turned every one of them into "Access to this camera ended" with a
 *      button. About fifteen minutes in, on cameras nobody had touched.
 *   2. A TOWER THAT WAS OFF WAS RETRIED ANYWAY, minting grants and claiming
 *      camera slots on a box that could not answer, in a loop.
 *   3. A TOWER THAT WAS ON gave up after five attempts and waited for a click
 *      that, on a wall nobody is standing at, never came.
 *
 * So the decisions live here, together, as functions over values: what the
 * server said, and whether the site is reachable. The player asks; it does not
 * decide.
 *
 * ⚠ THE DEFAULT IS ALWAYS "TRY AGAIN". An unknown reason, a missing reason, a
 * reason added to coordination next month -- all of them retry. Being wrong
 * that way costs a request; being wrong the other way puts "Access ended" on a
 * working camera and tells an operator they have lost a site they have not.
 */

/* ======================================================================
 *  HOW LONG TO WAIT
 * ====================================================================== */

/**
 * The wait before each attempt, in order, with the last repeating forever.
 *
 * ⚠ THE CEILING IS WHAT BOUNDS THE COST, NOT A COUNT. Every attempt mints a
 * grant on coordination and claims a slot on an off-grid tower, so a client
 * that retried flat out would quietly DDoS its own control plane from a phone
 * in somebody's pocket. What used to bound it was a cap of five attempts, and
 * a cap is the wrong instrument: five attempts over thirty seconds is long
 * enough for a lift and far too short for an uplink that is down for ten
 * minutes, which is the thing operators actually hit. The tile went terminal
 * and a wall left running overnight came back showing "Stream unavailable" on
 * cameras that had been fine for hours.
 *
 * Fast at first because the failures that resolve resolve quickly; half a
 * minute apart after that because the ones that do not should not be asked
 * every two seconds until morning.
 *
 * The two things that genuinely stop a runaway client still do, and neither is
 * a count: a HIDDEN tab spends nothing, and a tower that is OFF is not asked
 * at all -- see `reachabilityOf` below.
 */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000];

/** The longest wait, which is the last step repeating. Derived, never written twice. */
export const RECONNECT_MAX_DELAY_MS =
  RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1];

/**
 * The wait before attempt `n` (1-based), jittered.
 *
 * ⚠ JITTER IS NOT DECORATION HERE. A hub going down drops every tile on the
 * wall in the same instant; without it, eight tiles would retry on the same
 * millisecond, eight times over, and the first thing the hub meets on coming
 * back is a thundering herd of its own making.
 */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const i = Math.min(Math.max(attempt, 1) - 1, RECONNECT_DELAYS_MS.length - 1);
  const base = RECONNECT_DELAYS_MS[i];
  return Math.round(base * (0.8 + random() * 0.4));
}

/* ======================================================================
 *  WHETHER IT CAN WORK AT ALL
 * ====================================================================== */

/**
 * Why a camera cannot be reached, or `null` when nothing is in the way.
 *
 * Not a failure and not an error: it is the state of the site, which the page
 * already knows from the fleet it is drawing. A tile in one of these states
 * has nothing to retry -- there is no request that could succeed -- so it
 * makes none, says which box is off, and waits to be told otherwise.
 */
export type Reach = "tower-offline" | "hub-offline" | null;

/**
 * What stands between this camera and a picture.
 *
 * ⚠ THE HUB IS CHECKED FIRST, AND IT DECIDES FOR ITS TOWERS TOO. A hub that
 * is down takes its masts' video with it whatever those masts think of
 * themselves: coordination's last word on a tower can easily be "up" while the
 * box that carries its video is dark. Saying "Tower offline" there sends
 * somebody to the wrong mast.
 */
export function reachabilityOf(
  tower: { online?: boolean } | null | undefined,
  hub: { online?: boolean } | null | undefined,
): Reach {
  if (hub && hub.online === false) return "hub-offline";
  if (tower && tower.online === false) return "tower-offline";
  return null;
}

/** What a tile says while it is waiting for a box to come back. */
export function reachWord(reach: Reach): string {
  return reach === "hub-offline" ? "Hub offline" : "Tower offline";
}

/* ======================================================================
 *  WHAT THE SERVER SAID
 * ====================================================================== */

/**
 * The reasons that mean ACCESS IS OVER, and therefore the only ones that stop
 * a tile trying.
 *
 * ⚠ EVERY ONE OF THESE IS A DECISION ABOUT A PERSON, not about a machine.
 * The share ended or was withdrawn, the account was removed or disabled, the
 * camera is no longer in their sites, the grant does not cover this camera.
 * Asking again cannot change any of them, and a tile that kept asking would be
 * refusing to hear the answer.
 *
 * Read off coordination's own error codes (`core/coordination/stub/server.py`)
 * rather than invented here:
 *
 *   live_forbidden      §"You do not have access to that camera" -- the view
 *                       permission is not in the share
 *   grant_permission    the action is not in what was shared
 *   grant_scope         the grant does not cover this camera
 *   share_unknown       the share is gone: withdrawn, declined, or expired
 *   forbidden           the generic refusal, for the same class of reason
 *   unauthorized        the sign-in behind this is no longer good
 *   account_disabled    the person was disabled
 *   site_unknown        the camera is not in a site they can see
 *
 * ⚠ AND `session_unknown` IS DELIBERATELY NOT HERE. It is the one that caused
 * this: coordination answers it for a session it no longer holds, which covers
 * a withdrawn share AND a server that restarted AND an ordinary lapse. One
 * code, three meanings, and only one of them is final -- so it retries, and if
 * access really did end the NEXT request is refused with a reason that says
 * so. One extra request is the whole cost of being right about this.
 */
export const ACCESS_ENDED_REASONS: ReadonlySet<string> = new Set([
  /* ── coordination's own, as it names them ────────────────────────── */
  "share_ended",
  "tower_not_permitted",
  "hub_not_permitted",
  "tower_revoked",
  "view_not_permitted",
  "account_disabled",
  "account_unknown",
  /* ── the older and the generic, still answered by some paths ─────── */
  "live_forbidden",
  "grant_permission",
  "grant_scope",
  "share_unknown",
  "share_revoked",
  "forbidden",
  "unauthorized",
  "account_removed",
  "site_unknown",
  "camera_not_shared",
]);

/**
 * Reasons that mean THE SESSION STOPPED AND MAY BE REOPENED.
 *
 * ⚠ LISTED RATHER THAN LEFT TO THE DEFAULT, even though the default already
 * retries, because these are the ones somebody will be tempted to add to the
 * set above. Every one of them is a MACHINE: a grant that lapsed, a session
 * the server no longer holds, a store or a device that was not there, a
 * forward that failed, a link that dropped, a restart. None is a statement
 * about a person, and a tile that stopped for any of them should simply come
 * back.
 *
 * `renewal_lapsed` and `session_gone` are the two that used to end views:
 * they are the ordinary end of a long watch and the ordinary result of a
 * server restart, and both were being read as "your access was withdrawn".
 */
export const RETRYABLE_REASONS: ReadonlySet<string> = new Set([
  "renewal_lapsed",
  "session_gone",
  "no_store",
  "no_account",
  "no_device",
  "viewer_left",
  "tower_offline",
  "hub_offline",
  "forward_failed",
  "link_lost",
  "server_restart",
]);

/**
 * Reasons that mean THE PERSON'S SIGN-IN ENDED, not their access to a camera.
 *
 * ⚠ A THIRD ANSWER, AND NEITHER OF THE OTHER TWO FITS IT. "Viewing ended"
 * sends somebody looking for a share that was never withdrawn, and retrying
 * asks a server that has already said who it will not talk to. The honest
 * move is the one the app already has for an expired sign-in: the sign-in
 * screen. Every other tile is in the same position, so this is not a per-tile
 * state at all.
 */
export const SIGNED_OUT_REASONS: ReadonlySet<string> = new Set([
  "login_session_revoked",
  "login_session_expired",
  "login_session_unknown",
]);

/** Has the person's SIGN-IN ended, rather than their access to this camera? */
export function signedOut(reason: string | null | undefined): boolean {
  if (typeof reason !== "string") return false;
  return SIGNED_OUT_REASONS.has(reason.trim().toLowerCase());
}

/** What to do about a refusal. */
export type Verdict = "ended" | "retry";

/**
 * The one decision: has access ended, or should this try again?
 *
 * ⚠ IT FAILS TOWARDS "retry", ALWAYS. `undefined`, `null`, `""`, a code
 * nobody here has heard of, a code sentry-core adds next month -- every one of
 * them retries. "Access ended" is a claim about somebody's business
 * relationship and this app may only make it when the server actually said so.
 *
 * Case and surrounding whitespace are forgiven because two services spell
 * their own constants and one of them will eventually shout.
 */
export function verdictFor(
  reason: string | null | undefined,
  /**
   * The server's own answer, where it gave one.
   *
   * ⚠ IT OUTRANKS THE LIST, AND THAT IS THE POINT OF THE NEW CONTRACT. The
   * list is this app's reading of codes it happens to know; `retryable` is
   * coordination's statement about the session it just ended. When they
   * disagree the server is right, because it is the one that knows whether a
   * share was withdrawn or a process restarted. The list stays as the
   * fallback for every path that does not carry the field yet -- an older
   * server, a refusal from somewhere else in the stack, no answer at all.
   */
  retryable?: boolean | null,
): Verdict {
  if (typeof retryable === "boolean") return retryable ? "retry" : "ended";
  if (typeof reason !== "string") return "retry";
  const code = reason.trim().toLowerCase();
  if (code === "") return "retry";
  /* A sign-in that ended is not a camera that ended. It is handled before
     this is asked; saying "retry" here keeps it out of the ended screen if
     anything ever reaches this with one. */
  if (SIGNED_OUT_REASONS.has(code)) return "retry";
  return ACCESS_ENDED_REASONS.has(code) ? "ended" : "retry";
}

/** Did access really end? The same decision, read the other way round. */
export function accessEnded(
  reason: string | null | undefined,
  retryable?: boolean | null,
): boolean {
  return verdictFor(reason, retryable) === "ended";
}

/* ======================================================================
 *  THE RECORD
 * ====================================================================== */

/** One interruption, as it goes into the console. */
export interface Interruption {
  /** The camera's pool key, `kln_x_000001:1`. */
  camera: string;
  /** What happened, in the player's own words: `dropped`, `renewal-refused`… */
  event: string;
  /** The server's reason code, verbatim, or null when it gave none. */
  reason: string | null;
  /** What this app decided to do about it. */
  action: "retry" | "ended" | "waiting" | "recovered";
  /** Which attempt this is, where one is being counted. */
  attempt?: number;
  /** The wait before the next try, where one was scheduled. */
  waitMs?: number;
}

/**
 * Write one interruption to the console.
 *
 * ⚠ THE CONSOLE IS THE RIGHT PLACE AND THE ONLY PLACE. A random drop at 3am
 * on one camera out of forty is not something a person can describe well
 * enough afterwards; what makes it traceable is a line with the time, the
 * camera, what happened and WHAT THE SERVER SAID, which is exactly what was
 * missing when "Viewing ended" started appearing on healthy sites. Nothing
 * here reaches the screen: an operator is told what a tile is doing by the
 * tile, in words, and a log line is for whoever is asked about it later.
 *
 * `console.info`, not `warn`: a reconnect that works is normal operation on a
 * radio link, and a console full of warnings about normal operation is a
 * console nobody reads.
 */
export function logInterruption(it: Interruption, out: Console = console): void {
  const parts = [
    new Date().toISOString(),
    "live",
    it.camera,
    it.event,
    `reason=${it.reason ?? "none"}`,
    `action=${it.action}`,
  ];
  if (it.attempt !== undefined) parts.push(`attempt=${it.attempt}`);
  if (it.waitMs !== undefined) parts.push(`in=${Math.round(it.waitMs / 100) / 10}s`);
  out.info(parts.join(" · "));
}
