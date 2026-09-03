import { motion, useIsPresent } from "motion/react";
import type { ReactNode } from "react";
import type { Alert, TimelineEvent } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { ENTER, EXIT } from "@/lib/motion";
import {
  SESSION_NOW,
  formatClock,
  formatDelta,
  formatDuration,
  formatEventTime,
  formatSiteDate,
  isSameSiteDay,
} from "@/lib/time";
import { ClipCard } from "./ClipCard";
import {
  MutationError,
  MutationIcon,
  MutationStatus,
  errorRing,
} from "./MutationFeedback";
import type { MutationPhase } from "@/lib/useMutation";

/**
 * One cell of the Alert Details grid.
 *
 * Fixed height, not intrinsic: the four cells form a 2×2 block and a taller
 * value in one of them would drag its neighbour's baseline out of line, which
 * is precisely the alignment the grid exists to provide. Long values truncate
 * with the full string on hover rather than reflowing the block.
 */
function DetailCell({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex h-[60px] min-w-0 flex-col justify-center gap-[2px] rounded-[8px] bg-panel px-[14px]">
      <span className="truncate text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted">
        {label}
      </span>
      <span className="truncate text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
        {value}
      </span>
    </div>
  );
}

/**
 * One timeline step: badge, title, timestamp, and any evidence captured at that
 * moment.
 *
 * The rail is a border on the text column, so its length is derived from that
 * column's real height — it cannot fall out of step when a title wraps or a
 * clip card is absent. The last step drops it: a line continuing past the final
 * badge promises an event that is not there.
 */
type Step = TimelineEvent & { delta: string };

