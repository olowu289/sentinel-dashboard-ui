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

import type { ApiError } from "./models.js";
import {
  NetworkError,
  RequestAbortedError,
  RequestTimeoutError,
  SentryError,
  errorFromEnvelope,
} from "./errors.js";

/* ------------------------------------------------------------------ *
 * Structural platform types (no DOM lib required)
 * ------------------------------------------------------------------ */

export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
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

interface AbortControllerLike {
  readonly signal: AbortSignalLike;
  abort(reason?: unknown): void;
}

declare const fetch: FetchLike | undefined;
declare const AbortController: (new () => AbortControllerLike) | undefined;

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ *
 * The transport
 * ------------------------------------------------------------------ */

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

export class HttpTransport {
  private readonly baseUrl: string;
  private readonly token: TokenProvider | undefined;
  private readonly defaultTimeoutMs: number;
  private readonly extraHeaders: Record<string, string>;
  private readonly doFetch: FetchLike;
  private readonly userAgent: string | undefined;

  constructor(opts: HttpOptions) {
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
      throw new TypeError(
        "no global fetch found. Node 18+ or a browser is required, " +
          "or pass { fetch } explicitly.",
      );
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
  url(pathOrUrl: string): string {
    if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
    return this.baseUrl + (pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl);
  }

  async send(args: SendArgs): Promise<{ status: number; body: unknown }> {
    const url = this.url(args.path);
    const timeoutMs = args.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string> = { ...this.extraHeaders };
    if (args.accept === "json") headers["Accept"] = "application/json";
    else if (args.accept === "sdp") headers["Accept"] = "application/sdp, application/json";

    let body: string | undefined;
    if (args.sdp !== undefined) {
      headers["Content-Type"] = "application/sdp";
      body = args.sdp;
    } else if (args.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(args.json);
    }

    const token = await resolveToken(this.token);
    if (token) headers["Authorization"] = `Bearer ${token}`;
    if (this.userAgent) headers["X-Sentry-Client"] = this.userAgent;

    const { signal, cancel, timedOut } = deadline(timeoutMs, args.signal);

    let res: FetchResponseLike;
    try {
      const init: FetchInitLike = { method: args.method, headers };
      if (body !== undefined) init.body = body;
      if (signal !== undefined) init.signal = signal;
      res = await this.doFetch(url, init);
    } catch (cause) {
      if (timedOut()) {
        throw new RequestTimeoutError(
          `${args.method} ${args.path} timed out after ${timeoutMs}ms`,
          { timeoutMs, path: args.path, cause },
        );
      }
      if (args.signal?.aborted) {
        throw new RequestAbortedError(`${args.method} ${args.path} aborted`, {
          path: args.path,
          cause,
        });
      }
      throw new NetworkError(`${args.method} ${args.path} failed: ${messageOf(cause)}`, {
        path: args.path,
        cause,
      });
    } finally {
      cancel();
    }

    // BEFORE the body is touched. See `accept: "blob"` — text() would corrupt
    // binary, so a successful media response must be taken as bytes. A FAILED
    // one still reads as text, because an error body is JSON whatever the
    // request asked for.
    if (args.accept === "blob" && res.ok) {
      if (typeof res.arrayBuffer !== "function") {
        throw new SentryError(
          `${args.method} ${args.path} needs a fetch whose Response supports arrayBuffer()`,
          { code: "response_invalid", status: res.status, path: args.path },
        );
      }
      return { status: res.status, body: await res.arrayBuffer() };
    }

    const text = res.status === 204 ? "" : await res.text().catch(() => "");
    const contentType = res.headers.get("content-type") ?? "";

    if (!res.ok) {
      throw this.toError(res.status, text, contentType, args.path);
    }

    if (args.accept === "none" || text === "") return { status: res.status, body: undefined };
    if (args.accept === "sdp" && !contentType.includes("json")) {
      return { status: res.status, body: text };
    }
    try {
      return { status: res.status, body: JSON.parse(text) as unknown };
    } catch (cause) {
      // A 2xx that is not the promised JSON is a contract break, not a network
      // fault — say so plainly rather than handing back a string.
      throw new SentryError(
        `${args.method} ${args.path} returned ${res.status} with unparseable JSON`,
        { code: "response_invalid", status: res.status, path: args.path, cause },
      );
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
  private toError(status: number, text: string, contentType: string, path: string): SentryError {
    if (text && contentType.includes("json")) {
      try {
        const parsed = JSON.parse(text) as { error?: Partial<ApiError> };
        const err = parsed?.error;
        if (err && typeof err.code === "string") {
          return errorFromEnvelope(
            { code: err.code, message: typeof err.message === "string" ? err.message : err.code },
            { status, path },
          );
        }
      } catch {
        /* fall through to the synthetic path */
      }
    }
    const snippet = text.slice(0, 200).replace(/\s+/g, " ").trim();
    return errorFromEnvelope(
      { code: syntheticCode(status), message: snippet || `HTTP ${status}` },
      { status, path },
    );
  }
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Map a status to a §7.1 code when the server did not send an envelope. */
function syntheticCode(status: number): string {
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

async function resolveToken(t: TokenProvider | undefined): Promise<string | undefined> {
  if (t === undefined) return undefined;
  if (typeof t === "string") return t || undefined;
  const v = await t();
  return v || undefined;
}

function messageOf(e: unknown): string {
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
function deadline(
  timeoutMs: number,
  outer: AbortSignalLike | undefined,
): { signal: AbortSignalLike | undefined; cancel: () => void; timedOut: () => boolean } {
  if (typeof AbortController !== "function") {
    // No AbortController: run without a deadline rather than refuse to work.
    return { signal: outer, cancel: () => {}, timedOut: () => false };
  }
  const controller = new AbortController();
  let fired = false;

  const timer = setTimeout(() => {
    fired = true;
    controller.abort();
  }, timeoutMs);
  // Node: do not let a pending request keep the process alive on its own.
  (timer as unknown as { unref?: () => void }).unref?.();

  const onOuterAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onOuterAbort);
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
