import type { SiteAlertCounts } from "@kallon/sentry-sdk";
import { getClient } from "./client";
import { endSessionIfUnauthorized } from "./auth";

/**
 * HOW MANY ALERTS ARE STILL NOBODY'S, and the one call that clears a view.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THIS USED TO BE TWO HAND-ROLLED FETCHES
 * ══════════════════════════════════════════════════════════════════════
 *
 * Both routes were agreed and being built in coordination while this side was
 * written, so they lived here as two `webFetch` calls with their own paths,
 * their own bearer, their own body reading and their own error class — in the
 * shape `api/media.ts` uses for the one session route the SDK has no method
 * for. The note that shipped with them said they belonged in the SDK when it
 * gained them, and that it would be "a deletion rather than an excavation".
 *
 * `@kallon/sentry-sdk@0.14.0` gained them, and this is the deletion: the
 * paths, the bearer, the status handling and the response parsing are all the
 * SDK's now, which also means they are validated the way every other route
 * is rather than read defensively here. What is left is the two things that
 * are genuinely this app's — the shape the screens want, and the sentence an
 * operator reads when the write is refused.
 *
 * ── WHY A SEPARATE COUNT AT ALL ───────────────────────────────────────
 *
 * The feed is the newest page of alerts, not all of them. Counting the rows
 * the browser happens to be holding answers a different question from "how
 * many are outstanding", and the two diverge the moment a fleet has been up
 * for a week: a card read 4 because four rows had been fetched, not because
 * four alerts were waiting. The server counts; this side draws the number.
 */

/** What the counts route answers, in the shape the screens read it in. */
export interface AlertCounts {
  /** Every unacknowledged alert this account may see. */
  readonly total: number;
  /**
   * Per device, and devices with none are ABSENT rather than zero.
   *
   * Keyed by the id the alert carried, which for the two hub types is the
   * HUB's id and not a tower's. Nothing here resolves that; a card looks
   * itself up and a hub id simply matches no card, which is correct.
   */
  readonly byDevice: ReadonlyMap<string, number>;
}

/** Empty, and a real answer: nothing is outstanding. */
export const NO_COUNTS: AlertCounts = { total: 0, byDevice: new Map() };

/**
 * The SDK's answer in this app's shape.
 *
 * A `Map` rather than the wire's object because every consumer asks the same
 * question — "this device, if any" — and `byDevice[id] ?? 0` over a plain
 * object is a prototype lookup waiting to answer `"constructor"`.
 *
 * ⚠ A ZERO IS DROPPED, so that a device the server omitted and a device the
 * server sent as `0` land in the same place on screen. The route omits them,
 * and `countLabel` draws nothing at zero either, so this is belt and braces
 * on the one distinction that must NOT reach a card: a pill reading `0` is a
 * claim about a site, and absence is not.
 */
export function countsFrom(counts: SiteAlertCounts): AlertCounts {
  const byDevice = new Map<string, number>();
  for (const [id, n] of Object.entries(counts.byDevice)) {
    if (Number.isFinite(n) && n > 0) byDevice.set(id, Math.trunc(n));
  }
  return {
    total: Number.isFinite(counts.total) && counts.total > 0
      ? Math.trunc(counts.total)
      : 0,
    byDevice,
  };
}

/**
 * How many alerts are waiting, on the fleet and per device.
 *
 * ⚠ A FAILURE IS NOT A ZERO. A 404 from a node too old to serve this route
 * means the number is UNKNOWN, and answering zero would paint every card and
 * the rail badge clean on a fleet that may be on fire. It throws, and the
 * caller holds the last number it had and draws nothing if it never had one.
 */
