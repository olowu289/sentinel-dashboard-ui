import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { loadSiteConfig } from "@/lib/siteConfig";
import { useSession } from "@/components/AuthProvider";
import { ENTER, FADE } from "@/lib/motion";
import {
  AuthLockedError,
  AuthRejectedError,
  AuthUnreachableError,
} from "@/lib/api/auth";
import {
  LOCKED_MESSAGE,
  deadlineFor,
  forgetLock,
  formatCountdown,
  lockedButtonLabel,
  lockedUntil,
  rememberLock,
  secondsLeft,
  wrongCredentialMessage,
} from "@/lib/lockout";
import { said } from "@/lib/said";

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
 *
 * ── ONE FIELD, TWO KINDS OF LOGIN ──────────────────────────────────────
 *
 * It used to say ORGANIZATION NAME, because that is all there was. A login
 * now has a second shape: `dave.terra-industries`, a person in an
 * organization, and the dot is what tells them apart.
 *
 * ⚠ AND THE TWO ARE MATCHED DIFFERENTLY. A person's login is
 * case-insensitive; an organization's is byte-exact, because making it
 * insensitive would mean lower-casing a live customer's password-bearing
 * login. So this field still must not transform what is typed: for a person
 * it would be harmless, and for an organization it would be the lie above.
 * The note under the field says both, in that order, because the person
 * reading it is far more often a person than an organization.
 */

type Failure =
  | { kind: "rejected"; message: string }
  /** `hint` is the second line, and it is per-reason on purpose — see `HINT`. */
  | { kind: "unreachable"; message: string; hint?: string }
  | null;

/**
 * A LOCK IS NOT A FAILURE MESSAGE, IT IS A STATE WITH A CLOCK.
 *
 * `until` is an absolute moment, not a number of seconds, so a tab that sat in
 * the background and a page that was refreshed both read the same truth out of
 * it. Everything on screen -- the countdown, the disabled button, whether the
 * lock is over at all -- is derived from `until - now`, and the only thing
 * that ticks is `now`.
 */
type Lock = { until: number } | null;

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
 * A LOCK IS NO LONGER IN THIS TABLE AT ALL: it is its own state above, with
 * its own countdown. Everything left here gets one short line naming something
 * the person can actually do.
 */
const HINT: Record<AuthUnreachableError["reason"], string | undefined> = {
  network: "Check your connection and try again.",
  no_endpoint: "Please try again in a moment.",
  server_error: "Please try again in a moment.",
  bad_response: "Please try again in a moment.",
};

