/**
 * Site alerts — the four a customer reads, and the live channel they arrive on.
 *
 * Source of truth: `sentry-core/docs/alerts.md` §4. Scope: the viewer-facing
 * routes `GET /v1/viewer/site-alerts`, `GET /v1/viewer/site-alerts/{id}`,
 * `POST /v1/viewer/site-alerts/{id}/ack`, and `GET /v1/viewer/events`.
 *
 * ## Why a module of its own
 *
 * Same reasoning `sites.ts` gives: these are a different surface with a
 * different lifetime from §4.2's towers and sessions, and a consumer rendering
 * a camera wall should not have to import them.
 *
 * ## THE FIELD RULES, which a renderer depends on
 *
 * These are not style notes. Each one exists because its opposite put something
 * wrong on a screen.
 *
 * - **Absent, never null.** Everything that does not apply is simply missing.
 *   A `recovered_at: null` on a live alert is a field every renderer has to
 *   know to special-case, and "the camera is still down" is said better by
 *   there being nothing to say. So these parsers **omit** rather than emit
 *   `null`, and `"x" in alert` is the check.
 * - **`acknowledged` is always a boolean.** Never absent, never null. `false`
 *   and "an older hub that did not say" must not be the same thing on a screen,
 *   so the parser requires it and fails loudly if it is missing.
 * - **`type` and `colour` are CODES, not text.** There is deliberately no
 *   `message` field anywhere (§9). The website owns every sentence a customer
 *   reads; the server owns the facts. A colour arrives for a `type` this build
 *   has never heard of, which is what the list's `colours` map is for.
 * - **`rev` is machine ordering.** It increases on every change to the row and
 *   is how a consumer drops an out-of-order update — see
 *   {@link AlertRevisionGate}.
 * - **`url` and `download_url` MUST NOT be cached.** They are minted per
 *   request and a presigned bucket URL lives fifteen minutes. `key` is the
 *   stable identity. Re-read the alert to get fresh URLs; never stash one in
 *   component state and render it an hour later.
 */
/**
 * The alert types this build of the server raises (§4, `sitealerts.COLOURS`).
 *
 * Open on purpose: a newer hub forwards a type this build has not heard of, and
 * `colour_for` answers `grey` for it rather than refusing it. An alert whose
 * word we cannot name is still an alert that must appear.
 */
export type AlertType = "TOWER_OFFLINE" | "CAMERA_STOPPED" | "TOWER_ONLINE" | "FOOTAGE_RECOVERING" | "FOOTAGE_RECOVERED" | (string & {});
/**
 * A colour **key**, not a CSS colour: `red`, `orange`, `green`, `purple`,
 * `teal`, or `grey` for a type the server itself could not name. The website
 * maps it to its own palette.
 */
export type AlertColour = string;
/** Clip quality as a machine value. `2k` beats `standard` (§2). */
export type ClipQuality = "standard" | "2k" | (string & {});
/**
 * One clip cut around an alert (§2).
 *
 * `url` and `download_url` are **minted for the request that returned this
 * object** and are not cached anywhere on the server either — a row holding one
 * would serve a dead link to every reader after fifteen minutes.
 */
