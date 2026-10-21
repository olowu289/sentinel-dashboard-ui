/**
 * Sites, people and sharing — the model that replaced one shared login.
 *
 * ## Why this is a module of its own
 *
 * `models.ts` and `validate.ts` describe the viewer API of §4.2: towers,
 * sessions, PTZ, recordings. These shapes are a different surface with a
 * different lifetime, served by `/v1/sites`, `/v1/shares`, `/v1/admin/*` and
 * `/v1/capabilities`, and a consumer that only renders a camera wall should not
 * have to import them.
 *
 * ## Read `capabilities` before rendering anything
 *
 * **The same bundle serves two very different servers.** A hub serves the
 * dashboard from its own coordination with no internet, and a hub has no sites,
 * no people and no shares: every path here answers `404` there. The cloud (the
 * DC) has all of them. `GET /v1/capabilities` is how a client tells them apart,
 * it needs no token, and it is the only thing that should gate an
 * Administration area. A client that renders one because of a build flag will
 * render it on the hub too.
 *
 * ## Shapes are structural, not exhaustive
 *
 * Same rule as `validate.ts`: required fields are checked for type, unknown
 * fields pass through. A validator that rejected a field the server added last
 * week would turn a compatible change into an outage.
 */

import { ValidationError } from "./errors.js";

/* ------------------------------------------------------------------ *
 * Types
 * ------------------------------------------------------------------ */

/** What this coordination node can do. From `GET /v1/capabilities`. */
export interface Capabilities {
  /** `"hub"` or `"datacenter"`. Informational; gate on `features`. */
  readonly role: string;
  readonly features: {
    /**
     * Sites, people and shares exist here.
     *
     * `false` on a hub, and that is not a degraded cloud: it is the hub's
     * normal and permanent state. A client must render no Administration area,
     * no Shares view and no site switcher when this is false.
     */
    readonly sites: boolean;
  };
}

export type SiteStatus = "active" | "archived";

export interface Site {
  readonly site_id: string;
  readonly name: string;
  readonly status: SiteStatus;
  readonly created_at: string;
  /** Hub ids in this site. Present on the list, absent on the detail. */
  readonly hubs?: readonly string[];
  /** Account ids. Present on the detail, absent on the list. */
  readonly members?: readonly string[];
}

/** One hub and the towers it reports. The product calls this a "cell". */
export interface Cell {
  readonly hub_id: string;
  readonly towers: readonly string[];
}

/**
 * Another site in the same organization, as a NAME and an id.
 *
 * ⚠ THIS IS THE WHOLE OF WHAT ONE SITE KNOWS ABOUT ANOTHER, and it is
 * deliberate. A request has to name a site, so a site has to be nameable; its
 * hubs, masts, people and camera count are exactly what a share exists to hand
 * over on purpose, and sending them alongside the name would give that away
 * for free.
 */
export interface SiteName {
  readonly site_id: string;
  readonly name: string;
  /**
   * Does this site have ANY camera?
   *
   * ⚠ ONE BIT, AND A DELIBERATE EXCEPTION. A site knows another site's NAME
   * and nothing else -- not its hubs, not its masts, not how many cameras it
   * has -- because those are exactly what a share exists to hand over
   * deliberately. This is the one thing that leaks, and it is the smallest
   * thing that stops a dead end: a request to a site with no cameras can
   * never become anything, so such a site is not offered as one to ask.
   *
   * Absent on a server that predates it. Read an absent value as TRUE and let
   * the server refuse: hiding every site because an older DC did not say is
   * worse than offering one that turns out to be empty.
   */
  readonly has_cameras?: boolean;
}

export interface SiteListResponse {
  readonly sites: readonly Site[];
  /**
   * Every OTHER site in this organization, by name. The ones you can ask.
   *
   * Empty for an admin, who already sees them all in `sites`. Absent from a
   * server that predates it, which a caller reads as "no directory" rather
   * than as "no other sites".
   */
  readonly others?: readonly SiteName[];
  /**
   * Hubs in this organization that are in no site.
   *
   * **Admins only**, and absent for everyone else rather than empty: a site
   * user is not told that unplaced hubs exist. This is the only place in the
   * product they appear, which is why they are not simply hidden from the
   * admin too.
   */
  readonly unassigned_hubs?: readonly string[];
}

