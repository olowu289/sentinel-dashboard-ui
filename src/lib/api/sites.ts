/**
 * Sites, people and sharing: the read and write calls, and the capability that
 * decides whether any of them exist.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE CAPABILITY GATE IS NOT A PREFERENCE
 * ══════════════════════════════════════════════════════════════════════
 *
 * This bundle serves two servers. `scripts/build-hub-dashboard.sh` builds it
 * with `VITE_COORDINATION_URL` unset, so it talks to whatever origin served it
 * — which on a hub is the hub's own coordination, offline, with no sites, no
 * people and no shares. The cloud build points at the DC, which has all three.
 *
 * So the Administration area and the Shares view are gated on
 * `GET /v1/capabilities`, which needs no token and is the server telling us
 * what it is. **Not on a build flag**: a build flag would put an Administration
 * area on the hub kiosk, where every one of these routes answers 404, and the
 * kiosk is the screen nobody is watching when it breaks.
 *
 * `sites: false` is a hub's NORMAL and PERMANENT state, not a degraded cloud.
 * Nothing should retry it, warn about it, or offer to turn it on.
 *
 * ── THIS IS NOT THE ACCESS CONTROL ─────────────────────────────────────
 *
 * Same rule as `lib/features.ts`: hiding a screen hides a screen. Every route
 * here is enforced on the DC by `registry/access.py`, and the admin paths
 * answer 403 for a site user whatever this file renders. This exists so a
 * customer is not shown a product that cannot work, not to keep anybody out.
 */

import { getClient } from "@/lib/api/client";
import type {
  AddDeviceResponse,
  AuditResponse,
  Capabilities,
  CellDetailResponse,
  CellListResponse,
  PeopleListResponse,
  Person,
  SentryClient,
  Share,
  ShareListResponse,
  ShareScopeEntry,
  SiteDetailResponse,
  SiteListResponse,
} from "@kallon/sentry-sdk";

/** A hub, which has none of this. The honest default before the probe answers. */
export const NO_SITES: Capabilities = {
  role: "hub",
  features: { sites: false },
};

/**
 * What this server is. Cached for the life of the page.
 *
 * One request, once: the answer cannot change under a running tab (a hub does
 * not become a DC), and a screen that re-probed on every mount would put a
 * request on the wire for a value it already had.
 */
let probe: Promise<Capabilities> | null = null;

export function capabilities(): Promise<Capabilities> {
  if (probe === null) {
    probe = getClient()
      .capabilities()
      .catch(() => {
        // A FAILED PROBE READS AS A HUB. The restrictive direction, for the
        // same reason `lib/features.ts` defaults restrictively: the cost of
        // being wrong this way is a screen an admin has to reload for, and the
        // cost of the other way is an Administration area that 404s on every
        // click.
        return NO_SITES;
      });
  }
  return probe;
}

/** For tests and for sign-out, which should not carry one account's answer. */
export function resetCapabilities(): void {
  probe = null;
}

export function listSites(): Promise<SiteListResponse> {
  return getClient().listSites();
}

export function getSite(siteId: string): Promise<SiteDetailResponse> {
  return getClient().getSite(siteId);
}

export function listShares(): Promise<ShareListResponse> {
  return getClient().listShares();
}

/**
 * What starting a share takes.
 *
 * ⚠ TAKEN FROM THE SDK, NOT RESTATED. This was a hand-written copy of the
 * same shape, and the first time it drifted was the moment the SDK learned
 * that a request carries no scope and an admin names both sites: the copy
 * still said one permissive object, so nothing here failed to compile and a
 * request could still go out asserting permissions it had no business
 * asserting.
 */
export type NewShareRequest = Parameters<SentryClient["createShare"]>[0];

export function createShare(req: NewShareRequest): Promise<Share> {
  return getClient().createShare(req);
}

export function acceptShare(
  shareId: string,
  changes: {
    scope?: readonly ShareScopeEntry[];
    live?: boolean;
    ptz?: boolean;
    playback?: boolean;
    playbackFrom?: string;
    playbackTo?: string;
    durationSec?: number;
  } = {},
): Promise<Share> {
  return getClient().acceptShare(shareId, changes);
}

export function declineShare(shareId: string): Promise<Share> {
  return getClient().declineShare(shareId);
}

export function revokeShare(shareId: string): Promise<Share> {
  return getClient().revokeShare(shareId);
}

/**
 * More time, measured from now. Only the site that OWNS the cameras may.
 *
 * A borrowing site that wants longer asks again, which is one click and
 * leaves a record of having asked.
 */
export function extendShare(shareId: string, durationSec: number): Promise<Share> {
  return getClient().extendShare(shareId, durationSec);
}

/* ------------------------------ administration ------------------------- */

export function adminListShares(): Promise<ShareListResponse> {
  return getClient().adminListShares();
}

export function adminCreateSite(name: string) {
  return getClient().adminCreateSite(name);
}

export function adminRenameSite(siteId: string, name: string) {
  return getClient().adminUpdateSite(siteId, { name });
}

