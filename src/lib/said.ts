/**
 * What to put on screen when a call does not go through. ONE place, for every
 * screen in the app.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE TWO THAT WERE SEEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * A site was asked to lend a camera it did not have. The picker said "This
 * site has no towers to lend yet", Accept was pressed anyway, and the card
 * showed, in red:
 *
 *     scope: must be a non-empty list of towers
 *
 * Then an administrator added a person, the person WAS created, and the page
 * said:
 *
 *     people list from /v1/admin/people is not the documented shape
 *
 * An API path, the word "documented", the word "shape", and a sentence about a
 * contract — in front of somebody whose job is cameras. The first came from a
 * server validator. The second came from our own client library, which is
 * worse: we wrote it, for ourselves, and then printed it at a customer.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────
 *
 * The person never sees an API path, a field name, validator text, an HTTP
 * status, an exception class, or the words "shape", "schema" or "documented".
 * Every message says what happened and what to do next. When we cannot show
 * what the server said, the detail goes to the console with a short reference
 * and the person is given that reference, so a support call has something to
 * go on.
 *
 * ── WHY NOT ALWAYS USE OUR OWN WORDS ──────────────────────────────────
 *
 * Because the server knows things this screen does not. "East Ridge has no
 * cameras yet, so there is nothing to ask them for" and "a share has to last
 * at least 5 minutes" both come from rules that live on the server because
 * that is where they are enforced. Replacing them with "That did not work"
 * throws away the only useful part.
 *
 * So: show what the server said, UNLESS it looks like it was written for a
 * programmer. The test for that is deliberately crude, because the cost of
 * being wrong is asymmetric — a slightly generic sentence is a small loss, a
 * validator string on a share card is a bug report from a customer.
 */

/** The shapes a refusal arrives in, from the SDK or from `fetch`. */
interface Refusal {
  readonly message?: unknown;
  readonly status?: unknown;
  readonly code?: unknown;
}

/**
 * Words that mean "this sentence was written for whoever wrote the code".
 *
 * Each one is here because it was seen, or because it is the same KIND of
 * thing as something that was seen. Order does not matter; any match refuses.
 */
const NOT_FOR_A_PERSON: readonly RegExp[] = [
  // An API path. `/v1/admin/people` reached a customer.
  /\/v\d+\//,
  // The contract vocabulary. Real English, but never in a sentence to a
  // person about their cameras.
  /\bshapes?\b/i,
  /\bschema\b/i,
  /\bdocumented\b/i,
  /\bpayload\b/i,
  /\bendpoint\b/i,
  // `field: message`, which is what a validator stringifies into.
  /^[a-z_][a-z0-9_]*:\s/,
  /\bfield:/i,
  // Languages leaking through.
  /Traceback|Exception|Error:|\bNone\b|\bNoneType\b|\bundefined\b|\bnull\b/,
  // A stack line, in either language.
  /\n\s*at\s/,
  /\bat [A-Za-z$_][\w$.]*\s*\(/,
  /\.(?:ts|tsx|js|mjs|py):\d+/,
  /:\d+:\d+/,
  // Anything in brackets or braces: JSON, a type, a generic.
  /[{}[\]<>]/,
  // Schema words, in the shapes a validator produces.
  /\bnon-empty\b/,
  /\bmust be an? (?:object|array|list|integer|string|boolean|number)\b/,
  /\bexpected \w+, got\b/,
  // snake_case is a field name, not a word.
  /\b[a-z]+_[a-z]+\b/,
  // An HTTP status, however it is dressed.
  /\bHTTP\b/i,
  /\b(?:status|code)\s*[:=]?\s*\d{3}\b/i,
];

/**
 * A bare 4xx/5xx status code, unless a unit word follows it.
 *
 * Separate from the list above because the guard matters: "429" is a status
 * code and "500 cameras" is a quantity, and a customer with a big site is
 * allowed to be told about 500 of something.
 */
const UNIT = String.raw`(?:second|minute|hour|day|week|month|year|camera|tower|mast|site|cell|person|people|share|clip|byte|[kmg]b|metre|meter|km|character|attempt|time|row)s?`;
const BARE_STATUS = new RegExp(String.raw`\b[45]\d{2}\b(?!\s*(?:${UNIT})\b)`, "i");

/**
 * Does this read like something a person wrote for a person?
 *
 * Exported for the tests, which is the only reason it is not inlined: the
 * rules above are the whole of the judgement and they should be visible.
 */
export function readsLikeASentence(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 400) return false;
  // A bare identifier with no spaces is a code, not a sentence.
  if (!t.includes(" ")) return false;
  if (BARE_STATUS.test(t)) return false;
  for (const pattern of NOT_FOR_A_PERSON) {
    if (pattern.test(t)) return false;
  }
  return true;
}

