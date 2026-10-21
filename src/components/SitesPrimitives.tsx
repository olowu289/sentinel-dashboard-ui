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

import { motion } from "motion/react";
import type { KeyboardEvent, ReactNode } from "react";
import { ENTER, FADE } from "@/lib/motion";
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
