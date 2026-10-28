/**
 * Minimal ambient declarations for the platform globals this SDK uses.
 *
 * The package compiles against `lib: ["ES2022"]` only — no `DOM`, no
 * `@types/node`. That is deliberate: a consumer building this package's `.d.ts`
 * should never be forced to add a `lib` or a `@types` entry it does not
 * otherwise want, and this SDK exposes no DOM or Node type in its public API.
 *
 * `fetch` and `AbortController` are declared where they are used (`http.ts`) so
 * an injected implementation is visibly the same shape. Timers are declared
 * here because both `http.ts` and `client.ts` need them and neither exposes
 * them.
 *
 * The return type is `unknown` on purpose: it is `number` in a browser and a
 * `Timeout` object in Node, and the call sites already narrow it where they
 * need to (`.unref?.()`, `clearInterval(x as number)`).
 */

declare function setTimeout(handler: () => void, timeout?: number): unknown;
declare function clearTimeout(handle: unknown): void;
declare function setInterval(handler: () => void, timeout?: number): unknown;
declare function clearInterval(handle: unknown): void;

/**
 * Decodes the live event channel's bytes (`GET /v1/viewer/events`).
 *
 * Declared rather than pulled in from a lib for the reason above: this package
 * compiles against `lib: ["ES2022"]` with no DOM and no `@types/node`, and
 * `TextDecoder` is present in every runtime this SDK targets (Node 18+, every
 * current browser) without being in that lib. Only the one member is named,
 * because only the one member is used.
 */
declare const TextDecoder: {
  new (): { decode(input?: Uint8Array, options?: { stream?: boolean }): string };
};
