/**
 * The choices somebody makes about a share, in one place.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THESE ARE COMPONENTS AND NOT TWO COPIES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The brief asks for the same decision in two places: inside a floating card
 * over the video, and on the Sharing page. "The same choices as the card" is
 * not a thing you can keep true by writing it twice -- the second copy gains a
 * duration option, or loses the playback window, and nobody notices until an
 * operator makes a choice in one place that is impossible in the other.
 *
 * So the card and the page mount THESE. `ShareDecision` is answering; `ShareCompose`
 * is starting. Everything they offer, both of them offer.
 *
 * ── THE DEFAULTS ARE NOT NEUTRAL ──────────────────────────────────────
 *
 * Fifteen minutes, live only, no controls, no playback. Every one of those is
 * the smallest thing somebody could mean, because this is a form about handing
 * over cameras and the cost of an unnoticed default is somebody else driving
 * your mast for a day. The person answering turns things ON deliberately.
 */

import { useEffect, useMemo, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { SHARE_MESSAGE_MAX } from "@kallon/sentry-sdk";
import type { Share, ShareScopeEntry, Site } from "@kallon/sentry-sdk";
import { ENTER, FADE } from "@/lib/motion";
import { inputClass } from "@/components/SitesPrimitives";
import {
  type ComposeState,
  type DecisionState,
  composeToRequest,
  decisionToChoices,
  initialCompose,
  initialDecision,
} from "@/lib/shareRules";

/* Re-exported so the card and the page import their controls and their rules
   from one place. The rules themselves live in `lib/shareRules`, with no
   component around them, because that is what makes them testable. */
export {
  composeToRequest,
  decisionToChoices,
  initialCompose,
  initialDecision,
  type ComposeState,
  type DecisionState,
};

/* ------------------------------------------------------------------ *
 * Small shared pieces
 * ------------------------------------------------------------------ */

/** A label, a switch, and one line saying what turning it on means. */
export function Allow({
  label,
  detail,
  on,
  onChange,
  disabled,
}: {
  label: string;
  detail: string;
  on: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      className={`flex items-start gap-[10px] ${disabled ? "opacity-40" : ""}`}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!on)}
        className={`mt-[2px] h-[18px] w-[30px] shrink-0 rounded-full border transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
          on ? "border-notify-share bg-notify-share/30" : "border-stroke bg-ink"
        }`}
      >
        <motion.span
          layout
          transition={ENTER}
          className={`block size-[12px] rounded-full ${
            on ? "ml-[15px] bg-notify-share" : "ml-[2px] bg-muted"
          }`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-[0.8125rem] text-body-ink">{label}</span>
        <span className="block text-[0.75rem] leading-[16px] text-muted">
          {detail}
        </span>
      </span>
    </label>
  );
}

/** Durations as buttons, because typing seconds is not a thing anybody wants. */
const DURATIONS: readonly { label: string; sec: number }[] = [
  { label: "15 min", sec: 15 * 60 },
  { label: "1 hour", sec: 60 * 60 },
  { label: "4 hours", sec: 4 * 60 * 60 },
  { label: "24 hours", sec: 24 * 60 * 60 },
];

