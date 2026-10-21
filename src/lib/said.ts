/**
 * What to put on screen when the server says no.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE ONE THAT WAS SEEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * A site was asked to lend a camera it did not have. The picker said "This
 * site has no towers to lend yet", Accept was pressed anyway, and the card
 * showed, in red:
 *
 *     scope: must be a non-empty list of towers
 *
 * A field name, a schema word, and a sentence written for whoever wrote the
 * validator. The server says that properly now, and this is the second half:
 * a client that shows whatever arrives will show whatever arrives, including
 * from an older server, a proxy, or a route nobody thought about.
 *
 * ── WHY NOT JUST SHOW OUR OWN TEXT ALWAYS ─────────────────────────────
 *
 * Because the server knows things this screen does not. "Test Site has no
 * cameras yet" and "a share has to last at least 5 minutes" are both better
 * than anything a form could guess, and both come from rules that live on the
 * server because that is where they are enforced. Replacing them with "That
 * did not work" would be throwing away the only useful part.
 *
 * So: show what the server said, UNLESS it looks like it was written for a
 * programmer. The test for that is deliberately crude, because the cost of
 * being wrong is asymmetric -- a slightly generic sentence is a small loss, a
 * stack trace on a share card is a bug report from a customer.
 */

/** The shapes a refusal arrives in, from the SDK or from `fetch`. */
interface Refusal {
  readonly message?: unknown;
  readonly status?: unknown;
  readonly code?: unknown;
}

/**
 * Does this read like something a person wrote for a person?
 *
 * Exported for the tests, which is the only reason it is not inlined: the
 * rules below are the whole of the judgement and they should be visible.
 */
export function readsLikeASentence(text: string): boolean {
  const t = text.trim();
  if (t.length < 4 || t.length > 400) return false;
  // `field: message` is the shape a validator stringifies into, and the one
  // that actually reached a card.
  if (/^[a-z_][a-z0-9_]*:\s/.test(t)) return false;
  // A bare identifier with no spaces is a code, not a sentence.
  if (!t.includes(" ")) return false;
  // Python and JavaScript leaking through.
  if (/Traceback|Exception|Error:|\bNone\b|\bNoneType\b|\bundefined\b|\bnull\b/.test(t)) {
    return false;
  }
  if (/[{}[\]<>]/.test(t)) return false;
  // Schema words. These are real English, so they are only refused when they
  // appear in the shapes a validator produces.
  if (/\bnon-empty\b|\bmust be an? (object|array|list|integer|string|boolean)\b/.test(t)) {
    return false;
  }
  if (/\b[a-z]+_[a-z]+\b/.test(t)) return false;   // snake_case field names
  return true;
}

/**
 * The sentence to show for a failed call.
 *
 * `fallback` is what to say when the server's answer is not fit to show. Give
 * it the words for THIS action -- "That share did not go through" beats
 * "Something went wrong" because it says what did not happen.
 */
export function said(err: unknown, fallback = "That did not go through."): string {
  const e = (err ?? {}) as Refusal;
  const status = typeof e.status === "number" ? e.status : undefined;

  /* THE ONES WORTH REPLACING EVEN WHEN THEY ARE READABLE. These say the same
     thing every time and a shorter sentence is a better one. */
  if (status === 401) return "You are signed out. Sign in again to carry on.";
  if (status === 403 && typeof e.message !== "string") {
    return "This is not yours to do.";
  }
  if (e.code === "network_error" || status === 0) {
    return "Could not reach coordination. Check the connection.";
  }
  if (status !== undefined && status >= 500) {
    return "Coordination had a problem with that. Try again in a moment.";
  }

  const message = typeof e.message === "string" ? e.message.trim() : "";
  if (message && readsLikeASentence(message)) return message;
  return fallback;
}