function TimelineStep({
  event,
  first,
  last,
  alertId,
  onPlay,
}: {
  event: Step;
  first: boolean;
  last: boolean;
  alertId: string;
  onPlay: (at: number, attachment: NonNullable<Step["attachment"]>) => void;
}) {
  return (
    <li className="flex gap-[12px]">
      <div className="flex shrink-0 flex-col items-center">
        <img
          src={ALERT_BADGE[event.icon]}
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        {!last && <span className="w-px flex-1 bg-white/10" />}
      </div>

      <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-[16px]"}`}>
        <p className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          {event.title}
        </p>
        {/* Wall-clock, plus elapsed from the first step. The clock is what gets
            quoted on a handoff; the delta is what a column of clock times
            physically cannot show — when several steps land inside one minute
            their stamps look identical and the sequence stops being readable. */}
        <p className="mt-[2px] text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted tabular-nums">
          {formatClock(event.at)}
          {!first && <span className="text-white/25"> · {event.delta}</span>}
        </p>

        {event.attachment && (
          <div className="pt-[8px]">
            <ClipCard
              attachment={event.attachment}
              at={event.at}
              alertId={alertId}
              /* Audio has nothing to review, so it gets no player — the
                 glyph already says which of the two this row is. */
              onPlay={
                event.attachment.kind === "clip"
                  ? () => onPlay(event.at, event.attachment!)
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function AlertDetail({
  alert,
  onClose,
  onAcknowledge,
  onResolve,
  statusPhase = { kind: "idle" },
  onRetryStatus,
  onDismissStatus,
  onPlayClip,
  onWatchPerson,
  onRejectMatch,
}: {
  alert: Alert;
  onClose: () => void;
  onAcknowledge: () => void;
  onResolve: () => void;
  /**
   * What the acknowledge/resolve action is doing for THIS alert.
   *
   * ⚠ IT IS A PROP, NOT STATE, AND IT MUST STAY THAT WAY. This panel is never
   * remounted — the feed swaps its content in place so arrowing through alerts
   * stays instant — so a `useState` here would survive the swap and paint a
   * pending spinner, or a red failure, onto the NEXT alert. The shell keys this
   * by alert id and hands down only the phase for the one on screen.
   */
  statusPhase?: MutationPhase;
  onRetryStatus?: () => void;
  onDismissStatus?: () => void;
  /** Put the person in this detection on the watchlist. The face is already on
   *  screen here, which is the door this feature actually gets used through —
   *  uploading a file at a desk is the fallback, not the path. */
  onWatchPerson?: () => void;
  /** The operator says this is not the person. Keeps the detection, drops the
   *  identity: the camera did see somebody. A matcher is probabilistic and this
   *  is the only honest answer to a false positive. */
  onRejectMatch?: () => void;
  /** Hands the clip up to the panel, which owns the player. Deliberately not
   *  held here: this panel is never remounted — arrowing through the feed
   *  swaps its content in place — so a `useState` for the open clip would
   *  survive the swap and show one incident's footage under the next one's
   *  title. See the note in CLAUDE.md. */
  onPlayClip: (at: number, attachment: NonNullable<Step["attachment"]>) => void;
}) {
  const isPresent = useIsPresent();

  /* Sorted here rather than trusted from the seed: on a timeline, order *is*
     the information, and one step out of sequence silently inverts cause and
     effect. Falls back to the alert itself so the section is never blank. */
  const events = (
    alert.timeline ?? [{ at: alert.at, icon: alert.kind, title: alert.title }]
  )
    .slice()
    .sort((a, b) => a.at - b.at)
    .map((e, _i, all): Step => ({ ...e, delta: formatDelta(all[0].at, e.at) }));

  const detected = isSameSiteDay(alert.at, SESSION_NOW)
    ? formatClock(alert.at)
    : `${formatSiteDate(alert.at)}, ${formatClock(alert.at)}`;

  /* A short slide from the right edge, not a full panel width — the list is
     still conceptually behind this, so it should read as sliding over its own
     list rather than arriving from off-screen.

     `inert` while leaving: the panel stays mounted for the exit, and its
     controls must not be tabbable or clickable while it is on its way out. */
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, transition: EXIT }}
      transition={ENTER}
      inert={!isPresent}
      className="absolute inset-0 z-20 flex flex-col bg-ink"
    >
      {/* Both exits below lg, per the design: the chevron reads as "back to the
          list" and the X as "shut this", and on a phone the panel is the whole
          view so they land in the same place. They are labelled differently for
          AT so the redundancy is at least legible to a screen reader.
          At lg the chevron goes — there the panel is a drawer beside the wall,
          nothing was pushed, so "back" would name a journey that never
          happened. */}
      <header className="flex h-[46px] shrink-0 items-center gap-[4px] border-b border-line px-[16px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to alerts"
          className="mr-[8px] flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/8 hover:text-white lg:hidden"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path
              d="M10 3 5 8l5 5"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <img
          src={ALERT_BADGE[alert.kind]}
          alt=""
          width={16}
          height={16}
          className="shrink-0"
        />
        {/* Stable short ID before the human title — this is what gets read out
            over the radio during a handoff. */}
        <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-dim">
          {alert.id}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close alert detail"
          className="ml-auto flex size-[24px] items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[24px] overflow-y-auto px-[16px] pb-[16px] pt-[16px]">
        <section className="flex flex-col gap-[16px]">
          <div className="flex flex-col gap-[4px]">
            <h2 className="text-[1rem] leading-[20px] tracking-[0.16px] text-white">
              {alert.title}
            </h2>
            {/* Status, place, time — wall-clock rather than the frame's
                "18 seconds ago". A relative age goes stale on a panel an
                operator leaves open, and cannot be read aloud accurately on a
                handoff, which is the one thing this line is for. */}
            <p className="flex flex-wrap items-center gap-x-[6px] text-[0.875rem] leading-[20px] tracking-[0.14px]">
              <span
                className={
                  alert.status === "resolved"
                    ? "text-terra"
                    : alert.status === "acknowledged"
                      ? "text-warn"
                      : "text-critical"
                }
              >
                {alert.status[0].toUpperCase() + alert.status.slice(1)}
              </span>
              <span aria-hidden className="size-[2px] rounded-full bg-muted" />
              <span className="text-muted">{alert.zone}</span>
              <span aria-hidden className="size-[2px] rounded-full bg-muted" />
              <span className="text-muted tabular-nums">
                {formatEventTime(alert.at)}
              </span>
            </p>
          </div>

          {/* The triggering frame goes above every metadata row — an operator
              confirms with their eyes before they read anything. Aspect ratio
              rather than the frame's fixed 198px, so the panel can be any
              width and still show the designed proportion. */}
          <div className="relative aspect-[388/198] w-full overflow-hidden rounded-[12px] bg-panel">
            {alert.attachment ? (
              <>
                <img
                  src={alert.attachment.thumbnail}
                  alt={`Frame captured for ${alert.id}`}
                  className="absolute inset-0 size-full object-cover"
                />
                <button
                  type="button"
                  aria-label={`Play ${alert.attachment.title}`}
                  className="absolute inset-0 flex items-center justify-center bg-black/25 transition-colors hover:bg-black/10"
                >
                  <span className="chip-blur flex size-[44px] items-center justify-center rounded-full bg-black/55">
                    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                      <path d="M5 3.5 14 9l-9 5.5v-11Z" fill="white" />
                    </svg>
                  </span>
                </button>

                {/* Which camera and how long, burnt onto the frame. A still with
                    no label is evidence you cannot cite. After the button in the
                    DOM so they paint over its scrim, and inert so they never eat
                    the tap. */}
                <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] max-w-[calc(100%-16px)] truncate rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-white/85">
                  {alert.source}
                </span>
                {alert.attachment.durationSec !== undefined && (
                  <span className="chip-blur pointer-events-none absolute bottom-[8px] right-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-white/85 tabular-nums">
                    {formatDuration(alert.attachment.durationSec)}
                  </span>
                )}
              </>
            ) : (
              /* Absence is diagnostic, so it has to say *why*. "No clip
                 attached" under a dead camera reads as a missing file; the
                 truth is the feed was down, which is the more serious fact and
                 the one that changes what the operator does next. */
              <div className="flex size-full flex-col items-center justify-center gap-[3px] px-[16px] text-center">
                <p className="text-[0.75rem] text-white/40">
                  {alert.kind === "fault"
                    ? "No footage — feed was down"
                    : "No clip attached"}
                </p>
                <p className="text-[0.6875rem] text-white/25">
                  {alert.kind === "fault"
                    ? `${alert.source} stopped sending frames`
                    : `Raised by ${alert.source}, which has no camera`}
                </p>
              </div>
            )}
          </div>
        </section>

        <section className="flex flex-col gap-[8px]">
          <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
            Alert Details:
          </h3>
          {/* Two columns at every width. The panel is 417px at lg and full
              width below it, and at neither size does a 2×2 block of short
              key/value pairs need to collapse to one column. */}
          <div className="grid grid-cols-2 gap-[4px]">
            <DetailCell label="Source" value={alert.source} />
            <DetailCell label="Detected:" value={detected} />
            <DetailCell
              label={alert.cameras?.length === 1 ? "Camera" : "Cameras"}
              value={
                alert.cameras?.length ? (
                  alert.cameras.join(", ")
                ) : (
                  <span className="text-white/30">None</span>
                )
              }
            />
            <DetailCell
              label="AI Confidence:"
              value={
                alert.confidence !== undefined ? (
                  `${alert.confidence}%`
                ) : (
                  /* Blank, not "0%" or "N/A": a hardware fault and an operator
                     talk-down are decisions and events, not predictions, and a
                     number here would invent a machine judgement that was never
                     made. */
                  <span className="text-white/30">Not scored</span>
                )
              }
            />
          </div>
        </section>

        <section className="flex flex-col gap-[16px]">
          <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
            Timeline:
          </h3>
          <ol className="flex flex-col">
            {events.map((e, i) => (
              <TimelineStep
                key={`${e.at}-${e.title}`}
                event={e}
                first={i === 0}
                last={i === events.length - 1}
                alertId={alert.id}
                onPlay={onPlayClip}
              />
            ))}
          </ol>
        </section>
      </div>

      {/* The state machine lives on the primary button — you cannot resolve
          what you have not acknowledged, so that transition is never offered.
          Sits above the fixed view bar on mobile: the primary action must not
          be covered by navigation. */}
      <footer className="flex shrink-0 flex-col gap-[8px] border-t border-line px-[16px] pb-[calc(12px+env(safe-area-inset-bottom))] pt-[12px] mb-[56px] lg:mb-0">
        {/* Said where it happened, next to the button that did it. */}
        <MutationError
          phase={statusPhase}
          onRetry={onRetryStatus}
          onDismiss={onDismissStatus}
        />
        <MutationStatus
          phase={statusPhase}
          label={`${alert.status === "triggered" ? "Acknowledging" : "Resolving"} ${alert.id}`}
        />

        <div className="flex items-center gap-[8px]">
        {alert.status === "triggered" && (
          <button
            type="button"
            onClick={onAcknowledge}
            disabled={statusPhase.kind === "pending"}
            aria-busy={statusPhase.kind === "pending" || undefined}
            className={`flex h-[39px] flex-1 items-center justify-center gap-[8px] rounded-[8px] bg-white text-[0.8125rem] font-medium tracking-[0.13px] text-black transition-opacity hover:opacity-90 disabled:opacity-60 ${errorRing(statusPhase)}`}
          >
            <MutationIcon phase={statusPhase} idle={null} />
            Acknowledge
          </button>
        )}
        {alert.status === "acknowledged" && (
          <button
            type="button"
            onClick={onResolve}
            disabled={statusPhase.kind === "pending"}
            aria-busy={statusPhase.kind === "pending" || undefined}
            className={`flex h-[39px] flex-1 items-center justify-center gap-[8px] rounded-[8px] bg-terra text-[0.8125rem] font-medium tracking-[0.13px] text-black transition-opacity hover:opacity-90 disabled:opacity-60 ${errorRing(statusPhase)}`}
          >
            <MutationIcon phase={statusPhase} idle={null} />
            Resolve
          </button>
        )}
        {alert.status === "resolved" && (
          <p className="flex-1 text-[0.75rem] text-terra">
            Resolved by {alert.acknowledgedBy ?? "you"}
          </p>
        )}
        {/* A match is a possibility, so the flat contradiction sits beside the
            flat agreement. Without it the only way to answer a wrong match is
            to resolve an alert that never happened. */}
        {alert.matchedPersonId && !alert.matchRejected && (
          <button
            type="button"
            onClick={onRejectMatch}
            className="h-[39px] flex-1 rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-white transition-colors hover:bg-white/12"
          >
            Not them
          </button>
        )}
        {alert.kind === "person" && !alert.matchedPersonId && (
          <button
            type="button"
            onClick={onWatchPerson}
            className="h-[39px] flex-1 rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-white transition-colors hover:bg-white/12"
          >
            Add person
          </button>
        )}
        <button
          type="button"
          className="h-[39px] flex-1 rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-white transition-colors hover:bg-white/12"
        >
          Escalate
        </button>
        </div>
      </footer>
    </motion.div>
  );
}
