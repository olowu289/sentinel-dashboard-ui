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
