/**
 * Site alerts — the four a customer reads, and the live channel they arrive on.
 *
 * Source of truth: `sentry-core/docs/alerts.md` §4. Scope: the viewer-facing
 * routes `GET /v1/viewer/site-alerts`, `GET /v1/viewer/site-alerts/{id}`,
 * `GET /v1/viewer/site-alerts/counts`,
 * `POST /v1/viewer/site-alerts/{id}/ack`,
 * `POST /v1/viewer/site-alerts/ack-all`, and `GET /v1/viewer/events`.
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
import { ValidationError } from "./errors.js";
/** `true` for the frames that carry an alert, narrowing the union for TypeScript. */
export function isAlertRowEvent(event) {
    return event.kind === "alert.new" || event.kind === "alert.updated";
}
/** Same kernel as `sites.ts`, for the same reason: structural, not exhaustive. */
class Check {
    issues = [];
    fail(path, expected, got) {
        const shown = got === null ? "null" : Array.isArray(got) ? "array" : typeof got;
        this.issues.push(`${path}: expected ${expected}, got ${shown}`);
    }
    obj(path, v) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
            this.fail(path, "object", v);
            return {};
        }
        return v;
    }
    arr(path, v) {
        if (!Array.isArray(v)) {
            this.fail(path, "array", v);
            return [];
        }
        return v;
    }
    str(path, v) {
        if (typeof v !== "string") {
            this.fail(path, "string", v);
            return "";
        }
        return v;
    }
    num(path, v) {
        if (typeof v !== "number" || !Number.isFinite(v)) {
            this.fail(path, "finite number", v);
            return 0;
        }
        return v;
    }
    bool(path, v) {
        if (typeof v !== "boolean") {
            this.fail(path, "boolean", v);
            return false;
        }
        return v;
    }
    done(what, ctx) {
        if (this.issues.length === 0)
            return;
        throw new ValidationError(`${what} from ${ctx.path ?? "(unknown path)"} is not the documented shape`, { issues: this.issues, status: ctx.status, path: ctx.path });
    }
}
/**
 * Copy an optional field only when the server actually sent a value.
 *
 * ⚠ THIS IS THE "ABSENT, NEVER NULL" RULE IN CODE. A `null` arriving from
 * anywhere — an older tier, a forward, a hand-written fixture — is dropped
 * rather than carried through, because the contract a consumer was promised is
 * that presence means a value. One `null` leaking into the object re-creates
 * exactly the special-case the rule exists to delete.
 */
