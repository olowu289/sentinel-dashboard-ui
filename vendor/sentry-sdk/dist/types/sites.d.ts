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
    /** True when one of my sites OWNS the cameras. Only on `/v1/shares`. */
    readonly incoming?: boolean;
    /** True when one of my sites RECEIVES the access. Only on `/v1/shares`. */
    readonly outgoing?: boolean;
}
export interface ShareListResponse {
    readonly shares: readonly Share[];
}
export interface Person {
    readonly account_id: string;
    readonly login: string;
    /** `"admin"`, `"site_user"`, or `"owner"` which READS AS ADMIN. */
    readonly role: string;
    readonly status: string;
    readonly sites: readonly string[];
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
export {};
//# sourceMappingURL=sites.d.ts.map