export interface SiteDetailResponse {
  readonly site: Site;
  readonly cells: readonly Cell[];
}

export type ShareDirection = "request" | "offer";
export type ShareStatus = "pending" | "active" | "declined" | "revoked" | "expired";

/**
 * The longest message one site may send another, which the server enforces.
 * Exported so a box can count down instead of being refused after sending.
 */
export const SHARE_MESSAGE_MAX = 500;

/**
 * What a share lasts by default when nobody says otherwise: fifteen minutes.
 *
 * ⚠ THE SHORT ONE IS THE SAFE ONE. A share is somebody else's cameras, and
 * the failure that matters is the one nobody notices: a share that outlives
 * the reason for it. Fifteen minutes covers "our truck is at your gate" and
 * runs out on its own; anything longer should be a decision somebody typed.
 */
export const SHARE_DEFAULT_SEC = 15 * 60;

/**
 * The shortest and longest a share may last, which the server enforces.
 *
 * Exported so a box can refuse an impossible number where somebody typed it,
 * with the same limits the server would answer with, instead of sending it and
 * explaining a 422.
 *
 * ⚠ FIVE MINUTES IS A FLOOR, NOT A PREFERENCE. A share shorter than that can
 * expire while a browser is still negotiating WebRTC, and the renewal the
 * session layer runs on works in fifteen-minute grants -- so a two-minute share
 * is a share nobody can finish opening.
 *
 * ⚠ THIRTY DAYS IS A CEILING FOR THE SAME REASON THE DEFAULT IS SHORT. Past
 * that, lending stops being the thing this is for: a camera somebody should see
 * for a month is a camera their site should be given, in Administration, where
 * it is visible and reviewable. The server's old limit was a year and a day,
 * which was a guard against a typo rather than a policy about sharing.
 */
export const SHARE_MIN_SEC = 5 * 60;
export const SHARE_MAX_SEC = 30 * 24 * 60 * 60;

/** One tower, and optionally which of its cameras, inside a share's scope. */
export interface ShareScopeEntry {
  readonly device_id: string;
  /** Absent means every camera on that tower. */
  readonly cameras?: readonly number[];
}