function put(out, key, value) {
    if (value !== undefined && value !== null)
        out[key] = value;
}
function clip(c, path, raw) {
    const o = c.obj(path, raw);
    const out = {
        camera: c.num(`${path}.camera`, o.camera),
        quality: c.str(`${path}.quality`, o.quality),
        key: c.str(`${path}.key`, o.key),
    };
    if (o.start !== undefined && o.start !== null)
        put(out, "start", c.str(`${path}.start`, o.start));
    if (o.start_epoch !== undefined && o.start_epoch !== null) {
        put(out, "start_epoch", c.num(`${path}.start_epoch`, o.start_epoch));
    }
    if (o.duration !== undefined && o.duration !== null) {
        put(out, "duration", c.num(`${path}.duration`, o.duration));
    }
    if (o.size !== undefined && o.size !== null)
        put(out, "size", c.num(`${path}.size`, o.size));
    if (o.filename !== undefined && o.filename !== null) {
        put(out, "filename", c.str(`${path}.filename`, o.filename));
    }
    // MINTED PER REQUEST. Carried through as given — a relative path is resolved
    // by the client against the API origin, an absolute presigned URL passes
    // untouched. Neither is cached here, and neither should be cached by a caller.
    if (o.url !== undefined && o.url !== null)
        put(out, "url", c.str(`${path}.url`, o.url));
    if (o.download_url !== undefined && o.download_url !== null) {
        put(out, "download_url", c.str(`${path}.download_url`, o.download_url));
    }
    return out;
}
function progress(c, path, raw) {
    const o = c.obj(path, raw);
    const out = {};
    for (const key of ["files_left", "bytes_left", "progress", "eta_sec"]) {
        if (o[key] !== undefined && o[key] !== null) {
            put(out, key, c.num(`${path}.${key}`, o[key]));
        }
    }
    // The one non-numeric key, carried beside them. A block holding ONLY this is
    // the whole shape of a `HUB_OFFLINE` answer, so nothing here may assume a
    // number was seen first.
    if (o.footage !== undefined && o.footage !== null) {
        put(out, "footage", c.str(`${path}.footage`, o.footage));
    }
    return out;
}
function alert(c, path, raw) {
    const o = c.obj(path, raw);
    const out = {
        id: c.str(`${path}.id`, o.id),
        type: c.str(`${path}.type`, o.type),
        colour: c.str(`${path}.colour`, o.colour),
        device_id: c.str(`${path}.device_id`, o.device_id),
        started_at: c.str(`${path}.started_at`, o.started_at),
        started_epoch: c.num(`${path}.started_epoch`, o.started_epoch),
        // ALWAYS A BOOLEAN, and required for it. An absent `acknowledged` would be
        // rendered as "not acknowledged" by every sensible falsy check, which is
        // the one reading the server promises never to make a consumer guess at.
        acknowledged: c.bool(`${path}.acknowledged`, o.acknowledged),
        rev: c.num(`${path}.rev`, o.rev),
    };
    if (o.cameras !== undefined && o.cameras !== null) {
        out.cameras = c
            .arr(`${path}.cameras`, o.cameras)
            .map((v, i) => c.num(`${path}.cameras[${i}]`, v));
    }
    if (o.recovered_at !== undefined && o.recovered_at !== null) {
        put(out, "recovered_at", c.str(`${path}.recovered_at`, o.recovered_at));
    }
    if (o.acknowledged_by !== undefined && o.acknowledged_by !== null) {
        put(out, "acknowledged_by", c.str(`${path}.acknowledged_by`, o.acknowledged_by));
    }
    if (o.acknowledged_at !== undefined && o.acknowledged_at !== null) {
        put(out, "acknowledged_at", c.str(`${path}.acknowledged_at`, o.acknowledged_at));
    }
    if (o.best_quality !== undefined && o.best_quality !== null) {
        put(out, "best_quality", c.str(`${path}.best_quality`, o.best_quality));
    }
    if (o.clips !== undefined && o.clips !== null) {
        out.clips = c.arr(`${path}.clips`, o.clips).map((v, i) => clip(c, `${path}.clips[${i}]`, v));
    }
    if (o.progress !== undefined && o.progress !== null) {
        out.progress = progress(c, `${path}.progress`, o.progress);
    }
    if (o.via_hub_id !== undefined && o.via_hub_id !== null) {
        put(out, "via_hub_id", c.str(`${path}.via_hub_id`, o.via_hub_id));
    }
    return out;
}
/** Validate one alert — the `GET .../{id}`, the ack answer, and an event's `data`. */
export function parseSiteAlert(raw, ctx = {}) {
    const c = new Check();
    const value = alert(c, "$", raw);
    c.done("site alert", ctx);
    return value;
}
/**
 * Validate `GET /v1/viewer/site-alerts`.
 *
 * `colours` is required. A list without it would leave a dashboard unable to
 * render a type it does not know, which is the one thing the map is for — and
 * an empty map from a server that forgot it is better surfaced here than as
 * uncoloured rows on a screen.
 */
export function parseSiteAlertList(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const alerts = c.arr("$.alerts", o.alerts).map((a, i) => alert(c, `$.alerts[${i}]`, a));
    const coloursRaw = c.obj("$.colours", o.colours);
    const colours = {};
    for (const [type, colour] of Object.entries(coloursRaw)) {
        colours[type] = c.str(`$.colours.${type}`, colour);
    }
    c.done("site alert list", ctx);
    return { alerts, colours };
}
/**
 * Validate `GET /v1/viewer/site-alerts/counts`.
 *
 * `by_device` → `byDevice`, and every count is required to be a real number:
 * a `null` here is a badge that renders as nothing on a tower that may have
 * fifty outstanding, which is worth failing loudly for.
 */
export function parseSiteAlertCounts(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const total = c.num("$.total", o.total);
    const byDevice = {};
    for (const [deviceId, n] of Object.entries(c.obj("$.by_device", o.by_device))) {
        byDevice[deviceId] = c.num(`$.by_device.${deviceId}`, n);
    }
    c.done("site alert counts", ctx);
    return { total, byDevice };
}
/** Validate `POST /v1/viewer/site-alerts/ack-all`. */
export function parseAckAllSiteAlertsResult(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    // Required, and never defaulted. "How many did that change" is the whole
    // answer; a missing one silently reported as 0 would tell an operator their
    // click did nothing when it cleared the fleet.
    const acknowledged = c.num("$.acknowledged", o.acknowledged);
    c.done("ack-all result", ctx);
    return { acknowledged };
}
/**
 * Validate the `data` of an `alerts.acknowledged` frame.
 *
 * A WHITELIST, like every other parser here: `count` and the two optional
 * filters are read and nothing else is carried through, so a field the server
 * adds for its own use cannot become something a dashboard starts depending on.
 */
