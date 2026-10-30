import { getCoordinationBaseUrl, webFetch } from "./client";
import { getSessionRef } from "./session";
import { endSessionIfUnauthorized } from "./auth";

/**
 * HOW MANY ALERTS ARE STILL NOBODY'S, and the one call that clears a view.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS TWO HAND-ROLLED CALLS AND NOT TWO SDK METHODS
 * ══════════════════════════════════════════════════════════════════════
 *
 * `@kallon/sentry-sdk` has no method for either route. The SDK is vendored
 * from a repository that is the source of truth for it and is not edited from
 * here (`npm run check:sdk` fails the build if it is), so the two calls live
 * in this app's own api layer in the shape `api/media.ts` already uses for
 * `GET /v1/viewer/sessions/{id}`: through `webFetch`, with the session's own
 * bearer, reading the body itself.
 *
 * ⚠ `webFetch`, NEVER A BARE `fetch` STORED ON SOMETHING. The note in
 * `api/client.ts` is the whole reason that helper exists: in a browser `fetch`
 * is brand-checked against `Window`, and a detached reference throws "Illegal
 * invocation" in Chrome while passing every Node test. One helper, one binding.
 *
 * They belong in the SDK when it next gains them, and that will be a deletion
 * here rather than an excavation: the shapes below are the wire's, named the
 * way the SDK names things, and nothing above this file knows the paths.
 *
 * ── WHY A SEPARATE COUNT AT ALL ───────────────────────────────────────
 *
 * The feed is the newest page of alerts, not all of them. Counting the rows
 * the browser happens to be holding answers a different question from "how
 * many are outstanding", and the two diverge the moment a fleet has been up
 * for a week: a card read 4 because four rows had been fetched, not because
 * four alerts were waiting. The server counts; this side draws the number.
 *
 * A device with nothing outstanding is ABSENT from `by_device` rather than
 * present with a zero, which is the same rule the rest of this product
 * follows on the wire: absence of a field and a field whose value is zero are
 * different facts, and only one of them needs sending.
 */

/** What the counts route answers, in this app's own names. */
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
 * Which alerts an "acknowledge all" is allowed to touch.
 *
 * Both are optional and both narrow. Sending neither is the fleet, which is
 * what the Alerts page asks for, because that page has no site or tower
 * selector of its own.
 */
export interface AckAllScope {
  readonly siteId?: string;
  readonly deviceId?: string;
}

/** A failure with the status on it, so callers can tell a 403 from the rest. */
export class AlertCountsError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "AlertCountsError";
    this.status = status;
  }
}

const COUNTS_PATH = "/v1/viewer/site-alerts/counts";
const ACK_ALL_PATH = "/v1/viewer/site-alerts/ack-all";

function requireBaseUrl(): string {
  const base = getCoordinationBaseUrl();
  if (!base) throw new AlertCountsError(0, "no coordination url");
  return base;
}

function authHeader(): Record<string, string> {
  const ref = getSessionRef();
  return ref ? { Authorization: `Bearer ${ref}` } : {};
}

/** 0 for "nothing answered", which is not a refusal and must not read as one. */
async function send(path: string, init: RequestInit): Promise<Response> {
  try {
    return await webFetch(requireBaseUrl() + path, init);
  } catch (err) {
    if (err instanceof AlertCountsError) throw err;
    throw new AlertCountsError(
      0,
      err instanceof Error ? err.message : "request failed",
    );
  }
}

function refuse(status: number, what: string): never {
  const err = new AlertCountsError(status, `${what} answered ${status}`);
  /* The one session rule every other call in this layer follows: a 401 is the
     login being gone, not this feature being unavailable. A 403 is not, and
     `isUnauthorized` is the single place that knows the difference. */
  endSessionIfUnauthorized(err);
  throw err;
}

/**
 * How many alerts are waiting, on the fleet and per device.
 *
 * `GET /v1/viewer/site-alerts/counts` -> `{total, by_device}`.
 *
 * ⚠ A MISSING ROUTE IS A REFUSAL, NOT A ZERO. A 404 from a node too old to
 * serve this means the number is UNKNOWN, and answering zero would paint
 * every card and the rail badge clean on a fleet that may be on fire. The
 * caller holds the error and draws nothing.
 */
export async function readAlertCounts(signal?: AbortSignal): Promise<AlertCounts> {
  const response = await send(COUNTS_PATH, {
    method: "GET",
    headers: { Accept: "application/json", ...authHeader() },
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) refuse(response.status, "the alert counts");

  let body: Record<string, unknown>;
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new AlertCountsError(0, "the counts body was not json");
  }
  return parseCounts(body);
}

/**
 * The wire's shape, read defensively.
 *
 * Exported for the tests, which drive it with the exact bodies the route
 * documents -- including the one a careless reader gets wrong, where a device
 * with nothing outstanding is simply not in the map.
 */
export function parseCounts(body: Record<string, unknown>): AlertCounts {
  const raw = body["by_device"];
  const byDevice = new Map<string, number>();
  if (raw && typeof raw === "object") {
    for (const [id, n] of Object.entries(raw as Record<string, unknown>)) {
      /* A non-number, a negative, a NaN: not a count, so not drawn. Zero is
         dropped too, because "absent" and "zero" have to end up as the same
         thing on screen whichever way the server chose to say it. */
      const value = typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
      if (value > 0) byDevice.set(id, value);
    }
  }
  const total = body["total"];
  return {
    total:
      typeof total === "number" && Number.isFinite(total) && total > 0
        ? Math.trunc(total)
        : 0,
    byDevice,
  };
}

/**
 * Acknowledge everything up to one alert, optionally within one scope.
 *
 * `POST /v1/viewer/site-alerts/ack-all` -> `{acknowledged}`.
 *
 * ⚠ `up_to` IS THE POINT OF THE ROUTE AND NOT A DETAIL. An operator presses
 * this having read a list; an alert raised while the dialog was open was not
 * in that list and has not been read by anybody. A bulk acknowledgement with
 * no upper bound would quietly claim it, and the one thing acknowledgement
 * means in this product is that a person saw it. So the newest row the screen
 * was showing is the bound, and anything newer stays outstanding.
 *
 * It is still the same one-way act as a single acknowledgement: there is no
 * un-acknowledge, and the first person to press it wins.
 *
 * @returns how many the server actually acknowledged.
 */
export async function ackAllSiteAlerts(
  upTo: string,
  scope: AckAllScope = {},
): Promise<number> {
  const response = await send(ACK_ALL_PATH, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeader(),
    },
    /* Only what narrows. An absent key is the fleet; a key carrying undefined
       would be `null` on the wire, which is a different claim. */
    body: JSON.stringify(ackAllBody(upTo, scope)),
  });
  if (!response.ok) refuse(response.status, "acknowledging the alerts");

  try {
    const body = (await response.json()) as Record<string, unknown>;
    const n = body["acknowledged"];
    return typeof n === "number" && Number.isFinite(n) ? Math.trunc(n) : 0;
  } catch {
    /* It succeeded. A body we could not read is not a reason to tell somebody
       their acknowledgement failed; the counts are re-read either way. */
    return 0;
  }
}

/** The request body, built in one place so a test can assert the wire. */
export function ackAllBody(
  upTo: string,
  scope: AckAllScope = {},
): Record<string, string> {
  return {
    up_to: upTo,
    ...(scope.siteId ? { site_id: scope.siteId } : {}),
    ...(scope.deviceId ? { device_id: scope.deviceId } : {}),
  };
}