export interface AlertClip {
    /** The camera this clip is of. */
    readonly camera: number;
    readonly quality: ClipQuality;
    /** The stable identity. Cache against this, never against the URLs. */
    readonly key: string;
    /** RFC 3339. When the clip's footage begins — a minute before the event. */
    readonly start?: string;
    readonly start_epoch?: number;
    /** Seconds. */
    readonly duration?: number;
    /** Bytes. */
    readonly size?: number;
    /** The name a person reads. Built by the hub; use it as the `download` attr. */
    readonly filename?: string;
    /**
     * Plays inline. Relative → resolve against the API origin; absolute → a
     * presigned bucket URL, used untouched. **Do not cache.**
     */
    readonly url?: string;
    /** Same object as an attachment. **Do not cache.** */
    readonly download_url?: string;
}
/** How far the clip pipeline has to go (§3). Absent when there is nothing left. */
export interface AlertProgress {
    readonly files_left?: number;
    readonly bytes_left?: number;
    /** 0…1. */
    readonly progress?: number;
    readonly eta_sec?: number;
    /**
     * A verdict rather than a measurement, and the reason this block can appear
     * with no numbers in it at all: `"none"` means the hub **answered** and has
     * no recording covering that moment — the disk was full, the camera was not
     * recording, the box was rebuilt (§2 "No footage of that moment"). A screen
     * reading it says "No footage of that moment" and stops waiting.
     *
     * ⚠ ITS ABSENCE IS NOT "THERE IS FOOTAGE". Nothing has been answered yet is
     * also absent, which is the state every `HUB_OFFLINE` alert starts in and
     * may sit in for weeks while its hub is away. Only `"none"` is a statement.
     *
     * A code, like {@link SiteAlert.type} and {@link SiteAlert.colour}, left as
     * a plain string so a later verdict needs no SDK release to pass through.
     */
    readonly footage?: string;
}
/**
 * One alert, exactly as §4 "One alert" documents it — and the same shape the
 * live channel's `data` carries.
 *
 * Every optional field here is optional because the server **omits** it, not
 * because it might be null. See the module header.
 */
export interface SiteAlert {
    readonly id: string;
    /** A code. Never shown to a customer as itself. */
    readonly type: AlertType;
    /** A colour key for {@link type}, so an unknown type still renders. */
    readonly colour: AlertColour;
    readonly device_id: string;
    /**
     * Plural because `TOWER_OFFLINE` is about every camera on the mast. **Absent
     * when there are none** — not an empty array.
     */
    readonly cameras?: number[];
    /** RFC 3339, stamped at the event rather than at the raise (§1). */
    readonly started_at: string;
    readonly started_epoch: number;
    /** Absent while the condition still holds. Presence *is* "recovered". */
    readonly recovered_at?: string;
    /**
     * **Always present.** `false` is a fact; a missing field would be
     * indistinguishable from an older hub that did not say.
     */
    readonly acknowledged: boolean;
    /** The authenticated caller who acknowledged. Absent when nobody has. */
    readonly acknowledged_by?: string;
    readonly acknowledged_at?: string;
    /**
     * The best quality among {@link clips}, decided server-side so a pop-up and
     * a detail view cannot rank the list differently. Appears only with clips.
     */
    readonly best_quality?: ClipQuality;
    /** Absent when empty. */
    readonly clips?: AlertClip[];
    /** Absent when there is nothing in flight. */
    readonly progress?: AlertProgress;
    /** Machine ordering. Increases on every change to the row. */
    readonly rev: number;
    /** Present on the data centre only — which hub forwarded this. */
    readonly via_hub_id?: string;
}
/** `200` body of `GET /v1/viewer/site-alerts`. */
export interface SiteAlertList {
    /** Newest first. */
    readonly alerts: SiteAlert[];
    /**
     * The colour key per type, **including types this build of the website has
     * never heard of**. That is the whole reason it is sent: render by looking a
     * type up here, not by a switch in the bundle.
     */
    readonly colours: Readonly<Record<string, AlertColour>>;
}
/** Query for {@link SentryClient.listSiteAlerts}. */
export interface SiteAlertQuery {
    /**
     * Epoch seconds. A **recovery tool**: a client whose live stream dropped
     * re-reads from the last alert it saw. The stream replays nothing,
     * deliberately — a replay buffer would be a second and lossier answer to the
     * same question (§4, §9).
     */
    since?: number;
    limit?: number;
}
/** The two event kinds on `GET /v1/viewer/events`. */
export type AlertEventKind = "alert.new" | "alert.updated";
/** One parsed frame off the live channel. */
export interface AlertEvent {
    readonly kind: AlertEventKind;
    readonly alert: SiteAlert;
    /** The SSE `id:`, when the frame carried one. */
    readonly id?: string;
}
interface Ctx {
    readonly status?: number;
    readonly path?: string;
}
/** Validate one alert — the `GET .../{id}`, the ack answer, and an event's `data`. */
export declare function parseSiteAlert(raw: unknown, ctx?: Ctx): SiteAlert;
/**
 * Validate `GET /v1/viewer/site-alerts`.
 *
 * `colours` is required. A list without it would leave a dashboard unable to
 * render a type it does not know, which is the one thing the map is for — and
 * an empty map from a server that forgot it is better surfaced here than as
 * uncoloured rows on a screen.
 */