export function parseAlertsAcknowledged(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const out = {
        kind: "alerts.acknowledged",
        count: c.num("$.count", o.count),
    };
    // snake_case on the wire, camelCase in hand — and absent, never null.
    if (o.site_id !== undefined && o.site_id !== null) {
        put(out, "siteId", c.str("$.site_id", o.site_id));
    }
    if (o.device_id !== undefined && o.device_id !== null) {
        put(out, "deviceId", c.str("$.device_id", o.device_id));
    }
    // The window, echoed back by a server that was given one. Same name on both
    // sides -- `from` is not a Python keyword problem out here.
    if (o.from !== undefined && o.from !== null) {
        put(out, "from", c.str("$.from", o.from));
    }
    c.done("alerts.acknowledged event", ctx);
    return out;
}
/* ------------------------------------------------------------------ *
 * Ordering
 * ------------------------------------------------------------------ */
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
export class AlertRevisionGate {
    seen = new Map();
    /**
     * `true` when this alert is new or newer than what has been seen, and records
     * it. `false` when it is a duplicate or older, and changes nothing.
     *
     * Equal revs are rejected: a row that has not changed has nothing to apply,
     * and re-rendering it is work for no new fact.
     */
    accept(a) {
        const prev = this.seen.get(a.id);
        if (prev !== undefined && a.rev <= prev)
            return false;
        this.seen.set(a.id, a.rev);
        return true;
    }
    /** The highest `rev` seen for an alert, or `undefined`. */
    revOf(id) {
        return this.seen.get(id);
    }
    /** Forget everything. For a sign-out or a site switch. */
    clear() {
        this.seen.clear();
    }
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
export function parseSseFrame(block) {
    let id;
    let event;
    const data = [];
    for (const line of block.split("\n")) {
        if (line === "" || line.startsWith(":"))
            continue; // comment / keepalive
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        // One optional space after the colon is part of the framing, not the value.
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" "))
            value = value.slice(1);
        if (field === "id")
            id = value;
        else if (field === "event")
            event = value;
        else if (field === "data")
            data.push(value);
        // `retry:` is the browser's own reconnect hint and means nothing to a
        // reader that does its own backoff. Ignored, not an error.
    }
    if (data.length === 0 && event === undefined && id === undefined)
        return null;
    const out = { data: data.join("\n") };
    if (id !== undefined)
        out.id = id;
    if (event !== undefined)
        out.event = event;
    return out;
}
/**
 * Turn a decoded chunk stream into complete frames.
 *
 * Holds a buffer because **a frame can arrive split across two reads**: the
 * network does not respect `\n\n`, and a parser that treated every chunk as a
 * whole frame would drop the tail of one alert and the head of the next. This is
 * the bug that makes an event channel look "mostly reliable".
 */
export class SseBuffer {
    buf = "";
    /** Feed a decoded chunk; get back the frames that are now complete. */
    push(chunk) {
        // Normalize CRLF so a proxy that rewrites line endings cannot break framing.
        this.buf += chunk.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        const out = [];
        let cut;
        while ((cut = this.buf.indexOf("\n\n")) !== -1) {
            const block = this.buf.slice(0, cut);
            this.buf = this.buf.slice(cut + 2);
            const frame = parseSseFrame(block);
            if (frame)
                out.push(frame);
        }
        return out;
    }
}
const EVENT_KINDS = ["alert.new", "alert.updated", "alerts.acknowledged"];
/**
 * Read one frame as an event, or `null` when it is not one this build knows.
 *
 * `null` for any other kind — a future event kind on this channel is additive
 * and a reader that threw on one would turn a compatible server change into a
 * broken dashboard (§A.9's rule, same shape).
 *
 * Throws {@link ValidationError} only when a frame *claims* to be a kind we
 * know and its `data` is not that shape: a real contract break, not an unknown.
 */
export function alertEventOf(frame) {
    const kind = frame.event;
    if (kind === undefined || !EVENT_KINDS.includes(kind))
        return null;
    if (!frame.data)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(frame.data);
    }
    catch {
        throw new ValidationError(`${kind} carried data that is not JSON`, {
            issues: [`$.data: expected JSON, got ${frame.data.slice(0, 60)}`],
            path: "/v1/viewer/events",
        });
    }
    const out = kind === "alerts.acknowledged"
        ? parseAlertsAcknowledged(parsed, { path: "/v1/viewer/events" })
        : {
            kind: kind,
            alert: parseSiteAlert(parsed, { path: "/v1/viewer/events" }),
        };
    if (frame.id !== undefined)
        return { ...out, id: frame.id };
    return out;
}
//# sourceMappingURL=alerts.js.map