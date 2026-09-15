import { motion } from "motion/react";
import { useCallback, useState, type KeyboardEvent } from "react";
import { useSession } from "@/components/AuthProvider";
import { ENTER, FADE } from "@/lib/motion";
import {
  AuthRejectedError,
  AuthUnreachableError,
  UNIFORM_AUTH_MESSAGE,
} from "@/lib/api/auth";

/**
 * Signing in.
 *
 * Built as the app's own arrival screen rather than a login page bolted to the
 * front of it: the same 483px column, the same mast illustration, the same
 * heading pair and the same 57px primary action that `AddTowerView` opens with.
 * An operator meeting this screen first should recognise the product they are
 * about to be inside.
 *
 * ⚠ NO `<form>`. React handlers and an explicit Enter binding, as everywhere
 * else in this app — a form would navigate and take the page with it.
 *
 * ── TWO FAILURES, AND THEY MUST NOT LOOK ALIKE ─────────────────────────
 *
 * A rejected credential and an unreachable service are different facts and get
 * different colour, different wording and a different second line. Telling
 * somebody their password is wrong when coordination is simply down sends them
 * to reset a credential that was fine, and hides an outage.
 *
 * Rejection takes `--color-critical`, which is what this app already spends on
 * an input that will not validate — see the serial/pairing-code step in
 * `AddTowerView`. Unreachability takes amber, because it makes amber's usual
 * claim: *something here needs you, and it is not a reading about a site*.
 *
 * ── WHY THE ORGANIZATION FIELD IS NOT `uppercase` ──────────────────────
 *
 * Every other identifier input in this app carries `uppercase` — the site name,
 * the person's name — because those are stored the way they are displayed. This
 * one must not. `accounts._normalise_login` is the identity function by
 * deliberate decision, so the server matches the string byte for byte. A CSS
 * `text-transform` changes only the rendering, so the field would show
 * `TERRA INDUSTRIES` while sending `Terra Industries` — a screen lying about
 * what it is about to submit, on the one field where exactness is the rule.
 * `autoCapitalize`, `autoCorrect` and `spellCheck` are off for the same reason:
 * the browser must not help either.
 */

type Failure =
  | { kind: "rejected"; message: string }
  /** `hint` is the second line, and it is per-reason on purpose — see `HINT`. */
  | { kind: "unreachable"; message: string; hint?: string }
  | null;

/**
 * The second line, chosen by WHY the sign-in did not go through.
 *
 * ⚠ THIS USED TO BE ONE HARDCODED SENTENCE printed for every failure that was
 * not a wrong password — and a rate-limit lock is not a wrong password. So
 * being locked out showed "Too many sign-in attempts. Wait a few minutes and
 * try again" with "This is not a password problem — nothing answered. Check
 * that coordination is running, and that this browser trusts its certificate"
 * stapled underneath it. Two different states in one alert, and the second one
 * flatly untrue: something DID answer. It answered 429. The screen sent
 * somebody off to restart a service that was working perfectly and had simply
 * said no.
 *
 * A LOCK GETS NO SECOND LINE. Its own sentence is already complete and already
 * says the only thing that helps: wait. Everything else gets one short line
 * naming something the person can actually do.
 */
const HINT: Record<AuthUnreachableError["reason"], string | undefined> = {
  throttled: undefined,
  network: "Check your connection and try again.",
  no_endpoint: "Please try again in a moment.",
  server_error: "Please try again in a moment.",
  bad_response: "Please try again in a moment.",
};