export function adminSetSiteHubs(siteId: string, hubs: readonly string[]) {
  return getClient().adminSetSiteHubs(siteId, hubs);
}

export function adminListPeople(): Promise<PeopleListResponse> {
  return getClient().adminListPeople();
}

export function adminCreatePerson(req: {
  login: string;
  password: string;
  role?: "admin" | "site_user";
  sites?: readonly string[];
}): Promise<void> {
  return getClient().adminCreatePerson(req);
}

export function adminSetPersonSites(
  accountId: string,
  sites: readonly string[],
): Promise<void> {
  return getClient().adminUpdatePerson(accountId, { sites });
}

export function adminSetPersonStatus(
  accountId: string,
  status: "active" | "disabled",
): Promise<void> {
  return getClient().adminUpdatePerson(accountId, { status });
}

/**
 * Remove a person from the organization.
 *
 * Gone from the People screen, signed out at once, out of every site, unable
 * to sign in. The account row is KEPT so the audit log can still name them,
 * and the removal row carries the name for exactly that.
 */
export function adminRemovePerson(accountId: string): Promise<{ name: string }> {
  return getClient().adminRemovePerson(accountId);
}

export function adminResetPassword(
  accountId: string,
  password: string,
): Promise<void> {
  return getClient().adminResetPassword(accountId, password);
}

export function adminAudit(filter: {
  action?: string;
  accountId?: string;
  deviceId?: string;
  limit?: number;
  offset?: number;
  /** The readable groups the website shows. Filtered by the SERVER. */
  groups?: readonly string[];
  since?: string;
  until?: string;
}): Promise<AuditResponse> {
  return getClient().adminAudit(filter);
}

/* ------------------------------------------------------------------ *
 * Cells and towers
 *
 * A CELL IS A HUB, NAMED. The split below is the one worth knowing: `addCell`
 * and `addTower` are the only writes a SITE USER may make, and they work on
 * their own sites. Everything else here needs an administrator, and the server
 * says so with a 403 whatever this file does.
 * ------------------------------------------------------------------ */

export function listCells(): Promise<CellListResponse> {
  return getClient().listCells();
}

export function getCell(hubId: string): Promise<CellDetailResponse> {
  return getClient().getCell(hubId);
}

/**
 * Add a cell. Returns a PENDING claim, not a cell: it appears when the hub
 * enrols against the code, into the site chosen here.
 */
export function addCell(req: {
  siteId: string;
  name: string;
  pairingCode: string;
}): Promise<AddDeviceResponse> {
  return getClient().addCell(req);
}

/**
 * Add a tower to a cell.
 *
 * Two normal outcomes, and the caller has to tell them apart for the person
 * watching: the cell was asked and is waiting, or the cell is OFFLINE and this
 * is queued until it reconnects (`pending.queued`).
 */
export function addTower(req: {
  hubId: string;
  name: string;
  pairingCode: string;
}): Promise<AddDeviceResponse> {
  return getClient().addTower(req);
}

export function adminRenameCell(hubId: string, name: string) {
  return getClient().adminRenameCell(hubId, name);
}

/**
 * Move a cell to another site.
 *
 * ⚠ `shares_ended` COMES BACK FULL when the move ended agreements. Tell both
 * sides; a feed that simply stops is the thing this product does not do.
 */
export function adminMoveCell(hubId: string, siteId: string) {
  return getClient().adminMoveCell(hubId, siteId);
}

export function adminRemoveCell(hubId: string) {
  return getClient().adminRemoveCell(hubId);
}

export function adminRenameTower(deviceId: string, name: string) {
  return getClient().adminRenameTower(deviceId, name);
}

export function adminMoveTower(deviceId: string, hubId: string) {
  return getClient().adminMoveTower(deviceId, hubId);
}

export function adminReplaceTower(deviceId: string, pairingCode: string) {
  return getClient().adminReplaceTower(deviceId, pairingCode);
}

/**
 * Remove a tower.
 *
 * ⚠ ITS RECORDINGS STAY until normal retention, because they may be evidence.
 * Say that before the click, not after it.
 */
export function adminRemoveTower(deviceId: string) {
  return getClient().adminRemoveTower(deviceId);
}

/** Delete a site. Refused with `site_not_empty` while anything is in it. */
export function adminRemoveSite(siteId: string) {
  return getClient().adminRemoveSite(siteId);
}

/**
 * Add a person. A NAME, not a login: their login is `name.organization` and
 * the organization half is the admin's own. The returned person carries the
 * whole login, which is the one moment it should be shown.
 */
export function adminAddPerson(req: {
  name: string;
  password: string;
  role?: "admin" | "site_user";
  sites?: readonly string[];
}): Promise<Person> {
  return getClient().adminAddPerson(req);
}

/**
 * Correct a typo in a person's name. Changes their LOGIN, so tell them; does
 * not change their account id, so the audit log still resolves to them.
 */
export function adminRenamePerson(accountId: string, name: string): Promise<Person> {
  return getClient().adminRenamePerson(accountId, name);
}
