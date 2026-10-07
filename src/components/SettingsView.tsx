import { motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSession } from "@/components/AuthProvider";
import { IconRail } from "@/components/IconRail";
import { SiteClock } from "@/components/SiteClock";
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
import {
  SETTINGS_SECTIONS,
  hashForSection,
  type SettingsSection,
} from "@/lib/settingsRoute";

/**
 * Settings — four sections, one at a time, linkable.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS NOT ONE LONG PAGE ANY MORE
 * ══════════════════════════════════════════════════════════════════════
 *
 * The first version stacked everything vertically, and the Account card read:
 * the organization name, then "NEW ORGANIZATION NAME", then "YOUR CURRENT
 * PASSWORD". Three fields in a column with nothing to say that the last two
 * belong to an action nobody had started — so the page asked for a password to
 * do nothing, on load, forever. That is the shape of a form that gets a
 * password typed into it out of habit.
 *
 * Two fixes, and they are the same fix: SHOW THE STATE, THEN OFFER TO CHANGE IT.
 *
 *   · The organization name is TEXT with an Edit button. The form — new name,
 *     current password, Save, Cancel — does not exist until Edit is pressed, so
 *     there is never a password field on screen that is not part of something
 *     the person deliberately began.
 *   · The password change is behind its own button in its own section, for the
 *     same reason: "change my password" and "rename my organization" are
 *     different errands, and sharing a card made them look like one.
 *
 * ── THE LEFT LIST IS NAVIGATION, NOT A TABLE OF CONTENTS ───────────────
 *
 * Only the chosen section is mounted, and the pane is keyed on the section so
 * switching REMOUNTS it. That is deliberate: an unmounted form cannot be
 * holding a half-typed password, so changing section discards credentials
 * instead of parking them behind a tab somebody returns to an hour later. It
 * also means the Cameras list is not built for an account that came here to
 * change a password.
 *
 * ── LINKABLE, AND IT IS THE ONLY URL IN THIS APP ───────────────────────
 *
 * `#settings/cameras`. `lib/settingsRoute.ts` carries the reasoning; the short
 * version is that a hash needs no server rewrite, and this bundle is served
 * both by Vercel and by a hub whose static handler has no SPA fallback at all.
 *
 * ⚠ NO `<form>` ANYWHERE, as everywhere else in this app — a form would
 * navigate and take the page with it. Enter is bound explicitly.
 */

/* ------------------------------------------------------------------ *
 * The failure taxonomy — unchanged, and the load-bearing part
 * ------------------------------------------------------------------ */

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
       the server, and a local translation would be the stale copy.

       THIS IS ALSO WHERE THE 403 LANDS, which is the behaviour that must not
       regress. A wrong current password is a FIELD error, not a dead session:
       coordination answers 403 precisely so the browser does not sign the
       person out over a typo, and `AccountFieldError` is what carries that
       distinction into the UI. */
    return { field: err.field, message: err.message, tone: "critical" };
  }
  if (err instanceof AccountThrottledError) {
    /* Not a verdict about what was typed, so it goes on the form rather than
       under a field, in amber. The person is already signed in; what is locked
       is the change, not their account. */
    return { field: "form", message: err.message, tone: "warn" };
  }
  if (err instanceof AuthUnreachableError) {
    /* ⚠ ONE REASON NEEDS ITS OWN SENTENCE. `AuthUnreachableError` builds its
       message from a table written for the SIGN-IN screen, and for
       `no_endpoint` that sentence is "Signing in isn't available right now" —
       wrong and alarming on a page reached by somebody already signed in. It is
       also the likeliest to be read: `no_endpoint` is what a 404 or 501
       produces, which is what coordination answers while it is a version behind
       this bundle, and the DC is updated separately from Vercel. */
    if (err.reason === "no_endpoint") {
      return {
        field: "form",
        message: "Changing this isn't available yet. Please try again later.",
        tone: "warn",
      };
    }
    return { field: "form", message: err.message, tone: "warn" };
  }
  console.debug("[account] change failed with an unrecognised error:", err);
  return {
    field: "form",
    message: "Something went wrong. Please try again in a moment.",
    tone: "warn",
  };
}