export interface Share {
  readonly share_id: string;
  readonly direction: ShareDirection;
  readonly status: ShareStatus;
  readonly owner_site_id: string;
  /** The name the admin gave that site. Sites know each other by name only. */
  readonly owner_site_name: string;
  readonly viewer_site_id: string;
  readonly viewer_site_name: string;
  readonly scope: readonly ShareScopeEntry[];
  readonly live: boolean;
  readonly ptz: boolean;
  readonly playback: boolean;
  /** The window of FOOTAGE, absolute. Null when playback is not granted. */
  readonly playback_from: string | null;
  readonly playback_to: string | null;
  /** Every share expires. There is no unlimited option. */
  readonly expires_at: string;
  readonly created_at: string;
  readonly decided_at: string | null;
  /**
   * How long the side that STARTED this asked for, in seconds.
   *
   * ⚠ NOT WHAT IT ENDED UP BEING. `expires_at` is the live answer and this
   * is the question: on a request the asker says how long they want, the owner
   * answers with any length within {@link SHARE_MIN_SEC}..{@link SHARE_MAX_SEC},
   * and the card that lets them answer opens on what was asked. Keeping it
   * means "they asked for four hours, you gave one" is still sayable after the
   * accept has rewritten the expiry.
   *
   * On an offer it is what the offer said, which is also what it became --
   * an offer is accepted as sent.
   *
   * Absent from a server that predates it, and read as null rather than
   * guessed from `expires_at - created_at`: a pending share's expiry is the
   * asked length, but an accepted one's is not, and a number that is sometimes
   * the answer to a different question is worse than no number.
   */
  readonly asked_duration_sec?: number | null;
  /**
   * The ORGANIZATION'S ADMINISTRATOR made this, not the owning site.
   *
   * An admin share is an OFFER: it lends the owner site's cameras to the
   * viewer site, and the VIEWER accepts or declines it. The only thing that
   * differs is who started it, which is why this is a flag and not a third
   * `direction`.
   *
   * ⚠ IT CHANGES WHOSE SHARE IT IS TO UNDO. The owning site never agreed to
   * it, so it has nothing to withdraw: `can_answer`, `can_end` and
   * `can_extend` all come back false for that side, and its card is an
   * information card. The administrator can end it and the borrowing site can
   * always hand it back.
   *
   * Absent on a server that predates it, read as false, which is what every
   * share made by a site is.
   */
  readonly by_admin?: boolean;
  /**
   * What the site that started this SAID.
   *
   * ⚠ REQUIRED ON A REQUEST, and the only thing the site being asked has
   * to decide on: a request names no cameras, because the site asking cannot
   * know what the other has. Optional on an offer, which carries its own
   * meaning in its scope and duration.
   *
   * Render it verbatim. It is a person writing to another person.
   */
  readonly message: string | null;
  /**
   * True when one of my sites OWNS the cameras. Only on `/v1/shares`.
   *
   * ⚠ A FACT ABOUT SITES, NOT A PERMISSION. Do not gate a button on it.
   * An admin is in every site, so it is true of every share in the
   * organization; and for an OFFER the side that answers is the VIEWER, not
   * the owner. Deriving "may I answer this" from it put an offer's card back
   * in front of the site that sent it, and gave an administrator an Accept
   * button on an agreement between two other sites. Use {@link can_answer}.
   */
  readonly incoming?: boolean;
  /** True when one of my sites RECEIVES the access. See {@link incoming}. */
  readonly outgoing?: boolean;
  /**
   * May THIS account accept or decline it, right now.
   *
   * The server's answer, not a derivable one: it is false for an admin (who
   * may start a share and end one, but never agree on a site's behalf), false
   * for whoever created it, false unless this account is in the site that must
   * answer, and false if they are in BOTH sites -- they already see both, so
   * there is nothing to agree to.
   *
   * ⚠ THE CARD AND THE BUTTONS GATE ON THIS AND NOTHING ELSE. Absent from a
   * server that predates it, which a caller reads as "cannot": the restrictive
   * direction, because the cost of being wrong the other way is one person
   * negotiating both halves of an agreement.
   */
  readonly can_answer?: boolean;
  /** May this account cut it off (or withdraw it while pending). */
  readonly can_end?: boolean;
  /** May this account give it longer. The lending side, and an admin. */
  readonly can_extend?: boolean;
}

export interface ShareListResponse {
  readonly shares: readonly Share[];
}

export interface Person {
  readonly account_id: string;
  /**
   * A person's login is `name.organization` — `dave.kaduna-mine`.
   *
   * ⚠ IT IS A CREDENTIAL, AND A COLUMN OF CREDENTIALS IS A WORSE LIST THAN A
   * COLUMN OF NAMES. Show `name` in a list; show this where somebody is being
   * TOLD their login, which happens once, when they are added. An
   * ORGANIZATION's own login — the administrator — has no dot and no `name`.
   */
  readonly login: string;
  /**
   * The half before the dot. Absent on an organization's own login, which is
   * what the administrator is.
   */
  readonly name?: string;
  /**
   * The name this person had before an admin corrected a typo.
   *
   * Present only after a rename, and there so a list can read
   * `dele (was chi)` for as long as the old name still means something to
   * whoever is reading it. The audit ledger records `account_id` and never a
   * name, which is what makes renaming safe at all.
   */
  readonly was?: string;
  /** `"admin"`, `"site_user"`, or `"owner"` which READS AS ADMIN. */
  readonly role: string;
  readonly status: string;
  readonly sites: readonly string[];
  readonly created_at?: string;
}

export interface PeopleListResponse {
  readonly people: readonly Person[];
}

export interface AuditEntry {
  readonly seq: number;
  readonly ts: string;
  readonly action: string;
  readonly account_id: string | null;
  readonly device_id: string | null;
  readonly detail: unknown;
}

export interface AuditResponse {
  readonly entries: readonly AuditEntry[];
  readonly limit: number;
  readonly offset: number;
}

/** `owner` is every pre-sites account's role and means admin. One place. */
export function isAdminRole(role: string | null | undefined): boolean {
  if (typeof role !== "string") return false;
  const r = role.trim().toLowerCase();
  return r === "admin" || r === "owner";
}