export function LoginView() {
  const { signIn, pending, status, endedReason, account } = useSession();

  const [organizationName, setOrganizationName] = useState("");
  const [password, setPassword] = useState("");
  /**
   * The hub's own company login, filled in so only the password is typed.
   *
   * ⚠ A HUB HAS EXACTLY ONE CUSTOMER AND THE KIOSK IS BOLTED TO IT. Typing
   * `dave.terra-industries` on a TV with no keyboard, at a gate, in the rain,
   * is the whole of what this removes. Kallon Cloud serves thousands of
   * organizations, has no single right answer, and never sends the field --
   * so there, and on a hub that has not been told its customer yet, this
   * stays null and the screen is exactly the one it was.
   *
   * It is not a shortcut past anything: the password is unchanged, the
   * lockout is unchanged, and the box below stays an ordinary editable input
   * because Terra staff sign in on a customer's hub with their own login.
   */
  const [hubLogin, setHubLogin] = useState<string | null>(null);
  /**
   * Has anybody touched the login box?
   *
   * ⚠ THE PROBE IS ASYNCHRONOUS AND A PERSON IS NOT. `/healthz` can land a
   * second after the screen does, and somebody who has already started typing
   * their own login must not have it replaced under the cursor. Once this is
   * true nothing fills, nothing refocuses, and what was typed is what is
   * sent.
   */
  const touchedLogin = useRef(false);
  /** For moving focus past a box that is already correct. */
  const passwordRef = useRef<HTMLInputElement>(null);
  const [failure, setFailure] = useState<Failure>(null);
  const [lock, setLock] = useState<Lock>(null);
  /* THE ONLY THING THAT TICKS. One second, and only while a lock is running:
     a sign-in screen with a permanent interval on it is a screen that wakes a
     phone up once a second to draw nothing. */
  const [now, setNow] = useState(() => Date.now());

  const lockLeft = lock ? secondsLeft(lock.until, now) : 0;
  const locked = lockLeft > 0;

  useEffect(() => {
    if (!lock) return;
    const t = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [lock]);

  /* AND IT CLEARS ITSELF. When the countdown reaches zero the lock state goes,
     which re-enables the button and removes the message with no reload and no
     second request -- the person is simply allowed to try again. */
  useEffect(() => {
    if (lock && secondsLeft(lock.until, now) === 0) {
      forgetLock(organizationName);
      setLock(null);
      setFailure(null);
    }
  }, [lock, now, organizationName]);

  /* ⚠ A REFRESH MUST NOT LOOK LIKE A FRESH START. The deadline was remembered
     per login when the server sent it, so typing (or restoring) a login that
     is still locked shows the time it has left rather than a button that will
     answer 429 the moment it is pressed. */
  useEffect(() => {
    const until = lockedUntil(organizationName);
    setLock(until ? { until } : null);
    if (until) setNow(Date.now());
  }, [organizationName]);

  /* ONE REQUEST, THE ONE ALREADY BEING MADE. `loadSiteConfig` is memoised on
     its promise and the app asks it at boot for the site timezone, so this
     adds no round trip and no new unauthenticated surface. */
  useEffect(() => {
    let alive = true;
    void loadSiteConfig().then((config) => {
      if (!alive || config.hubLogin === null) return;
      if (touchedLogin.current) return;
      setHubLogin(config.hubLogin);
      setOrganizationName(config.hubLogin);
      /* The box above is already right, so the cursor belongs in the one
         thing left to do. Guarded on `touchedLogin` above: this must never
         take the caret off a field somebody is using. */
      passwordRef.current?.focus();
    });
    return () => {
      alive = false;
    };
  }, []);

  const wasReturning = status === "ended";

  const submit = useCallback(async () => {
    /* Guards a double submit from a fast second click, or an Enter arriving
       while the first call is still open. `pending` is the same flag that
       disables the button, so the two cannot disagree. */
    if (pending) return;
    /* A LOCKED LOGIN DOES NOT SEND. The button is disabled, but Enter is bound
       separately and a lock that only disabled the button would still spend an
       attempt -- and every attempt made while locked EXTENDS the lock. */
    if (locked) return;
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
      forgetLock(organizationName);
    } catch (err) {
      if (err instanceof AuthLockedError) {
        /* THE SERVER'S OWN NUMBER, as a deadline. Remembered against this
           login so a refresh shows what is left, and shown as a countdown
           beside a button that re-enables itself when it runs out. */
        const until = deadlineFor({ retryAfterSec: err.retryAfterSec });
        setNow(Date.now());
        if (until) {
          rememberLock(organizationName, until);
          setLock({ until });
        } else {
          /* A lock with no number: say so plainly rather than counting down
             from nothing. */
          setLock(null);
          setFailure({
            kind: "unreachable",
            message: LOCKED_MESSAGE,
            hint: "Try again shortly.",
          });
        }
      } else if (err instanceof AuthRejectedError) {
        /* ONE message for every credential failure. Unknown organization, wrong
           password and disabled account are indistinguishable here because
           coordination makes them indistinguishable on the wire — this screen
           must not undo the anti-enumeration property. The only help it offers
           is about SPELLING, and the example is built from what was typed
           rather than from a placeholder: `name.<organization>` is what one of
           these screens used to print, and somebody typed it in. */
        setFailure({
          kind: "rejected",
          message: wrongCredentialMessage(organizationName),
        });
      } else if (err instanceof AuthUnreachableError) {
        setFailure({
          kind: "unreachable",
          message: err.message,
          hint: HINT[err.reason],
        });
      } else {
        /* Not one of ours, so its message was written for a developer and may
           be anything at all — a stack-shaped string, a bare status. `said`
           decides whether any of it is fit to show and puts the rest in the
           console under a reference. */
        setFailure({
          kind: "unreachable",
          message: said(err, "Something went wrong signing in."),
          hint: "Please try again in a moment.",
        });
      }
    }
  }, [pending, locked, signIn, organizationName, password]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    void submit();
  };

  const canSubmit =
    organizationName.length > 0 && password.length > 0 && !pending && !locked;
  const rejected = failure?.kind === "rejected";

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-ink">
      <header className="flex h-[46px] shrink-0 items-center border-b border-line pl-[16px]">
        <span className="flex items-center gap-[8px]">
          <img src="/icons/logo.svg" alt="" width={22.286} height={19.5} className="block" />
          <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
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
              <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-body-ink">
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
                {endedReason === "password_changed"
                  ? "Your password was changed. Sign in with the new one."
                  : endedReason === "revoked"
                    ? "Your session was ended elsewhere. Sign in again to continue."
                    : "Your session ended. Sign in again to continue."}
                {account ? ` (${account.login})` : ""}
              </motion.p>
            )}

            <div className="flex w-full flex-col gap-[20px]">
              <label className="flex flex-col gap-[8px]">
                <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                  LOGIN
                </span>
                <input
                  value={organizationName}
                  onChange={(e) => {
                    touchedLogin.current = true;
                    setOrganizationName(e.target.value);
                    setFailure(null);
                  }}
                  onKeyDown={onKeyDown}
                  disabled={pending}
                  /* ⚠ `username`, NOT `organization`, AND THE DISTINCTION IS
                     THE POINT. This field holds an organization name, so
                     `organization` describes its CONTENT correctly — but a
                     password manager pairs a saved credential by finding a
                     USERNAME field next to a password field, and
                     `organization` is not one. The login identifier IS the
                     username in this system: it is the string you type to sign
                     in. So the credential ROLE is what the attribute has to
                     carry, and the content type is what the placeholder and
                     the label say.
                     This is also the ONLY field in the app that invites a
                     manager to fill — see the Settings notes. */
                  /* ⚠ AND `off` ONCE THE HUB HAS FILLED IT. A saved
                     credential from another site, or a manager restoring the
                     last login typed on this machine, arrives after paint and
                     overwrites a value that was already correct -- so the
                     kiosk would show whatever was signed in with last.
                     Suggestions are what is switched off; the box is still an
                     ordinary input and still takes anything typed into it. */
                  autoComplete={hubLogin === null ? "username" : "off"}
                  autoFocus
                  /* The browser must not normalise what the server matches
                     exactly. And no `uppercase` — see the header. */
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  aria-invalid={rejected || undefined}
                  placeholder="dave.terra-industries"
                  className={`h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-body-ink outline-none placeholder:text-body-ink/25 focus-visible:outline-1 focus-visible:outline-terra disabled:text-body-ink/40 ${
                    rejected ? "ring-1 ring-critical" : ""
                  }`}
                />
                <span className="text-[0.75rem] leading-[16px] text-muted">
                  Your name and your organization, like
                  <span className="font-mono"> dave.terra-industries</span>.
                  An organization signs in with its own name, matched
                  exactly, including spaces and capitals.
                </span>
              </label>

              <label className="flex flex-col gap-[8px]">
                <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                  PASSWORD
                </span>
                <input
                  ref={passwordRef}
                  type="password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFailure(null);
                  }}
                  onKeyDown={onKeyDown}
                  disabled={pending}
                  autoComplete="current-password"
                  /* Words, not dots. See the note in `SettingsView`: a dotted
                     placeholder in a password box cannot be told apart from a
                     filled one, and on the sign-in screen that is the first
                     thing anybody meets. */
                  placeholder="Enter your password"
                  aria-invalid={rejected || undefined}
                  /* `placeholder:` was missing here while the organization field
                     above has it, so the two boxes would have styled their hints
                     differently the moment this one had a hint. */
                  className={`h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-body-ink outline-none placeholder:text-body-ink/25 focus-visible:outline-1 focus-visible:outline-terra disabled:text-body-ink/40 ${
                    rejected ? "ring-1 ring-critical" : ""
                  }`}
                />
              </label>
            </div>

            {/* ⚠ THE LOCKOUT, WITH A CLOCK ON IT. Its own block above the
                failure line, because it is not a failure line: it is a state
                that ends by itself, and the countdown is the only part that
                answers the question the person actually has.

                `aria-live="polite"` on the time alone, not on the sentence:
                announcing the whole paragraph once a second is unusable, and
                announcing nothing leaves a screen-reader user with a disabled
                button and no reason. */}
            {locked && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={ENTER}
                role="status"
                data-locked="true"
                className="flex flex-col gap-[4px] rounded-[8px] bg-warn/12 px-[14px] py-[12px]"
              >
                <p className="text-[0.8125rem] leading-[20px] text-warn">
                  {LOCKED_MESSAGE}{" "}
                  <span className="whitespace-nowrap">
                    You can try again in{" "}
                    <span
                      aria-live="polite"
                      data-countdown="true"
                      className="font-mono text-body-ink"
                    >
                      {formatCountdown(lockLeft)}
                    </span>
                    .
                  </span>
                </p>
                <p className="text-[0.75rem] leading-[16px] text-muted">
                  Trying again before the time is up makes the wait longer.
                </p>
              </motion.div>
            )}

            {/* On the fields rather than as a page banner, which is where this
                app already puts a credential-shaped error. */}
            {failure && !locked && (
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
              className="h-[57px] w-full rounded-[8px] bg-action text-[1rem] leading-[20px] font-medium text-action-ink transition-colors hover:bg-overlay/90 disabled:cursor-not-allowed disabled:bg-overlay/25 disabled:text-action-ink/40"
            >
              {locked
                ? lockedButtonLabel(lockLeft)
                : pending
                  ? "SIGNING IN…"
                  : "SIGN IN"}
            </button>
          </div>
        </motion.div>
      </main>
    </div>
  );
}
