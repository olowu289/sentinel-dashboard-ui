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

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { SHARE_MESSAGE_MAX } from "@kallon/sentry-sdk";
import type { ReactNode } from "react";
import type { Share, ShareScopeEntry, Site } from "@kallon/sentry-sdk";
import { ENTER, FADE } from "@/lib/motion";
import {
  QUICK_DURATIONS,
  type DurationUnit,
  parseDuration,
  quickLabel,
  sayDuration,
  splitDuration,
} from "@/lib/durations";
import { inputClass } from "@/components/SitesPrimitives";
import {
  type ComposeState,
  type DecisionState,
  acceptOffer,
  answeringMeansChoosing,
  composeIsReady,
  composeToRequest,
  decisionToChoices,
  initialCompose,
  initialDecision,
} from "@/lib/shareRules";

/* Re-exported so the card and the page import their controls and their rules
   from one place. The rules themselves live in `lib/shareRules`, with no
   component around them, because that is what makes them testable. */
export {
  acceptOffer,
  answeringMeansChoosing,
  composeIsReady,
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
          /* ⚠ THE APP'S ON-STATE, NOT THE SHARE COLOUR. These controls sit
             inside a share card, and a blue switch in a card whose only
             colour is a 2px strip is the colour coming back in by the side
             door. White is "on" everywhere else in this product. */
          on ? "border-action bg-action/25" : "border-stroke bg-ink"
        }`}
      >
        <motion.span
          layout
          transition={ENTER}
          className={`block size-[12px] rounded-full ${
            on ? "ml-[15px] bg-action" : "ml-[2px] bg-muted"
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

/**
 * Four quick lengths, and a field for the one somebody actually means.
 *
 * ── WHY THE FIELD ──────────────────────────────────────────────────────
 *
 * Four buttons made every share 15 minutes, an hour, four hours or a day, and
 * real ones are "ten minutes while the truck turns round" and "until six". So
 * the buttons stay -- they are what gets pressed -- and anything else is typed,
 * in minutes or in hours, because 45 minutes and 3 hours are both things
 * people say and neither should need arithmetic.
 *
 * ── AND WHY IT IS CHECKED HERE AS WELL AS ON THE SERVER ────────────────
 *
 * The bounds are the server's (see `lib/durations`). Checking them where
 * somebody typed means the sentence appears under the field they are looking
 * at, instead of after a round trip and in a different part of the screen.
 * Nothing is decided here: the server refuses it either way.
 */
export function DurationPicker({
  value,
  onChange,
}: {
  /** Seconds. Zero or NaN means nothing has been chosen yet. */
  value: number;
  onChange: (sec: number) => void;
}) {
  /* The field opens on the current value only when it is NOT one of the quick
     ones, so pressing "1 hour" does not leave "60" sitting in the box
     contradicting the highlighted button. */
  const typed = value > 0 && quickLabel(value) === null;
  const opening = typed ? splitDuration(value) : { amount: "", unit: "minutes" as DurationUnit };
  const [amount, setAmount] = useState(opening.amount);
  const [unit, setUnit] = useState<DurationUnit>(opening.unit);
  const parsed = parseDuration(amount, unit);
  /* Typed RIGHT NOW, not "was typed when this opened": pressing a quick
     button after typing clears the box, and the summary goes with it. */
  const typedNow = quickLabel(value) === null;

  /* Typing commits as soon as what is typed is a valid length. No Apply
     button: this sits inside a form that already has one, and a second button
     that has to be pressed before the first one works is how somebody sends a
     share for a length they did not choose. */
  const retype = (nextAmount: string, nextUnit: DurationUnit) => {
    setAmount(nextAmount);
    setUnit(nextUnit);
    const next = parseDuration(nextAmount, nextUnit);
    if (next.sec !== null) onChange(next.sec);
  };

  return (
    <div className="flex flex-col gap-[6px]">
      <div role="radiogroup" aria-label="How long" className="flex flex-wrap gap-[6px]">
        {QUICK_DURATIONS.map((d) => {
          const on = d.sec === value;
          return (
            <button
              key={d.sec}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => {
                /* Clearing the field is part of pressing a button: the two
                   are one choice and only one of them can be the answer. */
                setAmount("");
                onChange(d.sec);
              }}
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

      <div className="flex flex-wrap items-center gap-[6px]">
        <span className="text-[0.75rem] text-muted">or</span>
        <input
          type="text"
          inputMode="numeric"
          aria-label="How long, a number"
          placeholder="10"
          value={amount}
          onChange={(e) => retype(e.target.value, unit)}
          className={`${inputClass} w-[64px] py-[5px] text-[0.75rem] tabular-nums`}
        />
        <select
          aria-label="Minutes or hours"
          value={unit}
          onChange={(e) => retype(amount, e.target.value as DurationUnit)}
          className={`${inputClass} w-auto py-[5px] text-[0.75rem]`}
        >
          <option value="minutes">minutes</option>
          <option value="hours">hours</option>
        </select>
        {/* WHAT IS ACTUALLY SET, in words -- for a TYPED value only.
            ⚠ It used to show for a pressed button too, which put "1 hour"
            next to the lit "1 hour" button saying the same thing, and in a
            narrow card the repeat wrapped into a column of two words beside
            the unit box. The buttons say it themselves; "2700" does not. */}
        {typedNow && value > 0 && !parsed.problem ? (
          <span className="whitespace-nowrap text-[0.75rem] text-muted">
            {sayDuration(value)}
          </span>
        ) : null}
      </div>

      {parsed.problem ? (
        <p className="text-[0.75rem] leading-[16px] text-critical" role="alert">
          {parsed.problem}
        </p>
      ) : null}
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

  const toggleCamera = (deviceId: string, camera: number, every: readonly number[]) => {
    const current = chosen.get(deviceId);
    /* ⚠ "ALL CAMERAS" IS AN EMPTY LIST, AND TOGGLING FROM IT MEANS
       REMOVING ONE. A tower picked with no camera list covers the whole mast,
       and every chip is drawn pressed to say so. Clicking a pressed chip
       therefore has to take that camera AWAY -- it used to start from an
       empty list and ADD it, so clicking "Cam 2" on a two-camera mast that
       showed "all cameras" shared camera 2 alone, which is the opposite of
       what was pressed. Found by a browser test narrowing a share to camera 1
       and getting camera 2. */
    const list = current && current.length > 0 ? [...current] : [...every];
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
                  on ? "border-action bg-action" : "border-stroke"
                }`}
              >
                {on ? (
                  <span className="size-[6px] rounded-[1px] bg-action-ink" />
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
                          onClick={() => toggleCamera(t.deviceId, c, t.cameras)}
                          className={`rounded-[4px] border px-[6px] py-[2px] text-[0.6875rem] transition-colors ${
                            picked
                              ? "border-action/60 text-body-ink"
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
 * What an OFFER says, read-only. No toggles and no choices.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY AN OFFER HAS NO FORM, AND WHAT HAPPENED WHEN IT DID
 * ══════════════════════════════════════════════════════════════════════
 *
 * An offer card used to mount `ShareDecision`, the same form a request card
 * mounts, with its tower picker fed by `useSiteTowers(share.owner_site_id)`.
 * That hook is called "the towers of one of MY sites", and for an offer the
 * owner site is THEIRS: the receiver is not a member of it and
 * `GET /v1/sites/{id}` answers `404 no such site` to them on purpose, because
 * a site id must not be probeable.
 *
 * So the card showed, in this order:
 *
 *   "1 camera on 1 tower - controls"      (correct, read from the scope)
 *   "They named no towers."               (the empty picker)
 *   "no such site"                        (the 404, in red)
 *
 * three statements about one share, two of them wrong, from one request that
 * should never have been made. The fix is not a better error message. It is
 * that whoever starts a share decides it: an offer arrives complete, the
 * receiver accepts or declines, and there is nothing here to choose.
 *
 * `scope` is on the wire for both sides of a share already, so this needs no
 * request at all -- which is the real tell that the old version was asking a
 * question it already had the answer to.
 */
export function OfferTerms({ share }: { share: Share }) {
  return (
    <dl className="flex flex-col gap-[8px]">
      <Term label="Cameras">
        {share.scope.length === 0 ? (
          /* An offer with no cameras cannot be created -- the server refuses
             one -- so this is a server that sent something impossible rather
             than an empty state to design for. Say so plainly. */
          <span className="text-muted">
            This offer names no cameras, which it should not be able to. Decline
            it and ask them to send it again.
          </span>
        ) : (
          <ul className="flex flex-col gap-[2px]">
            {share.scope.map((entry) => (
              <li key={entry.device_id} className="tabular-nums">
                {entry.device_id}
                <span className="text-muted">
                  {entry.cameras && entry.cameras.length > 0
                    ? ` - camera ${entry.cameras.join(", ")}`
                    : " - every camera"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Term>
      <Term label="Controls">
        {share.ptz ? "You can point the camera." : "View only."}
      </Term>
      <Term label="Playback">
        {share.playback
          ? share.playback_from && share.playback_to
            ? `Recorded footage, ${share.playback_from} to ${share.playback_to}.`
            : "Recorded footage."
          : "Live video only."}
      </Term>
      <Term label="For">
        {share.asked_duration_sec
          ? sayDuration(share.asked_duration_sec)
          : `until ${share.expires_at}`}
      </Term>
    </dl>
  );
}

function Term({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-[2px]">
      <dt className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted">
        {label}
      </dt>
      <dd className="text-[0.8125rem] leading-[18px] text-body-ink">{children}</dd>
    </div>
  );
}

/**
 * Towers, controls, playback, duration. The whole answer to a REQUEST, inline.
 *
 * ⚠ FOR A REQUEST ONLY. An offer is not answered with choices, it is
 * accepted or declined; see `OfferTerms` above for why, and for the three
 * contradictory sentences the mixed-up version put on one card.
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
  const asked = share.asked_duration_sec ?? null;
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
          emptyNote="This site has no towers to lend yet."
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
        {/* WHAT THEY ASKED FOR, SAID OUT LOUD, because the picker opens on it
            and an unlabelled pre-selected value reads as a default somebody
            else chose. The owner may answer with less or with more -- the
            server allows either, within its bounds -- and they can only mean
            to do that if they know what the number currently is. */}
        {asked ? (
          <p className="text-[0.75rem] text-muted">
            They asked for {sayDuration(asked)}. You decide what it is.
          </p>
        ) : null}
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