/** Is this share granting access right now? Status AND expiry, both. */
export function isShareLive(share: Share, now: Date = new Date()): boolean {
  if (share.status !== "active") return false;
  const expires = Date.parse(share.expires_at);
  // An unparseable expiry reads as EXPIRED, matching the server: the
  // alternative is a share that never dies because its timestamp was malformed.
  if (!Number.isFinite(expires)) return false;
  return now.getTime() < expires;
}

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

interface Ctx {
  readonly status?: number;
  readonly path?: string;
}

class Check {
  readonly issues: string[] = [];

  fail(path: string, expected: string, got: unknown): void {
    const shown =
      got === null ? "null" : Array.isArray(got) ? "array" : typeof got;
    this.issues.push(`${path}: expected ${expected}, got ${shown}`);
  }

  obj(path: string, v: unknown): Record<string, unknown> {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      this.fail(path, "object", v);
      return {};
    }
    return v as Record<string, unknown>;
  }

  arr(path: string, v: unknown): unknown[] {
    if (!Array.isArray(v)) {
      this.fail(path, "array", v);
      return [];
    }
    return v;
  }

  str(path: string, v: unknown): string {
    if (typeof v !== "string") {
      this.fail(path, "string", v);
      return "";
    }
    return v;
  }

  num(path: string, v: unknown): number {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      this.fail(path, "finite number", v);
      return 0;
    }
    return v;
  }

  bool(path: string, v: unknown): boolean {
    if (typeof v !== "boolean") {
      this.fail(path, "boolean", v);
      return false;
    }
    return v;
  }

  /** A string or null, which several of these fields genuinely are. */
  strOrNull(path: string, v: unknown): string | null {
    if (v === null || v === undefined) return null;
    if (typeof v !== "string") {
      this.fail(path, "string or null", v);
      return null;
    }
    return v;
  }

  done(what: string, ctx: Ctx): void {
    if (this.issues.length === 0) return;
    throw new ValidationError(
      `${what} from ${ctx.path ?? "(unknown path)"} is not the documented shape`,
      { issues: this.issues, status: ctx.status, path: ctx.path },
    );
  }
}

export function parseCapabilities(raw: unknown, ctx: Ctx = {}): Capabilities {
  const c = new Check();
  const o = c.obj("$", raw);
  const features = c.obj("$.features", o.features);
  const out: Capabilities = {
    role: c.str("$.role", o.role),
    features: { sites: c.bool("$.features.sites", features.sites) },
  };
  c.done("capabilities", ctx);
  return out;
}

function site(c: Check, path: string, raw: unknown): Site {
  const o = c.obj(path, raw);
  const status = c.str(`${path}.status`, o.status);
  if (status !== "active" && status !== "archived") {
    c.fail(`${path}.status`, "active or archived", o.status);
  }
  const out: Record<string, unknown> = {
    site_id: c.str(`${path}.site_id`, o.site_id),
    name: c.str(`${path}.name`, o.name),
    status: status as SiteStatus,
    created_at: c.str(`${path}.created_at`, o.created_at),
  };
  if (o.hubs !== undefined) {
    out.hubs = c.arr(`${path}.hubs`, o.hubs).map((h, i) =>
      c.str(`${path}.hubs[${i}]`, h),
    );
  }
  if (o.members !== undefined) {
    out.members = c.arr(`${path}.members`, o.members).map((m, i) =>
      c.str(`${path}.members[${i}]`, m),
    );
  }
  return out as unknown as Site;
}

