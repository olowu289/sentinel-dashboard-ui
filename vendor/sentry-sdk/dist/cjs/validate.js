"use strict";
/**
 * Minimal runtime validation for API responses.
 *
 * ## Why this exists
 *
 * v1's SDK had none. TypeScript types are erased at runtime, so every response
 * body was a blind `as` cast: if coordination ever changed a field name or sent
 * `null` where a number was promised, the SDK handed the dashboard a lie and
 * the failure surfaced hundreds of lines later as `Cannot read properties of
 * undefined`. That is the worst kind of bug to debug across a service boundary,
 * because the stack trace points at the consumer and the fault is at the
 * producer.
 *
 * ## Why it is hand-rolled
 *
 * Zod or valibot would be the obvious choice and both are good. Neither earns a
 * runtime dependency here: this SDK validates **six** response shapes, the
 * checks are shallow, and the whole file is smaller than the dependency's
 * README. The rule for this package is zero runtime dependencies (as v1 had),
 * and that rule is worth more than the ergonomics of a schema DSL for six
 * shapes.
 *
 * ## What it does and does not enforce
 *
 * It is **structural, not exhaustive**. It checks that required fields exist
 * with the right primitive type, and that arrays contain the right kind of
 * thing. It does **not** reject unknown extra fields: §2.2 and §A.9 make
 * forward compatibility explicit, and a validator that rejects a field the
 * server added last week would turn a compatible change into an outage. Unknown
 * fields pass through untouched.
 *
 * **There is exactly one exception**, and it is not an inconsistency: a
 * projected inventory carrying `path`, `whep_path` or `boot_id` is rejected
 * loudly, because §A.6 puts those in a MUST-NOT tier and puts the obligation to
 * refuse them on the consumer. See {@link assertNoProjectionLeak}. Everything
 * else in §A.6's SHOULD-omit tier — `codec`, `calibrated`, internal health
 * detail — is tolerated in silence whether present or absent.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ValidationCheck = void 0;
exports.assertNoProjectionLeak = assertNoProjectionLeak;
exports.parseViewerSession = parseViewerSession;
exports.parseSessionStatus = parseSessionStatus;
exports.parseIceCandidates = parseIceCandidates;
exports.parsePtzResult = parsePtzResult;
exports.parseSweepStatus = parseSweepStatus;
exports.sweepOf = sweepOf;
exports.parseCameraInfo = parseCameraInfo;
exports.parseTowerHealth = parseTowerHealth;
exports.parseDeviceFootage = parseDeviceFootage;
exports.parseTowerInfo = parseTowerInfo;
exports.parseTowerList = parseTowerList;
exports.parseTowerDetail = parseTowerDetail;
const errors_js_1 = require("./errors.js");
/* ------------------------------------------------------------------ *
 * Tiny checking kernel
 * ------------------------------------------------------------------ */
