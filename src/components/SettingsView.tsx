import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { useSession } from "@/components/AuthProvider";
import { IconRail } from "@/components/IconRail";
import {
  LabelRejectedError,
  TowerUnavailableError,
  renameCamera,
} from "@/lib/api/fleet";
import { getTheme, setTheme, type Theme } from "@/lib/theme";
import type { CameraFeed, Tower } from "@/lib/types";
import { ENTER, FADE } from "@/lib/motion";
import {
  AccountFieldError,
  AccountThrottledError,
  changeLogin,
  changePassword,
  getAccount,
} from "@/lib/api/account";
import {
  AuthUnreachableError,
  clearSession,
  endSessionIfUnauthorized,
  updateStoredAccount,
} from "@/lib/api/auth";
import {
  checkNewLogin,
  checkNewPassword,
  hasEdgeSpace,
  PASSWORD_MIN_LEN,
} from "@/lib/accountPolicy";

/**
 * Account settings — the organization's own name and its own password.
 *
 * The customer must be able to do both of these without us, which is what this
 * screen is for. Until it existed the only way to change either was an operator
 * running a CLI on the data centre, and a customer who cannot rotate their own
 * password is a customer who does not rotate it.
 *
 * ── TWO FORMS, TWO CURRENT-PASSWORD FIELDS, AND THAT IS DELIBERATE ─────
 *
 * The obvious tidy-up is one current-password box at the top serving both
 * forms. It is wrong. Each form is an independent submission that the server
 * verifies independently, and a shared box means a password typed to rename the
 * organization is sitting ready to authorise a password change the person never
 * started. Two boxes make each act cost its own deliberate keystrokes, which is
 * the whole point of asking.
 *
 * ── WHY LOCAL STATE AND NOT `useMutation` ──────────────────────────────
 *
 * `useMutation` is this app's pattern for an action on a target, and it reduces
 * a failure to one message string. These forms need the failure placed under
 * the FIELD it belongs to — a wrong current password under the current-password
 * box, a too-short new one under the new-password box — and the field comes off
 * the error, not off the message. `LoginView` is the precedent and the closest
 * relative: a credential form with its own local `Failure` state. This follows
 * it.
 *
 * ── THE POINT OF NO RETURN ─────────────────────────────────────────────
 *
 * A successful password change KILLS THIS SESSION — the server revokes every
 * session of the account, this one included, before it answers. So on success
 * this screen stops being a settings screen and becomes a confirmation with one
 * action, rendered WITHOUT the navigation rail. That is not for drama: the rail
 * would offer destinations that are all going to 401, and the person would be
 * bounced to the sign-in screen with "your session ended", which reads as a
 * fault rather than as the thing they just asked for.
 *
 * ⚠ NO `<form>` ANYWHERE. React handlers and an explicit Enter binding, as
 * everywhere else in this app — a form would navigate and take the page with it.
 */

/** A failure, with the field it belongs under. */
type Failure = {
  /** Server field name, or `"form"` for anything not about one input. */
  field: string;
  message: string;
  /** Red for "you typed something wrong", amber for "we could not reach it". */
  tone: "critical" | "warn";
} | null;

function failureFor(err: unknown): Failure {
  if (err instanceof AccountFieldError) {
    /* THE SERVER'S OWN MESSAGE, VERBATIM, under the field it named. Not mapped
       through a table of ours — the policy and the name-is-taken check live on
       the server, and a local translation would be the stale copy. */
    return { field: err.field, message: err.message, tone: "critical" };
  }
  if (err instanceof AccountThrottledError) {
    /* Not a verdict about what was typed, so it goes on the form rather than
       under a field, in amber. The person is already signed in; what is locked
       is the change, not their account. */
    return { field: "form", message: err.message, tone: "warn" };
  }
  if (err instanceof AuthUnreachableError) {
    /* ⚠ ONE REASON NEEDS ITS OWN SENTENCE HERE. `AuthUnreachableError` builds
       its message from a table written for the SIGN-IN screen, and for
       `no_endpoint` that sentence is "Signing in isn't available right now" —
       which is both wrong and alarming on a page reached by somebody who is
       already signed in.

       And it is not a hypothetical: `no_endpoint` is exactly what a 404 or a 501
       from these routes produces, which is what coordination answers while it is
       still a version behind this dashboard. That is a real deployment window —
       the data centre is updated separately from Vercel — so it is the message
       most likely to be read in anger. Everything else in that table is about
       reachability and says the right thing on either screen. */
    if (err.reason === "no_endpoint") {
      return {
        field: "form",
        message: "Changing this isn't available yet. Please try again later.",
        tone: "warn",
      };
    }
    return { field: "form", message: err.message, tone: "warn" };
  }
  /* Not one of ours, so its message was written for a developer and may be
     anything at all. The person gets a plain line; the error goes where it can
     be read. */
  console.debug("[account] change failed with an unrecognised error:", err);
  return {
    field: "form",
    message: "Something went wrong. Please try again in a moment.",
    tone: "warn",
  };
}