/* ------------------------------------------------------------------ *
 * The app's existing input, label and button vocabulary
 * ------------------------------------------------------------------ */

const INPUT =
  "h-[48px] rounded-[8px] bg-card px-[14px] text-[0.9375rem] text-body-ink " +
  "outline-none placeholder:text-body-ink/25 focus-visible:outline-1 " +
  "focus-visible:outline-terra disabled:text-body-ink/40";

const PRIMARY =
  "h-[44px] rounded-[8px] bg-action px-[18px] text-[0.875rem] font-medium " +
  "text-action-ink transition-colors hover:bg-action/90 " +
  "disabled:cursor-not-allowed disabled:bg-action/25 disabled:text-action-ink/40";

const SECONDARY =
  "h-[44px] shrink-0 rounded-[8px] border border-stroke px-[18px] " +
  "text-[0.875rem] text-sub transition-colors hover:bg-card-hover " +
  "hover:text-body-ink disabled:cursor-not-allowed disabled:text-sub/40";

function Field({
  label,
  hint,
  invalid,
  children,
}: {
  label: string;
  hint?: string;
  invalid?: boolean;
  children: ReactNode;
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

/** The error that belongs under one named input. */
function FieldError({ failure, field }: { failure: Failure; field: string }) {
  if (!failure || failure.field !== field) return null;
  return (
    <p role="alert" className="text-[0.8125rem] leading-[20px] text-critical">
      {failure.message}
    </p>
  );
}

/** A section's heading and lead, so all four read the same way. */
function SectionHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="flex flex-col gap-[6px]">
      <h2 className="font-display text-[1rem] leading-[22px] tracking-[0.16px] text-body-ink">
        {title}
      </h2>
      <p className="max-w-[560px] text-[0.8125rem] leading-[20px] text-sub/80">
        {lead}
      </p>
    </div>
  );
}

/** A bordered block inside a section — one setting, or one camera. */
function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[16px] rounded-[12px] border border-line bg-card/40 p-[20px]">
      {children}
    </div>
  );
}

/** One read-only fact. A real <dt>/<dd> pair, not two spans. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-[6px]">
      <dt className="text-muted">{label}</dt>
      <dd className="text-sub">{value}</dd>
    </div>
  );
}

const SECTION_LABEL: Record<SettingsSection, string> = {
  account: "Account",
  security: "Password & security",
  appearance: "Appearance",
  cameras: "Cameras",
};

/* ================================================================== *
 * The screen
 * ================================================================== */

