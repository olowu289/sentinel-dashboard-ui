/**
 * Where the session reference lives on the client.
 *
 * Stage 1 ships only the READ half, because that is all the SDK client needs to
 * be built correctly: its token provider is a callback that runs on every
 * request, and it must be able to read the current reference synchronously. The
 * write half — login, persistence, expiry, subscribers — lands in Stage 2 and
 * fills in around this.
 *
 * `getSessionRef()` returning `undefined` today is not a stub standing in for
 * something; it is the truth. There is no session yet, and `undefined` is what
 * an unauthenticated call should carry — no `Authorization` header at all,
 * rather than an empty bearer.
 *
 * ── WHY IT IS A MODULE-LEVEL VALUE AND NOT REACT STATE ─────────────────
 *
 * `lib/api/client.ts` reads this from inside the SDK's `TokenProvider`, which
 * is called during a request and cannot be a hook. The dashboard has the same
 * shape for the same reason: an in-memory mirror, read synchronously, hydrated
 * once on mount by the loader that Stage 2 adds.
 *
 * ── WHERE THE CREDENTIAL WILL LIVE (Stage 2) ───────────────────────────
 *
 * `sessionStorage`, and that is settled rather than open. An httpOnly cookie is
 * the better answer in general and is *unavailable* to this architecture: the
 * browser talks to coordination directly and the SDK sets
 * `Authorization: Bearer <ref>` in page JavaScript, and a cookie the JS cannot
 * read cannot go into that header. Making it work would mean routing every call
 * through a server proxy — a real architecture change, not something to smuggle
 * into a login screen. `sessionStorage` over `localStorage` because the
 * requirement is surviving a reload, not surviving days on a shared
 * control-room machine.
 *
 * The password will never be stored anywhere: not here, not in state that
 * outlives the login request, not in a URL, not in a log line.
 */

/** The live session reference, or `undefined` when there is none. */
let current: string | undefined;

/**
 * The credential for the `Authorization` header.
 *
 * Synchronous on purpose — see the note above. `undefined` means send no header.
 */
export function getSessionRef(): string | undefined {
  return current;
}

/**
 * Replace the in-memory reference.
 *
 * Internal to the api layer: Stage 2's session store owns the persistence and
 * the notifications, and calls this to keep the synchronous mirror in step.
 * Nothing outside `src/lib/api/` should reach for it.
 */
export function setSessionRef(ref: string | undefined): void {
  current = ref;
}
