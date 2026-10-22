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
export declare const SHARE_MESSAGE_MAX = 500;
/**
 * What a share lasts by default when nobody says otherwise: fifteen minutes.
 *
 * ⚠ THE SHORT ONE IS THE SAFE ONE. A share is somebody else's cameras, and
 * the failure that matters is the one nobody notices: a share that outlives
 * the reason for it. Fifteen minutes covers "our truck is at your gate" and
 * runs out on its own; anything longer should be a decision somebody typed.
 */
export declare const SHARE_DEFAULT_SEC: number;
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
export declare const SHARE_MIN_SEC: number;
export declare const SHARE_MAX_SEC: number;
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
/**
 * The organization the Administration area is working in.
 *
 * ⚠ `name` AND `slug` ARE TWO DIFFERENT VALUES AND BOTH ARE NEEDED. `name` is
 * what the customer calls themselves — `Terra Industries`, spaces and capitals
 * — and `slug` is the half after the dot in every person's login:
 * `terra-industries`. A rename changes the first and never the second, because
 * changing the second would change every person's login at the same moment.
 *
 * A screen that adds people cannot say what the new login will be without the
 * slug. One that guessed printed `they will sign in as guest2.<organization>`
 * — in production, with the angle brackets, to an administrator who passed it
 * on to the person it was about.
 */
export interface Organization {
    readonly org_id: string;
    readonly name: string;
    /**
     * Empty only for an organization that has not been given one yet. Such an
     * organization cannot have people at all, and the server says so (409
     * `no_org_slug`) rather than inventing a login half.
     */
    readonly slug: string;
}
export interface PeopleListResponse {
    readonly people: readonly Person[];
    /**
     * Absent from a server that predates it, and from an answer to a caller
     * whose account belongs to no organization. Optional for that reason only:
     * every current DC sends it.
     */
    readonly org?: Organization;
}
export interface AuditEntry {
    readonly seq: number;
    readonly ts: string;
    readonly action: string;
    readonly account_id: string | null;
    readonly device_id: string | null;
    readonly detail: unknown;
    /**
     * The actor's NAME, resolved by the server. `""` means the system did it,
     * which a reader is told in words rather than left to infer from a blank.
     */
    readonly who?: string;
}
export interface AuditResponse {
    readonly entries: readonly AuditEntry[];
    readonly limit: number;
    readonly offset: number;
    /**
     * Every id in this page, mapped to the name a person would recognise:
     * account ids to people, site ids to site names, hub and device ids to the
     * names somebody typed.
     *
     * ⚠ RESOLVED BY THE SERVER, AND THAT IS NOT AN OPTIMISATION. A screen must
     * never print `acct_...` or `kln_lab_000002`, and the rows that most need a
     * name are exactly the ones a browser cannot resolve: a REMOVED person is not
     * in the people list any more, and an archived site is not in the sites list,
     * so the oldest entries would be the ones that fell back to an id.
     *
     * Absent from a server that predates it, which is why the audit view falls
     * back to "somebody" rather than to the id.
     */
    readonly names?: Readonly<Record<string, string>>;
    /** The group names this server can filter by. */
    readonly groups?: readonly string[];
}
/** The four groups the audit view offers. The server owns the membership. */
export type AuditGroup = "sign_ins" | "people" | "sharing" | "places";
/** `owner` is every pre-sites account's role and means admin. One place. */
export declare function isAdminRole(role: string | null | undefined): boolean;
/** Is this share granting access right now? Status AND expiry, both. */
export declare function isShareLive(share: Share, now?: Date): boolean;
interface Ctx {
    readonly status?: number;
    readonly path?: string;
}
export declare function parseCapabilities(raw: unknown, ctx?: Ctx): Capabilities;
export declare function parseSiteList(raw: unknown, ctx?: Ctx): SiteListResponse;
export declare function parseSiteDetail(raw: unknown, ctx?: Ctx): SiteDetailResponse;
export declare function parseShare(raw: unknown, ctx?: Ctx): Share;
export declare function parseShareList(raw: unknown, ctx?: Ctx): ShareListResponse;
export declare function parsePeopleList(raw: unknown, ctx?: Ctx): PeopleListResponse;
export declare function parseAudit(raw: unknown, ctx?: Ctx): AuditResponse;
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
export interface RemovePersonResponse {
    readonly removed: string;
    /** Their name, for the confirmation the screen shows afterwards. */
    readonly name: string;
}
export declare function parseCellList(raw: unknown, ctx?: Ctx): CellListResponse;
export declare function parseCellDetail(raw: unknown, ctx?: Ctx): CellDetailResponse;
export declare function parseAddDevice(raw: unknown, ctx?: Ctx): AddDeviceResponse;
export declare function parseMoveCell(raw: unknown, ctx?: Ctx): MoveCellResponse;
export declare function parseRemoveTower(raw: unknown, ctx?: Ctx): RemoveTowerResponse;
export {};
//# sourceMappingURL=sites.d.ts.map