export function parseSiteList(raw: unknown, ctx: Ctx = {}): SiteListResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const sites = c
    .arr("$.sites", o.sites)
    .map((s, i) => site(c, `$.sites[${i}]`, s));
  const out: Record<string, unknown> = { sites };
  // ABSENT, NOT EMPTY, for a non-admin. The distinction is the point: a site
  // user is not told that unplaced hubs exist, so a UI must check presence
  // rather than length.
  if (o.unassigned_hubs !== undefined) {
    out.unassigned_hubs = c
      .arr("$.unassigned_hubs", o.unassigned_hubs)
      .map((h, i) => c.str(`$.unassigned_hubs[${i}]`, h));
  }
  if (o.others !== undefined) {
    out.others = c.arr("$.others", o.others).map((raw, i) => {
      const e = c.obj(`$.others[${i}]`, raw);
      const row: Record<string, unknown> = {
        site_id: c.str(`$.others[${i}].site_id`, e.site_id),
        name: c.str(`$.others[${i}].name`, e.name),
      };
      // Absent is not false. See the field: an older server says nothing, and
      // hiding every site would be worse than offering an empty one.
      if (e.has_cameras !== undefined) {
        row.has_cameras = c.bool(`$.others[${i}].has_cameras`, e.has_cameras);
      }
      return row as unknown as SiteName;
    });
  }
  c.done("site list", ctx);
  return out as unknown as SiteListResponse;
}

export function parseSiteDetail(raw: unknown, ctx: Ctx = {}): SiteDetailResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const s = site(c, "$.site", o.site);
  const cells = c.arr("$.cells", o.cells).map((cell, i) => {
    const co = c.obj(`$.cells[${i}]`, cell);
    return {
      hub_id: c.str(`$.cells[${i}].hub_id`, co.hub_id),
      towers: c
        .arr(`$.cells[${i}].towers`, co.towers)
        .map((t, j) => c.str(`$.cells[${i}].towers[${j}]`, t)),
    };
  });
  c.done("site detail", ctx);
  return { site: s, cells };
}

function shareOne(c: Check, path: string, raw: unknown): Share {
  const o = c.obj(path, raw);
  const direction = c.str(`${path}.direction`, o.direction);
  if (direction !== "request" && direction !== "offer") {
    c.fail(`${path}.direction`, "request or offer", o.direction);
  }
  const status = c.str(`${path}.status`, o.status);
  const known = ["pending", "active", "declined", "revoked", "expired"];
  if (!known.includes(status)) {
    c.fail(`${path}.status`, known.join(" | "), o.status);
  }
  const scope = c.arr(`${path}.scope`, o.scope).map((entry, i) => {
    const eo = c.obj(`${path}.scope[${i}]`, entry);
    const out: Record<string, unknown> = {
      device_id: c.str(`${path}.scope[${i}].device_id`, eo.device_id),
    };
    if (eo.cameras !== undefined) {
      out.cameras = c
        .arr(`${path}.scope[${i}].cameras`, eo.cameras)
        .map((n, j) => c.num(`${path}.scope[${i}].cameras[${j}]`, n));
    }
    return out as unknown as ShareScopeEntry;
  });
  const out: Record<string, unknown> = {
    share_id: c.str(`${path}.share_id`, o.share_id),
    direction: direction as ShareDirection,
    status: status as ShareStatus,
    owner_site_id: c.str(`${path}.owner_site_id`, o.owner_site_id),
    owner_site_name: c.str(`${path}.owner_site_name`, o.owner_site_name),
    viewer_site_id: c.str(`${path}.viewer_site_id`, o.viewer_site_id),
    viewer_site_name: c.str(`${path}.viewer_site_name`, o.viewer_site_name),
    scope,
    live: c.bool(`${path}.live`, o.live),
    ptz: c.bool(`${path}.ptz`, o.ptz),
    playback: c.bool(`${path}.playback`, o.playback),
    playback_from: c.strOrNull(`${path}.playback_from`, o.playback_from),
    playback_to: c.strOrNull(`${path}.playback_to`, o.playback_to),
    expires_at: c.str(`${path}.expires_at`, o.expires_at),
    created_at: c.str(`${path}.created_at`, o.created_at),
    decided_at: c.strOrNull(`${path}.decided_at`, o.decided_at),
    // Absent on an older server, and null rather than derived. See the field.
    asked_duration_sec:
      o.asked_duration_sec === undefined || o.asked_duration_sec === null
        ? null
        : c.num(`${path}.asked_duration_sec`, o.asked_duration_sec),
    // Absent reads as FALSE, like the `can_*` below: a share made by a site
    // is the thing every older server could produce.
    by_admin: o.by_admin === undefined ? false : c.bool(`${path}.by_admin`, o.by_admin),
    // Tolerated as absent for a server that predates it, and read as null,
    // which is the same thing an offer with nothing to say sends.
    message:
      o.message === undefined ? null : c.strOrNull(`${path}.message`, o.message),
  };
  if (o.incoming !== undefined) out.incoming = c.bool(`${path}.incoming`, o.incoming);
  if (o.outgoing !== undefined) out.outgoing = c.bool(`${path}.outgoing`, o.outgoing);
  for (const k of ["can_answer", "can_end", "can_extend"] as const) {
    // Absent reads as FALSE rather than as undefined, so a caller that writes
    // `share.can_answer` against an older server gets the restrictive answer
    // instead of a falsy value that happens to work by accident.
    out[k] = o[k] === undefined ? false : c.bool(`${path}.${k}`, o[k]);
  }
  return out as unknown as Share;
}

