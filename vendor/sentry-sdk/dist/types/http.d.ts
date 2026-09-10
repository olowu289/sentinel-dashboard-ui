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
export interface FetchResponseLike {
    readonly ok: boolean;
    readonly status: number;
    readonly headers: {
        get(name: string): string | null;
    };
    text(): Promise<string>;
    /**
     * Bytes, for recorded media (§12.6). OPTIONAL because this interface is the
     * SDK's whole fetch contract and a host that supplies a minimal one should
     * not have to grow a method to keep compiling — `fetchRecordingSlice` checks
     * for it and says so plainly if it is absent, which beats a TypeError from
     * inside the transport.
     *
     * ArrayBuffer rather than Blob: this SDK compiles against ES2022 with no DOM
     * lib so it runs under Node as well as a browser, and Blob is a DOM type.
     * The caller wraps it for whatever it is feeding.
     */
    arrayBuffer?(): Promise<ArrayBuffer>;
}
export interface FetchInitLike {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: unknown;
}
/** The one platform capability this SDK requires. */
export type FetchLike = (url: string, init?: FetchInitLike) => Promise<FetchResponseLike>;
export interface AbortSignalLike {
    readonly aborted: boolean;
    addEventListener(type: "abort", listener: () => void): void;
    removeEventListener(type: "abort", listener: () => void): void;
}
/** A bearer token, or a function producing one (sync or async). */
export type TokenProvider = string | (() => string | undefined | Promise<string | undefined>);
export interface HttpOptions {
    /**
     * Base URL of the coordination service, e.g. `https://coord.example.com`.
     *
     * One versioned base URL, as v1 had. `/v1` is part of the documented paths
     * (§4.2), so a base of `https://host` and a base of `https://host/` behave
     * identically and neither should include `/v1`.
     */
    baseUrl: string;
    /**
     * Viewer credential (§4.2: "authenticated as a viewer — bearer token or
     * session cookie; out of scope here").
     *
     * The shape is wired now even though coordination's auth is stubbed, because
     * the header is the part the dashboard has to get right and retrofitting an
     * auth path through every call site is worse than carrying an unused one.
     * Omit it entirely to rely on cookies (`credentials: "include"` is *not* set
     * by this SDK; a cookie-authenticated deployment configures CORS itself).
     */
    token?: TokenProvider;
    /** Default per-call timeout in ms. Default 10 000. */
    timeoutMs?: number;
    /** Extra headers on every request. Never overrides `Authorization`. */
    headers?: Record<string, string>;
    /** Injectable `fetch`, for tests or a non-standard runtime. */
    fetch?: FetchLike;
    /** `User-Agent`-ish marker for server logs. Browsers ignore it. */
    userAgent?: string;
}
export interface RequestOptions {
    /** Overrides the client default for this one call. */
    timeoutMs?: number;
    /** Caller-owned cancellation, composed with the timeout. */
    signal?: AbortSignalLike;
}
interface SendArgs {
    method: string;
    path: string;
    /** JSON body. Mutually exclusive with `sdp`. */
    json?: unknown;
    /** Raw `application/sdp` body (§4.2 offer). */
    sdp?: string;
    /** What the caller expects back. */
    /**
     * `blob` is for RECORDED MEDIA (§12.6) and is the one mode that does not go
     * through `res.text()`. Reading a multi-megabyte fMP4 as text would decode
     * it as UTF-8 and corrupt every byte that is not valid UTF-8 — which, for
     * video, is most of them. It has to branch before the body is read at all.
     */
    accept: "json" | "sdp" | "none" | "blob";
    timeoutMs?: number;
    signal?: AbortSignalLike;
}
export declare class HttpTransport {
    private readonly baseUrl;
    private readonly token;
    private readonly defaultTimeoutMs;
    private readonly extraHeaders;
    private readonly doFetch;
    private readonly userAgent;
    constructor(opts: HttpOptions);
    /**
     * Resolve a path against the base URL.
     *
     * Accepts both an absolute path (`/v1/viewer/sessions/x/offer`) and a full
     * URL, which is what lets the client use the server-supplied `offer_url` /
     * `ice_url` verbatim rather than rebuilding them (§4.2).
     */
    url(pathOrUrl: string): string;
    send(args: SendArgs): Promise<{
        status: number;
        body: unknown;
    }>;
    /**
     * Turn a non-2xx into the right typed exception.
     *
     * §4.2: "Error bodies use one envelope everywhere" —
     * `{"error":{"code":...,"message":...}}`. When the body is not that envelope
     * (a proxy's HTML 502, say), synthesise a code from the status rather than
     * pretending the server spoke the protocol.
     */
    private toError;
}
export {};
//# sourceMappingURL=http.d.ts.map