export function DurationPicker({
  value,
  onChange,
}: {
  value: number;
  onChange: (sec: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="How long" className="flex flex-wrap gap-[6px]">
      {DURATIONS.map((d) => {
        const on = d.sec === value;
        return (
          <button
            key={d.sec}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(d.sec)}
            className={`rounded-[6px] border px-[9px] py-[4px] text-[0.75rem] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action ${
              on
                ? "border-action bg-action text-action-ink"
                : "border-stroke text-muted hover:text-body-ink"
            }`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

export interface PickableTower {
  readonly deviceId: string;
  readonly label: string;
  /** 1-based camera indexes. Empty means "we do not know what it has". */
  readonly cameras: readonly number[];
}

/**
 * Which towers, and which cameras on them.
 *
 * ⚠ A TOWER WITH NO CAMERA CHOSEN MEANS ALL OF THEM, and the summary says
 * so in words. The scope shape allows `{device_id}` with no `cameras`, which
 * is the honest way to say "this mast" rather than listing whatever it happens
 * to report today -- a camera added next week is then covered by what was
 * agreed, instead of silently excluded.
 */
export function TowerPicker({
  towers,
  value,
  onChange,
  loading,
  emptyNote,
}: {
  towers: readonly PickableTower[];
  value: readonly ShareScopeEntry[];
  onChange: (next: readonly ShareScopeEntry[]) => void;
  loading?: boolean;
  emptyNote: string;
}) {
  const chosen = useMemo(
    () => new Map(value.map((e) => [e.device_id, e.cameras ?? null])),
    [value],
  );

  const toggleTower = (deviceId: string) => {
    const next = value.filter((e) => e.device_id !== deviceId);
    if (!chosen.has(deviceId)) next.push({ device_id: deviceId });
    onChange(next);
  };

  const toggleCamera = (deviceId: string, camera: number) => {
    const current = chosen.get(deviceId);
    const list = current ? [...current] : [];
    const at = list.indexOf(camera);
    if (at >= 0) list.splice(at, 1);
    else list.push(camera);
    const next = value.filter((e) => e.device_id !== deviceId);
    next.push(
      list.length > 0
        ? { device_id: deviceId, cameras: list.sort((a, b) => a - b) }
        : { device_id: deviceId },
    );
    onChange(next);
  };

  if (loading) {
    return (
      <p className="text-[0.75rem] text-muted" aria-live="polite">
        Loading your towers...
      </p>
    );
  }
  if (towers.length === 0) {
    return <p className="text-[0.75rem] leading-[16px] text-muted">{emptyNote}</p>;
  }

  return (
    <ul className="flex max-h-[168px] flex-col gap-[2px] overflow-y-auto rounded-[8px] border border-stroke bg-ink p-[6px]">
      {towers.map((t) => {
        const on = chosen.has(t.deviceId);
        const cams = chosen.get(t.deviceId);
        return (
          <li key={t.deviceId}>
            <button
              type="button"
              aria-pressed={on}
              onClick={() => toggleTower(t.deviceId)}
              className="flex w-full items-center gap-[8px] rounded-[6px] px-[6px] py-[5px] text-left transition-colors hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-action"
            >
              <span
                aria-hidden
                className={`flex size-[14px] shrink-0 items-center justify-center rounded-[3px] border ${
                  on ? "border-notify-share bg-notify-share" : "border-stroke"
                }`}
              >
                {on ? (
                  <span className="size-[6px] rounded-[1px] bg-notify-share-ink" />
                ) : null}
              </span>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-body-ink">
                {t.label}
              </span>
              <span className="shrink-0 text-[0.6875rem] text-muted">
                {on
                  ? cams && cams.length > 0
                    ? `${cams.length} of ${t.cameras.length || "?"}`
                    : "all cameras"
                  : ""}
              </span>
            </button>
            <AnimatePresence initial={false}>
              {on && t.cameras.length > 1 ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={FADE}
                  className="overflow-hidden"
                >
                  <div className="flex flex-wrap gap-[4px] px-[28px] pb-[6px] pt-[2px]">
                    {t.cameras.map((c) => {
                      const picked = !cams || cams.length === 0 || cams.includes(c);
                      return (
                        <button
                          key={c}
                          type="button"
                          aria-pressed={picked}
                          onClick={() => toggleCamera(t.deviceId, c)}
                          className={`rounded-[4px] border px-[6px] py-[2px] text-[0.6875rem] transition-colors ${
                            picked
                              ? "border-notify-share/60 text-notify-share"
                              : "border-stroke text-muted"
                          }`}
                        >
                          Cam {c}
                        </button>
                      );
                    })}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The playback window.
 *
 * ⚠ ABSOLUTE, NEVER RELATIVE. "The last 24 hours" drifts as the share ages
 * and ends up meaning a day nobody agreed to; these are the hours somebody
 * actually meant. The server refuses playback without both ends, which is why
 * turning the switch on fills in a sensible pair rather than leaving a form
 * that cannot be submitted.
 */
export function PlaybackWindow({
  from,
  to,
  onChange,
}: {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      <input
        type="datetime-local"
        aria-label="Footage from"
        value={from}
        onChange={(e) => onChange(e.target.value, to)}
        className={`${inputClass} w-auto flex-1 py-[5px] text-[0.75rem]`}
      />
      <span className="text-[0.75rem] text-muted">to</span>
      <input
        type="datetime-local"
        aria-label="Footage to"
        value={to}
        onChange={(e) => onChange(from, e.target.value)}
        className={`${inputClass} w-auto flex-1 py-[5px] text-[0.75rem]`}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Answering: the shared body of the card and the page
 * ------------------------------------------------------------------ */

/**
 * Towers, controls, playback, duration. The whole answer, inline.
 *
 * Mounted by the floating card and by the Sharing page, which is what makes
 * "the same choices as the card" true rather than aspirational.
 */
export function ShareDecision({
  share,
  towers,
  loadingTowers,
  state,
  onChange,
  compact,
}: {
  share: Share;
  towers: readonly PickableTower[];
  loadingTowers?: boolean;
  state: DecisionState;
  onChange: (next: DecisionState) => void;
  /** In a card: tighter spacing, no section headings that repeat the title. */
  compact?: boolean;
}) {
  const gap = compact ? "gap-[10px]" : "gap-[14px]";
  return (
    <div className={`flex flex-col ${gap}`}>
      <div className="flex flex-col gap-[6px]">
        <p className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted">
          Towers
        </p>
        <TowerPicker
          towers={towers}
          loading={loadingTowers}
          value={state.scope}
          onChange={(scope) => onChange({ ...state, scope })}
          emptyNote={
            share.direction === "request"
              ? "This site has no towers to lend yet."
              : "They named no towers."
          }
        />
      </div>

      <Allow
        label="Controls"
        detail="They can point the camera. Your site always wins a contest for it."
        on={state.ptz}
        onChange={(ptz) => onChange({ ...state, ptz })}
      />

      <Allow
        label="Playback"
        detail="They can watch recorded footage from the window below."
        on={state.playback}
        onChange={(playback) => onChange({ ...state, playback })}
      />
      <AnimatePresence initial={false}>
        {state.playback ? (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={FADE}
            className="overflow-hidden"
          >
            <PlaybackWindow
              from={state.from}
              to={state.to}
              onChange={(from, to) => onChange({ ...state, from, to })}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-col gap-[6px]">
        <p className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted">
          For how long
        </p>
        <DurationPicker
          value={state.durationSec}
          onChange={(durationSec) => onChange({ ...state, durationSec })}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A message box that counts down rather than being refused
 * ------------------------------------------------------------------ */

export function MessageBox({
  value,
  onChange,
  required,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const left = SHARE_MESSAGE_MAX - value.length;
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className="flex flex-col gap-[4px]">
      <textarea
        ref={ref}
        rows={3}
        value={value}
        maxLength={SHARE_MESSAGE_MAX}
        required={required}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Message"
        className={`${inputClass} resize-none text-[0.8125rem]`}
      />
      <div className="flex items-baseline gap-[8px]">
        {required ? (
          <span className="text-[0.6875rem] text-muted">
            Required: it is all they have to decide on.
          </span>
        ) : (
          <span className="text-[0.6875rem] text-muted">Optional.</span>
        )}
        {/* The count appears only when it starts to matter. A counter at 500
            remaining is noise; a counter at 40 is the thing you need. */}
        {left < 80 ? (
          <span
            className={`ml-auto text-[0.6875rem] tabular-nums ${
              left < 0 ? "text-critical" : "text-muted"
            }`}
          >
            {left}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Starting one
 * ------------------------------------------------------------------ */

/** The site to ask, by NAME, because that is all anybody knows about it. */
export function SitePicker({
  sites,
  value,
  onChange,
  label = "Which site",
}: {
  sites: readonly Site[];
  value: string;
  onChange: (siteId: string) => void;
  label?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputClass} text-[0.8125rem]`}
    >
      <option value="">Choose a site...</option>
      {sites.map((s) => (
        <option key={s.site_id} value={s.site_id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}