export function parseShare(raw: unknown, ctx: Ctx = {}): Share {
  const c = new Check();
  const o = c.obj("$", raw);
  const s = shareOne(c, "$.share", o.share);
  c.done("share", ctx);
  return s;
}

export function parseShareList(raw: unknown, ctx: Ctx = {}): ShareListResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const shares = c
    .arr("$.shares", o.shares)
    .map((s, i) => shareOne(c, `$.shares[${i}]`, s));
  c.done("share list", ctx);
  return { shares };
}

export function parsePeopleList(raw: unknown, ctx: Ctx = {}): PeopleListResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const people = c.arr("$.people", o.people).map((p, i) => {
    const at = `$.people[${i}]`;
    const po = c.obj(at, p);
    const row: Record<string, unknown> = {
      account_id: c.str(`${at}.account_id`, po.account_id),
      login: c.str(`${at}.login`, po.login),
      role: c.str(`${at}.role`, po.role),
      status: c.str(`${at}.status`, po.status),
      sites: c
        .arr(`${at}.sites`, po.sites)
        .map((s, j) => c.str(`${at}.sites[${j}]`, s)),
    };
    // SPREAD, NOT DEFAULTED. An absent `name` means this login is an
    // ORGANIZATION, which is a different thing from a person with a blank
    // name; and an absent `was` means never renamed, not renamed from nothing.
    if (po.name !== undefined) row.name = c.str(`${at}.name`, po.name);
    if (po.was !== undefined) row.was = c.str(`${at}.was`, po.was);
    if (po.created_at !== undefined) {
      row.created_at = c.str(`${at}.created_at`, po.created_at);
    }
    return row as unknown as Person;
  });
  c.done("people list", ctx);
  return { people };
}

export function parseAudit(raw: unknown, ctx: Ctx = {}): AuditResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const entries = c.arr("$.entries", o.entries).map((e, i) => {
    const eo = c.obj(`$.entries[${i}]`, e);
    return {
      seq: c.num(`$.entries[${i}].seq`, eo.seq),
      ts: c.str(`$.entries[${i}].ts`, eo.ts),
      action: c.str(`$.entries[${i}].action`, eo.action),
      account_id: c.strOrNull(`$.entries[${i}].account_id`, eo.account_id),
      device_id: c.strOrNull(`$.entries[${i}].device_id`, eo.device_id),
      // `detail` is free-form by design: each action records what it needs and
      // a validator that pinned it would break on the next action added.
      detail: eo.detail ?? null,
    };
  });
  c.done("audit", ctx);
  return {
    entries,
    limit: c.num("$.limit", o.limit),
    offset: c.num("$.offset", o.offset),
  };
}

/* ------------------------------------------------------------------ *
 * Cells and towers, as a customer manages them
 *
 * A CELL IS A HUB, NAMED. `Cell` above is the shape the site detail carries —
 * a hub id and the towers under it. This is the shape the MANAGEMENT routes
 * carry: the name, the site, the ceiling, and whether anybody can reach it.
 * Two types rather than one optional-heavy one, because a caller drawing a
 * site's contents and a caller drawing the Administration area need different
 * things and neither should have to check which fields arrived.
 * ------------------------------------------------------------------ */

