/**
 * The pieces every sites screen is built from.
 *
 * ── COLOUR IS RESERVED, AND THESE SCREENS SPEND NONE OF IT ─────────────
 *
 * `CLAUDE.md`: green is live, amber is degraded or a detection, red is a fault.
 * Nothing else gets a hue, and selection and primary actions are white on
 * black. So an Administration area has no accent: a green "Save" on a
 * monitoring product reads as a signal about a site, not as a button.
 *
 * The one hue these screens do use is the existing **detect amber**, for a
 * share that is PENDING — the same claim amber always makes, *this needs you*,
 * and the same extension `PendingTowerCard` already makes for a tower whose
 * setup is unfinished. An active share is white text; a revoked or expired one
 * is muted. A share is never green, because green would say the cameras are
 * live rather than that the agreement is.
 *
 * ── THE THREE STATES ARE COMPONENTS, NOT CONVENTIONS ───────────────────
 *
 * `Loading`, `Failed` and `Empty` are here so no screen writes its own, and so
 * "absence is diagnostic" is the default rather than something to remember:
 * `Empty` takes a `why`, and there is no way to render it without one.
 */

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import { ENTER, FADE } from "@/lib/motion";
import { placePopover } from "@/lib/popover";
import { formatSiteStamp } from "@/lib/time";

/**
 * A wall-clock stamp as one string, in SITE time.
 *
 * `formatSiteStamp` returns `{date, time}` because most of this product draws
 * them in separate columns. These screens draw them inline in a sentence, so
 * the pair is joined here once rather than at nine call sites -- and joined
 * with the date first, because an audit row read aloud is "on the 4th at
 * 14:05", not the other way round.
 */
export function siteStampLine(at: number): string {
  if (!Number.isFinite(at)) return "an unknown time";
  const { date, time } = formatSiteStamp(at);
  return `${date} ${time}`;
}

/**
 * How long is left, for somebody deciding whether that is enough.
 *
 * NOT `formatDuration`, which is the timeline's delta formatter: it never rolls
 * minutes into hours, so a share with four hours on it read "expires in 239m
 * 59s" -- a number nobody can judge at a glance on a screen whose whole purpose
 * is "have I got long enough". This rounds DOWN to the unit that matters and
 * stops there, because a second figure of precision on a four hour window is
 * noise.
 */
