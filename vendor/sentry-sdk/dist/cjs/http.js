"use strict";
/**
 * Zero-dependency HTTP transport.
 *
 * Uses the platform's `fetch`, `AbortController` and `URL` — the same approach
 * v1's SDK took, and the reason it installed cleanly into a browser bundle, a
 * Node service and a Vercel edge function without a polyfill argument. Node 18+
 * and every current browser have all three.
 *
 * Nothing DOM-typed leaks into the public API: the structural types below mean
 * a consumer never needs `"lib": ["DOM"]` to build against this package, and a
 * test can inject a fake `fetch` without a mock library.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpTransport = void 0;
const errors_js_1 = require("./errors.js");
class HttpTransport {
    baseUrl;
    token;
    defaultTimeoutMs;
    extraHeaders;
    doFetch;
    userAgent;
    constructor(opts) {
        if (!opts.baseUrl) {
            throw new TypeError("baseUrl is required, e.g. https://coord.example.com");
        }
        this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
        this.token = opts.token;
        this.defaultTimeoutMs = opts.timeoutMs ?? 10_000;
        this.extraHeaders = { ...opts.headers };
        this.userAgent = opts.userAgent;
        const platformFetch = opts.fetch ?? (typeof fetch === "function" ? fetch : undefined);
        if (!platformFetch) {
            throw new TypeError("no global fetch found. Node 18+ or a browser is required, " +
                "or pass { fetch } explicitly.");
        }
        this.doFetch = platformFetch;
    }
    /**
     * Resolve a path against the base URL.
     *
     * Accepts both an absolute path (`/v1/viewer/sessions/x/offer`) and a full
     * URL, which is what lets the client use the server-supplied `offer_url` /
     * `ice_url` verbatim rather than rebuilding them (§4.2).
     */
    url(pathOrUrl) {
        if (/^https?:\/\//i.test(pathOrUrl))
            return pathOrUrl;
        return this.baseUrl + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
    }
    async send(args) {
        const url = this.url(args.path);
        const timeoutMs = args.timeoutMs ?? this.defaultTimeoutMs;
        const headers = { ...this.extraHeaders };
        if (args.accept === "json")
            headers["Accept"] = "application/json";
        else if (args.accept === "sdp")
            headers["Accept"] = "application/sdp, application/json";
        let body;
        if (args.sdp !== undefined) {
            headers["Content-Type"] = "application/sdp";
            body = args.sdp;
        }
        else if (args.json !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(args.json);
        }
        const token = await resolveToken(this.token);
        if (token)
            headers["Authorization"] = `Bearer ${token}`;
        if (this.userAgent)
            headers["X-Sentry-Client"] = this.userAgent;
        const { signal, cancel, timedOut } = deadline(timeoutMs, args.signal);
        let res;
        try {
            const init = { method: args.method, headers };
            if (body !== undefined)
                init.body = body;
            if (signal !== undefined)
                init.signal = signal;
            res = await this.doFetch(url, init);
        }
        catch (cause) {
            if (timedOut()) {
                throw new errors_js_1.RequestTimeoutError(`${args.method} ${args.path} timed out after ${timeoutMs}ms`, { timeoutMs, path: args.path, cause });
            }
            if (args.signal?.aborted) {
                throw new errors_js_1.RequestAbortedError(`${args.method} ${args.path} aborted`, {
                    path: args.path,
                    cause,
                });
            }
            throw new errors_js_1.NetworkError(`${args.method} ${args.path} failed: ${messageOf(cause)}`, {
                path: args.path,
                cause,
            });
        }
        finally {
            cancel();
        }
        // BEFORE the body is touched. See `accept: "blob"` — text() would corrupt
        // binary, so a successful media response must be taken as bytes. A FAILED
        // one still reads as text, because an error body is JSON whatever the
        // request asked for.
        if (args.accept === "blob" && res.ok) {
            if (typeof res.arrayBuffer !== "function") {
                throw new errors_js_1.SentryError(`${args.method} ${args.path} needs a fetch whose Response supports arrayBuffer()`, { code: "response_invalid", status: res.status, path: args.path });
            }
            return { status: res.status, body: await res.arrayBuffer() };
        }
        const text = res.status === 204 ? "" : await res.text().catch(() => "");
        const contentType = res.headers.get("content-type") ?? "";
        if (!res.ok) {
            throw this.toError(res.status, text, contentType, args.path);
        }
        if (args.accept === "none" || text === "")
            return { status: res.status, body: undefined };
        if (args.accept === "sdp" && !contentType.includes("json")) {
            return { status: res.status, body: text };
        }
        try {
            return { status: res.status, body: JSON.parse(text) };
        }
        catch (cause) {
            // A 2xx that is not the promised JSON is a contract break, not a network
            // fault — say so plainly rather than handing back a string.
            throw new errors_js_1.SentryError(`${args.method} ${args.path} returned ${res.status} with unparseable JSON`, { code: "response_invalid", status: res.status, path: args.path, cause });
        }
    }
    /**
     * Turn a non-2xx into the right typed exception.
     *
     * §4.2: "Error bodies use one envelope everywhere" —
     * `{"error":{"code":...,"message":...}}`. When the body is not that envelope
     * (a proxy's HTML 502, say), synthesise a code from the status rather than
     * pretending the server spoke the protocol.
     */
    toError(status, text, contentType, path) {
        if (text && contentType.includes("json")) {
            try {
                const parsed = JSON.parse(text);
                const err = parsed?.error;
                if (err && typeof err.code === "string") {
                    return (0, errors_js_1.errorFromEnvelope)({ code: err.code, message: typeof err.message === "string" ? err.message : err.code }, { status, path });
                }
            }
            catch {
                /* fall through to the synthetic path */
            }
        }
        const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
        return (0, errors_js_1.errorFromEnvelope)({ code: syntheticCode(status), message: snippet || `HTTP ${status}` }, { status, path });
    }
}
exports.HttpTransport = HttpTransport;
/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */
/** Map a status to a §7.1 code when the server did not send an envelope. */
function syntheticCode(status) {
    switch (status) {
        case 401:
            return "unauthorized";
        case 403:
            return "not_authorized";
        case 404:
            return "session_unknown";
        case 409:
            return "session_duplicate";
        case 422:
        case 400:
            return "invalid_request";
        case 429:
            return "rate_limited";
        case 503:
            return "tower_offline";
        case 504:
            return "tower_timeout";
        default:
            return status >= 500 ? "internal" : "invalid_request";
    }
}
async function resolveToken(t) {
    if (t === undefined)
        return undefined;
    if (typeof t === "string")
        return t || undefined;
    const v = await t();
    return v || undefined;
}
function messageOf(e) {
    return e instanceof Error ? e.message : String(e);
}
/**
 * Compose a per-call timeout with the caller's own signal.
 *
 * `AbortSignal.any` would be tidier but is too new to assume across the
 * runtimes this package targets, so the composition is done by hand. `cancel()`
 * always runs, so a completed request never leaves a timer holding the event
 * loop open — the failure mode that makes a Node CLI hang for ten seconds after
 * printing its answer.
 */
function deadline(timeoutMs, outer) {
    if (typeof AbortController !== "function") {
        // No AbortController: run without a deadline rather than refuse to work.
        return { signal: outer, cancel: () => { }, timedOut: () => false };
    }
    const controller = new AbortController();
    let fired = false;
    const timer = setTimeout(() => {
        fired = true;
        controller.abort();
    }, timeoutMs);
    // Node: do not let a pending request keep the process alive on its own.
    timer.unref?.();
    const onOuterAbort = () => controller.abort();
    if (outer) {
        if (outer.aborted)
            controller.abort();
        else
            outer.addEventListener("abort", onOuterAbort);
    }
    return {
        signal: controller.signal,
        cancel: () => {
            clearTimeout(timer);
            outer?.removeEventListener("abort", onOuterAbort);
        },
        timedOut: () => fired,
    };
}
//# sourceMappingURL=http.js.map