export declare function parseSiteAlertList(raw: unknown, ctx?: Ctx): SiteAlertList;
/**
 * Drops out-of-order alert updates by `rev`.
 *
 * ⚠ THE LIVE CHANNEL AND THE LIST ENDPOINT ARE TWO SOURCES FOR ONE ROW, and a
 * client reads both: it re-reads the list after any drop (§4), so a recovery
 * read and a live frame routinely describe the same alert. Nothing orders them
 * against each other — the HTTP response and the stream frame race — so without
 * this a stale forward overwrites a fresh one and a recovered alert flips back
 * to live on screen.
 *
 * `rev` increases on every change to the row and is exactly what the data centre
 * uses to tell a stale forward from a fresh one. Same field, same job.
 *
 * ```ts
 * const gate = new AlertRevisionGate();
 * if (gate.accept(a)) store.upsert(a);   // else: already have this or newer
 * ```
 */
export declare class AlertRevisionGate {
    private readonly seen;
    /**
     * `true` when this alert is new or newer than what has been seen, and records
     * it. `false` when it is a duplicate or older, and changes nothing.
     *
     * Equal revs are rejected: a row that has not changed has nothing to apply,
     * and re-rendering it is work for no new fact.
     */
    accept(a: SiteAlert): boolean;
    /** The highest `rev` seen for an alert, or `undefined`. */
    revOf(id: string): number | undefined;
    /** Forget everything. For a sign-out or a site switch. */
    clear(): void;
}
/** One raw SSE frame, before the `data` is understood as anything. */
export interface SseFrame {
    id?: string;
    event?: string;
    data: string;
}
/**
 * Split a complete SSE frame into its fields, or `null` if it carries nothing.
 *
 * Comment lines are dropped, which is how `: keepalive` (every 15 s) and the
 * `: open` the stream starts with are **ignored rather than parsed**. A keepalive
 * is not an event and must never reach a consumer as one; it exists so a proxy
 * does not time the connection out.
 *
 * Exported because the framing is worth testing on its own, separately from the
 * transport that feeds it.
 */
export declare function parseSseFrame(block: string): SseFrame | null;
/**
 * Turn a decoded chunk stream into complete frames.
 *
 * Holds a buffer because **a frame can arrive split across two reads**: the
 * network does not respect `\n\n`, and a parser that treated every chunk as a
 * whole frame would drop the tail of one alert and the head of the next. This is
 * the bug that makes an event channel look "mostly reliable".
 */
export declare class SseBuffer {
    private buf;
    /** Feed a decoded chunk; get back the frames that are now complete. */
    push(chunk: string): SseFrame[];
}
/**
 * Read one frame as an alert event, or `null` when it is not one.
 *
 * `null` for anything that is not `alert.new` / `alert.updated` — a future event
 * kind on this channel is additive and a reader that threw on one would turn a
 * compatible server change into a broken dashboard (§A.9's rule, same shape).
 *
 * Throws {@link ValidationError} only when a frame *claims* to be an alert and
 * its `data` is not one: that is a real contract break, not an unknown.
 */
export declare function alertEventOf(frame: SseFrame): AlertEvent | null;
export {};
//# sourceMappingURL=alerts.d.ts.map