/**
 * The messages that belong to a machine code rather than to a sentence.
 *
 * ⚠ ONE TABLE, AND THIS IS IT. Screens used to keep their own: a `switch` in
 * the add-device drawer, a chain of `instanceof` in Settings, a fallback in
 * every loader. Each was reasonable and none of them knew about the others, so
 * "could not reach coordination" had four wordings and one of them said
 * "Signing in isn't available right now" on a page reached by somebody who was
 * already signed in.
 *
 * A code here is one the SERVER chose, or one of our own client's. Keys are
 * matched exactly; anything unknown falls through to the caller's fallback.
 */
const FOR_A_CODE: Readonly<Record<string, string>> = {
  // Our client could not read the answer. The person cannot do anything about
  // it, and the detail is in the console under the reference.
  response_invalid: "We could not read the server's answer.",
  network_error: "Could not reach coordination. Check the connection.",
  unauthorized: "You are signed out. Sign in again to carry on.",
  forbidden: "This is not yours to do.",
  // Claiming a tower, which has its own small vocabulary.
  claim_conflict: "Another account is already waiting for that code.",
  hub_offline: "That cell is offline, so nothing could be sent to it.",
  hub_timeout: "That cell did not answer. Try again in a moment.",
  cell_unknown: "That cell is not one you can add to.",
  site_unknown: "That site is not one you can add to.",
  name_taken: "Somebody in this organization already has that name.",
  no_org_slug: "This organization has no login name yet. Contact support.",
  too_many_attempts: "Too many attempts. Try again shortly.",

  /* ──────────────────────────────────────────────────────────────────────
      LIVE VIDEO, CAMERA CONTROL AND FOOTAGE
     ──────────────────────────────────────────────────────────────────────

     ⚠ THE ROUND THAT MADE THIS TABLE MISSED THE VIDEO PATHS ENTIRELY, and
     they are where a customer spends their day. A viewer whose share did not
     include steering pressed an arrow and was told

         PTZ FAILED — PTZ_FORBIDDEN

     which is a server enum, in capitals, on a camera tile. The mapper existed;
     the PTZ and footage helpers each kept their own list of codes and their own
     shouting fallback, so none of it came through here.

     EVERY code the live-video seam can produce now has a sentence, and the two
     helpers (`api/ptz.ts`, `api/recordings.ts`) ask this table. */

  // Permission, which is the one an ordinary viewer actually meets. A share is
  // per camera and per capability, so "wasn't included in what was shared with
  // you" is both true and the thing they can act on: ask for more.
  ptz_forbidden:
    "Moving this camera wasn't included in what was shared with you.",
  grant_permission:
    "Moving this camera wasn't included in what was shared with you.",
  not_authorized:
    "Moving this camera wasn't included in what was shared with you.",
  grant_scope: "This camera wasn't included in what was shared with you.",
  live_forbidden: "Live video wasn't included in what was shared with you.",
  recordings_forbidden:
    "Recorded footage wasn't included in what was shared with you.",

  // Time, which reads as permission to a person and is not the same thing.
  grant_expired: "Your access to this camera has ended.",
  session_unknown: "Your live view ended. Open it again to carry on.",

  // The camera and the tower, said as the person sees them.
  ptz_unavailable: "This camera cannot be moved.",
  control_not_configured: "Moving cameras isn't set up on this tower.",
  control_failed: "The camera didn't move. Try again.",
  ptz_failed: "The camera didn't move. Try again.",
  home_not_settable:
    "This camera's home position is set by calibration, not by hand.",
  rate_limited: "That's a lot of moves at once. Try again in a moment.",
  camera_unknown: "That camera isn't on this tower any more.",
  tower_offline: "This camera is offline right now.",
  tower_timeout: "The tower didn't answer. Try again.",
  tower_unknown: "This camera is no longer available.",
  stream_starting: "Starting the camera. Give it a moment.",

  // Footage.
  archive_disabled:
    "This tower isn't recording, so there's no footage to show.",
  archive_misconfigured: "Recording isn't set up on this tower yet.",
  archive_unavailable: "Footage isn't available right now.",
  snapshot_unavailable: "No picture is available from this camera right now.",
  recording_unsupported: "This camera doesn't keep recorded footage.",
  remote_clip_unsupported: "Clips can't be taken from this camera.",
  empty_clip: "There's no footage in the time you chose.",
  slice_too_long: "That clip is too long. Choose a shorter time.",

  // Capacity, which is nobody's mistake.
  hub_at_capacity:
    "Too many cameras are being watched at this site. Try again shortly.",
  dc_at_capacity: "Too many cameras are being watched. Try again shortly.",
  hub_media_unavailable: "The video service isn't available right now.",
  dc_media_unavailable: "The video service isn't available right now.",
};

