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
/** `owner` is every pre-sites account's role and means admin. One place. */
export function isAdminRole(role) {
    if (typeof role !== "string")
        return false;
    const r = role.trim().toLowerCase();
    return r === "admin" || r === "owner";
}
/** Is this share granting access right now? Status AND expiry, both. */
export function isShareLive(share, now = new Date()) {
    if (share.status !== "active")
        return false;
    const expires = Date.parse(share.expires_at);
    // An unparseable expiry reads as EXPIRED, matching the server: the
    // alternative is a share that never dies because its timestamp was malformed.
    if (!Number.isFinite(expires))
        return false;
    return now.getTime() < expires;
}
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
    /** A string or null, which several of these fields genuinely are. */
    strOrNull(path, v) {
        if (v === null || v === undefined)
            return null;
        if (typeof v !== "string") {
            this.fail(path, "string or null", v);
            return null;
        }
        return v;
    }
    done(what, ctx) {
        if (this.issues.length === 0)
            return;
        throw new ValidationError(`${what} from ${ctx.path ?? "(unknown path)"} is not the documented shape`, { issues: this.issues, status: ctx.status, path: ctx.path });
    }
}
export function parseCapabilities(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const features = c.obj("$.features", o.features);
    const out = {
        role: c.str("$.role", o.role),
        features: { sites: c.bool("$.features.sites", features.sites) },
    };
    c.done("capabilities", ctx);
    return out;
}
function site(c, path, raw) {
    const o = c.obj(path, raw);
    const status = c.str(`${path}.status`, o.status);
    if (status !== "active" && status !== "archived") {
        c.fail(`${path}.status`, "active or archived", o.status);
    }
    const out = {
        site_id: c.str(`${path}.site_id`, o.site_id),
        name: c.str(`${path}.name`, o.name),
        status: status,
        created_at: c.str(`${path}.created_at`, o.created_at),
    };
    if (o.hubs !== undefined) {
        out.hubs = c.arr(`${path}.hubs`, o.hubs).map((h, i) => c.str(`${path}.hubs[${i}]`, h));
    }
    if (o.members !== undefined) {
        out.members = c.arr(`${path}.members`, o.members).map((m, i) => c.str(`${path}.members[${i}]`, m));
    }
    return out;
}
export function parseSiteList(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const sites = c
        .arr("$.sites", o.sites)
        .map((s, i) => site(c, `$.sites[${i}]`, s));
    const out = { sites };
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
            const row = {
                site_id: c.str(`$.others[${i}].site_id`, e.site_id),
                name: c.str(`$.others[${i}].name`, e.name),
            };
            // Absent is not false. See the field: an older server says nothing, and
            // hiding every site would be worse than offering an empty one.
            if (e.has_cameras !== undefined) {
                row.has_cameras = c.bool(`$.others[${i}].has_cameras`, e.has_cameras);
            }
            return row;
        });
    }
    c.done("site list", ctx);
    return out;
}
export function parseSiteDetail(raw, ctx = {}) {
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
function shareOne(c, path, raw) {
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
        const out = {
            device_id: c.str(`${path}.scope[${i}].device_id`, eo.device_id),
        };
        if (eo.cameras !== undefined) {
            out.cameras = c
                .arr(`${path}.scope[${i}].cameras`, eo.cameras)
                .map((n, j) => c.num(`${path}.scope[${i}].cameras[${j}]`, n));
        }
        return out;
    });
    const out = {
        share_id: c.str(`${path}.share_id`, o.share_id),
        direction: direction,
        status: status,
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
        asked_duration_sec: o.asked_duration_sec === undefined || o.asked_duration_sec === null
            ? null
            : c.num(`${path}.asked_duration_sec`, o.asked_duration_sec),
        // Absent reads as FALSE, like the `can_*` below: a share made by a site
        // is the thing every older server could produce.
        by_admin: o.by_admin === undefined ? false : c.bool(`${path}.by_admin`, o.by_admin),
        // Tolerated as absent for a server that predates it, and read as null,
        // which is the same thing an offer with nothing to say sends.
        message: o.message === undefined ? null : c.strOrNull(`${path}.message`, o.message),
    };
    if (o.incoming !== undefined)
        out.incoming = c.bool(`${path}.incoming`, o.incoming);
    if (o.outgoing !== undefined)
        out.outgoing = c.bool(`${path}.outgoing`, o.outgoing);
    for (const k of ["can_answer", "can_end", "can_extend"]) {
        // Absent reads as FALSE rather than as undefined, so a caller that writes
        // `share.can_answer` against an older server gets the restrictive answer
        // instead of a falsy value that happens to work by accident.
        out[k] = o[k] === undefined ? false : c.bool(`${path}.${k}`, o[k]);
    }
    return out;
}
export function parseShare(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const s = shareOne(c, "$.share", o.share);
    c.done("share", ctx);
    return s;
}
export function parseShareList(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const shares = c
        .arr("$.shares", o.shares)
        .map((s, i) => shareOne(c, `$.shares[${i}]`, s));
    c.done("share list", ctx);
    return { shares };
}
export function parsePeopleList(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const people = c.arr("$.people", o.people).map((p, i) => {
        const at = `$.people[${i}]`;
        const po = c.obj(at, p);
        const row = {
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
        if (po.name !== undefined)
            row.name = c.str(`${at}.name`, po.name);
        if (po.was !== undefined)
            row.was = c.str(`${at}.was`, po.was);
        if (po.created_at !== undefined) {
            row.created_at = c.str(`${at}.created_at`, po.created_at);
        }
        return row;
    });
    c.done("people list", ctx);
    return { people };
}
export function parseAudit(raw, ctx = {}) {
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
function managedCell(c, at, raw) {
    const o = c.obj(at, raw);
    const out = {
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
    return out;
}
export function parseCellList(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const cells = c
        .arr("$.cells", o.cells)
        .map((cell, i) => managedCell(c, `$.cells[${i}]`, cell));
    c.done("cell list", ctx);
    return { cells };
}
export function parseCellDetail(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const cell = managedCell(c, "$.cell", o.cell);
    const towers = c.arr("$.towers", o.towers).map((t, i) => {
        const at = `$.towers[${i}]`;
        const to = c.obj(at, t);
        const device_id = c.str(`${at}.device_id`, to.device_id);
        const out = {
            device_id,
            // THE ID AS A FALLBACK, not an empty string: a row with a blank name is
            // a row nobody can click on with any confidence.
            name: typeof to.name === "string" && to.name ? to.name : device_id,
        };
        if (typeof to.last_seen === "string")
            out.last_seen = to.last_seen;
        return out;
    });
    c.done("cell detail", ctx);
    return { cell, towers };
}
function pending(c, at, raw) {
    const o = c.obj(at, raw);
    const out = {};
    for (const key of ["what", "name", "claim_id", "site_id", "hub_id",
        "expires_at", "status", "message"]) {
        if (o[key] !== undefined)
            out[key] = c.str(`${at}.${key}`, o[key]);
    }
    if (o.queued !== undefined)
        out.queued = c.bool(`${at}.queued`, o.queued);
    if (o.old_keys_revoked !== undefined) {
        out.old_keys_revoked = c.bool(`${at}.old_keys_revoked`, o.old_keys_revoked);
    }
    // ⚠ AND A PAIRING CODE IS DROPPED HERE TOO, if a server ever sends one. It
    // has no business in a parsed response, and a client that quietly carried one
    // into its state would put it in a devtools tree and then in a bug report.
    return out;
}
export function parseAddDevice(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const out = {
        pending: pending(c, "$.pending", o.pending),
    };
    if (o.cell !== undefined && o.cell !== null) {
        out.cell = managedCell(c, "$.cell", o.cell);
    }
    c.done("added device", ctx);
    return out;
}
export function parseMoveCell(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const cell = o.cell === undefined || o.cell === null
        ? null
        : managedCell(c, "$.cell", o.cell);
    const ended = c
        .arr("$.shares_ended", o.shares_ended)
        .map((s, i) => c.str(`$.shares_ended[${i}]`, s));
    c.done("moved cell", ctx);
    return { cell, shares_ended: ended };
}
export function parseRemoveTower(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw);
    const out = {
        removed: c.str("$.removed", o.removed),
        keys_revoked: c.bool("$.keys_revoked", o.keys_revoked),
        recordings_kept: c.bool("$.recordings_kept", o.recordings_kept),
    };
    if (o.note !== undefined)
        out.note = c.str("$.note", o.note);
    c.done("removed tower", ctx);
    return out;
}
//# sourceMappingURL=sites.js.map