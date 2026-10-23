/**
 * Is this page being served BY A HUB, standing on its own?
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE BUNDLE, TWO PLACES, AND THE SERVER DECIDES WHICH
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same dist serves sentri.watch and the hub's own dashboard at
 * `https://<hub>:9081/` -- on the kiosk TV at localhost, over USB at
 * 192.168.55.1, and on the site LAN. There is deliberately NO build flag for
 * this. A flag would mean two artefacts that look identical, and the failure
 * it produces is an Administration area on a kiosk whose endpoints answer 404,
 * or a Sharing page on a box with no internet to share over. `sentry-core`'s
 * own test says it in one line: "A build flag would put an Administration area
 * on the kiosk."
 *
 * ── THE SIGNAL ────────────────────────────────────────────────────────
 *
 * `GET /v1/capabilities`, which exists for exactly this and answers before a
 * login screen is drawn. It carries two things:
 *
 *   role             "hub" on a hub, "datacenter" on Kallon Cloud. The hub's
 *                    default is "hub" (`KALLON_NODE_ROLE`), and coordination's
 *                    own test asserts a hub's role is NOT "datacenter".
 *   features.sites   false on a hub, and permanently so. Sites, people and
 *                    shares do not exist there; it is not a degraded cloud.
 *
 * ⚠ THE TEST IS `role !== "datacenter"`, NOT `role === "hub"`. That is the
 * claim coordination actually makes and the one its test enforces. A third
 * role added later -- a regional node, a second kind of edge box -- is far
 * more likely to be hub-shaped than cloud-shaped, and the cost of being wrong
 * in that direction is a hidden Sharing page rather than a Sharing page that
 * 404s on a box with no uplink.
 *
 * ⚠ AND NOT ANSWERED YET IS NOT HUB MODE. `useCapabilities` returns `null`
 * until the probe lands, and this returns false for it. Hiding on `null` would
 * be the restrictive choice everywhere else in this app, but not here: these
 * screens must not FLASH. Everything gated on this is additionally gated on a
 * server feature that is itself false while `null`, so the only thing `null`
 * decides is whether Sharing appears for a moment on a cloud page, and it does
 * not.
 *
 * ── WHAT IT DOES NOT DECIDE ───────────────────────────────────────────
 *
 * Addresses. Every URL is already same-origin unless `VITE_COORDINATION_URL`
 * is set -- see `config.ts` -- and the hub build leaves it unset, so the page
 * talks to whatever served it at localhost, 127.0.0.1, 192.168.55.1 or the
 * LAN address with no per-hub configuration and no CORS. Hub mode is about
 * what the product SHOWS, not where it points.
 */

import type { Capabilities } from "@kallon/sentry-sdk";

/** The one role that is not an edge box. */
export const CLOUD_ROLE = "datacenter";

/**
 * Hub mode, from what the server said it is.
 *
 * `null` (not answered yet) is NOT hub mode -- see the note above.
 */
/**
 * The rule itself, over a bare role string.
 *
 * ⚠ TWO ENDPOINTS CARRY THIS ROLE AND THEY MUST AGREE. `/v1/capabilities`
 * answers it for the product gating below, and `/healthz` answers it for the
 * SIGN-IN screen, which has to decide before anybody has a session. One rule,
 * two carriers: a second copy of "is this a hub" is how the kiosk ends up
 * filling in a login on a page that then shows an Administration area.
 */
export function isHubRole(role: string | null | undefined): boolean {
  const word = typeof role === "string" ? role.trim().toLowerCase() : "";
  return word !== "" && word !== CLOUD_ROLE;
}

export function isHubMode(caps: Capabilities | null | undefined): boolean {
  if (!caps) return false;
  /* An EMPTY role falls back to the feature, because a server that sends no
     role at all is older than this field and `features.sites` predates it. */
  if (typeof caps.role !== "string" || caps.role.trim() === "") {
    return caps.features?.sites === false;
  }
  return isHubRole(caps.role);
}

/**
 * The opposite, named, because most call sites read better this way.
 *
 * "Does this server have sites, people and shares" is the question nine of
 * the ten gated screens are actually asking, and it is the same answer.
 */
export function hasSites(caps: Capabilities | null | undefined): boolean {
  return caps?.features?.sites === true;
}