export function SettingsView({
  onNavigate,
  onBack,
  section = "account",
  onSectionChange,
  towers = [],
  feeds = [],
  onCameraRenamed,
}: {
  onNavigate?: (id: string) => void;
  onBack?: () => void;
  /** Which section is open. Owned by `App.tsx`, because the URL is its
   *  business — this component should not be the thing that knows about
   *  `location`. */
  section?: SettingsSection;
  onSectionChange?: (section: SettingsSection) => void;
  towers?: Tower[];
  feeds?: CameraFeed[];
  onCameraRenamed?: (tower: Tower, feeds: CameraFeed[]) => void;
}) {
  const { account } = useSession();

  /* The organization name the SERVER currently has. Not the same as the one in
     `account`: that block is a snapshot from sign-in, and after a rename it is
     stale. A settings page showing a stale name next to the control that
     renames things gets used to rename something back by accident. */
  const [serverLogin, setServerLogin] = useState<string | null>(null);

  /* ── the rename, which does not exist until Edit is pressed ── */
  const [editingName, setEditingName] = useState(false);
  const [newLogin, setNewLogin] = useState("");
  const [renamePassword, setRenamePassword] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [renameFailure, setRenameFailure] = useState<Failure>(null);
  const [renamedTo, setRenamedTo] = useState<string | null>(null);

  /* ── the password change, likewise ── */
  const [changingPw, setChangingPw] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [passwordFailure, setPasswordFailure] = useState<Failure>(null);
  /** Set once the password has changed. This session is dead from here on. */
  const [doneRevoked, setDoneRevoked] = useState<number | null>(null);

  /* ── theme ── */
  const [theme, setThemeState] = useState<Theme>(() => getTheme());

  /* ── camera names, keyed by feed id ──
     Keyed because the edit belongs to the CAMERA, not to this panel. One
     shared "editing" value would follow the operator from one camera to the
     next — the same class of bug `useMutation` documents for AlertDetail. */
  const [camEditing, setCamEditing] = useState<string | null>(null);
  const [camDraft, setCamDraft] = useState<Record<string, string>>({});
  const [camSaving, setCamSaving] = useState<string | null>(null);
  const [camError, setCamError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [camSaved, setCamSaved] = useState<string | null>(null);

  /* Synchronous latches. `renaming`/`saving` are state, so two clicks in one
     tick both read the same stale `false` and both POST — the exact bug
     `AuthProvider` documents on its sign-in path. */
  const renameInFlight = useRef(false);
  const pwInFlight = useRef(false);

  /* The current name, fetched once on mount. AbortController because
     StrictMode mounts, tears down and remounts, and a late response from the
     torn-down run must not write over the live one's state. */
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const fresh = await getAccount(controller.signal);
        if (controller.signal.aborted) return;
        setServerLogin(fresh.login);
        /* The stored copy too, so the rest of the app agrees with this screen
           even if the name was changed in another tab or by an operator. */
        updateStoredAccount(fresh);
      } catch (err) {
        if (controller.signal.aborted) return;
        /* A dead session must drop the whole app to login. Anything else is
           non-fatal: the screen falls back to the sign-in snapshot. */
        endSessionIfUnauthorized(err);
        console.debug("[account] could not read the current account:", err);
      }
    })();
    return () => controller.abort();
  }, []);

  const shownLogin = serverLogin ?? account?.login ?? "";

  /* Client-side policy as a HINT, never a gate. These mirror the server (see
     `accountPolicy`) and are weaker by design: the submit still goes through if
     they disagree, and the server's message wins. */
  const loginProblem = checkNewLogin(newLogin);
  const passwordProblem = checkNewPassword(newPassword, currentPassword);
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;

  const canRename =
    newLogin.length > 0 &&
    renamePassword.length > 0 &&
    !loginProblem &&
    newLogin !== shownLogin &&
    !renaming;

  const canSavePassword =
    currentPassword.length > 0 &&
    newPassword.length > 0 &&
    confirmPassword.length > 0 &&
    !passwordProblem &&
    !mismatch &&
    !saving;

  /** Leave the rename form, dropping whatever was typed into it. */
  const cancelRename = useCallback(() => {
    setEditingName(false);
    setNewLogin("");
    setRenamePassword("");
    setRenameFailure(null);
  }, []);

  /** Leave the password form, dropping whatever was typed into it. */
  const cancelPassword = useCallback(() => {
    setChangingPw(false);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordFailure(null);
  }, []);

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
      /* Back to the read-only view, and the password leaves state. On SUCCESS
         only: after a failure the form stays, so a mistyped NAME can be fixed
         without retyping the password. */
      setEditingName(false);
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
    if (pwInFlight.current) return;
    if (!currentPassword || !newPassword) return;
    if (newPassword !== confirmPassword) return;
    pwInFlight.current = true;
    setSaving(true);
    setPasswordFailure(null);
    try {
      const result = await changePassword(currentPassword, newPassword);
      /* Every password leaves state here, before anything is rendered. */
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      if (result.reauthenticate) {
        /* THIS SESSION IS ALREADY DEAD — revoked server-side before the 200 was
           written. The screen becomes the confirmation; `clearSession` is the
           button's job, so the person reads the result before the app returns
           to sign-in. */
        setDoneRevoked(result.sessionsRevoked);
      } else {
        /* The server chose to keep this session. Not today's behaviour, and
           handled rather than assumed away. */
        setChangingPw(false);
      }
    } catch (err) {
      endSessionIfUnauthorized(err);
      setPasswordFailure(failureFor(err));
    } finally {
      pwInFlight.current = false;
      setSaving(false);
    }
  }, [currentPassword, newPassword, confirmPassword]);

  /**
   * Save one camera's name. An EMPTY value clears it — the server treats blank
   * as "clear", so there is no separate delete control to explain.
   */
  const saveCamera = useCallback(
    async (feed: CameraFeed) => {
      if (camSaving) return;
      const next = (camDraft[feed.id] ?? "").trim();
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
        setCamEditing(null);
        setCamDraft((prev) => {
          const { [feed.id]: _drop, ...rest } = prev;
          return rest;                        // fall back to the server's value
        });
      } catch (err) {
        endSessionIfUnauthorized(err);
        /* The SAME two errors the tower rename raises. A 404 means unknown
           tower, somebody else's tower, OR a disabled `settings` feature — the
           server does not distinguish them on purpose, so neither does this. */
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

  const onEnter = (fn: () => void) => (e: KeyboardEvent) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    fn();
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
              className={`${PRIMARY} w-full`}
            >
              SIGN IN AGAIN
            </button>
          </motion.div>
        </main>
      </div>
    );
  }

  /* ── the four panes ───────────────────────────────────────────────────── */

  const accountSection = (
    <div className="flex flex-col gap-[20px]">
      <SectionHead
        title="Account"
        lead="One login is shared by everyone in your organization, so changing it changes it for all of them."
      />
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-[16px]">
          <div className="flex min-w-0 flex-col gap-[4px]">
            <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
              ORGANIZATION NAME
            </span>
            {/* READ-ONLY TEXT, not an input. An input holding a value nobody
                asked to change invites a change nobody meant — which is what
                the first version of this screen did. */}
            <span className="break-words text-[1.0625rem] leading-[24px] text-body-ink">
              {shownLogin || "—"}
            </span>
            <span className="text-[0.75rem] leading-[16px] text-muted">
              This is the name you sign in with.
            </span>
          </div>
          {!editingName && (
            <button
              type="button"
              onClick={() => {
                setEditingName(true);
                setNewLogin(shownLogin);
                setRenamedTo(null);
              }}
              className={SECONDARY}
            >
              Edit
            </button>
          )}
        </div>

        {renamedTo && !editingName && (
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={ENTER}
            role="status"
            className="rounded-[8px] bg-terra/12 px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-terra"
          >
            Renamed. Sign in with{" "}
            <span className="text-body-ink">{renamedTo}</span> from now on. You
            are still signed in here.
          </motion.p>
        )}

        {/* THE FORM ONLY EXISTS AFTER EDIT. Before that there is no password
            field on this screen at all. */}
        {editingName && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={ENTER}
            className="flex flex-col gap-[16px] border-t border-line pt-[16px]"
          >
            <Field
              label="NEW ORGANIZATION NAME"
              invalid={!!loginProblem || hasEdgeSpace(newLogin)}
              hint={
                loginProblem ??
                (hasEdgeSpace(newLogin)
                  ? "This starts or ends with a space, and the space counts — you would have to type it that way every time."
                  : "Matched exactly, including spaces and capitals.")
              }
            >
              <input
                value={newLogin}
                onChange={(e) => {
                  setNewLogin(e.target.value);
                  setRenameFailure(null);
                }}
                onKeyDown={onEnter(() => canRename && void submitRename())}
                disabled={renaming}
                autoFocus
                /* The browser must not normalise what the server matches
                   exactly, and no `uppercase`: a CSS transform would show one
                   string and submit another. */
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="organization"
                aria-invalid={
                  renameFailure?.field === "new_login" || !!loginProblem || undefined
                }
                className={`${INPUT} ${
                  renameFailure?.field === "new_login" || loginProblem
                    ? "ring-1 ring-critical"
                    : ""
                }`}
              />
            </Field>
            <FieldError failure={renameFailure} field="new_login" />

            <Field
              label="CONFIRM WITH YOUR CURRENT PASSWORD"
              hint="Asked for because the sign-in name is half of your credentials."
            >
              <input
                type="password"
                value={renamePassword}
                onChange={(e) => {
                  setRenamePassword(e.target.value);
                  setRenameFailure(null);
                }}
                onKeyDown={onEnter(() => canRename && void submitRename())}
                disabled={renaming}
                autoComplete="current-password"
                aria-invalid={renameFailure?.field === "current_password" || undefined}
                className={`${INPUT} ${
                  renameFailure?.field === "current_password"
                    ? "ring-1 ring-critical"
                    : ""
                }`}
              />
            </Field>
            <FieldError failure={renameFailure} field="current_password" />
            <FormError failure={renameFailure} />

            <div className="flex gap-[10px]">
              <button
                type="button"
                onClick={() => void submitRename()}
                disabled={!canRename}
                aria-busy={renaming || undefined}
                className={PRIMARY}
              >
                {renaming ? "SAVING…" : "Save"}
              </button>
              <button
                type="button"
                onClick={cancelRename}
                disabled={renaming}
                className={SECONDARY}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </Panel>
    </div>
  );

  const securitySection = (
    <div className="flex flex-col gap-[20px]">
      <SectionHead
        title="Password & security"
        lead="Changing the password signs out every device using this account, including this one."
      />
      <Panel>
        {!changingPw ? (
          <div className="flex flex-wrap items-center justify-between gap-[16px]">
            <div className="flex flex-col gap-[4px]">
              <span className="text-[0.9375rem] leading-[22px] text-body-ink">
                Password
              </span>
              <span className="text-[0.75rem] leading-[16px] text-muted">
                {/* No "last changed" date: coordination does not report one, and
                    a made-up date on a security screen is worse than none. The
                    audit ledger has it if anyone needs to ask. */}
                Hidden. You will be asked for the current one to change it.
              </span>
            </div>
            <button
              type="button"
              onClick={() => setChangingPw(true)}
              className={SECONDARY}
            >
              Change password
            </button>
          </div>
        ) : (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={ENTER}
            className="flex flex-col gap-[16px]"
          >
            {/* THE RULE, BEFORE SUBMIT. Stated once at the top rather than only
                as an error after a refusal — a policy a person discovers by
                failing is a policy they meet twice. */}
            <p className="rounded-[8px] bg-card px-[14px] py-[12px] text-[0.8125rem] leading-[20px] text-sub">
              Use at least {PASSWORD_MIN_LEN} characters. A few words you will
              remember beats a short one with symbols in it.
            </p>

            <Field label="CURRENT PASSWORD">
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => {
                  setCurrentPassword(e.target.value);
                  setPasswordFailure(null);
                }}
                onKeyDown={onEnter(() => canSavePassword && void submitPassword())}
                disabled={saving}
                autoFocus
                autoComplete="current-password"
                aria-invalid={passwordFailure?.field === "current_password" || undefined}
                className={`${INPUT} ${
                  passwordFailure?.field === "current_password"
                    ? "ring-1 ring-critical"
                    : ""
                }`}
              />
            </Field>
            <FieldError failure={passwordFailure} field="current_password" />

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
                onKeyDown={onEnter(() => canSavePassword && void submitPassword())}
                disabled={saving}
                autoComplete="new-password"
                aria-invalid={
                  passwordFailure?.field === "new_password" || !!passwordProblem || undefined
                }
                className={`${INPUT} ${
                  passwordFailure?.field === "new_password" || passwordProblem
                    ? "ring-1 ring-critical"
                    : ""
                }`}
              />
            </Field>
            <FieldError failure={passwordFailure} field="new_password" />

            <Field
              label="CONFIRM NEW PASSWORD"
              invalid={mismatch}
              hint={
                mismatch
                  ? "These two do not match."
                  : /* Client-side only, and said so: the server never sees this
                       field. It exists because a mistyped new password locks you
                       out of an account you can no longer reach from here. */
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
                onKeyDown={onEnter(() => canSavePassword && void submitPassword())}
                disabled={saving}
                autoComplete="new-password"
                aria-invalid={mismatch || undefined}
                className={`${INPUT} ${mismatch ? "ring-1 ring-critical" : ""}`}
              />
            </Field>

            <FormError failure={passwordFailure} />

            <div className="flex gap-[10px]">
              <button
                type="button"
                onClick={() => void submitPassword()}
                disabled={!canSavePassword}
                aria-busy={saving || undefined}
                className={PRIMARY}
              >
                {saving ? "CHANGING…" : "Change password"}
              </button>
              <button
                type="button"
                onClick={cancelPassword}
                disabled={saving}
                className={SECONDARY}
              >
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </Panel>
    </div>
  );

  const appearanceSection = (
    <div className="flex flex-col gap-[20px]">
      <SectionHead
        title="Appearance"
        lead="Remembered on this device, for you. One login is shared across your organization, so this is not stored on the server — otherwise one person's choice would change everyone's screen."
      />
      <div role="radiogroup" aria-label="Theme" className="flex flex-wrap gap-[16px]">
        {(["dark", "light"] as const).map((option) => {
          const chosen = theme === option;
          /* HARDCODED HEXES IN THE PREVIEW, on purpose: these two cards must
             show what each THEME looks like, so they cannot follow the theme
             that happens to be active. Taken from `index.css` — the dark
             @theme block and the `[data-theme="light"]` override. */
          const p =
            option === "dark"
              ? {
                  page: "#000000", card: "#161618", line: "#1f1f1f",
                  ink: "#ffffff", sub: "#c1c1c1", accent: "#66e28e",
                }
              : {
                  page: "#f4f5f7", card: "#ffffff", line: "#e2e4e9",
                  ink: "#111827", sub: "#374151", accent: "#0f8a46",
                };
          return (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={chosen}
              onClick={() => {
                /* Applied to the document by `setTheme`, not by a re-render: the
                   attribute lives on <html>, above React's root. The local state
                   is only so this control shows which one is active. */
                setTheme(option);
                setThemeState(option);
              }}
              className={`flex w-[232px] max-w-full flex-col gap-[12px] rounded-[12px] border p-[14px] text-left transition-colors ${
                chosen
                  ? "border-terra bg-terra/8"
                  : "border-line bg-card/40 hover:bg-card-hover"
              }`}
            >
              {/* A MINIATURE OF THE PRODUCT — a bar, a video tile and two lines
                  of text — rather than a plain colour swatch. A swatch shows the
                  background; this shows the CONTRAST the theme actually has,
                  which is the thing being chosen between. */}
              <span
                aria-hidden="true"
                className="flex h-[96px] flex-col gap-[6px] overflow-hidden rounded-[8px] p-[8px]"
                style={{ background: p.page, border: `1px solid ${p.line}` }}
              >
                <span
                  className="flex h-[14px] shrink-0 items-center gap-[4px] rounded-[3px] px-[4px]"
                  style={{ background: p.card }}
                >
                  <span className="size-[5px] rounded-full" style={{ background: p.accent }} />
                  <span
                    className="h-[3px] w-[28px] rounded-full"
                    style={{ background: p.sub, opacity: 0.6 }}
                  />
                </span>
                <span className="flex min-h-0 flex-1 gap-[6px]">
                  {/* The video tile, dark in BOTH previews — because it IS dark
                      in both themes, and a preview showing it white would be
                      advertising something the product does not do. */}
                  <span className="flex-1 rounded-[3px]" style={{ background: "#11141a" }} />
                  <span
                    className="flex w-[64px] flex-col justify-center gap-[4px] rounded-[3px] px-[5px]"
                    style={{ background: p.card }}
                  >
                    <span
                      className="h-[3px] w-[80%] rounded-full"
                      style={{ background: p.ink, opacity: 0.85 }}
                    />
                    <span
                      className="h-[3px] w-[55%] rounded-full"
                      style={{ background: p.sub, opacity: 0.55 }}
                    />
                  </span>
                </span>
              </span>
              <span className="flex items-center justify-between">
                <span className="text-[0.9375rem] text-body-ink">
                  {option === "dark" ? "Dark" : "Light"}
                </span>
                {chosen && (
                  <span className="font-display text-[0.6875rem] tracking-[0.11px] text-terra">
                    IN USE
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <p className="max-w-[560px] text-[0.75rem] leading-[16px] text-muted">
        Camera tiles stay dark in both themes: a video picture is letterboxed,
        and light bars either side of it make the picture harder to read.
      </p>
    </div>
  );

  const camerasSection = (
    <div className="flex flex-col gap-[20px]">
      <SectionHead
        title="Cameras"
        lead="Name each camera so it can be quoted on the radio. The name is used everywhere — the wall, playback, and downloaded footage."
      />
      {towers.length === 0 ? (
        /* HONEST ABSENCE, not a spinner and not an invented row. An account
           with no towers is a real state, and this screen is reachable before
           the first tower is claimed. */
        <Panel>
          <p className="text-[0.8125rem] leading-[20px] text-muted">
            No towers on this account yet. Cameras appear here once a tower is
            added and has reported them.
          </p>
        </Panel>
      ) : (
        <div className="flex flex-col gap-[24px]">
          {towers.map((tower) => {
            const mine = feeds.filter((f) => f.towerId === tower.id);
            return (
              <section key={tower.id} className="flex flex-col gap-[10px]">
                <h3 className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
                  {tower.site || tower.id}
                </h3>
                {mine.length === 0 ? (
                  <Panel>
                    <p className="text-[0.8125rem] leading-[20px] text-muted">
                      {/* Offline, or never reported an inventory. Both are
                          facts; neither is "this tower has no cameras". */}
                      This tower has not reported any cameras.
                    </p>
                  </Panel>
                ) : (
                  <ul className="flex flex-col gap-[10px]">
                    {mine.map((feed) => {
                      const editing = camEditing === feed.id;
                      const busy = camSaving === feed.id;
                      const err = camError?.id === feed.id ? camError.message : null;
                      const draft = camDraft[feed.id] ?? feed.label ?? "";
                      const resolution = (() => {
                        /* The DEFAULT profile the tower advertised. Absent
                           rather than guessed when it advertised none —
                           inventing 1080p here would be the fake reading this
                           app refuses everywhere else. */
                        const prof =
                          feed.profiles?.find((x) => x.default) ?? feed.profiles?.[0];
                        return prof?.resolution
                          ? `${prof.resolution.width} × ${prof.resolution.height}`
                          : "Not reported";
                      })();
                      return (
                        <li
                          key={feed.id}
                          className="flex flex-col gap-[12px] rounded-[12px] border border-line bg-card/40 p-[16px]"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-[12px]">
                            <div className="flex min-w-0 flex-col gap-[6px]">
                              <span className="break-words text-[0.9375rem] leading-[22px] text-body-ink">
                                {feed.name}
                              </span>
                              {/* THE DETAILS, read-only. No IP, no password, no
                                  network, recording or image settings — none are
                                  in this screen's vocabulary or the route's, so
                                  there is nothing here to get wrong. */}
                              <dl className="flex flex-wrap gap-x-[18px] gap-y-[2px] text-[0.75rem] leading-[16px]">
                                <Detail
                                  label="Status"
                                  value={
                                    feed.state === "live"
                                      ? "Online"
                                      : feed.state === "offline"
                                        ? "Offline"
                                        : "Not reported"
                                  }
                                />
                                <Detail label="Resolution" value={resolution} />
                                <Detail
                                  label="Lens"
                                  value={
                                    feed.lens === "ptz"
                                      ? "PTZ"
                                      : feed.lens === "fixed"
                                        ? "Fixed"
                                        : "Not reported"
                                  }
                                />
                                <Detail
                                  label="Control"
                                  value={feed.ptz ? "Pan, tilt, zoom" : "None"}
                                />
                                {/* ⚠ MODEL IS NOT AVAILABLE. No tower reports a
                                    camera make or model — it is not in
                                    `tower.hello`, so the projection has no field
                                    for it. Shown as not reported rather than
                                    omitted, so the gap is visible instead of
                                    looking like a field nobody thought of. */}
                                <Detail label="Model" value="Not reported" />
                              </dl>
                            </div>
                            {!editing && (
                              <button
                                type="button"
                                onClick={() => {
                                  setCamEditing(feed.id);
                                  setCamDraft((prev) => ({
                                    ...prev,
                                    [feed.id]: feed.label ?? "",
                                  }));
                                  setCamError(null);
                                  setCamSaved(null);
                                }}
                                className={SECONDARY}
                              >
                                Rename
                              </button>
                            )}
                          </div>

                          {camSaved === feed.id && !editing && !err && (
                            <p
                              role="status"
                              className="text-[0.8125rem] leading-[20px] text-terra"
                            >
                              Saved.
                            </p>
                          )}

                          {editing && (
                            <motion.div
                              initial={{ opacity: 0 }}
                              animate={{ opacity: 1 }}
                              transition={ENTER}
                              className="flex flex-col gap-[10px] border-t border-line pt-[12px]"
                            >
                              <Field
                                label="CAMERA NAME"
                                hint={`Leave it empty to go back to "CAMERA ${feed.index}".`}
                              >
                                <input
                                  value={draft}
                                  onChange={(e) => {
                                    setCamDraft((prev) => ({
                                      ...prev,
                                      [feed.id]: e.target.value,
                                    }));
                                    setCamError(null);
                                  }}
                                  onKeyDown={onEnter(() => !busy && void saveCamera(feed))}
                                  disabled={busy}
                                  autoFocus
                                  maxLength={80}
                                  autoCapitalize="none"
                                  autoCorrect="off"
                                  spellCheck={false}
                                  aria-label={`Name for camera ${feed.index}`}
                                  placeholder={`CAMERA ${feed.index}`}
                                  className={`${INPUT} ${err ? "ring-1 ring-critical" : ""}`}
                                />
                              </Field>
                              {err && (
                                <p
                                  role="alert"
                                  className="text-[0.8125rem] leading-[20px] text-critical"
                                >
                                  {err}
                                </p>
                              )}
                              <div className="flex gap-[10px]">
                                <button
                                  type="button"
                                  onClick={() => void saveCamera(feed)}
                                  disabled={busy}
                                  aria-busy={busy || undefined}
                                  className={PRIMARY}
                                >
                                  {busy ? "SAVING…" : "Save"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setCamEditing(null);
                                    setCamError(null);
                                    setCamDraft((prev) => {
                                      const { [feed.id]: _drop, ...rest } = prev;
                                      return rest;
                                    });
                                  }}
                                  disabled={busy}
                                  className={SECONDARY}
                                >
                                  Cancel
                                </button>
                              </div>
                            </motion.div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );

  const PANES: Record<SettingsSection, ReactNode> = {
    account: accountSection,
    security: securitySection,
    appearance: appearanceSection,
    cameras: camerasSection,
  };

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
              SETTINGS
            </span>
          </nav>
          <SiteClock />
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* ── THE SECTION LIST ──────────────────────────────────────────
              Real <a> links, not buttons, and each href is that section's own
              hash — so middle-click, right-click → copy link, and "open in new
              tab" all do what they look like they do. That is the point of
              making sections linkable at all; a <button> would have given the
              URL without the affordance. The plain left click is intercepted so
              the pane swaps without a navigation. */}
          <nav
            aria-label="Settings sections"
            className="hidden w-[232px] shrink-0 flex-col gap-[2px] border-r border-line p-[12px] sm:flex"
          >
            {SETTINGS_SECTIONS.map((id) => {
              const active = section === id;
              return (
                <a
                  key={id}
                  href={hashForSection(id)}
                  aria-current={active ? "page" : undefined}
                  onClick={(e) => {
                    /* A modified click belongs to the browser — new tab, copy
                       link. Only a plain left click is ours to handle. */
                    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
                    e.preventDefault();
                    onSectionChange?.(id);
                  }}
                  className={`rounded-[8px] px-[12px] py-[10px] text-[0.875rem] leading-[20px] transition-colors ${
                    active
                      ? "bg-card text-body-ink"
                      : "text-sub hover:bg-card-hover hover:text-body-ink"
                  }`}
                >
                  {SECTION_LABEL[id]}
                </a>
              );
            })}
          </nav>

          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* The same list as a scrolling row below `sm`, where a 232px
                column would take a third of the window. */}
            <div className="flex shrink-0 gap-[6px] overflow-x-auto border-b border-line px-[12px] py-[8px] sm:hidden">
              {SETTINGS_SECTIONS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-current={section === id ? "page" : undefined}
                  onClick={() => onSectionChange?.(id)}
                  className={`shrink-0 rounded-[8px] px-[12px] py-[8px] text-[0.8125rem] transition-colors ${
                    section === id ? "bg-card text-body-ink" : "text-sub hover:bg-card-hover"
                  }`}
                >
                  {SECTION_LABEL[id]}
                </button>
              ))}
            </div>

            <main className="min-h-0 flex-1 overflow-y-auto px-[16px] py-[24px] sm:px-[28px]">
              {/* KEYED ON THE SECTION, so switching REMOUNTS the pane. That is
                  what discards a half-typed password rather than parking it
                  behind a tab somebody returns to an hour later. */}
              <motion.div
                key={section}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={FADE}
                className="mx-auto w-full max-w-[720px]"
              >
                {PANES[section]}
              </motion.div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}
