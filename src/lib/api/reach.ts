/**
 * Why a coordination call failed, in the only four shapes that matter to an
 * operator.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE THREE FAILURES THAT LOOK IDENTICAL
 * ══════════════════════════════════════════════════════════════════════
 *
 * The Stage 0 spike surfaced three completely different causes that all arrive
 * as `status: 0` with a `Failed to fetch`-shaped message, and telling them
 * apart is the whole reason this module exists:
 *
 *   1. THE BROWSER DOES NOT TRUST THE CA. Coordination's certificate is signed
 *      by a local CA, and until it is trusted every call dies before it leaves.
 *      Nothing is wrong with the service or the code.
 *
 *   2. COORDINATION IS DOWN, or the network is. Also nothing wrong with the
 *      code.
 *
 *   3. `Illegal invocation` — the bound-fetch bug. The SDK stores `fetch` and
 *      calls it as a method, which detaches it from `Window`; Chrome
 *      brand-checks and refuses. **This is a CODE DEFECT**, it should be
 *      impossible now that `client.ts` injects a bound fetch, and it must never
 *      be reported as "coordination is down" — that sends somebody to restart a
 *      healthy server while the real fault sits in the bundle.
 *
 * The first two share a message because the operator's next move is the same:
 * check the service, check the certificate. The third gets its own, because the
 * next move is to fix the app.
 *
 * A 401/403 is deliberately NOT here. That is a session ending, it is handled
 * once in `auth.ts`, and it drops the whole app to the login screen — an
 * authentication verdict is an answer, not a failure to get one.
 */

export type ReachFailure =
  /** Cannot get an answer: the service is down, the network is out, or the CA
   *  is not trusted. Not the operator's mistake and not a bug. */
  | "unreachable"
  /** A defect in this app. Distinct because the remedy is completely different. */
  | "client_bug"
  /** Coordination answered, and the answer was an error of its own. */
  | "server_error"
  /** Coordination answered something this app cannot read — a contract
   *  mismatch, most likely a version skew between the SDK and the service. */
  | "contract";

export interface ReachProblem {
  failure: ReachFailure;
  /** One line, for the operator. */
  headline: string;
  /** What it means, or what to do. Never blames the wrong thing. */
  detail: string;
  /** The transport's own words. Logged, not rendered — see the note above
   *  `HEADLINE`, and `CoordinationBanner`, which used to print this in mono
   *  under the headline. Kept on the object because code still wants it. */
  raw: string;
}

/*
 * WRITTEN FOR THE PERSON READING IT, NOT FOR US.
 *
 * Everything above this line is the diagnosis and it is worth every word — but
 * it is a diagnosis for whoever is FIXING this, and it used to be printed
 * straight onto the screen of somebody watching a yard. They were told the name
 * of a service they have never heard of, and then asked to check that it was
 * running and that their browser trusted its certificate: two things they
 * cannot do, about a machine they cannot reach. Being handed a job you cannot
 * start is worse than being told nothing.
 *
 * The classification does not change, and neither does `raw`. The specifics now
 * go to `console.debug` in `classifyReach`, which is where the person who can
 * act on them is already looking.
 */
const HEADLINE: Record<ReachFailure, string> = {
  unreachable: "Can't connect right now",
  client_bug: "Something went wrong in the app",
  server_error: "Something went wrong at our end",
  contract: "This app needs an update",
};

const DETAIL: Record<ReachFailure, string> = {
  /* The half of the old wording worth keeping: an operator staring at an empty
     fleet needs to hear that it is not their doing, or the next thirty minutes
     go into the wrong place entirely. Said without handing them our plumbing. */
  unreachable: "Check your connection and try again. Nothing you did caused this.",
  client_bug:
    "The app couldn't send the request. Reloading the page usually clears it — " +
    "if it keeps happening, let us know.",
  server_error: "What you can see may be incomplete. Try again in a moment.",
  contract:
    "This version can't read what it was sent. Reload the page, and tell us if " +
    "that doesn't help.",
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Classify a thrown coordination error.
 *
 * ⚠ ORDER MATTERS. `Illegal invocation` is tested FIRST, because the SDK wraps
 * it in a `NetworkError` carrying `status: 0` — exactly the shape an outage
 * produces. A status-first test would file a code defect as a service outage
 * and hide it permanently behind a message telling somebody to check the
 * server.
 */
export function classifyReach(err: unknown): ReachProblem {
  const raw = messageOf(err);
  const name = String((err as { name?: unknown })?.name ?? "");
  const status = (err as { status?: unknown })?.status;
  const code = (err as { code?: unknown })?.code;

  /* WHICH of the identical-looking failures it was — the whole point of the
     three-way split at the top of this file — logged where an engineer looks
     instead of printed at an operator who cannot act on it. `raw` stays on the
     returned object: this line is for a person, the field is for code. */
  const of = (failure: ReachFailure): ReachProblem => {
    console.debug("[reach]", failure, { raw, name, status, code });
    return { failure, headline: HEADLINE[failure], detail: DETAIL[failure], raw };
  };

  /* Ours. The bound-fetch defect, and anything else where the request could not
     even be constructed. */
  if (/Illegal invocation|is not a function|Cannot read properties/i.test(raw)) {
    return of("client_bug");
  }

  /* A contract break: the document parsed but did not conform. Includes a
     projection leak, which is a coordination bug and worth naming as such
     rather than letting somebody go and debug a tower. */
  if (
    code === "response_invalid" ||
    /ValidationError|ProjectionLeak/i.test(name) ||
    /must never reach/i.test(raw)
  ) {
    return of("contract");
  }

  /* No answer at all. `status: 0` is the browser saying the request never
     completed — an untrusted CA, a dead service, a severed network, a blocked
     origin. One message, because they share a next move. */
  if (status === 0 || status === undefined || code === "network_error") {
    return of("unreachable");
  }

  if (typeof status === "number" && status >= 500) return of("server_error");

  /* Anything else that answered. A 401/403 never reaches here — those are
     session endings, handled once in `auth.ts`. */
  return of("server_error");
}