/* ------------------------------------------------------------------ *
 * Small shared pieces — the app's existing input and label vocabulary
 * ------------------------------------------------------------------ */

const INPUT_BASE =
  "h-[52px] rounded-[8px] bg-card px-[14px] text-[1rem] text-body-ink outline-none " +
  "placeholder:text-body-ink/25 focus-visible:outline-1 focus-visible:outline-terra " +
  "disabled:text-body-ink/40";

function Field({
  label,
  hint,
  invalid,
  children,
}: {
  label: string;
  hint?: string;
  invalid?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[8px]">
      <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
        {label}
      </span>
      {children}
      {hint && (
        <span
          className={`text-[0.75rem] leading-[16px] ${
            invalid ? "text-critical" : "text-muted"
          }`}
        >
          {hint}
        </span>
      )}
    </label>
  );
}

function FormError({ failure }: { failure: Failure }) {
  if (!failure || failure.field !== "form") return null;
  return (
    <motion.p
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={ENTER}
      role="alert"
      className={`text-[0.8125rem] leading-[20px] ${
        failure.tone === "critical" ? "text-critical" : "text-warn"
      }`}
    >
      {failure.message}
    </motion.p>
  );
}

function Card({
  title, description, children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-[20px] rounded-[12px] border border-line bg-card/40 p-[20px]">
      <div className="flex flex-col gap-[6px]">
        <h2 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
          {title}
        </h2>
        <p className="text-[0.8125rem] leading-[20px] text-sub/80">{description}</p>
      </div>
      {children}
    </section>
  );
}

