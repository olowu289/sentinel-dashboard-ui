import { motion } from "motion/react";
import { said } from "@/lib/said";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useSession } from "@/components/AuthProvider";
import { useCapabilities } from "@/lib/useSites";
import { isHubMode } from "@/lib/hubMode";
import { PatrolControl, type PatrolPhase } from "@/components/PatrolControl";
import { deviceName, nameMatches } from "@/lib/deviceName";
import { useCapitalName } from "@/lib/useCapitalName";
import { patrolWord, type PatrolEdit } from "@/lib/patrol";
import { IconRail } from "@/components/IconRail";
import { SharingPane } from "@/components/sharing/SharingPane";
import { SiteClock } from "@/components/SiteClock";
import {
  LabelRejectedError,
  NoAnswerError,
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
    return {
      field: err.field,
      /* Through `said` even here, and the reason is not distrust of the
         server: this arm carries whatever a validator wrote, and the one on
         the sharing cards is how `scope: must be a non-empty list of towers`
         reached a customer. A plain sentence passes through untouched. */
      message: said(err, "That could not be changed. Check it and try again."),
      tone: "critical",
    };
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
  return {
    field: "form",
    /* The console line and the reference come from `said`, which is where
       every unrecognised failure in the app now goes. */
    message: said(err, "Something went wrong. Please try again in a moment."),
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

const SECTION_LABEL: Record<SettingsSection, string> = {
  account: "Account",
  security: "Password & security",
  sharing: "Sharing",
  appearance: "Appearance",
  cameras: "Cameras",
};

/* ================================================================== *
 * The screen
 * ================================================================== */

/**
 * The sections a hub does not have.
 *
 * Named here rather than inline so the test can read the same list the screen
 * does, and so adding a sixth section is one decision about whether a hub has
 * it.
 */
const HUB_HIDES: ReadonlySet<SettingsSection> = new Set(["account", "sharing"]);

export function SettingsView({
  onNavigate,
  onBack,
  section = "account",
  onSectionChange,
  towers = [],
  feeds = [],
  onCameraRenamed,
  onSetPatrol,
  patrolPhase,
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
  /**
   * Change one camera's patrol, and what that save is doing.
   *
   * Owned by the shell, like the tower panel's copy, because the write goes
   * to coordination and the answer replaces the camera's own block. Absent
   * means no patrol controls on this screen at all -- which is what a share
   * holder gets, and what a caller that has not wired it yet gets.
   */
  onSetPatrol?: (feedId: string, edit: PatrolEdit) => void;
  patrolPhase?: (feedId: string) => PatrolPhase;
}) {
  const { account } = useSession();
  const caps = useCapabilities();
  /**
   * What this server is, and therefore which sections exist.
   *
   * ⚠ ACCOUNT AND SHARING BOTH GO ON A HUB, for two different reasons.
   * Sharing is between two sites over the internet and a hub has neither.
   * Account manages the ORGANIZATION's login, which is a thing Kallon Cloud
   * holds: the hub checks one company login and has no directory to rename
   * anybody in. Signing out is not on this page at all -- it is the rail's
   * own button -- so hiding Account here takes nothing away from somebody who
   * wants to leave the kiosk.
   */
  const hubMode = isHubMode(caps);
  const sections = useMemo(
    () => SETTINGS_SECTIONS.filter((id) => !(hubMode && HUB_HIDES.has(id))),
    [hubMode],
  );
  /* A hash pointing at a section this server does not have -- a bookmark from
     the cloud opened on a kiosk -- lands on the first one that exists rather
     than on an empty pane. */
  const shown = sections.includes(section) ? section : (sections[0] ?? "appearance");

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
  const [camDraft, setCamDraft] = useState<Record<string, string>>({});
  const [camSaving, setCamSaving] = useState<string | null>(null);
  const [camError, setCamError] = useState<{ id: string; message: string } | null>(
    null,
  );
  const [camSaved, setCamSaved] = useState<string | null>(null);
  /** What the search box holds. Filters towers AND cameras by name. */
  const [camQuery, setCamQuery] = useState("");
  /** Which tower is open. One at a time: a hundred open towers is the old screen. */
  const [camOpenTower, setCamOpenTower] = useState<string | null>(null);
  /** Which camera's side panel is open, by feed id. */
  const [camOpen, setCamOpen] = useState<string | null>(null);

  /**
   * The towers to list, with the cameras that match.
   *
   * ⚠ A TOWER MATCHES BY ITS OWN NAME *OR* BY ONE OF ITS CAMERAS', and when
   * it matched by a camera only that camera is listed. Searching "gate"
   * should not make you open North Gate and read past its other camera to
   * find the one called GATE.
   */
  const matches = useMemo(() => {
    const q = camQuery.trim();
    const of = (t: Tower) => feeds.filter((f) => f.towerId === t.id);
    if (q === "") return towers.map((tower) => ({ tower, cameras: of(tower) }));
    const out: { tower: Tower; cameras: CameraFeed[] }[] = [];
    for (const tower of towers) {
      /* ⚠ BOTH SIDES THROUGH THE SAME FUNCTION THE SCREEN DRAWS WITH, rather
         than lower-casing here. The names are shown in capitals; a search that
         folded them a third way would be a third opinion about what this
         camera is called, and the first one to disagree would be the one
         nobody could see. */
      const named = nameMatches(tower.site || tower.id, q);
      const mine = of(tower);
      const hits = mine.filter((f) => nameMatches(f.name, q));
      if (named) out.push({ tower, cameras: mine });
      else if (hits.length > 0) out.push({ tower, cameras: hits });
    }
    return out;
  }, [towers, feeds, camQuery]);

  /** The camera whose side panel is open, if it is still in the fleet. */
  const openFeed = useMemo(
    () => feeds.find((f) => f.id === camOpen) ?? null,
    [feeds, camOpen],
  );

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
      /* ⚠ CAPITALS GO UP THE WIRE, not just onto the screen. The box
         capitalises every keystroke, so this is belt and braces for a draft
         that arrived some other way — a paste, an autofill, a restored
         value. A name that displays in capitals and is stored in lower case
         is the bug this whole change exists to remove. */
      const next = deviceName(camDraft[feed.id] ?? "").trim();
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
        /* The SAME two errors the tower rename raises. A 404 means unknown
           tower, somebody else's tower, OR a disabled `settings` feature — the
           server does not distinguish them on purpose, so neither does this. */
        /* ⚠ EVERY BRANCH IS A SENTENCE WRITTEN HERE, never the error's own
           text and never anything built from an id. `said` is the backstop
           for the paths that do pass a message through; this one chooses. */
        const message =
          err instanceof LabelRejectedError
            ? err.message
            : err instanceof NoAnswerError
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
              {shownLogin || "-"}
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
                  ? "This starts or ends with a space, and the space counts."
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
                /* `off`, not `organization`. A manager filling the saved
                   organization name in here would pre-load the RENAME box with
                   the name you already have — a value nobody typed, in the one
                   control that changes what you sign in with. Chrome honours
                   `off` on non-password fields; it is passwords where it does
                   not, which is the next four notes. */
                autoComplete="off"
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
                /* ⚠ `new-password` ON A CURRENT-PASSWORD FIELD, DELIBERATELY.
                   Chrome ignores `autocomplete="off"` on password inputs by
                   design; `new-password` is the token it respects by NOT
                   offering a stored credential. Semantically wrong, and the
                   lesser wrong: a confirmation box pre-filled by the browser
                   confirms the browser, not the person. */
                autoComplete="new-password"
                /* ⚠ A PLAIN-TEXT HINT, NEVER A ROW OF DOTS. A dotted
                   placeholder in a password box is indistinguishable from a
                   filled one — the control renders real input as dots too — so
                   it reads as "a password is already in here" and people either
                   trust it or clear it before typing. Words cannot be mistaken
                   for a value. */
                placeholder="Enter your current password"
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
                /* `new-password` here too, for the reason above: this must be
                   typed, every time, by the person making the change. */
                autoComplete="new-password"
                placeholder="Enter your current password"
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
                /* The length comes from the SHARED constant, not a typed "12".
                   The hint, the field note and the server's refusal all have to
                   agree, and a hardcoded number here is the one that would be
                   left behind when the policy moves. */
                placeholder={`New password (at least ${PASSWORD_MIN_LEN} characters)`}
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
                placeholder="Type the new password again"
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
        lead="Remembered on this device, for you."
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
        Camera tiles stay dark in both themes.
      </p>
    </div>
  );

  /**
   * Settings → Cameras, built for a fleet rather than for a demo.
   *
   * ══════════════════════════════════════════════════════════════════
   *  WHAT A HUNDRED TOWERS BREAKS
   * ══════════════════════════════════════════════════════════════════
   *
   * It used to render every tower, every camera and every camera's full
   * detail block, expanded, in one column. On the three-tower fixture that
   * reads fine. On a real fleet it is two hundred cards, several thousand
   * words, and the camera somebody came here for is somewhere in the middle
   * of it. Nothing was wrong with any one card; there were simply too many.
   *
   * So: a search box, towers collapsed to one summary line each, and the
   * detail for ONE camera at a time in a side panel. The page now shows a
   * hundred lines instead of a hundred cards, and the thing a person came to
   * change is two clicks away rather than a scroll.
   *
   * ⚠ THE SUMMARY LINE IS THE WHOLE POINT OF COLLAPSING. A closed row that
   * says only a name has made somebody open it to learn anything, which is
   * the scroll back again. "2 cameras · 1 patrolling" answers the two
   * questions this screen exists for without opening anything.
   */
  const camerasSection = (
    <div className="flex flex-col gap-[20px]">
      <SectionHead
        title="Cameras"
        lead="Name each camera so it can be quoted on the radio."
      />

      {towers.length === 0 ? (
        /* HONEST ABSENCE, not a spinner and not an invented row. An account
           with no towers is a real state, and this screen is reachable before
           the first tower is claimed. */
        <Panel>
          <p className="text-[0.8125rem] leading-[20px] text-muted">
            No towers yet. Cameras appear once a tower is added.
          </p>
        </Panel>
      ) : (
        <>
          <label className="flex flex-col gap-[6px]">
            <span className="sr-only">Search towers and cameras</span>
            <input
              type="search"
              value={camQuery}
              onChange={(e) => setCamQuery(e.target.value)}
              placeholder="Search towers and cameras"
              autoComplete="off"
              className={INPUT}
            />
          </label>

          {matches.length === 0 ? (
            <Panel>
              <p className="text-[0.8125rem] leading-[20px] text-muted">
                Nothing matches that.
              </p>
            </Panel>
          ) : (
            <ul className="flex flex-col gap-[6px]">
              {matches.map(({ tower, cameras }) => {
                const open = camOpenTower === tower.id;
                const patrolling = cameras.filter((f) => f.patrol?.enabled).length;
                return (
                  <li
                    key={tower.id}
                    className="overflow-hidden rounded-[10px] border border-line bg-card/40"
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => setCamOpenTower(open ? null : tower.id)}
                      className="flex w-full items-center justify-between gap-[12px] px-[14px] py-[11px] text-left transition-colors hover:bg-card-hover"
                    >
                      <span className="min-w-0 truncate text-[0.875rem] leading-[20px] text-body-ink">
                        {deviceName(tower.site || tower.id)}
                      </span>
                      {/* ⚠ THE SUMMARY, AND NOT A COUNT OF "Not reported".
                          An offline tower says the one thing worth knowing and
                          stops: its camera list is whatever it last sent, and
                          counting that as fact would describe a site nobody
                          can currently see. */}
                      <span className="flex shrink-0 items-center gap-[6px] text-[0.75rem] leading-[16px] text-muted">
                        {tower.online === false ? (
                          <span className="text-critical">Offline</span>
                        ) : (
                          <>
                            <span>
                              {cameras.length === 1 ? "1 camera" : `${cameras.length} cameras`}
                            </span>
                            {patrolling > 0 && (
                              <>
                                <span aria-hidden>·</span>
                                <span>{patrolling} patrolling</span>
                              </>
                            )}
                          </>
                        )}
                        <Chevron open={open} />
                      </span>
                    </button>

                    {open && (
                      <ul className="flex flex-col border-t border-line">
                        {cameras.length === 0 ? (
                          <li className="px-[14px] py-[10px] text-[0.75rem] leading-[16px] text-muted">
                            {/* Offline, or never reported an inventory. Both
                                are facts; neither is "this tower has no
                                cameras". */}
                            This tower has not reported any cameras.
                          </li>
                        ) : (
                          cameras.map((feed) => (
                            <li key={feed.id}>
                              <button
                                type="button"
                                aria-current={camOpen === feed.id ? "true" : undefined}
                                onClick={() => setCamOpen(feed.id)}
                                className={`flex w-full items-center justify-between gap-[12px] px-[14px] py-[9px] text-left transition-colors hover:bg-card-hover ${
                                  camOpen === feed.id ? "bg-card-hover" : ""
                                }`}
                              >
                                <span className="min-w-0 truncate text-[0.8125rem] leading-[18px] text-body-ink">
                                  {deviceName(feed.name)}
                                </span>
                                <span className="flex shrink-0 items-center gap-[10px] text-[0.75rem] leading-[16px]">
                                  <span
                                    className={
                                      feed.state === "offline" ? "text-critical" : "text-muted"
                                    }
                                  >
                                    {feed.state === "live"
                                      ? "Online"
                                      : feed.state === "offline"
                                        ? "Offline"
                                        : "Not reported"}
                                  </span>
                                  {/* Absent on a fixed camera: no round to
                                      sweep, so no value to print. */}
                                  {feed.patrol && (
                                    <span className="text-muted">
                                      {patrolWord(feed.patrol)}
                                    </span>
                                  )}
                                </span>
                              </button>
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {openFeed && (
        <CameraPanel
          feed={openFeed}
          draft={camDraft[openFeed.id] ?? openFeed.label ?? ""}
          busy={camSaving === openFeed.id}
          error={camError?.id === openFeed.id ? camError.message : null}
          saved={camSaved === openFeed.id}
          onDraft={(v) => setCamDraft((prev) => ({ ...prev, [openFeed.id]: v }))}
          onRename={() => void saveCamera(openFeed)}
          onClose={() => setCamOpen(null)}
          {...(onSetPatrol
            ? {
                onSetPatrol: (edit: PatrolEdit) => onSetPatrol(openFeed.id, edit),
                patrolPhase: patrolPhase?.(openFeed.id) ?? { kind: "idle" as const },
              }
            : {})}
        />
      )}
    </div>
  );

  const PANES: Record<SettingsSection, ReactNode> = {
    account: accountSection,
    security: securitySection,
    /* THE HOME OF SHARING, and the only place a request can be STARTED: the
       floating cards are replies to something, and a first move has nothing
       to reply to. Both read the same feed, so answering in either is
       answering in both. */
    sharing: <SharingPane />,
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
            {sections.map((id) => {
              const active = shown === id;
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
              {sections.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-current={shown === id ? "page" : undefined}
                  onClick={() => onSectionChange?.(id)}
                  className={`shrink-0 rounded-[8px] px-[12px] py-[8px] text-[0.8125rem] transition-colors ${
                    shown === id ? "bg-card text-body-ink" : "text-sub hover:bg-card-hover"
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
                key={shown}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={FADE}
                className="mx-auto w-full max-w-[720px]"
              >
                {PANES[shown]}
              </motion.div>
            </main>
          </div>
        </div>
      </div>
    </div>
  );
}

/** The chevron a collapsed tower row turns. */
function Chevron({ open }: { open: boolean }) {
  return (
    <img
      src="/icons/chevron-right.svg"
      alt=""
      width={12}
      height={12}
      aria-hidden
      className={`block shrink-0 opacity-60 transition-transform ${open ? "rotate-90" : ""}`}
    />
  );
}

/**
 * One camera, opened from the list.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY A PANEL AND NOT AN EXPANDING CARD
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because the list is the thing a person is navigating. An expanding card
 * pushes every row below it down, so choosing a second camera means finding
 * where the first one went; on a fleet that is the scroll this screen was
 * rebuilt to remove. The panel sits beside the list on a wide screen and over
 * it on a phone, and the list does not move.
 *
 * ⚠ IT CARRIES RENAME AND PATROL AND NOTHING ELSE. The old card also listed
 * Status, Resolution, Lens, Control and a "Model: Not reported" row -- five
 * readings, four of them repeated from the line you clicked to get here and
 * one that has never been reported by anything. The line above carries the
 * status; this carries what you came to CHANGE.
 */
function CameraPanel({
  feed,
  draft,
  busy,
  error,
  saved,
  onDraft,
  onRename,
  onClose,
  onSetPatrol,
  patrolPhase,
}: {
  feed: CameraFeed;
  draft: string;
  busy: boolean;
  error: string | null;
  saved: boolean;
  onDraft: (value: string) => void;
  onRename: () => void;
  onClose: () => void;
  onSetPatrol?: (edit: PatrolEdit) => void;
  patrolPhase?: PatrolPhase;
}) {
  const capitals = useCapitalName(onDraft);
  return (
    <motion.aside
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      aria-label={`${deviceName(feed.name)} settings`}
      className="fixed inset-x-0 bottom-0 z-30 max-h-[80vh] overflow-y-auto rounded-t-[16px] border-t border-line bg-panel p-[18px] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[340px] sm:max-h-none sm:rounded-none sm:border-l sm:border-t-0"
    >
      <div className="flex items-start justify-between gap-[12px]">
        <h3 className="min-w-0 break-words text-[1rem] leading-[22px] text-body-ink">
          {deviceName(feed.name)}
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="shrink-0 rounded-[6px] px-[8px] py-[4px] text-[0.8125rem] text-muted transition-colors hover:bg-card-hover hover:text-body-ink"
        >
          Close
        </button>
      </div>

      <div className="mt-[16px] flex flex-col gap-[6px]">
        <span className="font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.1px] text-dim">
          Name
        </span>
        {/* ⚠ THE VALUE IS THE NAME, AND THE PLACEHOLDER IS THE FALLBACK.
            `draft` is the camera's own label, so a named camera shows its name
            here and an unnamed one shows `CAMERA 2` greyed out behind an empty
            box — the two are different facts and the box says which.
            `useCapitalName` capitalises as it is typed and puts the caret
            back where it was; there is no `uppercase` class, because a
            transform drawn over a lower-case value is exactly how the claim
            wizard came to register towers in lower case. */}
        <input
          ref={capitals.ref}
          value={draft}
          onChange={capitals.onChange}
          disabled={busy}
          placeholder={deviceName(feed.name)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className={INPUT}
        />
        {error && (
          <p role="alert" className="text-[0.75rem] leading-[16px] text-critical">
            {error}
          </p>
        )}
        {saved && !error && (
          <p role="status" className="text-[0.75rem] leading-[16px] text-terra">
            Saved
          </p>
        )}
        <button
          type="button"
          onClick={onRename}
          disabled={busy}
          aria-busy={busy || undefined}
          className={`mt-[2px] h-[32px] self-start rounded-[8px] px-[14px] text-[0.8125rem] font-medium transition-colors ${
            busy
              ? "cursor-not-allowed bg-card text-body-ink/30"
              : "bg-action text-action-ink hover:opacity-90"
          }`}
        >
          {busy ? "Saving…" : "Save name"}
        </button>
      </div>

      {/* The same control the tower and hub mast panels draw. A fixed camera
          carries no patrol block and gets nothing here. */}
      {feed.ptz && feed.patrol && onSetPatrol && (
        <div className="mt-[18px] border-t border-line pt-[16px]">
          <PatrolControl
            patrol={feed.patrol}
            cameraName={deviceName(feed.name ?? feed.id)}
            showName={false}
            phase={patrolPhase ?? { kind: "idle" }}
            onSave={onSetPatrol}
          />
        </div>
      )}
    </motion.aside>
  );
}