export function timeLeft(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "expired";
  if (sec < 60) return "under a minute";
  const mins = Math.floor(sec / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (hours < 24) return rest ? `${hours}h ${rest}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const spare = hours % 24;
  return spare ? `${days}d ${spare}h` : `${days}d`;
}

/** A screen heading plus one line of what the screen is for. */
export function PaneHead({
  title,
  blurb,
  action,
}: {
  title: string;
  blurb: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-[12px]">
      <div className="flex flex-col gap-[6px]">
        <h2 className="font-display text-[1rem] leading-[22px] tracking-[0.16px] text-body-ink">
          {title}
        </h2>
        <p className="max-w-[560px] text-[0.8125rem] leading-[20px] text-sub/80">
          {blurb}
        </p>
      </div>
      {action}
    </div>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[16px] rounded-[12px] border border-line bg-card/40 p-[20px]">
      {children}
    </div>
  );
}

/**
 * A skeleton, not a spinner.
 *
 * A spinner says "something is happening"; a skeleton says "a list is coming
 * and it will be about this tall", which stops the screen jumping when it
 * arrives. `aria-busy` is on the region so a screen reader is told once rather
 * than reading three grey boxes.
 */
export function Loading({ rows = 3, label }: { rows?: number; label: string }) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label={label}
      className="flex flex-col gap-[8px]"
    >
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="h-[52px] animate-pulse rounded-[10px] border border-line bg-card/30"
        />
      ))}
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * A failure, with the reason and a way out.
 *
 * `role="alert"` so it is announced, and a Retry that is a real button: a
 * failure a keyboard user cannot clear is a dead screen.
 */
export function Failed({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-[12px] rounded-[12px] border border-critical/40 bg-card/40 p-[20px]"
    >
      <p className="text-[0.8125rem] leading-[20px] text-critical">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-[8px] border border-stroke px-[12px] py-[6px] text-[0.8125rem] text-body-ink transition-colors hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Nothing here, and WHY.
 *
 * `why` is required. "No sites" is a statement an operator cannot act on; "No
 * sites yet. Create one to group this organization's hubs." is.
 */
export function Empty({
  title,
  why,
  action,
}: {
  title: string;
  why: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      className="flex flex-col items-start gap-[12px] rounded-[12px] border border-dashed border-stroke/60 bg-card/20 p-[24px]"
    >
      <p className="font-display text-[0.9375rem] leading-[20px] text-body-ink">
        {title}
      </p>
      <p className="max-w-[460px] text-[0.8125rem] leading-[20px] text-muted">
        {why}
      </p>
      {action}
    </motion.div>
  );
}

/** The product's primary action: white on black, never a hue. */
export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className="rounded-[8px] bg-action px-[14px] py-[8px] font-display text-[0.8125rem] tracking-[0.12px] text-action-ink transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
    >
      {children}
    </button>
  );
}

export function QuietButton({
  children,
  onClick,
  disabled,
  danger,
  label,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  /** A revoke or a disable. Red is the product's fault colour and this is one. */
  danger?: boolean;
  /**
   * What a screen reader should say, when the visible word is not enough.
   * "Copy" beside a login is clear to somebody looking at the login and
   * ambiguous to somebody being read the page.
   */
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={
        "rounded-[8px] border px-[12px] py-[6px] text-[0.8125rem] transition-colors disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
        (danger
          ? "border-critical/50 text-critical hover:bg-critical/10"
          : "border-stroke text-body-ink hover:bg-card-hover")
      }
    >
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="flex flex-col gap-[8px]">
      <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
        {label}
      </span>
      {children}
      {hint ? (
        <span className="text-[0.75rem] leading-[16px] text-muted/80">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

export const inputClass =
  "w-full rounded-[8px] border border-stroke bg-ink px-[12px] py-[8px] text-[0.875rem] text-body-ink placeholder:text-muted/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-action";

/**
 * A share's status, as a word and the one hue these screens allow.
 *
 * Pending is detect amber: *this needs you*. Active is plain white, because an
 * active share is normal and a green pill would read as a camera being live.
 * Everything finished is muted.
 */
export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "pending"
      ? "border-detect/50 bg-detect-bg text-detect"
      : status === "active"
        ? "border-stroke text-body-ink"
        : "border-line text-muted";
  return (
    <span
      className={
        "rounded-full border px-[8px] py-[2px] font-mono text-[0.6875rem] uppercase tracking-[0.08em] " +
        tone
      }
    >
      {status}
    </span>
  );
}

/** What a share allows, as three words that are present or absent. */
export function Allowances({
  live,
  ptz,
  playback,
}: {
  live: boolean;
  ptz: boolean;
  playback: boolean;
}) {
  const items: string[] = [];
  if (live) items.push("live");
  if (ptz) items.push("PTZ");
  if (playback) items.push("playback");
  return (
    <span className="font-mono text-[0.6875rem] uppercase tracking-[0.08em] text-muted">
      {/* ABSENCE IS DIAGNOSTIC: a share that allows nothing says so, rather
          than rendering an empty gap that reads as "not loaded". */}
      {items.length ? items.join(" · ") : "nothing"}
    </span>
  );
}

/**
 * A row in a list of things, clickable or not.
 *
 * `onOpen` makes it a real button rather than a div with a click handler, so it
 * is in the tab order and answers Enter and Space without any extra code.
 */
export function Row({
  children,
  onOpen,
  selected,
}: {
  children: ReactNode;
  onOpen?: () => void;
  selected?: boolean;
}) {
  const base =
    "flex w-full flex-wrap items-center gap-x-[16px] gap-y-[6px] rounded-[10px] border px-[14px] py-[12px] text-left transition-colors " +
    (selected
      ? "border-stroke bg-card-lift"
      : "border-line bg-card/40 hover:bg-card-hover");
  if (!onOpen) return <div className={base}>{children}</div>;
  return (
    <motion.button
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      type="button"
      onClick={onOpen}
      aria-current={selected ? "true" : undefined}
      className={
        base +
        " focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      }
    >
      {children}
    </motion.button>
  );
}

/** Tabs that work with a keyboard: arrows move, and the panel is labelled. */
export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: readonly { id: string; label: string; count?: number }[];
  active: string;
  onChange: (id: string) => void;
}) {
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = tabs.findIndex((t) => t.id === active);
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(tabs[(i + 1) % tabs.length].id);
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(tabs[(i - 1 + tabs.length) % tabs.length].id);
    }
  };
  return (
    <div
      role="tablist"
      aria-label="Section"
      onKeyDown={onKeyDown}
      className="flex flex-wrap gap-[4px] border-b border-line"
    >
      {tabs.map((t) => {
        const on = t.id === active;
        return (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={on}
            aria-controls={`pane-${t.id}`}
            id={`tab-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={
              "-mb-px border-b-2 px-[12px] py-[10px] font-display text-[0.8125rem] tracking-[0.12px] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action " +
              (on
                ? "border-action text-body-ink"
                : "border-transparent text-muted hover:text-sub")
            }
          >
            {t.label}
            {t.count !== undefined ? (
              <span className="ml-[6px] font-mono text-[0.6875rem] text-muted">
                {t.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════
    THE SHARED CONTROLS: ONE OVERFLOW MENU, ONE SIDE PANEL, ONE CONFIRM
   ══════════════════════════════════════════════════════════════════════

   Sites, People and Shares each grew their own answer to "where do the
   actions go". People had six buttons in a row that wrapped onto three lines
   on a laptop; Sites had buttons inside buttons; Shares had a chip row. Three
   screens in one area, three vocabularies, and the destructive action sitting
   next to the harmless one in all three.

   So: ONE overflow menu for a row's actions, ONE side panel for anything that
   needs a form, ONE confirmation dialog for anything that cannot be undone,
   and red only inside that dialog. Somebody who has used one of these screens
   has used all three. */

/**
 * The three-dot menu for a row's actions.
 *
 * ⚠ A PORTAL, AND THAT IS NOT CAUTION. `position: fixed` resolves against the
 * viewport only while no ancestor establishes a containing block, and this app
 * animates with `motion`, which sets `transform` on what it animates. A menu
 * rendered inside an animated row draws clipped INSIDE THE ROW — the exact bug
 * `SignOutConfirm` documents. `placePopover` then keeps it on screen.
 */
export function OverflowMenu({
  label,
  items,
}: {
  /** What this menu is about, for a screen reader: "Actions for guest2". */
  label: string;
  items: readonly {
    readonly label: string;
    readonly onSelect: () => void;
    /** Shown muted and unclickable, with the reason as its title. */
    readonly disabled?: boolean;
    readonly why?: string;
    /** A destructive action. Still not red HERE: red lives in the confirm. */
    readonly danger?: boolean;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const button = useRef<HTMLButtonElement | null>(null);

  const place = useCallback(() => {
    const el = button.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAt(
      placePopover({
        anchor: { top: r.top, left: r.left, right: r.right, bottom: r.bottom },
        width: 220,
        height: Math.min(items.length * 40 + 12, 320),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [items.length]);

  useEffect(() => {
    if (!open) return;
    place();
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onAway = () => setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    /* `click`, not `mousedown`: a mousedown listener closes the menu before the
       item's own click lands, so every action needed two presses. */
    window.addEventListener("click", onAway);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("click", onAway);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[8px] border border-line text-muted transition-colors hover:border-stroke hover:text-body-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        <span aria-hidden="true" className="text-[1rem] leading-none">
          &#8943;
        </span>
      </button>
      {open && at
        ? createPortal(
            <div
              role="menu"
              aria-label={label}
              onClick={(e) => e.stopPropagation()}
              style={{ top: at.top, left: at.left, width: 220 }}
              className="fixed z-[60] flex flex-col gap-[2px] rounded-[10px] border border-stroke bg-panel p-[6px] shadow-xl"
            >
              {items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  title={item.disabled ? item.why : undefined}
                  onClick={() => {
                    setOpen(false);
                    item.onSelect();
                  }}
                  className={
                    "rounded-[6px] px-[10px] py-[8px] text-left text-[0.8125rem] transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
                    (item.danger
                      ? "text-body-ink hover:bg-critical/12"
                      : "text-body-ink hover:bg-card-hover")
                  }
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/**
 * A right-hand panel for anything that needs a form.
 *
 * The list behind it stays visible, because the list is what says whether the
 * change landed — the same reasoning `AddDeviceDrawer` is built on, and the
 * same shape, so the two do not read as different products.
 */
export function SidePanel({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={FADE}
            className="fixed inset-0 z-40 cursor-default bg-ink/60"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: 24, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 24, opacity: 0 }}
            transition={ENTER}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[min(26rem,100vw)] flex-col border-l border-stroke bg-panel"
          >
            <div className="flex items-start justify-between gap-[12px] border-b border-line p-[20px]">
              <h2 className="font-display text-[1rem] tracking-[0.2px] text-body-ink">
                {title}
              </h2>
              <QuietButton onClick={onClose}>Close</QuietButton>
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto p-[20px]">
              {children}
            </div>
            {footer ? (
              <div className="flex flex-wrap items-center gap-[8px] border-t border-line p-[20px]">
                {footer}
              </div>
            ) : null}
          </motion.div>
        </>
      ) : null}
    </AnimatePresence>
  );
}

/**
 * "Remove guest2?" — the one place red is spent.
 *
 * NAMES THE THING, every time. A dialog that says "Are you sure?" is one
 * somebody confirms without reading; one that says "Remove guest2 from Terra
 * Industries?" is one they can check.
 */
export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}: {
  open: boolean;
  title: string;
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-ink/70 p-[20px]">
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={ENTER}
        className="flex w-full max-w-[420px] flex-col gap-[12px] rounded-[12px] border border-stroke bg-panel p-[20px]"
      >
        <h2 className="font-display text-[1rem] tracking-[0.2px] text-body-ink">
          {title}
        </h2>
        <p className="text-[0.8125rem] leading-[20px] text-sub">{consequence}</p>
        <div className="mt-[4px] flex flex-wrap items-center justify-end gap-[8px]">
          <QuietButton onClick={onCancel}>Cancel</QuietButton>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="h-[34px] rounded-[8px] border border-critical/60 bg-critical/12 px-[14px] text-[0.8125rem] font-medium text-critical transition-colors hover:bg-critical/20 disabled:opacity-50"
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}

/**
 * A searchable list of checkboxes with a select-all: site membership, mostly.
 *
 * ⚠ IT REPLACED A ROW OF CHIPS, and not for looks. The chips were one button
 * per site, so an organization with nine sites gave every person a nine-button
 * row that wrapped over three lines, with the current state readable only by
 * colour. A checkbox says what it is, a search box makes nine or ninety the
 * same amount of work, and "Every site" is one press instead of nine.
 */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  allLabel = "Every site",
  searchLabel = "Search",
}: {
  label: string;
  options: readonly { readonly id: string; readonly name: string }[];
  selected: readonly string[];
  onChange: (next: string[]) => void;
  allLabel?: string;
  searchLabel?: string;
}) {
  const [query, setQuery] = useState("");
  const shown = options.filter((o) =>
    o.name.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const all = options.length > 0 && selected.length === options.length;
  return (
    <div className="flex flex-col gap-[8px]">
      <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
        {label}
      </span>
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={searchLabel}
        aria-label={searchLabel}
        className={inputClass}
      />
      <label className="flex items-center gap-[8px] rounded-[8px] border border-line px-[10px] py-[8px] text-[0.8125rem] text-body-ink">
        <input
          type="checkbox"
          checked={all}
          aria-label={allLabel}
          onChange={() => onChange(all ? [] : options.map((o) => o.id))}
          className="h-[14px] w-[14px] accent-action"
        />
        {allLabel}
      </label>
      <div className="flex max-h-[240px] flex-col gap-[2px] overflow-y-auto">
        {shown.length === 0 ? (
          <p className="px-[10px] py-[8px] text-[0.8125rem] text-muted">
            Nothing matches that search.
          </p>
        ) : (
          shown.map((o) => {
            const on = selected.includes(o.id);
            return (
              <label
                key={o.id}
                className="flex items-center gap-[8px] rounded-[8px] px-[10px] py-[8px] text-[0.8125rem] text-body-ink transition-colors hover:bg-card-hover"
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    onChange(
                      on ? selected.filter((s) => s !== o.id) : [...selected, o.id],
                    )
                  }
                  className="h-[14px] w-[14px] accent-action"
                />
                {o.name}
              </label>
            );
          })
        )}
      </div>
    </div>
  );
}

/**
 * A login, monospaced, with a button that copies it.
 *
 * ⚠ IT FALLS BACK RATHER THAN FAILING SILENTLY. `navigator.clipboard` needs a
 * secure context, and a hub's LAN dashboard is served over plain HTTP to a
 * browser that will refuse it. When it refuses, the button says to select it
 * instead — the text beside it is `select-all`, which is why that is a
 * complete answer and not an apology.
 */
export function CopyableLogin({ login }: { login: string }) {
  const [state, setState] = useState<"idle" | "copied" | "manual">("idle");
  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(login);
        setState("copied");
        setTimeout(() => setState("idle"), 2_000);
      } catch {
        setState("manual");
      }
    })();
  }, [login]);
  return (
    <span className="flex min-w-0 items-center gap-[6px]">
      <code
        data-login={login}
        className="select-all truncate rounded-[6px] bg-ink/40 px-[6px] py-[2px] font-mono text-[0.75rem] text-sub"
      >
        {login}
      </code>
      {/* ⚠ QUIETER THAN A BUTTON. This sits on every row of the People
          list, and as a bordered `QuietButton` six of them were the loudest
          thing on the screen -- louder than "Add a person", which is the one
          action somebody came to press. A copy control is a convenience; it
          should be findable and never compete. */}
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy the login ${login}`}
        className="shrink-0 rounded-[4px] px-[4px] py-[1px] text-[0.6875rem] text-muted underline decoration-dotted underline-offset-2 transition-colors hover:text-body-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
      >
        {state === "copied" ? "Copied" : state === "manual" ? "Select it" : "Copy"}
      </button>
    </span>
  );
}
