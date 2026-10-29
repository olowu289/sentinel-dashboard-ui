import type {
  AlertEvent,
  SiteAlert,
  SiteAlertList,
  SiteAlertQuery,
} from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * SITE ALERTS — the four a customer reads, and the channel they arrive on.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THERE USED TO BE NO BACKEND HERE AT ALL
 * ══════════════════════════════════════════════════════════════════════
 *
 * Until this round the alert feed was six fixtures in `lib/data.ts`, loaded on
 * every fleet, naming towers no real account has. The note in `App.tsx` that
 * argued for taking them out said the way back was "a real feed, or a mark on
 * screen". This is the real feed: `GET /v1/viewer/site-alerts` for the list,
 * `GET /v1/viewer/events` for live, `POST .../ack` for the one write.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ─────────────────────────
 *
 * It does not poll. The SDK's `subscribeSiteAlerts` holds a `fetch()` body
 * reader on the event stream and re-reads the list with `since=` on every
 * drop — and drops are EXPECTED here rather than exceptional: a slow reader is
 * closed rather than waited for, because the publisher is the loop watching
 * the fleet, and a node holds at most 64 streams. A poll beside that would be
 * a second, lossier answer to a question already being answered.
 *
 * It does not cache a clip URL. `url` and `download_url` are minted per
 * request and a presigned bucket URL lives fifteen minutes; `key` is the
 * stable identity. See the 403 path in `AlertDetail`.
 *
 * It does not take an account parameter, because no route accepts one: the
 * scope is computed from identity through the same choke point every other
 * viewer route goes through. A second way to say "whose alerts" is how one
 * customer ends up reading another's.
 */

/** The alerts this account may see, newest first, with the colours map. */
export async function listSiteAlerts(
  query: SiteAlertQuery = {},
): Promise<SiteAlertList> {
  try {
    return await getClient().listSiteAlerts(query);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * One alert, re-read.
 *
 * ⚠ THIS IS ALSO HOW FRESH CLIP URLS ARE OBTAINED, and it is the only way.
 * The URLs on an alert were minted for the request that returned it, so a clip
 * opened half an hour after the feed loaded is a dead link. Re-reading the
 * alert is cheap and is what the server intends; refreshing one clip is not
 * offered by any route.
 */
export async function getSiteAlert(id: string): Promise<SiteAlert> {
  try {
    return await getClient().getSiteAlert(id);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Acknowledge, and take the answer as the truth.
 *
 * ⚠ NO BODY IS SENT AND NONE SHOULD BE. Who acknowledged is the authenticated
 * caller; a name in the request would be an unverified claim about a person
 * written into an audit fact. That is exactly why `App.tsx` carried a visibly
 * fake `acknowledgedBy` placeholder rather than the session's own name while
 * there was no route — the honest state was a placeholder, and the real one
 * has to come back from the server. It does now.
 *
 * One-way, and the first one wins: a second person opening the same alert has
 * not re-noticed it.
 */
export async function ackSiteAlert(id: string): Promise<SiteAlert> {
  try {
    return await getClient().ackSiteAlert(id);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * The live channel. Returns a handle whose `stop()` is idempotent.
 *
 * Everything hard about it is in the SDK: frames split across reads, the
 * 15-second keepalive, out-of-order updates dropped by `rev`, and the recovery
 * read on every drop. What is left here is the session guard — a stream that
 * dies because the session was revoked must end the session rather than
 * reconnect against a dead credential for ever.
 */
export function subscribeSiteAlerts(handlers: {
  onAlert: (event: AlertEvent) => void;
  onError?: (err: unknown) => void;
  onOpen?: () => void;
  since?: number;
}): { stop: () => void; done: Promise<void> } {
  return getClient().subscribeSiteAlerts({
    onAlert: handlers.onAlert,
    onError: (err) => {
      endSessionIfUnauthorized(err);
      handlers.onError?.(err);
    },
    ...(handlers.onOpen ? { onOpen: handlers.onOpen } : {}),
    ...(handlers.since !== undefined ? { since: handlers.since } : {}),
  });
}

/**
 * Why the feed could not be read, in one sentence an operator can act on.
 *
 * Same shape and the same discipline as `describeRecordingFailure`: no code,
 * no endpoint, no field name, and one sentence.
 */
export function describeAlertFailure(err: unknown): string {
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  if (status === 401 || status === 403 || code === "forbidden" || code === "unauthorized") {
    return "Alerts weren't included in what was shared with you.";
  }
  if (status === 404 || code === "not_found") {
    /* An older hub with no alert routes at all. "Not set up here" rather than
       "not found": the second describes a URL and the first describes the
       site, and only one of them is the customer's situation. */
    return "Alerts aren't set up on this site yet.";
  }
  if (status === 0 || code === "network_error") {
    return "Couldn't reach the site for alerts. Check the connection.";
  }
  if (typeof status === "number" && status >= 500) {
    return "The site couldn't list its alerts. Try again in a moment.";
  }
  if (code) console.error("[alerts] list failed:", code, err);
  return "Alerts couldn't be loaded. Try again.";
}