/** One cell as `/v1/cells` and `/v1/admin/cells` report it. */
export interface ManagedCell {
  readonly hub_id: string;
  /** The name somebody chose. Never a slug, never the hub id. */
  readonly name: string;
  /** Null when it is in no site, which only an admin ever sees. */
  readonly site_id: string | null;
  readonly site_name: string;
  readonly status: string;
  /** How many towers the hub has reported. */
  readonly towers: number;
  /** Is its uplink connected right now. */
  readonly online: boolean;
  /**
   * ⚠ ABSENT, NOT ZERO, when the hub has never reported a ceiling.
   *
   * That is an older hub, and capacity is then not enforced for this cell. A
   * `capacity: 0` would read as "this cell can hold nothing", and a client that
   * defaulted it to 0 would refuse every add.
   */
  readonly capacity?: number;
  /** At the ceiling. Adding a tower is refused, with `cell_full`. */
  readonly full: boolean;
  /** Three quarters or more. Worth warning about; not yet a refusal. */
  readonly filling: boolean;
}

/** One tower in a cell, named as its hub last reported it. */
export interface CellTower {
  readonly device_id: string;
  readonly name: string;
  readonly last_seen?: string;
}

export interface CellListResponse {
  readonly cells: readonly ManagedCell[];
}

export interface CellDetailResponse {
  readonly cell: ManagedCell;
  readonly towers: readonly CellTower[];
}

/**
 * A device that has been asked for and has not arrived yet.
 *
 * ⚠ THE PAIRING CODE IS NEVER HERE. It is a live secret until it is consumed,
 * and a response body is no safer than a log line: it reaches a browser, a
 * proxy, and whatever devtools are recording. The server omits it, and the
 * parser drops it if one ever appears.
 */
export interface PendingDevice {
  /** `"cell"` or `"tower"`. */
  readonly what?: string;
  readonly name?: string;
  readonly claim_id?: string;
  readonly site_id?: string;
  readonly hub_id?: string;
  /**
   * When the claim window closes. ABSENT for a queued add, because its window
   * has not started: it begins when the offline cell receives it.
   */
  readonly expires_at?: string;
  /**
   * `open` or `expired` for a claim the server holds, or one of
   * `waiting_for_cell` (the cell is offline and this is queued) and
   * `waiting_for_tower` (the cell is expecting it).
   */
  readonly status?: string;
  /** True when the cell was offline and this is held until it reconnects. */
  readonly queued?: boolean;
  /** A sentence for a person. Present on the queued and waiting answers. */
  readonly message?: string;
  /** Replacement only: the old board's keys are gone. */
  readonly old_keys_revoked?: boolean;
}

export interface AddDeviceResponse {
  readonly pending: PendingDevice;
  /** Present when adding a tower: the cell as it now stands. */
  readonly cell?: ManagedCell | null;
}

export interface MoveCellResponse {
  readonly cell: ManagedCell | null;
  /**
   * The shares that ENDED because the cameras left the site.
   *
   * ⚠ NOT A WARNING — A FACT. A share is an agreement between two sites about
   * particular cameras; when the cameras move, it no longer describes anything.
   * Both sides have to be told, which is why the ids come back rather than a
   * client having to diff a share list to notice.
   */
  readonly shares_ended: readonly string[];
}

export interface RemoveTowerResponse {
  readonly removed: string;
  readonly keys_revoked: boolean;
  /**
   * ⚠ ALWAYS TRUE, deliberately: a removed tower's recordings stay until
   * normal retention because they may be evidence. This is the only removal in
   * the product that leaves data behind, and the UI is expected to say so at
   * the moment of removing rather than afterwards.
   */
  readonly recordings_kept: boolean;
  readonly note?: string;
}

export interface RemoveCellResponse {
  readonly removed: string;
  readonly name: string;
}

export interface RemoveSiteResponse {
  readonly removed: string;
  readonly name: string;
  /**
   * The row is ARCHIVED rather than dropped: every audit entry and every closed
   * share still refers to it, and deleting it would make a year of the ledger
   * unreadable. It is gone from every list.
   */
  readonly archived: boolean;
}