/** One read-only fact about a camera. A <dt>/<dd> pair, so it is a real
 *  description list to a screen reader rather than two spans. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-[6px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-sub">{value}</dd>
    </div>
  );
}

const BUTTON =
  "h-[52px] rounded-[8px] bg-action text-[0.9375rem] leading-[20px] font-medium " +
  "text-black transition-colors hover:bg-overlay/90 disabled:cursor-not-allowed " +
  "disabled:bg-overlay/25 disabled:text-black/40";

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function SettingsView({
  onNavigate,
  onBack,
  towers = [],
  feeds = [],
  onCameraRenamed,
}: {
  onNavigate?: (id: string) => void;
  onBack?: () => void;
  /** The fleet, for the camera section. Empty is a valid state and says so. */
  towers?: Tower[];
  feeds?: CameraFeed[];
  /** Hand the re-projected tower and feeds back up, so the wall agrees. */
  onCameraRenamed?: (tower: Tower, feeds: CameraFeed[]) => void;
}) {
  const { account } = useSession();

  /* The organization name the SERVER currently has, which is not necessarily
     the one in `account`: that block is a snapshot from sign-in, and after a
     rename it is stale. A settings page rendering a stale name in the box you
     rename things with gets used to rename something back by accident. */
  const [serverLogin, setServerLogin] = useState<string | null>(null);

  /* ── the rename form ── */
  const [newLogin, setNewLogin] = useState("");
  const [renamePassword, setRenamePassword] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameFailure, setRenameFailure] = useState<Failure>(null);
  const [renamedTo, setRenamedTo] = useState<string | null>(null);

  /* ── the password form ── */
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changing, setChanging] = useState(false);
  const [passwordFailure, setPasswordFailure] = useState<Failure>(null);
  /** Set once the password has changed. This session is dead from here on. */
  const [doneRevoked, setDoneRevoked] = useState<number | null>(null);

  /* ── theme ── */
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  /* ── camera names ──
     Keyed by feed id, because the edit belongs to the CAMERA and not to this
     panel. One shared "editing" value would follow the operator from one
     camera to the next, which is the same class of bug `useMutation` documents
     for AlertDetail: state that outlives the thing it was about. */
  const [camDraft, setCamDraft] = useState<Record<string, string>>({});
  const [camSaving, setCamSaving] = useState<string | null>(null);
  const [camError, setCamError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [camSaved, setCamSaved] = useState<string | null>(null);

  /* Synchronous latches. `renaming`/`changing` are state, so two clicks
     dispatched in one tick both read the same stale `false` and both POST — the
     exact bug `AuthProvider` documents on its sign-in path. A ref is read and
     written in the same tick. The state flags stay, for display. */
  const renameInFlight = useRef(false);
  const changeInFlight = useRef(false);

  /* The current name, fetched once on mount. An `AbortController` because
     StrictMode mounts, tears down and remounts, and a late response from the
     torn-down run must not write over the live one's state. */
  useEffect(() => {
    const controller = new AbortController();
    let alive = true;
    void (async () => {
      try {
        const fresh = await getAccount(controller.signal);
        if (!alive || controller.signal.aborted) return;
        setServerLogin(fresh.login);
        /* The stored copy too, so the rest of the app agrees with this screen
           even if the name was changed from another tab or by an operator. */
        updateStoredAccount(fresh);
      } catch (err) {
        if (controller.signal.aborted) return;
        /* A dead session here must drop the whole app to login, the same as on
           any other authenticated call. Anything else is non-fatal: the screen
           falls back to the name from sign-in, which is what it had before. */
        endSessionIfUnauthorized(err);
        console.debug("[account] could not read the current account:", err);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
  }, []);

  const shownLogin = serverLogin ?? account?.login ?? "";

  /* ── client-side policy, as a hint rather than a gate ──────────────────
     These mirror the server (see `accountPolicy`) and are WEAKER by design:
     the submit still goes through if they disagree, and the server's message
     wins. They exist so somebody finds out their password is too short while
     they are still typing it. */
  const loginProblem = checkNewLogin(newLogin);
  const passwordProblem = checkNewPassword(newPassword, currentPassword);
  const mismatch =
    confirmPassword.length > 0 && confirmPassword !== newPassword;

  const canRename =
    newLogin.length > 0 &&
    renamePassword.length > 0 &&
    !loginProblem &&
    newLogin !== shownLogin &&
    !renaming;

  const canChange =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !passwordProblem &&
    !mismatch &&
    !changing;

  const submitRename = useCallback(async () => {
    if (renameInFlight.current) return;
    if (!newLogin || !renamePassword) return;
    renameInFlight.current = true;
    setRenaming(true);
    setRenameFailure(null);
    setRenamedTo(null);
    try {
      // VERBATIM. No trim anywhere on this path — see `accountPolicy`.
      const updated = await changeLogin(renamePassword, newLogin);
      setServerLogin(updated.login);
      setRenamedTo(updated.login);
      /* The rest of the app reads the organization from the stored session;
         without this it keeps stamping yesterday's name on today's actions. */
      updateStoredAccount(updated);
      /* The password leaves state the moment it is no longer needed. On success
         only: after a failure it stays so a mistyped NAME can be fixed without
         retyping the password. It is never persisted either way. */
      setRenamePassword("");
      setNewLogin("");
    } catch (err) {
      endSessionIfUnauthorized(err);
      setRenameFailure(failureFor(err));
    } finally {
      renameInFlight.current = false;
      setRenaming(false);
    }
  }, [newLogin, renamePassword]);

  const submitPassword = useCallback(async () => {
    if (changeInFlight.current) return;
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) return;
    changeInFlight.current = true;
    setChanging(true);
    setPasswordFailure(null);
    try {
      const result = await changePassword(currentPassword, newPassword);
      /* Every password leaves state here, before anything is rendered. */
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (result.reauthenticate) {
        /* THIS SESSION IS ALREADY DEAD — revoked server-side before the 200 was
           written. The screen switches to the confirmation; `clearSession` is
           the button's job, so the person reads the result before the app
           returns to sign-in. */
        setDoneRevoked(result.sessionsRevoked);
      } else {
        /* The server chose to keep this session. Not today's behaviour, and
           handled rather than assumed away: say it worked and stay put. */
        setDoneRevoked(null);
        setPasswordFailure(null);
      }
    } catch (err) {
      endSessionIfUnauthorized(err);
      setPasswordFailure(failureFor(err));
    } finally {
      changeInFlight.current = false;
      setChanging(false);
    }
  }, [currentPassword, newPassword, confirmPassword]);

  /**
   * Save one camera's name.
   *
   * An EMPTY value clears the name — the server treats blank as "clear", so
   * there is no separate delete control to explain. The placeholder then shows
   * `CAMERA <n>` again, which is what the wall will fall back to.
   */
  const saveCamera = useCallback(
    async (feed: CameraFeed) => {
      if (camSaving) return;
      const next = (camDraft[feed.id] ?? "").trim();
      const current = feed.label ?? "";
      if (next === current) return;           // nothing to do, and no request
      setCamSaving(feed.id);
      setCamError(null);
      setCamSaved(null);
      try {
        const { towers: [updated], feeds: updatedFeeds } = await renameCamera(
          feed.towerId,
          feed.index ?? 0,
          next,
        );
        /* Straight back up to App, so the wall, the tower view and the playback
           picker show the new name without a refetch. Renaming here and
           leaving the rest stale is how one camera ends up with two names. */
        if (updated) onCameraRenamed?.(updated, updatedFeeds);
        setCamSaved(feed.id);
        setCamDraft((prev) => {
          const { [feed.id]: _drop, ...rest } = prev;
          return rest;                        // fall back to the server's value
        });
      } catch (err) {
        endSessionIfUnauthorized(err);
        /* The SAME two errors the tower rename raises, handled the same way.
           A 404 means unknown tower, somebody else's tower, OR a disabled
           `settings` feature — the server does not distinguish them on purpose,
           so neither does this message. */
        const message =
          err instanceof LabelRejectedError
            ? err.message
            : err instanceof TowerUnavailableError
              ? "That tower is not available."
              : "The name could not be saved.";
        setCamError({ id: feed.id, message });
      } finally {
        setCamSaving(null);
      }
    },
    [camDraft, camSaving, onCameraRenamed],
  );

  const onRenameKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (canRename) void submitRename();
  };
  const onPasswordKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    if (canChange) void submitPassword();
  };

  /* ── THE CONFIRMATION, AFTER THE PASSWORD CHANGED ──────────────────────
     No rail and no way back into the app: every destination it could offer is
     going to 401. The one action ends the local session and lands on sign-in,
     which says "Your password was changed. Sign in with the new one." */
  if (doneRevoked !== null) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden bg-ink">
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
            role="status"
            className="my-auto flex w-[483px] max-w-full flex-col items-center gap-[26px] text-center"
          >
            <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-body-ink">
              PASSWORD CHANGED
            </h1>
            <p className="text-[0.875rem] leading-[20px] text-sub/80">
              {doneRevoked > 1
                ? `Everyone signed in on this account was signed out (${doneRevoked} sessions), including here. Sign in again with the new password.`
                : "You were signed out everywhere, including here. Sign in again with the new password."}
            </p>
            <button
              type="button"
              onClick={() => clearSession("password_changed")}
              autoFocus
              className={`${BUTTON} w-full`}
            >
              SIGN IN AGAIN
            </button>
          </motion.div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail active="settings" onSelect={onNavigate} className="hidden lg:block" />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line px-[16px]">
          <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-[4px]">
            <button
              type="button"
              onClick={onBack}
              title="Back to all towers"
              className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-body-ink"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span
              aria-current="page"
              className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink"
            >
              ACCOUNT
            </span>
          </nav>
        </header>

        <main className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[28px]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={FADE}
            className="mx-auto flex w-[560px] max-w-full flex-col gap-[20px]"
          >
            <div className="flex flex-col gap-[6px]">
              <h1 className="font-display text-[1.125rem] leading-[20px] tracking-[0.18px] text-body-ink">
                ACCOUNT
              </h1>
              <p className="text-[0.875rem] leading-[20px] text-sub/80">
                Signed in as{" "}
                <span className="text-body-ink">{shownLogin || "your organization"}</span>.
                One login is shared by everyone in your organization, so changing
                either of these changes it for all of them.
              </p>
            </div>

            {/* ───────────────── organization name ───────────────── */}
            <Card
              title="ORGANIZATION NAME"
              description="This is the name you sign in with. It is matched exactly, including spaces and capitals."
            >
              <div className="flex flex-col gap-[20px]">
                <Field
                  label="NEW ORGANIZATION NAME"
                  invalid={!!loginProblem || hasEdgeSpace(newLogin)}
                  hint={
                    loginProblem ??
                    (hasEdgeSpace(newLogin)
                      ? "This starts or ends with a space, and the space counts. You would have to type it that way every time."
                      : "Matched exactly, including spaces and capitals.")
                  }
                >
                  <input
                    value={newLogin}
                    onChange={(e) => {
                      setNewLogin(e.target.value);
                      setRenameFailure(null);
                      setRenamedTo(null);
                    }}
                    onKeyDown={onRenameKey}
                    disabled={renaming}
                    /* The browser must not normalise what the server matches
                       exactly, and no `uppercase`: a CSS transform would show
                       one string and submit another. Same reasoning as the
                       sign-in field. */
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    autoComplete="organization"
                    aria-invalid={
                      (renameFailure?.field === "new_login" || !!loginProblem) || undefined
                    }
                    placeholder={shownLogin || "Terra Industries"}
                    className={`${INPUT_BASE} ${
                      renameFailure?.field === "new_login" || loginProblem
                        ? "ring-1 ring-critical"
                        : ""
                    }`}
                  />
                </Field>
                {renameFailure?.field === "new_login" && (
                  <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
                    {renameFailure.message}
                  </p>
                )}

                <Field
                  label="YOUR CURRENT PASSWORD"
                  hint="Asked for because the sign-in name is half of your credentials."
                >
                  <input
                    type="password"
                    value={renamePassword}
                    onChange={(e) => {
                      setRenamePassword(e.target.value);
                      setRenameFailure(null);
                    }}
                    onKeyDown={onRenameKey}
                    disabled={renaming}
                    autoComplete="current-password"
                    aria-invalid={
                      renameFailure?.field === "current_password" || undefined
                    }
                    className={`${INPUT_BASE} ${
                      renameFailure?.field === "current_password"
                        ? "ring-1 ring-critical"
                        : ""
                    }`}
                  />
                </Field>
                {renameFailure?.field === "current_password" && (
                  <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
                    {renameFailure.message}
                  </p>
                )}

                <FormError failure={renameFailure} />

                {renamedTo && (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={ENTER}
                    role="status"
                    className="rounded-[8px] bg-terra/12 px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-terra"
                  >
                    Your organization is now <span className="text-body-ink">{renamedTo}</span>.
                    Sign in with that name from now on. You are still signed in here.
                  </motion.p>
                )}

                <button
                  type="button"
                  onClick={() => void submitRename()}
                  disabled={!canRename}
                  aria-busy={renaming || undefined}
                  className={BUTTON}
                >
                  {renaming ? "SAVING…" : "CHANGE NAME"}
                </button>
              </div>
            </Card>

            {/* ───────────────── password ───────────────── */}
            <Card
              title="PASSWORD"
              description={`At least ${PASSWORD_MIN_LEN} characters. A few words you will remember beats a short one with symbols in it.`}
            >
              <div className="flex flex-col gap-[20px]">
                <Field label="YOUR CURRENT PASSWORD">
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => {
                      setCurrentPassword(e.target.value);
                      setPasswordFailure(null);
                    }}
                    onKeyDown={onPasswordKey}
                    disabled={changing}
                    autoComplete="current-password"
                    aria-invalid={
                      passwordFailure?.field === "current_password" || undefined
                    }
                    className={`${INPUT_BASE} ${
                      passwordFailure?.field === "current_password"
                        ? "ring-1 ring-critical"
                        : ""
                    }`}
                  />
                </Field>
                {passwordFailure?.field === "current_password" && (
                  <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
                    {passwordFailure.message}
                  </p>
                )}

                <Field
                  label="NEW PASSWORD"
                  invalid={!!passwordProblem}
                  hint={passwordProblem ?? `At least ${PASSWORD_MIN_LEN} characters.`}
                >
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value);
                      setPasswordFailure(null);
                    }}
                    onKeyDown={onPasswordKey}
                    disabled={changing}
                    autoComplete="new-password"
                    aria-invalid={
                      (passwordFailure?.field === "new_password" || !!passwordProblem) ||
                      undefined
                    }
                    className={`${INPUT_BASE} ${
                      passwordFailure?.field === "new_password" || passwordProblem
                        ? "ring-1 ring-critical"
                        : ""
                    }`}
                  />
                </Field>
                {passwordFailure?.field === "new_password" && (
                  <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
                    {passwordFailure.message}
                  </p>
                )}

                <Field
                  label="NEW PASSWORD AGAIN"
                  invalid={mismatch}
                  hint={
                    mismatch
                      ? "These two do not match."
                      : /* Client-side only, and said so: the server never sees
                           this field. It exists because a mistyped new password
                           locks you out of an account you can no longer reach
                           from here. */
                        "Typed twice, so a slip cannot lock you out."
                  }
                >
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      setPasswordFailure(null);
                    }}
                    onKeyDown={onPasswordKey}
                    disabled={changing}
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                    className={`${INPUT_BASE} ${mismatch ? "ring-1 ring-critical" : ""}`}
                  />
                </Field>

                <FormError failure={passwordFailure} />

                {/* Said BEFORE the button, not after the fact. Being signed out
                    of a running control-room screen is a consequence worth
                    knowing about in advance. */}
                <p className="text-[0.75rem] leading-[16px] text-muted">
                  Changing the password signs out every device using this
                  account, including this one.
                </p>

                <button
                  type="button"
                  onClick={() => void submitPassword()}
                  disabled={!canChange}
                  aria-busy={changing || undefined}
                  className={BUTTON}
                >
                  {changing ? "CHANGING…" : "CHANGE PASSWORD"}
                </button>
              </div>
            </Card>

            {/* ───────────────── theme ───────────────── */}
            <Card
              title="APPEARANCE"
              description="Remembered on this device, for you. One login is shared across your organization, so this is not stored on the server — otherwise one person's choice would change everyone's screen."
            >
              <div
                role="radiogroup"
                aria-label="Theme"
                className="flex gap-[12px]"
              >
                {(["dark", "light"] as const).map((option) => {
                  const chosen = theme === option;
                  return (
                    <button
                      key={option}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => {
                        /* Applied to the document by `setTheme`, not by a
                           re-render: the attribute lives on <html>, above
                           React's root. The local state is only so this
                           control shows which one is active. */
                        setTheme(option);
                        setThemeState(option);
                      }}
                      className={`flex h-[52px] flex-1 items-center justify-center gap-[10px] rounded-[8px] border text-[0.9375rem] transition-colors ${
                        chosen
                          ? "border-terra bg-terra/12 text-body-ink"
                          : "border-line bg-card text-sub hover:bg-card-hover"
                      }`}
                    >
                      {/* A filled swatch, so the choice reads without the label.
                          Hardcoded hexes on purpose: these two squares must show
                          what each THEME looks like, so they cannot follow the
                          theme that is currently active. */}
                      <span
                        aria-hidden="true"
                        className="size-[16px] rounded-[4px] border"
                        style={{
                          background: option === "dark" ? "#000000" : "#f4f5f7",
                          borderColor: option === "dark" ? "#2c2c30" : "#c4c8d0",
                        }}
                      />
                      {option === "dark" ? "Dark" : "Light"}
                    </button>
                  );
                })}
              </div>
              <p className="text-[0.75rem] leading-[16px] text-muted">
                Camera tiles stay dark in both themes: a video picture is
                letterboxed, and light bars either side of it make the picture
                harder to read, not easier.
              </p>
            </Card>

            {/* ───────────────── cameras ───────────────── */}
            <Card
              title="CAMERAS"
              description="Name each camera so it can be quoted on the radio. The name is used everywhere — the wall, playback, and downloaded footage."
            >
              {towers.length === 0 ? (
                /* HONEST ABSENCE, not a spinner and not an invented row. An
                   account with no towers yet is a real state, and this screen
                   is reachable before the first tower is claimed. */
                <p className="text-[0.8125rem] leading-[20px] text-muted">
                  No towers on this account yet. Cameras appear here once a
                  tower is added and has reported them.
                </p>
              ) : (
                <div className="flex flex-col gap-[24px]">
                  {towers.map((tower) => {
                    const mine = feeds.filter((f) => f.towerId === tower.id);
                    return (
                      <div key={tower.id} className="flex flex-col gap-[12px]">
                        <h3 className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                          {tower.site || tower.id}
                        </h3>

                        {mine.length === 0 ? (
                          <p className="text-[0.8125rem] leading-[20px] text-muted">
                            {/* A tower with no cameras is either offline or has
                                never reported an inventory. Both are facts, and
                                neither is "no cameras exist". */}
                            This tower has not reported any cameras.
                          </p>
                        ) : (
                          mine.map((feed) => {
                            const draft = camDraft[feed.id];
                            const value = draft ?? feed.label ?? "";
                            const busy = camSaving === feed.id;
                            const err =
                              camError?.id === feed.id ? camError.message : null;
                            const dirty = value.trim() !== (feed.label ?? "");
                            return (
                              <div
                                key={feed.id}
                                className="flex flex-col gap-[10px] rounded-[8px] border border-line bg-card/60 p-[14px]"
                              >
                                <div className="flex flex-wrap items-center gap-[8px]">
                                  <input
                                    value={value}
                                    onChange={(e) => {
                                      setCamDraft((prev) => ({
                                        ...prev,
                                        [feed.id]: e.target.value,
                                      }));
                                      setCamError(null);
                                      setCamSaved(null);
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key !== "Enter") return;
                                      e.preventDefault();
                                      if (dirty && !busy) void saveCamera(feed);
                                    }}
                                    disabled={busy}
                                    maxLength={80}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    aria-label={`Name for camera ${feed.index}`}
                                    /* The PLACEHOLDER is the fallback the wall
                                       will show, so an empty box is not a
                                       mystery — it says what the camera is
                                       currently called. */
                                    placeholder={`CAMERA ${feed.index}`}
                                    className={`h-[44px] min-w-[200px] flex-1 rounded-[8px] bg-card px-[12px] text-[0.9375rem] text-body-ink outline-none placeholder:text-body-ink/25 focus-visible:outline-1 focus-visible:outline-terra disabled:text-body-ink/40 ${
                                      err ? "ring-1 ring-critical" : ""
                                    }`}
                                  />
                                  <button
                                    type="button"
                                    onClick={() => void saveCamera(feed)}
                                    disabled={!dirty || busy}
                                    aria-busy={busy || undefined}
                                    className="h-[44px] rounded-[8px] bg-action px-[16px] text-[0.875rem] font-medium text-action-ink transition-colors hover:bg-action/90 disabled:cursor-not-allowed disabled:bg-action/25 disabled:text-action-ink/40"
                                  >
                                    {busy ? "SAVING…" : "SAVE"}
                                  </button>
                                </div>

                                {err && (
                                  <p
                                    role="alert"
                                    className="text-[0.8125rem] leading-[20px] text-critical"
                                  >
                                    {err}
                                  </p>
                                )}
                                {camSaved === feed.id && !err && (
                                  <p
                                    role="status"
                                    className="text-[0.8125rem] leading-[20px] text-terra"
                                  >
                                    Saved.
                                  </p>
                                )}

                                {/* ── READ-ONLY DETAILS ──────────────────────
                                    What the tower reports and nothing more. No
                                    IP, no password, no network, no recording or
                                    image settings: none of those are in this
                                    screen's vocabulary or the route's, so there
                                    is nothing here to get wrong. */}
                                <dl className="flex flex-wrap gap-x-[20px] gap-y-[4px] text-[0.75rem] leading-[16px]">
                                  <Detail label="Status" value={
                                    feed.state === "live" ? "Online"
                                      : feed.state === "offline" ? "Offline"
                                        : "Not reported"
                                  } />
                                  <Detail label="Resolution" value={
                                    /* From the DEFAULT profile the tower
                                       advertised. Absent rather than guessed
                                       when it advertised none — the projection
                                       omits resolution it does not know, and
                                       inventing 1080p here would be the fake
                                       reading this app refuses elsewhere. */
                                    (() => {
                                      const p = feed.profiles?.find((x) => x.default)
                                        ?? feed.profiles?.[0];
                                      return p?.resolution
                                        ? `${p.resolution.width} × ${p.resolution.height}`
                                        : "Not reported";
                                    })()
                                  } />
                                  <Detail label="Lens" value={
                                    feed.lens === "ptz" ? "PTZ"
                                      : feed.lens === "fixed" ? "Fixed"
                                        : "Not reported"
                                  } />
                                  <Detail label="Control" value={
                                    feed.ptz ? "Pan, tilt, zoom" : "None"
                                  } />
                                  {/* ⚠ MODEL IS NOT AVAILABLE. No tower reports a
                                      camera make or model — it is not in
                                      `tower.hello`, so the projection has no
                                      field for it and `_project_camera` could not
                                      pass one on if it did. Shown as not
                                      reported rather than omitted, so the gap is
                                      visible instead of looking like a field
                                      nobody thought of. Making it real needs the
                                      tower to report it first. */}
                                  <Detail label="Model" value="Not reported" />
                                </dl>
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </motion.div>
        </main>
      </div>
    </div>
  );
}