export async function readAlertCounts(
  signal?: AbortSignal,
): Promise<AlertCounts> {
  try {
    return countsFrom(
      await getClient().siteAlertCounts(signal ? { signal } : {}),
    );
  } catch (err) {
    /* A 401 is the login being gone, not this feature being unavailable. A
       403 is not, and `isUnauthorized` is the single place that knows the
       difference. */
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Which alerts an "acknowledge all" is allowed to touch, beside the anchor.
 *
 * All three are optional and all three narrow. Sending none of them with an
 * anchor is "everything down to the newest row I can see", which is what an
 * unfiltered fleet feed asks for.
 */
export interface AckAllWindow {
  /**
   * The NEAR end of the window, ISO-8601 — the start of the date range the
   * list on screen was filtered to.
   *
   * ⚠ SEND IT WHENEVER THE LIST IS FILTERED. Without it the sweep reaches
   * back past everything the operator had filtered OUT of view: a week
   * nobody had looked at, cleared by a click on a screen showing Tuesday.
   */
  readonly from?: string;
  readonly siteId?: string;
  readonly deviceId?: string;
}

/**
 * Acknowledge a window of alerts: at or after `from`, no newer than `upTo`.
 *
 * ⚠ `upTo` IS THE POINT OF THE ROUTE AND NOT A DETAIL. An operator presses
 * this having read a list; an alert raised while the dialog was open was not
 * in that list and has not been read by anybody. A bulk acknowledgement with
 * no upper bound would quietly claim it, and the one thing acknowledgement
 * means in this product is that a person saw it. So the newest row the screen
 * was showing is the bound, and anything newer stays outstanding. There is
 * deliberately no "acknowledge everything" on the route at all.
 *
 * It is still the same one-way act as a single acknowledgement: there is no
 * un-acknowledge, and the first person to press it wins.
 *
 * @returns how many rows the server actually changed. `0` is a normal answer.
 */
export async function ackAllSiteAlerts(
  upTo: string,
  window: AckAllWindow = {},
): Promise<number> {
  try {
    const result = await getClient().ackAllSiteAlerts({
      upTo,
      /* Only what narrows. An absent key is "no lower bound"; a key carrying
         `undefined` is `null` on the wire, which is a different claim. */
      ...(window.from !== undefined ? { from: window.from } : {}),
      ...(window.siteId !== undefined ? { siteId: window.siteId } : {}),
      ...(window.deviceId !== undefined ? { deviceId: window.deviceId } : {}),
    });
    return result.acknowledged;
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Why the sweep was refused, in one sentence an operator can act on.
 *
 * ⚠ A 400 FROM THIS ROUTE IS THREE DIFFERENT MISTAKES WITH THREE DIFFERENT
 * REMEDIES, and only the server knows which: the anchor could not be
 * resolved (reload the list), `from` could not be parsed, or `from` is later
 * than the anchor's own alert (the range ends before it starts). One sentence
 * of ours covering all three would have to say "try again", which is useless
 * advice for two of them — and the route was built to answer with the
 * remedy, so the remedy is what gets shown.
 *
 * Nothing changed, whichever it was. A refusal here acknowledges nothing.
 */
export function describeAckAllFailure(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;

  if (status === 400 || code === "invalid_request") {
    const sentence = (err as { message?: unknown } | null)?.message;
    if (typeof sentence === "string" && readable(sentence)) return sentence;
  }
  if (status === 401 || status === 403 || code === "not_authorized") {
    return "You don't have permission to acknowledge these alerts.";
  }
  if (status === 0 || code === "network_error") {
    return "Couldn't reach the site. Check the connection and try again.";
  }
  return "Couldn't acknowledge those alerts. Try again.";
}

/**
 * Is this message something a customer can be shown?
 *
 * ⚠ THE SDK SYNTHESISES A MESSAGE WHEN THE BODY IS NOT THE ERROR ENVELOPE,
 * from the first 200 characters of whatever came back — which for a proxy's
 * own 400 page is a slab of HTML, and for a status with no body at all is
 * `HTTP 400`. The route's three sentences are written for this screen; a
 * gateway's markup is not, and putting the wire on screen would break the
 * first writing rule in the loudest possible way.
 *
 * So the test is for a sentence rather than for a status: it has to start
 * like prose, end like prose, and be short enough to be one. Anything else
 * falls through to ours.
 */
function readable(message: string): boolean {
  const text = message.trim();
  if (text.length < 8 || text.length > 200) return false;
  if (!/^[A-Z]/.test(text)) return false;
  if (!/[.!?]$/.test(text)) return false;
  return !/[<>{}]|\bHTTP\b|_/.test(text);
}