function managedCell(c: Check, at: string, raw: unknown): ManagedCell {
  const o = c.obj(at, raw);
  const out: Record<string, unknown> = {
    hub_id: c.str(`${at}.hub_id`, o.hub_id),
    name: c.str(`${at}.name`, o.name),
    site_id: c.strOrNull(`${at}.site_id`, o.site_id),
    site_name: c.str(`${at}.site_name`, o.site_name),
    status: c.str(`${at}.status`, o.status),
    towers: c.num(`${at}.towers`, o.towers),
    online: c.bool(`${at}.online`, o.online),
    full: c.bool(`${at}.full`, o.full),
    filling: c.bool(`${at}.filling`, o.filling),
  };
  // Spread only when the server sent one, so "absent" survives the parse.
  if (o.capacity !== undefined) {
    out.capacity = c.num(`${at}.capacity`, o.capacity);
  }
  return out as unknown as ManagedCell;
}

export function parseCellList(raw: unknown, ctx: Ctx = {}): CellListResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const cells = c
    .arr("$.cells", o.cells)
    .map((cell, i) => managedCell(c, `$.cells[${i}]`, cell));
  c.done("cell list", ctx);
  return { cells };
}

export function parseCellDetail(raw: unknown, ctx: Ctx = {}): CellDetailResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const cell = managedCell(c, "$.cell", o.cell);
  const towers = c.arr("$.towers", o.towers).map((t, i) => {
    const at = `$.towers[${i}]`;
    const to = c.obj(at, t);
    const device_id = c.str(`${at}.device_id`, to.device_id);
    const out: Record<string, unknown> = {
      device_id,
      // THE ID AS A FALLBACK, not an empty string: a row with a blank name is
      // a row nobody can click on with any confidence.
      name: typeof to.name === "string" && to.name ? to.name : device_id,
    };
    if (typeof to.last_seen === "string") out.last_seen = to.last_seen;
    return out as unknown as CellTower;
  });
  c.done("cell detail", ctx);
  return { cell, towers };
}

function pending(c: Check, at: string, raw: unknown): PendingDevice {
  const o = c.obj(at, raw);
  const out: Record<string, unknown> = {};
  for (const key of ["what", "name", "claim_id", "site_id", "hub_id",
                     "expires_at", "status", "message"]) {
    if (o[key] !== undefined) out[key] = c.str(`${at}.${key}`, o[key]);
  }
  if (o.queued !== undefined) out.queued = c.bool(`${at}.queued`, o.queued);
  if (o.old_keys_revoked !== undefined) {
    out.old_keys_revoked = c.bool(`${at}.old_keys_revoked`, o.old_keys_revoked);
  }
  // ⚠ AND A PAIRING CODE IS DROPPED HERE TOO, if a server ever sends one. It
  // has no business in a parsed response, and a client that quietly carried one
  // into its state would put it in a devtools tree and then in a bug report.
  return out as unknown as PendingDevice;
}

export function parseAddDevice(raw: unknown, ctx: Ctx = {}): AddDeviceResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const out: Record<string, unknown> = {
    pending: pending(c, "$.pending", o.pending),
  };
  if (o.cell !== undefined && o.cell !== null) {
    out.cell = managedCell(c, "$.cell", o.cell);
  }
  c.done("added device", ctx);
  return out as unknown as AddDeviceResponse;
}

export function parseMoveCell(raw: unknown, ctx: Ctx = {}): MoveCellResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const cell =
    o.cell === undefined || o.cell === null
      ? null
      : managedCell(c, "$.cell", o.cell);
  const ended = c
    .arr("$.shares_ended", o.shares_ended)
    .map((s, i) => c.str(`$.shares_ended[${i}]`, s));
  c.done("moved cell", ctx);
  return { cell, shares_ended: ended };
}

export function parseRemoveTower(raw: unknown, ctx: Ctx = {}): RemoveTowerResponse {
  const c = new Check();
  const o = c.obj("$", raw);
  const out: Record<string, unknown> = {
    removed: c.str("$.removed", o.removed),
    keys_revoked: c.bool("$.keys_revoked", o.keys_revoked),
    recordings_kept: c.bool("$.recordings_kept", o.recordings_kept),
  };
  if (o.note !== undefined) out.note = c.str("$.note", o.note);
  c.done("removed tower", ctx);
  return out as unknown as RemoveTowerResponse;
}