export function LoginView() {
  const { signIn, pending, status, endedReason, account } = useSession();

  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<Failure>(null);

  const wasReturning = status === "ended";

  const submit = useCallback(async () => {
    /* Guards a double submit from a fast second click, or an Enter arriving
       while the first call is still open. `pending` is the same flag that
       disables the button, so the two cannot disagree. */
    if (pending) return;
    if (!organizationName || !password) return;
    setFailure(null);

    try {
      // VERBATIM — see the header. `organizationName` is not trimmed.
      await signIn(organizationName, password);
      /* The password leaves component state the moment it is no longer needed.
         On success only: after a failure it stays in the field so a mistyped
         organization name can be fixed without retyping it. It is never
         persisted anywhere either way. */
      setPassword("");
    } catch (err) {
      if (err instanceof AuthRejectedError) {
        /* ONE message for every credential failure. Unknown organization, wrong
           password and disabled account are indistinguishable here because
           coordination makes them indistinguishable on the wire — this screen
           must not undo the anti-enumeration property. */
        setFailure({ kind: "rejected", message: UNIFORM_AUTH_MESSAGE });
      } else if (err instanceof AuthUnreachableError) {
        setFailure({
          kind: "unreachable",
          message: err.message,
          hint: HINT[err.reason],
        });
      } else {
        /* Not one of ours, so its message was written for a developer and may
           be anything at all — a stack-shaped string, a bare status. The person
           gets the same plain line every other failure gets; the error itself
           goes where it can be read. */
        console.debug("[auth] sign-in failed with an unrecognised error:", err);
        setFailure({
          kind: "unreachable",
          message: "Something went wrong",
          hint: "Please try again in a moment.",
        });
      }
    }
  }, [pending, signIn, organizationName, password]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void submit();
  };

  const canSubmit = organizationName.length > 0 && password.length > 0 && !pending;
  const rejected = failure?.kind === "rejected";

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-ink">
      <header className="flex h-[46px] shrink-0 items-center border-b border-line pl-[16px]">
        <span className="flex items-center gap-[8px]">
          <img src="/icons/logo.svg" alt="" width={22.286} height={19.5} className="block" />
          <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
            TERRA SENTINEL
          </span>
        </span>
      </header>

      <main className="flex min-h-0 flex-1 justify-center overflow-y-auto px-[24px] py-[48px]">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="my-auto flex w-[483px] max-w-full flex-col items-center gap-[40px]"
        >
          <img
            src="/icons/twr-mast-lg.svg"
            alt=""
            width={183}
            height={317}
            className="block max-h-[220px] w-auto"
          />

          <div className="flex w-full flex-col gap-[26px]">
            <div className="flex flex-col items-center gap-[6px] text-center">
              <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-white">
                SIGN IN
              </h1>
              <p className="text-[0.875rem] leading-[20px] text-sub/80">
                Your organization&rsquo;s towers, cameras and alerts.
              </p>
            </div>

            {/* A session that ended on its own is worth explaining — otherwise
                being put back here reads as the app breaking. A deliberate
                sign-out says nothing, because the operator already knows. */}
            {wasReturning && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={ENTER}
                role="status"
                className="rounded-[8px] bg-warn/12 px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-warn"
              >
                {endedReason === "revoked"
                  ? "Your session was ended elsewhere. Sign in again to continue."
                  : "Your session ended. Sign in again to continue."}
                {account ? ` (${account.login})` : ""}
              </motion.p>
            )}

            <div className="flex w-full flex-col gap-[20px]">
              <label className="flex flex-col gap-[8px]">
                <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                  ORGANIZATION NAME
                </span>
                <input
                  value={organizationName}
                  onChange={(e) => {
                    setOrganizationName(e.target.value);
                    setFailure(null);
                  }}
                  onKeyDown={onKeyDown}
                  disabled={pending}
                  autoComplete="organization"
                  autoFocus
                  /* The browser must not normalise what the server matches
                     exactly. And no `uppercase` — see the header. */
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={rejected || undefined}
                  placeholder="Terra Industries"
                  className={`h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-white outline-none placeholder:text-white/25 focus-visible:outline-1 focus-visible:outline-terra disabled:text-white/40 ${
                    rejected ? "ring-1 ring-critical" : ""
                  }`}
                />
                <span className="text-[0.75rem] leading-[16px] text-muted">
                  Matched exactly, including spaces and capitals.
                </span>
              </label>

              <label className="flex flex-col gap-[8px]">
                <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                  PASSWORD
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFailure(null);
                  }}
                  onKeyDown={onKeyDown}
                  disabled={pending}
                  autoComplete="current-password"
                  aria-invalid={rejected || undefined}
                  className={`h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-white outline-none focus-visible:outline-1 focus-visible:outline-terra disabled:text-white/40 ${
                    rejected ? "ring-1 ring-critical" : ""
                  }`}
                />
              </label>
            </div>

            {/* On the fields rather than as a page banner, which is where this
                app already puts a credential-shaped error. */}
            {failure && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={ENTER}
                role="alert"
                className="flex flex-col gap-[4px]"
              >
                <p
                  className={`text-[0.8125rem] leading-[20px] ${
                    rejected ? "text-critical" : "text-warn"
                  }`}
                >
                  {failure.message}
                </p>
                {/* Only when there is one. A lock shows its own sentence and
                    nothing else — see `HINT`. */}
                {failure.kind === "unreachable" && failure.hint && (
                  <p className="text-[0.75rem] leading-[16px] text-muted">
                    {failure.hint}
                  </p>
                )}
              </motion.div>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={!canSubmit}
              aria-busy={pending || undefined}
              className="h-[57px] w-full rounded-[8px] bg-white text-[1rem] leading-[20px] font-medium text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25 disabled:text-black/40"
            >
              {pending ? "SIGNING IN…" : "SIGN IN"}
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
