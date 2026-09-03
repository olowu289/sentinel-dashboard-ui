/**
 * The SDK client — this app's one door to coordination.
 *
 * `@kallon/sentry-sdk` is signaling only, and deliberately so: the protocol puts
 * the peer connection between the viewer and the tower's MediaMTX, with
 * coordination as a relay that must not rewrite SDP. So the SDK owns the
 * conversation that sets a stream up, and this app owns the
 * `RTCPeerConnection` — that half lands in `api/media.ts` at Stage 3.
 *
 * Every coordination call in this app goes through the client this module
 * builds. If something needs an endpoint the SDK does not expose, the fix
 * belongs in the SDK or the protocol, not in a raw fetch here. The two
 * exceptions are already known and will be quarantined and marked when they
 * arrive — `api/auth.ts` (the SDK has no auth methods) and `api/claim.ts` (no
 * claim methods) — so that moving them into the SDK later is a deletion rather
 * than an excavation.
 */

import { SentryClient, type FetchLike } from "@kallon/sentry-sdk";

import {
  NotConfiguredError,
  coordinationBaseUrl,
  isConfigured as configOk,
  requireCoordinationUrl,
} from "@/lib/config";
import { getSessionRef } from "./session";

/**
 * ══════════════════════════════════════════════════════════════════════
 *  THE ONE PLACE `fetch` IS INVOKED. Do not add a second.
 * ══════════════════════════════════════════════════════════════════════
 *
 * In a browser `fetch` is a method of `Window` and is brand-checked: WebIDL
 * requires its `this` to be a `Window`. Call it with any other receiver and
 * Chrome throws
 *
 *     TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * `@kallon/sentry-sdk@0.2.0` stores the platform fetch on its transport
 * (`src/http.ts:144`) and calls it as `this.doFetch(url, init)` (`:187`), whose
 * receiver is the transport rather than Window. So every SDK request dies at the
 * fetch call — while a bare `fetch(...)` elsewhere keeps working, because an
 * unqualified call has `this === undefined` and WebIDL falls back to the global.
 *
 * That asymmetry is what makes it dangerous: **login succeeds and the fleet
 * list fails, in the same app, in the same tab.** Node's undici does NOT
 * brand-check, so no Node test can see it. The Stage 0 spike reproduced it in
 * real Chrome, deliberately, so the shape is on record.
 *
 * `globalThis.fetch(...)` is a METHOD call on `globalThis`, so `this` is the
 * global object — which is what the brand check wants. `globalThis` rather than
 * `window` because nothing here should assume a DOM.
 *
 * ⚠ Do NOT "simplify" this to `export const sdkFetch = globalThis.fetch`. That
 * re-detaches it and restores the bug exactly.
 *
 * TODO(sdk): the real fix is upstream — bind at assignment
 * (`platformFetch.bind(globalThis)`) or call detached
 * (`const f = this.doFetch; await f(url, init)`). Until a release carries it,
 * this goes through the SDK's own documented injection point
 * (`SentryClientOptions.fetch`), which is a supported seam rather than a patch.
 */
export const sdkFetch: FetchLike = (url, init) =>
  globalThis.fetch(url, init as RequestInit | undefined);

export { NotConfiguredError };

/** True when a real client can be built. Callers use this to stay honest in the UI. */
export function isConfigured(): boolean {
  return configOk();
}

/** The configured origin, or `undefined`. Also used by the auth and claim calls. */
export function getCoordinationBaseUrl(): string | undefined {
  return coordinationBaseUrl();
}

let client: SentryClient | null = null;

/**
 * The shared client.
 *
 * ⚠ THE TOKEN IS A FUNCTION, NOT A VALUE. `TokenProvider` accepts a callback,
 * and using one is what keeps the client correct across a login, a logout and an
 * expiry: it reads the CURRENT session on every request rather than capturing
 * whatever happened to be there when the client was constructed. A captured
 * string would keep sending a revoked reference until a full page reload — a
 * half-authenticated state that is worse than being signed out, because the UI
 * has no way to tell.
 *
 * Throws rather than returning a half-built client. An unconfigured app that
 * renders as though it were connected is the one failure this whole integration
 * exists to refuse.
 */
export function getClient(): SentryClient {
  if (client) return client;

  client = new SentryClient({
    baseUrl: requireCoordinationUrl(),
    // Read per request. `undefined` means no Authorization header at all, which
    // is what an unauthenticated call should be — not an empty bearer.
    token: () => getSessionRef(),
    // REQUIRED, not optional tuning. See the note on `sdkFetch` above.
    fetch: sdkFetch,
    userAgent: "terra-sentinel",
  });
  return client;
}

/**
 * Drop the memoised client.
 *
 * The client itself is stateless with respect to the session — the token
 * callback means a login or logout needs no rebuild — so this exists for the one
 * case that genuinely invalidates it: configuration changing under a hot reload
 * during development.
 */
export function resetClient(): void {
  client = null;
}