/** Collects field paths that failed, so one error reports every problem. */
class Check {
    issues = [];
    fail(path, expected, got) {
        this.issues.push(`${path}: expected ${expected}, got ${describe(got)}`);
    }
    obj(path, v) {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
            this.fail(path, "object", v);
            return undefined;
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
    arr(path, v) {
        if (!Array.isArray(v)) {
            this.fail(path, "array", v);
            return [];
        }
        return v;
    }
    /** Integer with an optional inclusive minimum — §A.2's `index` is ≥ 1. */
    int(path, v, min) {
        if (typeof v !== "number" || !Number.isInteger(v)) {
            this.fail(path, min === undefined ? "integer" : `integer >= ${min}`, v);
            return min ?? 0;
        }
        if (min !== undefined && v < min) {
            this.fail(path, `integer >= ${min}`, v);
            return min;
        }
        return v;
    }
    /**
     * A closed enum. Used only where the contract fixes the value set — `lens`,
     * `status` and `role` (§A.2/§A.5).
     *
     * Deliberately **not** used for `link`: §A.3 made that a word specifically so
     * a further state such as `"reconnecting"` can appear without a breaking
     * change (§A.12 #2), and validating it against a closed set would make the
     * forward compatibility it was reshaped for impossible to exercise.
     */
    enum(path, v, allowed, fallback) {
        if (typeof v !== "string" || !allowed.includes(v)) {
            this.fail(path, `one of ${allowed.map((a) => `"${a}"`).join(" | ")}`, v);
            return fallback;
        }
        return v;
    }
    /**
     * An ISO-8601 timestamp, or `null`.
     *
     * The key must be **present** — §A.3.2 makes `as_of` a MUST because it is
     * what stops a stale camera status rendering as a current one, and a missing
     * stamp is the silent failure it exists to remove. `null` is a legitimate
     * value (before the first `tower.hello`), an absent key is not.
     *
     * This checks only that a string parses. It does **not** compare against the
     * clock: computing staleness is the dashboard's job (§A.3.2), and an SDK that
     * applied its own freshness threshold would be making a display decision on
     * the consumer's behalf.
     */
    isoOrNull(path, present, v) {
        if (!present) {
            this.fail(path, "ISO-8601 timestamp or null (required, §A.3.2)", undefined);
            return null;
        }
        if (v === null)
            return null;
        if (typeof v !== "string" || Number.isNaN(Date.parse(v))) {
            this.fail(path, "parseable ISO-8601 timestamp or null", v);
            return null;
        }
        return v;
    }
    /** Optional field: absent/`null` is fine, present-and-wrong is not. */
    optStr(path, v) {
        if (v === undefined || v === null)
            return undefined;
        return this.str(path, v);
    }
    optNum(path, v) {
        if (v === undefined || v === null)
            return undefined;
        return this.num(path, v);
    }
    optBool(path, v) {
        if (v === undefined || v === null)
            return undefined;
        return this.bool(path, v);
    }
    /** Throw once, with every issue found, or return the value. */
    done(value, what, ctx) {
        if (this.issues.length > 0) {
            throw new errors_js_1.ValidationError(`${what} from the coordination service did not match the session-protocol shape`, { issues: this.issues, status: ctx.status, path: ctx.path });
        }
        return value;
    }
}
exports.ValidationCheck = Check;
function describe(v) {
    if (v === null)
        return "null";
    if (Array.isArray(v))
        return `array(${v.length})`;
    return typeof v;
}
/* ------------------------------------------------------------------ *
 * §A.6 — the MUST-NOT tier
 * ------------------------------------------------------------------ */
/**
 * Fields §A.6 says MUST NOT ever reach a viewer, anywhere in a projected
 * inventory document.
 *
 * `path` and `whep_path` are loopback media-plane addresses internal to the
 * tower. `boot_id` is the link-layer restart discriminator (§3.1, §7.3) and
 * leaks reboot timing for a physical asset; §A.13 records the ruling that moved
 * it here from the SHOULD tier, and the general rule it settled — when MUST NOT
 * and SHOULD collide on one field, MUST NOT wins absent a concrete viewer need.
 */
const FORBIDDEN_KEYS = ["path", "whep_path", "boot_id"];
/**
 * Reject a projected document that carries a §A.6 MUST-NOT field, naming every
 * offending path exactly.
 *
 * **This is the single exception to this module's unknown-field tolerance**,
 * and the asymmetry is deliberate rather than inconsistent. An unknown field is
 * usually a compatible addition (§2.2, §A.9), so rejecting one would turn a
 * safe change into an outage. These three are not additions — they are a
 * projection that failed to strip what it was required to strip, and §A.6 puts
 * the obligation on the consumer in as many words: the dashboard **MUST reject**
 * a projection containing any of them, "loud at the door, never silently
 * ignored".
 *
 * The scan is recursive because §A.6 says *anywhere in the document*: a `path`
 * nested three levels into a camera entry is the same leak as one at the top.
 */
function assertNoProjectionLeak(raw, ctx = {}) {
    const leaked = [];
    const walk = (node, at) => {
        if (Array.isArray(node)) {
            node.forEach((item, i) => walk(item, `${at}[${i}]`));
            return;
        }
        if (typeof node !== "object" || node === null)
            return;
        for (const [key, value] of Object.entries(node)) {
            const here = at ? `${at}.${key}` : key;
            if (FORBIDDEN_KEYS.includes(key))
                leaked.push(here);
            walk(value, here);
        }
    };
    walk(raw, "");
    if (leaked.length > 0) {
        throw new errors_js_1.ProjectionLeakError(`projection leaked ${leaked.length} field(s) §A.6 says MUST NOT reach a viewer: ` +
            leaked.join(", ") +
            " — this is a coordination bug, not a compatible addition", { leaked, status: ctx.status, path: ctx.path });
    }
}
/* ------------------------------------------------------------------ *
 * §4.2 — POST /v1/viewer/sessions response
 * ------------------------------------------------------------------ */
function iceServer(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return { urls: [] };
    // Tolerate the single-string form some servers emit for `urls`; the browser
    // accepts both and normalizing here saves every call site the branch.
    const urls = typeof o["urls"] === "string"
        ? [o["urls"]]
        : c.arr(`${path}.urls`, o["urls"]).map((u, i) => c.str(`${path}.urls[${i}]`, u));
    const out = { urls };
    const username = c.optStr(`${path}.username`, o["username"]);
    const credential = c.optStr(`${path}.credential`, o["credential"]);
    if (username !== undefined)
        out.username = username;
    if (credential !== undefined)
        out.credential = credential;
    return out;
}
/**
 * Validate the `201` body of `POST /v1/viewer/sessions` (§4.2).
 *
 * `offer_url` and `ice_url` are treated as **required**, because a client that
 * silently reconstructs them when the server omitted them is guessing at the
 * API surface. §4.2 documents both as present.
 */
function parseViewerSession(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const value = {
        session_id: c.str("session_id", o["session_id"]),
        device_id: c.str("device_id", o["device_id"]),
        camera: c.num("camera", o["camera"]),
        expires_at: c.str("expires_at", o["expires_at"]),
        ice_servers: c
            .arr("ice_servers", o["ice_servers"])
            .map((s, i) => iceServer(c, `ice_servers[${i}]`, s)),
        offer_url: c.str("offer_url", o["offer_url"]),
        ice_url: c.str("ice_url", o["ice_url"]),
    };
    return c.done(value, "session", ctx);
}
/* ------------------------------------------------------------------ *
 * §4.2 / §4.5 — GET .../ice
 * ------------------------------------------------------------------ */
function iceCandidate(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return { candidate: "" };
    const out = { candidate: c.str(`${path}.candidate`, o["candidate"]) };
    // `sdpMid` / `sdpMLineIndex` are legitimately null in WebRTC, so null is a
    // value here rather than an absence: pass it through as the browser expects.
    if (o["sdpMid"] !== undefined) {
        out.sdpMid = o["sdpMid"] === null ? null : c.str(`${path}.sdpMid`, o["sdpMid"]);
    }
    if (o["sdpMLineIndex"] !== undefined) {
        out.sdpMLineIndex =
            o["sdpMLineIndex"] === null ? null : c.num(`${path}.sdpMLineIndex`, o["sdpMLineIndex"]);
    }
    if (typeof o["usernameFragment"] === "string")
        out.usernameFragment = o["usernameFragment"];
    return out;
}
/** Validate `GET /v1/viewer/sessions/{id}` (§4.2, §7.4). */
function parseSessionStatus(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const value = {
        session_id: c.str("session_id", o["session_id"]),
        camera: c.num("camera", o["camera"]),
        // The field this route exists for. A missing expiry is a hard failure: a
        // client that defaulted it would either tear a live session down early or
        // keep a dead one on screen.
        expires_at: c.str("expires_at", o["expires_at"]),
        status: o["status"] === "ended" ? "ended" : "active",
    };
    // Optional: fresh ICE servers re-issued each poll. Absent on older servers and
    // direct-only deployments, so a missing/empty field is not an error.
    if (Array.isArray(o["ice_servers"])) {
        value.ice_servers = o["ice_servers"].map((s, i) => iceServer(c, `ice_servers[${i}]`, s));
    }
    return c.done(value, "session status", ctx);
}
/** Validate the `200` body of `GET /v1/viewer/sessions/{id}/ice` (§4.2). */
function parseIceCandidates(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const value = {
        candidates: c
            .arr("candidates", o["candidates"])
            .map((x, i) => iceCandidate(c, `candidates[${i}]`, x)),
    };
    const eoc = c.optBool("end_of_candidates", o["end_of_candidates"]);
    if (eoc !== undefined)
        value.end_of_candidates = eoc;
    return c.done(value, "ICE candidates", ctx);
}
/* ------------------------------------------------------------------ *
 * §5.2 — ptz.result relayed over HTTPS
 * ------------------------------------------------------------------ */
/**
 * Validate a relayed `ptz.result` payload (§5.2).
 *
 * `result` is intentionally unvalidated beyond "is an object": §5.2 shows it
 * carrying transport diagnostics, and `status` adds calibration-dependent
 * bearing/elevation. Pinning that down would make the SDK the reason a tower
 * cannot add a diagnostic field.
 */
function parsePtzResult(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const value = {
        session_id: c.str("session_id", o["session_id"]),
        ok: c.bool("ok", o["ok"]),
    };
    if (o["result"] !== undefined && o["result"] !== null) {
        const r = c.obj("result", o["result"]);
        if (r)
            value.result = r;
    }
    if (o["error"] !== undefined && o["error"] !== null) {
        const e = c.obj("error", o["error"]);
        if (e) {
            value.error = {
                code: c.str("error.code", e["code"]),
                message: c.str("error.message", e["message"]),
            };
            // The yield refusal's detail, when it is there. Optional and untyped on
            // the wire for every other code, so a missing one is not an issue.
            if (typeof e["holder_site"] === "string") {
                value.error.holder_site = e["holder_site"];
            }
            if (typeof e["retry_after_sec"] === "number") {
                value.error.retry_after_sec = e["retry_after_sec"];
            }
        }
    }
    // WHO MAY DRIVE IT, on every reply. Older coordination sends nothing here and
    // that is NOT an issue to report: its absence means "this server does not
    // arbitrate control", which a caller reads as the unrestricted behaviour it
    // had before leases existed.
    if (o["control"] !== undefined && o["control"] !== null) {
        const k = c.obj("control", o["control"]);
        if (k) {
            const control = {
                held: c.bool("control.held", k["held"]),
                yours: c.bool("control.yours", k["yours"]),
            };
            if (typeof k["holder_site"] === "string")
                control.holder_site = k["holder_site"];
            if (typeof k["holder_is_owner"] === "boolean") {
                control.holder_is_owner = k["holder_is_owner"];
            }
            if (typeof k["expires_in_sec"] === "number") {
                control.expires_in_sec = k["expires_in_sec"];
            }
            value.control = control;
        }
    }
    return c.done(value, "PTZ result", ctx);
}
/**
 * Validate a sweep block.
 *
 * TOLERANT ON EVERY FIELD BUT `state`, and deliberately. The three states are
 * what a dashboard renders and a fourth would be unrenderable, so an unknown
 * one is read as `idle` -- the safe reading, because it draws nothing rather
 * than claiming a camera is turning. Everything else is optional on the wire
 * (an idle block is `{"state":"idle"}` and nothing more), so a missing figure
 * is absence and not an error: a progress bar with no percent must not take the
 * whole reply down.
 */
function parseSweepStatus(raw, ctx = {}) {
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const state = c.optStr("state", o["state"]);
    const value = {
        state: state === "sweeping" || state === "paused" ? state : "idle",
    };
    const percent = c.optNum("percent", o["percent"]);
    // Bounded here as well as on the device: a percent over 100 would overflow a
    // progress bar, and this is the cheaper place to be sure of it.
    if (percent !== undefined)
        value.percent = percent < 0 ? 0 : percent > 100 ? 100 : percent;
    const covered = c.optNum("covered_deg", o["covered_deg"]);
    if (covered !== undefined)
        value.covered_deg = covered;
    const target = c.optNum("target_deg", o["target_deg"]);
    if (target !== undefined)
        value.target_deg = target;
    const seconds = c.optNum("seconds", o["seconds"]);
    if (seconds !== undefined)
        value.seconds = seconds;
    const startedAt = c.optStr("started_at", o["started_at"]);
    if (startedAt !== undefined)
        value.started_at = startedAt;
    const resumeIn = c.optNum("resume_in_sec", o["resume_in_sec"]);
    // Never negative: an overdue auto-resume counts down to 0 and stays there.
    if (resumeIn !== undefined)
        value.resume_in_sec = resumeIn < 0 ? 0 : resumeIn;
    const last = c.optStr("last", o["last"]);
    if (last !== undefined)
        value.last = last;
    return c.done(value, "sweep status", ctx);
}
/**
 * The sweep block carried by a PTZ reply, or `undefined` when there is none.
 *
 * ⚠ ABSENCE IS MEANINGFUL AND IS NOT AN ERROR. A `sweep` key appears only
 * on a reply that reported or CHANGED a sweep; an ordinary move answers without
 * one. So `undefined` means "this reply says nothing about a sweep", which is
 * different from `{state:"idle"}` ("there is no sweep on this camera"), and a
 * UI must not turn the first into the second -- that is how a running sweep
 * started in another tab gets drawn as idle.
 *
 * Use this rather than reaching into `result.sweep`: `PtzResult.result` is a
 * pass-through object, so a cast would skip validation on the one block whose
 * numbers drive a progress indicator.
 */
function sweepOf(result) {
    const inner = result?.result;
    if (!inner || typeof inner !== "object")
        return undefined;
    const block = inner.sweep;
    if (!block || typeof block !== "object")
        return undefined;
    return parseSweepStatus(block);
}
/* ------------------------------------------------------------------ *
 * §3.1 / §3.4 — inventory and health
 * ------------------------------------------------------------------ */
/**
 * Validate one camera of the **projected** inventory (§A.2).
 *
 * Required: `index`, `lens`, `ptz_capable`, `status`. Optional: `resolution`
 * (an object — a `"WIDTHxHEIGHT"` string is rejected, §A.12 #1), `enclosure`,
 * `role`.
 *
 * **`path` is not read and not required.** 0.1.0 required it, because it needed
 * it to join `health.feeds[]` for liveness. §A.2 serves `status` directly and
 * §A.6 puts `path` in the MUST-NOT tier, so the field is gone from both ends of
 * that join: not consumed here, and rejected by {@link assertNoProjectionLeak}
 * if coordination sends it anyway.
 *
 * `resolution` stays per-camera — §3.1 warns cam1 is 1080p and cam2 1440p on
 * the same tower, and "consumers MUST NOT assume uniformity".
 */
/** The closed sets `projection.py` validates against. Named once, used once. */
const PATROL_EVERY = ["1h", "2h", "4h", "6h", "12h", "24h", "random"];
const PATROL_DIRECTIONS = ["clockwise", "anticlockwise", "random"];
function parseCameraInfo(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return { index: 0, lens: "fixed", ptz_capable: false, status: "unknown" };
    const out = {
        // §A.2 — integer ≥ 1. A 0 or a float is not an address this protocol has.
        index: c.int(`${path}.index`, o["index"], 1),
        lens: c.enum(`${path}.lens`, o["lens"], ["ptz", "fixed"], "fixed"),
        ptz_capable: c.bool(`${path}.ptz_capable`, o["ptz_capable"]),
        // §A.2 — "unknown" is the honest pre-report value and MUST pass. It is
        // never an error here; §A.3.2 forbids only *rendering* it as good.
        status: c.enum(`${path}.status`, o["status"], ["live", "down", "unknown"], "unknown"),
    };
    /* THE CAMERA'S OWN NAME.
  
       ⚠ THE SECOND FIELD THIS WHITELIST HAS SWALLOWED, and the comment the
       dashboard left at its own read site is why it took so long to find:
       "`CameraInfo` is a version behind ... narrowing here rather than editing
       the vendored type". The reasoning was about the TYPE. The problem is the
       VALIDATOR -- `parseCameraInfo` builds a new object from the fields it
       names, so a cast that reads `label` off the parsed camera reads a field
       that is no longer there. Coordination sent "Gate test", the hub stored
       it, every GET carried it, and every screen said CAMERA 1.
  
       ⚠ AND AN EMPTY LABEL IS LEFT OFF rather than carried as "". Clearing a
       name is a real act, and the absence IS the cleared state -- a client
       printing an empty string where it falls back to `CAMERA 1` would show a
       blank tile caption instead. */
    const label = o["label"];
    if (typeof label === "string" && label.trim() !== "")
        out.label = label;
    /* MACHINE FIELDS, carried for whoever orders two writers and rendered by
       nobody. Tolerant like `patrol`: these arrived in a release this build did
       not know about, and a strict reading would have taken the whole fleet off
       the screen rather than ignoring a number it had no use for. */
    if (typeof o["name_rev"] === "number" && Number.isFinite(o["name_rev"])) {
        out.name_rev = o["name_rev"];
    }
    if (typeof o["patrol_rev"] === "number" && Number.isFinite(o["patrol_rev"])) {
        out.patrol_rev = o["patrol_rev"];
    }
    if (o["resolution"] !== undefined && o["resolution"] !== null) {
        // §A.12 #1 — the object form won. A string reaches c.obj and fails as
        // "expected object, got string", which is exactly the message we want.
        const r = c.obj(`${path}.resolution`, o["resolution"]);
        if (r) {
            out.resolution = {
                width: c.num(`${path}.resolution.width`, r["width"]),
                height: c.num(`${path}.resolution.height`, r["height"]),
            };
        }
    }
    /* PATROL, on a movable camera only.
  
       ⚠ WHITELISTED LIKE EVERYTHING ELSE HERE, AND THAT IS WHY IT HAD TO BE
       ADDED. This function builds a NEW object from the fields it names, so a
       block it does not name is not merely unvalidated -- it is DROPPED. The
       dashboard's Patrol row read `camera.patrol`, coordination sent it on all
       four cameras of the lab fleet, and it never arrived: the field was
       whitelisted out one layer above the code looking for it.
  
       ⚠ AND IT IS TOLERANT WHERE `lens` AND `status` ARE STRICT, deliberately.
       Those two are PROTOCOL: a tower reporting an unknown lens has said
       something this version cannot act on, and the loud answer is right.
       Patrol is a SETTING on a device that gets firmware updates, so a seventh
       direction or an eighth interval is a thing to expect rather than a
       malformed tower -- and `c.enum` records an issue, which `done` throws on,
       which would take the WHOLE FLEET off the screen over one camera's
       schedule. Unknown values fall back here and nothing is recorded.
  
       Absent stays absent: a fixed camera has no round to sweep, and a block
       defaulted in here would hand it a schedule it cannot keep. */
    const rawPatrol = o["patrol"];
    if (rawPatrol !== null && typeof rawPatrol === "object" && !Array.isArray(rawPatrol)) {
        const p = rawPatrol;
        const oneOf = (v, set, fallback) => typeof v === "string" && set.includes(v) ? v : fallback;
        const nextAt = p["next_at"];
        out.patrol = {
            enabled: p["enabled"] === true,
            every: oneOf(p["every"], PATROL_EVERY, "4h"),
            direction: oneOf(p["direction"], PATROL_DIRECTIONS, "clockwise"),
            /* `null` is the documented value for "not scheduled", so it is not an
               error and must not become one: the projection sends it for every
               camera whose patrol is off. */
            next_at: typeof nextAt === "string" && nextAt.trim() !== "" ? nextAt : null,
            running: p["running"] === true,
        };
    }
    if (o["profiles"] !== undefined && o["profiles"] !== null) {
        // §3.1 — default first, but order is the tower's business and not asserted
        // here. Each entry is whitelisted the way the projection whitelists it:
        // `id` and `default` always, `resolution` only when both dimensions are
        // there. An entry with no usable id is DROPPED rather than defaulted to
        // one, because a profile id is a name a session will be opened by — a
        // wrong one sends a viewer at a stream that never goes ready.
        out.profiles = c
            .arr(`${path}.profiles`, o["profiles"])
            .map((x, i) => {
            const po = c.obj(`${path}.profiles[${i}]`, x);
            if (!po)
                return undefined;
            const id = c.str(`${path}.profiles[${i}].id`, po["id"]);
            if (!id)
                return undefined;
            const entry = {
                id,
                default: c.bool(`${path}.profiles[${i}].default`, po["default"]),
            };
            if (po["resolution"] !== undefined && po["resolution"] !== null) {
                const r = c.obj(`${path}.profiles[${i}].resolution`, po["resolution"]);
                if (r) {
                    entry.resolution = {
                        width: c.num(`${path}.profiles[${i}].resolution.width`, r["width"]),
                        height: c.num(`${path}.profiles[${i}].resolution.height`, r["height"]),
                    };
                }
            }
            return entry;
        })
            .filter((p) => p !== undefined);
    }
    const enclosure = c.optStr(`${path}.enclosure`, o["enclosure"]);
    if (enclosure !== undefined)
        out.enclosure = enclosure;
    if (o["role"] !== undefined && o["role"] !== null) {
        out.role = c.enum(`${path}.role`, o["role"], ["primary", "secondary"], "primary");
    }
    // §A.6 SHOULD-omit tier: `codec` and `calibrated` are read by nothing here
    // and are tolerated in silence whether present or absent. Their presence is
    // noise, not a violation — the opposite of the MUST-NOT tier above.
    return out;
}
/**
 * Validate a health block (§3.1 `health`, §3.4 `tower.state.health`).
 *
 * Every member is optional because §3.4 pushes **partial** health — only what
 * changed. Requiring the full set would reject every state push.
 */
function parseTowerHealth(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return {};
    const out = {};
    const door = o["door"] === undefined || o["door"] === null ? undefined : c.obj(`${path}.door`, o["door"]);
    if (door)
        out.door = { open: c.bool(`${path}.door.open`, door["open"]) };
    const cover = o["cover"] === undefined || o["cover"] === null ? undefined : c.obj(`${path}.cover`, o["cover"]);
    if (cover)
        out.cover = { exposed: c.bool(`${path}.cover.exposed`, cover["exposed"]) };
    const impact = o["impact"] === undefined || o["impact"] === null ? undefined : c.obj(`${path}.impact`, o["impact"]);
    if (impact) {
        // §3.1 shows `last_delta_mg: null` on a tower that has recorded nothing —
        // null is a documented value here, not a missing field.
        const d = impact["last_delta_mg"];
        out.impact = { last_delta_mg: d === null || d === undefined ? null : c.num(`${path}.impact.last_delta_mg`, d) };
    }
    const thermal = o["thermal"] === undefined || o["thermal"] === null ? undefined : c.obj(`${path}.thermal`, o["thermal"]);
    if (thermal) {
        const soc = thermal["soc_c"];
        out.thermal = { soc_c: soc === null || soc === undefined ? null : c.num(`${path}.thermal.soc_c`, soc) };
        const state = c.optStr(`${path}.thermal.state`, thermal["state"]);
        if (state !== undefined)
            out.thermal.state = state;
    }
    const disk = o["disk"] === undefined || o["disk"] === null ? undefined : c.obj(`${path}.disk`, o["disk"]);
    if (disk) {
        /* `free_pct` stays REQUIRED whenever a disk block is present — it is the
           protocol's field, and a disk reported without it is a tower saying
           nothing while appearing to say something. The gigabytes are additive and
           optional, so an older agent that sends only the percentage still parses.
           Each is taken only when it is actually a number: a null or a string here
           would otherwise reach a UI that renders it as a size. */
        const d = {
            free_pct: c.num(`${path}.disk.free_pct`, disk["free_pct"]),
        };
        if (typeof disk["used_gb"] === "number")
            d.used_gb = disk["used_gb"];
        if (typeof disk["total_gb"] === "number")
            d.total_gb = disk["total_gb"];
        out.disk = d;
    }
    const uplink = o["uplink"] === undefined || o["uplink"] === null
        ? undefined
        : c.obj(`${path}.uplink`, o["uplink"]);
    if (uplink) {
        /* Every member optional, and each absence is its own claim — see
           `UplinkHealth`. Nothing is defaulted in: a missing `signal_dbm` must stay
           missing so a consumer cannot mistake a wired link for a 0 dBm one. */
        const out2 = {};
        if (uplink["signal_dbm"] !== undefined && uplink["signal_dbm"] !== null) {
            out2.signal_dbm = c.num(`${path}.uplink.signal_dbm`, uplink["signal_dbm"]);
        }
        const kind = c.optStr(`${path}.uplink.type`, uplink["type"]);
        if (kind !== undefined)
            out2.type = kind;
        if (uplink["associated"] !== undefined && uplink["associated"] !== null) {
            out2.associated = c.bool(`${path}.uplink.associated`, uplink["associated"]);
        }
        out.uplink = out2;
    }
    const battery = o["battery"] === undefined || o["battery"] === null
        ? undefined
        : c.obj(`${path}.battery`, o["battery"]);
    if (battery) {
        /* `reachable` is the ONLY required field, and it is what makes the deploy
           order safe: coordination returns no battery block at all unless it has a
           real boolean here, so this cannot be handed a block that throws.
    
           Every reading is optional because a tower that cannot reach its pack —
           the phone app holds the single BLE connection — is a normal state that
           must be representable with no numbers. Each is taken only when it really
           is a number, so a null or a string cannot reach a UI that would draw it
           as a charge level. Local shape rather than a new type import, matching
           the disk block above. */
        const b = { reachable: c.bool(`${path}.battery.reachable`, battery["reachable"]) };
        const stamp = c.optStr(`${path}.battery.as_of`, battery["as_of"]);
        if (stamp !== undefined)
            b.as_of = stamp;
        if (typeof battery["soc_pct"] === "number")
            b.soc_pct = battery["soc_pct"];
        if (typeof battery["voltage_v"] === "number")
            b.voltage_v = battery["voltage_v"];
        if (typeof battery["current_a"] === "number")
            b.current_a = battery["current_a"];
        if (typeof battery["temp_c"] === "number")
            b.temp_c = battery["temp_c"];
        out.battery = b;
    }
    if (o["feeds"] !== undefined && o["feeds"] !== null) {
        out.feeds = c.arr(`${path}.feeds`, o["feeds"]).map((f, i) => {
            const fo = c.obj(`${path}.feeds[${i}]`, f);
            if (!fo)
                return { path: "", live: false };
            const feed = {
                path: c.str(`${path}.feeds[${i}].path`, fo["path"]),
                live: c.bool(`${path}.feeds[${i}].live`, fo["live"]),
            };
            const since = c.optStr(`${path}.feeds[${i}].since`, fo["since"]);
            if (since !== undefined)
                feed.since = since;
            return feed;
        });
    }
    /* ── THE THREE BLOCKS THAT USED TO BE TYPED AND NOT PARSED ───────────
       `radio`, `sectors` and `recording` were declared on {@link TowerHealth}
       and never copied out of the body, so every one of them was DROPPED here
       on the way to the caller. A consumer compiled happily against
       `health.radio.signal_dbm` and read `undefined` for ever, which is the
       worst shape of all: the contract said the field existed, the server sent
       it, and the SDK quietly removed it.
  
       Parsed by name like everything above, and each absence preserved as an
       absence: a tower with no radio block has no radio link to describe, and a
       `{associated: false}` substituted here would claim a radio joined to
       nothing. */
    const radio = o["radio"] === undefined || o["radio"] === null
        ? undefined
        : c.obj(`${path}.radio`, o["radio"]);
    if (radio) {
        const r = {
            associated: c.bool(`${path}.radio.associated`, radio["associated"]),
        };
        if (typeof radio["node_id"] === "number")
            r.node_id = radio["node_id"];
        if (radio["state"] !== undefined && radio["state"] !== null) {
            r.state = c.enum(`${path}.radio.state`, radio["state"], ["up", "degraded", "down"], "down");
        }
        if (typeof radio["last_seen_sec"] === "number")
            r.last_seen_sec = radio["last_seen_sec"];
        if (typeof radio["quality"] === "number")
            r.quality = radio["quality"];
        const sector = c.optStr(`${path}.radio.sector`, radio["sector"]);
        if (sector !== undefined)
            r.sector = sector;
        /* The measurement, and WHICH END MADE IT. Taken only when it really is a
           number: a null or a string here would reach a row that grades it, and
           "Good" printed over a non-reading is the fake-green this whole contract
           refuses. */
        if (typeof radio["signal_dbm"] === "number")
            r.signal_dbm = radio["signal_dbm"];
        if (radio["signal_from"] !== undefined && radio["signal_from"] !== null) {
            r.signal_from = c.enum(`${path}.radio.signal_from`, radio["signal_from"], ["tower", "hub"], "hub");
        }
        out.radio = r;
    }
    if (o["sectors"] !== undefined && o["sectors"] !== null) {
        out.sectors = c.arr(`${path}.sectors`, o["sectors"]).map((s, i) => {
            const so = c.obj(`${path}.sectors[${i}]`, s);
            if (!so)
                return { id: "", state: "unknown", associations: "unknown" };
            const sec = {
                id: c.str(`${path}.sectors[${i}].id`, so["id"]),
                /* `unknown` IS NEVER RENDERED AS UP, so an unrecognized word falls to
                   it rather than passing through. */
                state: c.enum(`${path}.sectors[${i}].state`, so["state"], ["up", "down", "unknown"], "unknown"),
                associations: c.enum(`${path}.sectors[${i}].associations`, so["associations"], ["observed", "unknown"], "unknown"),
            };
            if (typeof so["azimuth"] === "number")
                sec.azimuth = so["azimuth"];
            const ssid = c.optStr(`${path}.sectors[${i}].ssid`, so["ssid"]);
            if (ssid !== undefined)
                sec.ssid = ssid;
            const mgmt = c.optStr(`${path}.sectors[${i}].mgmt`, so["mgmt"]);
            if (mgmt !== undefined)
                sec.mgmt = mgmt;
            const mac = c.optStr(`${path}.sectors[${i}].mac`, so["mac"]);
            if (mac !== undefined)
                sec.mac = mac;
            if (typeof so["freq_mhz"] === "number")
                sec.freq_mhz = so["freq_mhz"];
            if (typeof so["width_mhz"] === "number")
                sec.width_mhz = so["width_mhz"];
            if (typeof so["signal_dbm"] === "number")
                sec.signal_dbm = so["signal_dbm"];
            /* ⚠ ONLY UNDER `observed`, AND NEVER DEFAULTED TO `[]`. `towers: []`
               beside `associations: "unknown"` reads as "this sector has no masts",
               which is the one wrong answer available here. */
            if (Array.isArray(so["stations"])) {
                sec.stations = c
                    .arr(`${path}.sectors[${i}].stations`, so["stations"])
                    .filter((m) => typeof m === "string");
            }
            if (Array.isArray(so["towers"])) {
                sec.towers = c
                    .arr(`${path}.sectors[${i}].towers`, so["towers"])
                    .filter((t) => typeof t === "string");
            }
            if (Array.isArray(so["tower_signals"])) {
                const signals = c
                    .arr(`${path}.sectors[${i}].tower_signals`, so["tower_signals"])
                    .map((t) => {
                    const to = c.obj(`${path}.sectors[${i}].tower_signals`, t);
                    if (!to)
                        return undefined;
                    if (typeof to["device_id"] !== "string")
                        return undefined;
                    if (typeof to["signal_dbm"] !== "number")
                        return undefined;
                    return { device_id: to["device_id"], signal_dbm: to["signal_dbm"] };
                })
                    .filter((t) => t !== undefined);
                if (signals.length > 0)
                    sec.tower_signals = signals;
            }
            return sec;
        });
    }
    const recording = o["recording"] === undefined || o["recording"] === null
        ? undefined
        : c.obj(`${path}.recording`, o["recording"]);
    if (recording) {
        const rec = {};
        if (recording["mode"] !== undefined && recording["mode"] !== null) {
            rec.mode = c.enum(`${path}.recording.mode`, recording["mode"], ["tower", "hub"], "hub");
        }
        if (recording["stream"] !== undefined && recording["stream"] !== null) {
            rec.stream = c.enum(`${path}.recording.stream`, recording["stream"], ["main", "sub"], "sub");
        }
        if (typeof recording["retain_days"] === "number")
            rec.retain_days = recording["retain_days"];
        if (typeof recording["effective_days"] === "number") {
            rec.effective_days = recording["effective_days"];
        }
        if (recording["bound_by"] !== undefined && recording["bound_by"] !== null) {
            rec.bound_by = c.enum(`${path}.recording.bound_by`, recording["bound_by"], ["age", "disk"], "age");
        }
        out.recording = rec;
    }
    return out;
}
/**
 * Validate the server's `cloud` block (see {@link CloudHealth}).
 *
 * Absent and `{}` both come back as `undefined`: "this box cannot say" is the
 * state a screen must render in words, and an empty object dressed as a
 * reading would be rendered as "disconnected" by any caller reading
 * `cloud.connected === true`.
 */
function parseCloudHealth(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return undefined;
    const out = {};
    if (o["connected"] !== undefined && o["connected"] !== null) {
        out.connected = c.bool(`${path}.connected`, o["connected"]);
    }
    if (o["iface"] !== undefined && o["iface"] !== null) {
        out.iface = c.enum(`${path}.iface`, o["iface"], ["Ethernet", "Fibre", "Mobile", "Satellite", "Wi-Fi"], "Ethernet");
    }
    const since = c.optStr(`${path}.since`, o["since"]);
    if (since !== undefined)
        out.since = since;
    if (typeof o["latency_ms"] === "number")
        out.latency_ms = o["latency_ms"];
    if (o["is_cloud"] !== undefined && o["is_cloud"] !== null) {
        out.is_cloud = c.bool(`${path}.is_cloud`, o["is_cloud"]);
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
/**
 * One entry of the projected inventory (§A.3), shared by the list and detail
 * endpoints.
 *
 * Required per §A.3: `device_id`, `label`, `link`, `as_of`, `cameras`,
 * `sensors`. Note what is **not** here any more:
 *
 * - **`online` is gone.** §A.12 #2 replaced it with `link`, a word rather than
 *   a boolean, so a third state (`"reconnecting"`) can arrive without a
 *   breaking change. There is no boolean form to fall back to, and a response
 *   sending `online: true` fails here as a missing `link`.
 * - **`agent_version`, `capabilities`, `last_seen` are optional.** §A.3.3 is
 *   explicit that narrowing them out of the required set is deliberate and not
 *   a prohibition: §4.2.3 still serves them, so they are read when present.
 *
 * `sensors` must be **present even when empty** (§A.3, §A.9). An absent array
 * and an empty one mean different things — reserved-and-none versus a server
 * that has not implemented the field — and only the second is a contract miss.
 */
function towerInfo(c, path, raw) {
    const o = c.obj(path, raw);
    const p = path === "$" ? "" : `${path}.`;
    if (!o) {
        return { device_id: "", label: "", link: "down", as_of: null, cameras: [], sensors: [] };
    }
    const value = {
        device_id: c.str(`${p}device_id`, o["device_id"]),
        // §A.3.1 — the human name from the account layer. Required: without it a
        // consumer falls back to slug-parsing `device_id`, which is the "Tower 1"
        // trap the field exists to close.
        label: c.str(`${p}label`, o["label"]),
        // §A.3/§A.12 #2 — a word, validated as a string rather than a closed set.
        link: c.str(`${p}link`, o["link"]),
        as_of: c.isoOrNull(`${p}as_of`, "as_of" in o, o["as_of"]),
        cameras: c
            .arr(`${p}cameras`, o["cameras"])
            .map((x, i) => parseCameraInfo(c, `${p}cameras[${i}]`, x)),
        sensors: c.arr(`${p}sensors`, o["sensors"]).map((s, i) => {
            // §A.9 — reserved. Unknown item types MUST be tolerated, so this checks
            // shape and nothing else: no discriminator is required yet, and the UI
            // degrades to a placeholder rather than crashing on one it cannot draw.
            const so = c.obj(`${p}sensors[${i}]`, s);
            return (so ?? {});
        }),
    };
    /* Present only while the link is up, so its ABSENCE is meaningful and is
       preserved as absence rather than coerced to null — "offline" and "connected
       at an unknown time" are different claims. */
    if (o["connected_at"] !== undefined && o["connected_at"] !== null) {
        const at = c.isoOrNull(`${p}connected_at`, true, o["connected_at"]);
        if (at !== null)
            value.connected_at = at;
    }
    /* Which revision of the tower's own name this is. A machine field, carried
       and never rendered, tolerant for the reason `patrol` is. */
    if (typeof o["name_rev"] === "number" && Number.isFinite(o["name_rev"])) {
        value.name_rev = o["name_rev"];
    }
    const agent = c.optStr(`${p}agent_version`, o["agent_version"]);
    if (agent !== undefined)
        value.agent_version = agent;
    const channel = c.optStr(`${p}ota_channel`, o["ota_channel"]);
    if (channel !== undefined)
        value.ota_channel = channel;
    /* What the box is. Optional, each independently: a tower that reports a
       model and no serial is an ordinary state (the serial is blank in its
       device.env), and the dashboard says "Not reported" for the one that is
       missing rather than refusing the whole tower. */
    for (const key of ["model", "serial", "board_serial"]) {
        const got = c.optStr(`${p}${key}`, o[key]);
        if (got !== undefined)
            value[key] = got;
    }
    /* TOWER OR HUB. Only the one word is believed: a screen branches on this to
       decide which Network rows to draw, so an unrecognized value must read as a
       tower rather than reach that branch. */
    if (o["kind"] === "hub")
        value.kind = "hub";
    if (o["last_seen"] !== undefined) {
        value.last_seen = o["last_seen"] === null ? null : c.str(`${p}last_seen`, o["last_seen"]);
    }
    if (o["capabilities"] !== undefined && o["capabilities"] !== null) {
        value.capabilities = c
            .arr(`${p}capabilities`, o["capabilities"])
            .map((x, i) => c.str(`${p}capabilities[${i}]`, x));
    }
    if (o["health"] !== undefined && o["health"] !== null) {
        value.health = parseTowerHealth(c, `${p}health`, o["health"]);
    }
    // THE `footage` BLOCK, a sibling of `health` and parsed like one.
    //
    // ⚠ A LINE HERE FOR EVERY FIELD, which is the lesson `label` and `patrol`
    // both taught: this validator builds a NEW object from the fields it names,
    // so a block the projection sends and this function does not read is a block
    // no consumer can see, however correct the type beside it is.
    if (o["footage"] !== undefined && o["footage"] !== null) {
        value.footage = parseDeviceFootage(c, `${p}footage`, o["footage"]);
    }
    return value;
}
/* ------------------------------------------------------------------ *
 * The `footage` block (footage-sync.md §3.3/§3.4/§3.4.1, alerts.md §8)
 * ------------------------------------------------------------------ */
const FOOTAGE_SYNC_STATES = ["ready", "unavailable", "sending", "idle"];
const FOOTAGE_SYNC_REASONS = [
    "ok",
    "behind",
    "unreachable",
    "no_recording_disk",
    "recording_off",
];
const FOOTAGE_BLOCKED_BY = [
    "no_recording_disk",
    "recording_disabled",
    "wireguard_link",
    "no_recording_path",
    "cannot_determine",
];
const FOOTAGE_STREAMS = ["sub", "main"];
/**
 * Validate a device's `footage` block.
 *
 * **Every member is optional**, because the projection whitelists field by
 * field and a tower that did not report something sends nothing. The one rule
 * that is not merely structural is `oldest_unconfirmed_exact`: it is read as
 * `=== false` and carried only then, because its ABSENCE is the stronger
 * statement and defaulting it to `true` would turn "we could not establish
 * this" into "we did".
 */
function parseDeviceFootage(c, path, raw) {
    const o = c.obj(path, raw);
    if (!o)
        return {};
    const out = {};
    const asOf = c.optStr(`${path}.as_of`, o["as_of"]);
    if (asOf !== undefined)
        out.as_of = asOf;
    if (o["times"] !== undefined && o["times"] !== null) {
        out.times = c.enum(`${path}.times`, o["times"], ["reliable", "unreliable"], "reliable");
    }
    if (o["footage_stream"] !== undefined && o["footage_stream"] !== null) {
        out.footage_stream = c.enum(`${path}.footage_stream`, o["footage_stream"], ["2k", "standard"], "standard");
    }
    if (o["record_stream"] !== undefined && o["record_stream"] !== null) {
        out.record_stream = c.enum(`${path}.record_stream`, o["record_stream"], FOOTAGE_STREAMS, "sub");
    }
    if (o["copy"] !== undefined && o["copy"] !== null) {
        out.copy = c.enum(`${path}.copy`, o["copy"], ["tower", "hub_only"], "hub_only");
    }
    if (o["clock"] !== undefined && o["clock"] !== null) {
        const k = c.obj(`${path}.clock`, o["clock"]);
        if (k) {
            const clock = {};
            if (k["state"] !== undefined && k["state"] !== null) {
                clock.state = c.enum(`${path}.clock.state`, k["state"], ["synced", "unsynced", "unknown"], "unknown");
            }
            // `true` only — the projection sends this key exclusively when the answer
            // is the bad one, so anything else is left absent rather than coerced.
            if (k["unsynced_at_record_start"] === true)
                clock.unsynced_at_record_start = true;
            out.clock = clock;
        }
    }
    if (o["sync"] !== undefined && o["sync"] !== null) {
        const s = c.obj(`${path}.sync`, o["sync"]);
        if (s) {
            const sync = {};
            if (s["state"] !== undefined && s["state"] !== null) {
                sync.state = c.enum(`${path}.sync.state`, s["state"], FOOTAGE_SYNC_STATES, "idle");
            }
            // THE VERDICT, over a fixed five. Absent is meaningful: a tower that said
            // nothing about its sync has not said `ok`.
            if (s["reason"] !== undefined && s["reason"] !== null) {
                sync.reason = c.enum(`${path}.sync.reason`, s["reason"], FOOTAGE_SYNC_REASONS, "unreachable");
            }
            // ...and the tower's own refusal code, which this key used to carry.
            if (s["blocked_by"] !== undefined && s["blocked_by"] !== null) {
                sync.blocked_by = c.enum(`${path}.sync.blocked_by`, s["blocked_by"], FOOTAGE_BLOCKED_BY, "cannot_determine");
            }
            const freePct = c.optNum(`${path}.sync.free_pct`, s["free_pct"]);
            if (freePct !== undefined)
                sync.free_pct = freePct;
            const totalGb = c.optNum(`${path}.sync.total_gb`, s["total_gb"]);
            if (totalGb !== undefined)
                sync.total_gb = totalGb;
            const separate = c.optBool(`${path}.sync.separate_disk`, s["separate_disk"]);
            if (separate !== undefined)
                sync.separate_disk = separate;
            out.sync = sync;
        }
    }
    if (o["cameras"] !== undefined && o["cameras"] !== null) {
        const cams = c.arr(`${path}.cameras`, o["cameras"]).map((raw, i) => {
            const at = `${path}.cameras[${i}]`;
            const cam = c.obj(at, raw);
            if (!cam)
                return { camera: 0, streams: [] };
            const streams = c.arr(`${at}.streams`, cam["streams"]).map((s, j) => {
                const sat = `${at}.streams[${j}]`;
                const st = c.obj(sat, s);
                if (!st)
                    return { stream: "sub" };
                const entry = {
                    stream: c.enum(`${sat}.stream`, st["stream"], FOOTAGE_STREAMS, "sub"),
                };
                for (const key of [
                    "segments",
                    "bytes",
                    "unconfirmed_segments",
                    "unconfirmed_bytes",
                    "unplaced_segments",
                ]) {
                    const v = c.optNum(`${sat}.${key}`, st[key]);
                    if (v !== undefined)
                        entry[key] = v;
                }
                const oldest = c.optStr(`${sat}.oldest_unconfirmed_start`, st["oldest_unconfirmed_start"]);
                if (oldest !== undefined)
                    entry.oldest_unconfirmed_start = oldest;
                // ⚠ `=== false`, NEVER FALSY, AND NEVER DEFAULTED. Absent means the
                // start WAS established exactly; defaulting to true would state that on
                // a tower that never said so.
                if (st["oldest_unconfirmed_exact"] === false)
                    entry.oldest_unconfirmed_exact = false;
                if (st["spans"] !== undefined && st["spans"] !== null) {
                    const spans = c.arr(`${sat}.spans`, st["spans"]).map((sp, k) => {
                        const pat = `${sat}.spans[${k}]`;
                        const so = c.obj(pat, sp);
                        if (!so)
                            return { from: "", to: "" };
                        const span = {
                            from: c.str(`${pat}.from`, so["from"]),
                            to: c.str(`${pat}.to`, so["to"]),
                        };
                        for (const key of ["segments", "bytes", "confirmed_bytes"]) {
                            const v = c.optNum(`${pat}.${key}`, so[key]);
                            if (v !== undefined)
                                span[key] = v;
                        }
                        return span;
                    });
                    if (spans.length > 0)
                        entry.spans = spans;
                }
                return entry;
            });
            return { camera: c.int(`${at}.camera`, cam["camera"], 0), streams };
        });
        if (cams.length > 0)
            out.cameras = cams;
    }
    return out;
}
/**
 * Validate one projected tower (§A.3).
 *
 * The §A.6 leak scan runs **first**, before any shape check. A leak is a
 * different class of problem from a malformed field — it is a contract
 * violation with a security rationale, and reporting it as one of several
 * shape issues would bury it.
 */
function parseTowerInfo(raw, ctx = {}) {
    assertNoProjectionLeak(raw, ctx);
    const c = new Check();
    return c.done(towerInfo(c, "$", raw), "tower", ctx);
}
/** Validate the `200` body of `GET /v1/viewer/towers` (§4.2.3, §A.3). */
function parseTowerList(raw, ctx = {}) {
    assertNoProjectionLeak(raw, ctx);
    const c = new Check();
    const o = c.obj("$", raw) ?? {};
    const value = {
        towers: c.arr("towers", o["towers"]).map((t, i) => towerInfo(c, `towers[${i}]`, t)),
    };
    /* ONE FACT ABOUT THE SERVER, beside the towers rather than inside each of
       them — see {@link CloudHealth}. Optional: a hub whose uplink agent has
       never run sends no block, and that is "cannot say", not "disconnected". */
    if (o["cloud"] !== undefined && o["cloud"] !== null) {
        const cloud = parseCloudHealth(c, "cloud", o["cloud"]);
        if (cloud)
            value.cloud = cloud;
    }
    return c.done(value, "tower list", ctx);
}
/**
 * Validate the `200` body of `GET /v1/viewer/towers/{device_id}` (§4.2.3,
 * §A.3).
 *
 * `health` and `health_as_of` are **required** here, unlike on a list entry.
 * §4.2.3 makes `health_as_of` mandatory precisely so a stale reading cannot
 * render as a current one, and a validator that let it go missing would hand
 * the dashboard `undefined` for the field whose whole job is to prevent that.
 *
 * This document carries **two** stamps and they are not interchangeable
 * (§A.3.2): `as_of` covers the camera statuses, `health_as_of` covers the
 * sensor block. Usually the same instant, separately served.
 */
function parseTowerDetail(raw, ctx = {}) {
    assertNoProjectionLeak(raw, ctx);
    const c = new Check();
    const base = towerInfo(c, "$", raw);
    const o = c.obj("$", raw) ?? {};
    // An absent `health` reaches parseTowerHealth as undefined and fails there as
    // "expected object" — which is the required-field error we want, once.
    const health = parseTowerHealth(c, "health", o["health"]);
    const healthAsOf = c.isoOrNull("health_as_of", "health_as_of" in o, o["health_as_of"]);
    const value = { ...base, health, health_as_of: healthAsOf };
    return c.done(value, "tower detail", ctx);
}
//# sourceMappingURL=validate.js.map