/** What to add to a fallback so a support call has something to go on. */
export const SUPPORT_HINT = "if it keeps happening, contact support";

/** Four characters somebody can read down a phone. Not an identity. */
function reference(): string {
  const n = Math.floor(Math.random() * 0x10000);
  return n.toString(36).toUpperCase().padStart(4, "0").slice(-4);
}

/**
 * Put the technical detail where it can be read, and hand back the sentence
 * with a reference on it.
 *
 * `console.error` rather than `console.debug`: this is the branch where the
 * person has been given a reference and may well be reading it out, so the
 * matching line has to be visible in a console nobody has configured.
 */
function withReference(text: string, err: unknown): string {
  const ref = reference();
  try {
    console.error("[sentinel] " + ref, err);
  } catch {
    /* A console that throws is not a reason to lose the message. */
  }
  return `${text} (ref ${ref})`;
}

/**
 * The sentence to show for a failed call.
 *
 * `fallback` is what to say when the server's answer is not fit to show. Give
 * it the words for THIS action — "We could not load the people list. Refresh
 * the page" beats "Something went wrong", because it says what did not happen
 * and what to do about it.
 *
 * When the server's own words are discarded, or there were none, the error
 * goes to the console under a short reference and the reference is appended to
 * what the person reads. A screen never has to arrange that.
 */
/**
 * The same sentence, with no reference on it.
 *
 * For somewhere the words live for four seconds and then go: a PTZ chip on a
 * camera tile, a toast. The detail still reaches the console -- what is dropped
 * is the "(ref 4F2A)" the person has no time to read and no reason to quote
 * about a camera that moved on the next press.
 */
export function saidQuiet(err: unknown, fallback: string): string {
  const text = said(err, fallback);
  return text.replace(/\s*\(ref [0-9A-Z]{4}\)$/, "");
}

export function said(err: unknown, fallback = "That did not go through."): string {
  const e = (err ?? {}) as Refusal;
  const status = typeof e.status === "number" ? e.status : undefined;
  const code = typeof e.code === "string" ? e.code : "";

  /* THE ONES WORTH REPLACING EVEN WHEN THEY ARE READABLE. These say the same
     thing every time and a shorter sentence is a better one. */
  if (status === 401 || code === "unauthorized") return FOR_A_CODE.unauthorized;
  if (code === "network_error" || status === 0) return FOR_A_CODE.network_error;

  const message = typeof e.message === "string" ? e.message.trim() : "";

  /* A CODE WE HAVE WORDS FOR beats the server's sentence, because the words
     here were written for a person and the code is what the server actually
     decided. `response_invalid` is the one that matters most: its message is
     written for us and names a path.

     ⚠ AND IT IS ASKED BEFORE THE 403 RULE, WHICH IT WAS NOT.

     "This is not yours to do" is a fair thing to say about a 403 nobody has
     better words for. It was said about EVERY 403, because the status was read
     first -- so a viewer who pressed an arrow on a camera that was lent
     without steering was told the camera was not theirs, when the truth is
     that moving it was not part of what they were lent and the next step is to
     ask for it. Every `*_forbidden` row in the table was unreachable for the
     same reason. Found by photographing the screen. */
  if (code && Object.prototype.hasOwnProperty.call(FOR_A_CODE, code)) {
    const known = FOR_A_CODE[code];
    return code === "response_invalid" ? withReference(known, err) : known;
  }

  /* A refusal with no code we have words for, and nothing readable of its
     own. The generic sentence, which is better than the server's. */
  if (status === 403 && !message) return FOR_A_CODE.forbidden;

  if (status !== undefined && status >= 500) {
    return withReference(
      "Coordination had a problem with that. Try again in a moment.", err);
  }

  if (message && readsLikeASentence(message)) return message;
  /* Either there was no message, or it was written for a programmer. Both end
     up here, and both are worth a reference: the first is a failure nobody can
     describe, the second a sentence somebody may need read back to them. */
  return withReference(fallback, err);
}
