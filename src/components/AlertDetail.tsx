import { motion, useIsPresent } from "motion/react";
import { useCallback } from "react";
import type { ReactNode } from "react";
import type { Alert, AlertAttachment, TimelineEvent } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import {
  alertColour,
  recoveryDetail,
  recoveryProgress,
  shortAlertId,
  type CameraNameOf,
  type NameOf,
} from "@/lib/alertCopy";
import { alertStory, type AlertPane } from "@/lib/alertStory";
import { useClipHealth } from "@/lib/useClipHealth";
import { AlertClips } from "./AlertClips";
import { deviceName } from "@/lib/deviceName";
import { ENTER, EXIT } from "@/lib/motion";
import {
  siteNow,
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
      <span className="truncate text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
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
        {!last && <span className="w-px flex-1 bg-overlay/10" />}
      </div>

      <div className={`min-w-0 flex-1 ${last ? "pb-0" : "pb-[16px]"}`}>
        <p className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
          {event.title}
        </p>
        {/* Wall-clock, plus elapsed from the first step. The clock is what gets
            quoted on a handoff; the delta is what a column of clock times
            physically cannot show — when several steps land inside one minute
            their stamps look identical and the sequence stops being readable. */}
        <p className="mt-[2px] text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted tabular-nums">
          {formatClock(event.at)}
          {!first && <span className="text-body-ink/25"> · {event.delta}</span>}
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
  nameOf,
  cameraNameOf,
  onRefresh,
  onClose,
  onAcknowledge,
  onResolve,
  statusPhase = { kind: "idle" },
  onRetryStatus,
  onDismissStatus,
  rejectPhase = { kind: "idle" },
  onRetryReject,
  onPlayClip,
  onWatchPerson,
  onRejectMatch,
}: {
  alert: Alert;
  /* ⚠ NO `towerName`. It was here to label the clip panes, and the panes
     are labelled by CAMERA now — which is the only label that distinguishes
     two of them side by side. The player's breadcrumb still names the site,
     and the panel that owns the player passes it there directly. */
  /** Names a tower, for the timeline's first step. */
  nameOf?: NameOf;
  /**
   * Names a camera, for the panes, the cells and the timeline.
   *
   * ⚠ THE CUSTOMER'S NAME, NOT THE `CAMERA 2` FALLBACK — see `CameraNameOf`.
   * The lab read "CAMERA 1 camera stopped working" off a mast whose cameras
   * are called NORTH GATE and YARD, which is both the wrong name and the
   * word doubled.
   */
  cameraNameOf?: CameraNameOf;
  /**
   * Re-read this alert for fresh clip URLs, after an expired ticket.
   *
   * Handed down rather than called here, because the FEED is what must end up
   * holding the new URLs — a copy fetched into this panel would be dropped
   * the moment the row re-rendered from the store, and the operator would be
   * back on a dead link.
   */
  onRefresh?: (id: string) => Promise<void>;
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
  /** "Not them" — deliberate, and keyed by alert id like everything else here. */
  rejectPhase?: MutationPhase;
  onRetryReject?: () => void;
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
  onPlayClip: (
    at: number,
    attachment: NonNullable<Step["attachment"]>,
    /** The other cameras that saw the same moment. One transport, two panes. */
    companions?: AlertAttachment[],
    /** Which camera is leading, so the panel can re-derive on an update. */
    camera?: number,
  ) => void;
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

  /* Read fresh on every render rather than captured. An alert raised at 23:50
     is "today" until midnight and dated after it, and this panel can easily be
     on screen across that boundary. */
  const detected = isSameSiteDay(alert.at, siteNow())
    ? formatClock(alert.at)
    : `${formatSiteDate(alert.at)}, ${formatClock(alert.at)}`;

  /* Hoisted so the hero's play button can close over it. Narrowing on
     `alert.attachment` does not survive into a callback, and the alternative is
     a non-null assertion on the one line where being wrong shows an operator
     the wrong incident's footage. */
  const hero = alert.attachment;

  /* THE SERVER'S OWN ALERT, when this row came from coordination. Everything
     below that a fixture has no shape for is read off here rather than copied
     onto the app's `Alert`: the clips (whose URLs must never be stored), the
     progress block, `recovered_at`, and the colour the hub chose. */
  const server = alert.site;
  const tone = server ? alertColour(server.colour) : null;
  const recovering = server ? recoveryDetail(server) : undefined;
  const recoveryPct = server ? recoveryProgress(server) : undefined;
  /* When the condition ended, which is NOT when somebody acknowledged it. A
     camera coming back writes `recovered_at` onto the same row, so one alert
     can carry both facts and they belong to different actors. */
  const recoveredAt = server?.recovered_at ? Date.parse(server.recovered_at) : null;
  /* The sequence, and the moment every delta is measured from. Built on each
     render rather than memoised: it is five objects, and a stale one would
     show the wrong elapsed time, which is the only number on it that matters. */
  const noRefresh = useCallback(async () => {}, []);
  const clips = useClipHealth(alert.id, onRefresh ?? noRefresh);
  const story = server ? alertStory(server, nameOf, cameraNameOf) : [];
  const firstStamp = story.find((step) => step.at !== null)?.at ?? null;

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
      data-alert-detail
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
          className="mr-[8px] flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-body-ink/50 transition-colors hover:bg-overlay/8 hover:text-body-ink lg:hidden"
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
            over the radio during a handoff.

            ⚠ SHORTENED FOR A SERVER ALERT, AND NOT FOR A FIXTURE. A fixture's
            id IS `ALT-8842`; coordination's is a 32-character hex string, and
            `95ae76a8085641718fc1a64cbda85280` shipped here — unreadable aloud,
            uncomparable by eye, and overflowing the line. The full id is one
            press away on the clipboard, which is where the one reader who
            needs it (us, in a log) can get it. */}
        {server ? (
          <button
            type="button"
            data-alert-id
            title={`${alert.id} · copy`}
            aria-label={`Alert ${shortAlertId(alert.id)}. Copy the full reference.`}
            onClick={() => {
              void navigator.clipboard?.writeText(alert.id).catch(() => {});
            }}
            className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-dim transition-colors hover:text-body-ink"
          >
            {shortAlertId(alert.id)}
          </button>
        ) : (
          <span className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-dim">
            {alert.id}
          </span>
        )}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close alert detail"
          className="ml-auto flex size-[24px] items-center justify-center rounded-[4px] text-body-ink/50 transition-colors hover:bg-overlay/8 hover:text-body-ink"
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
            <h2 className="text-[1rem] leading-[20px] tracking-[0.16px] text-body-ink">
              {alert.title}
            </h2>
            {/* Status, place, time — wall-clock rather than the frame's
                "18 seconds ago". A relative age goes stale on a panel an
                operator leaves open, and cannot be read aloud accurately on a
                handoff, which is the one thing this line is for. */}
            <p className="flex flex-wrap items-center gap-x-[6px] text-[0.875rem] leading-[20px] tracking-[0.14px]">
              {/* ⚠ TWO DIFFERENT COLOURS, FOR TWO DIFFERENT QUESTIONS, AND
                  THE SERVER OWNS ONE OF THEM. A fixture's word is coloured by
                  its own triage state, which is this app's judgement and is
                  fine. A server alert's is coloured by the hub's `colour` —
                  how bad the SITE is — because that is the judgement the hub
                  made and sent, and it is the one the operator needs before
                  they need to know whether somebody has clicked a button. */}
              <span
                className={
                  tone
                    ? tone.text
                    : alert.status === "resolved"
                      ? "text-terra"
                      : alert.status === "acknowledged"
                        ? "text-warn"
                        : "text-critical"
                }
              >
                {server
                  ? server.acknowledged
                    ? "Noticed"
                    : "Not acknowledged"
                  : alert.status[0].toUpperCase() + alert.status.slice(1)}
              </span>
              {/* The separator goes with the thing it separates. A zone is a
                  detection's, and a stray dot with nothing after it is the
                  shape of a value that failed to load. */}
              {alert.zone ? (
                <>
                  <span aria-hidden className="size-[2px] rounded-full bg-muted" />
                  <span className="text-muted">{alert.zone}</span>
                </>
              ) : null}
              <span aria-hidden className="size-[2px] rounded-full bg-muted" />
              <span className="text-muted tabular-nums">
                {formatEventTime(alert.at)}
              </span>
            </p>
          </div>

          {/* THE EVIDENCE GOES ABOVE EVERY METADATA ROW. An operator confirms
              with their eyes before they read anything, which is why this is
              the first thing in the panel and why it is not a thumbnail with a
              play button over it. */}
          {server ? (
            /* ⚠ KEYED ON THE ALERT ID, AND THIS PANEL IS WHY. `AlertsPanel`
               renders `AlertDetail` without a key so arrowing through the feed
               swaps its content in place and bulk triage stays instant — so
               every piece of state inside the player (the position, a fetched
               fresh URL, "Clip no longer kept") would survive the swap and
               appear against the NEXT alert. Key the subtree that owns the
               state, not the panel: the rule CLAUDE.md states, applied at the
               one place in this round that needed it. */
            <AlertClips
              alert={server}
              cameraNameOf={cameraNameOf}
              evicted={clips.evicted}
              onClipError={clips.report}
              onPlay={(pane: AlertPane, companions) =>
                /* The clip's OWN start, not the alert's: the cut begins a
                   minute before the event, and the player's wall-clock
                   readout is only quotable if it is anchored to the footage
                   rather than to the row. */
                onPlayClip(
                  (pane.clip.start_epoch ?? server.started_epoch) * 1000,
                  pane.attachment,
                  companions,
                  pane.clip.camera,
                )
              }
            />
          ) : (
          <div className="relative aspect-[388/198] w-full overflow-hidden rounded-[12px] bg-panel">
            {hero ? (
              <>
                <img
                  src={hero.thumbnail}
                  alt={`Frame captured for ${alert.id}`}
                  className="absolute inset-0 size-full object-cover"
                />
                {/* The hero had a label and no handler: it looked like the
                    play button the timeline's clip cards below it are, and did
                    nothing. It now hands the same pair up to the same panel —
                    this frame IS the alert's own attachment, so the moment to
                    open at is the alert's own timestamp. */}
                <button
                  type="button"
                  aria-label={`Play ${hero.title}`}
                  onClick={() => onPlayClip(alert.at, hero)}
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
                {alert.source && (
                  <span className="chip-blur pointer-events-none absolute left-[8px] top-[8px] max-w-[calc(100%-16px)] truncate rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-body-ink/85">
                    {alert.source}
                  </span>
                )}
                {hero.durationSec !== undefined && (
                  <span className="chip-blur pointer-events-none absolute bottom-[8px] right-[8px] rounded-[3px] bg-black/55 px-[6px] py-[2px] font-display text-[0.625rem] leading-[14px] text-body-ink/85 tabular-nums">
                    {formatDuration(hero.durationSec)}
                  </span>
                )}
              </>
            ) : (
              /* Absence is diagnostic, so it has to say *why*. "No clip
                 attached" under a dead camera reads as a missing file; the
                 truth is the feed was down, which is the more serious fact and
                 the one that changes what the operator does next. */
              <div className="flex size-full flex-col items-center justify-center gap-[3px] px-[16px] text-center">
                <p className="text-[0.75rem] text-body-ink/40">
                  {alert.kind === "fault"
                    ? "No footage, the feed was down"
                    : "No clip attached"}
                </p>
                <p className="text-[0.6875rem] text-body-ink/25">
                  {alert.kind === "fault"
                    ? `${alert.source ?? "This camera"} stopped sending frames`
                    : `Raised by ${alert.source ?? "nothing with a camera"}`}
                </p>
              </div>
            )}
          </div>
          )}

          {/* HOW MUCH FOOTAGE IS STILL COMING. The recovery pair has no clip
              to cut (§9: there is no moment to cut around) and this is what
              stands in its place — a quantity and an end in sight, moving as
              the hub re-reports on every footage report. */}
          {recovering || recoveryPct !== undefined ? (
            <div className="flex flex-col gap-[6px]" data-recovery>
              {recovering && (
                <p className="text-[0.8125rem] leading-[18px] text-muted tabular-nums">
                  {recovering}
                </p>
              )}
              {recoveryPct !== undefined && (
                <span
                  aria-hidden
                  className="h-[4px] w-full overflow-hidden rounded-full bg-overlay/10"
                >
                  <span
                    className={`block h-full rounded-full ${tone?.strip ?? "bg-muted"}`}
                    style={{ width: `${Math.round(recoveryPct * 100)}%` }}
                  />
                </span>
              )}
            </div>
          ) : null}
        </section>

        <section className="flex flex-col gap-[8px]">
          <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
            Alert Details:
          </h3>
          {/* Two columns at every width. The panel is 417px at lg and full
              width below it, and at neither size does a 2×2 block of short
              key/value pairs need to collapse to one column. */}
          {/* Two columns at every width. The panel is 417px at lg and full
              width below it, and at neither size does a block of short
              key/value pairs need to collapse to one column.

              ⚠ THE CELLS ARE CHOSEN, NOT FIXED AT FOUR. Source, Cameras and
              AI Confidence are the DETECTION vocabulary: a sensor, a zone, a
              model's certainty. Coordination raises five kinds and not one of
              them has any of those — a tower offline has no sensor and a
              camera stopping is not a prediction. "Not scored" under AI
              Confidence on a hardware fault is a row narrating the absence of
              something that was never going to be there, which is rule 4 the
              wrong way round. So a server alert gets the cells that are true
              of it, and a fixture keeps all four exactly as before. */}
          <div className="grid grid-cols-2 gap-[4px]">
            {server ? (
              <>
                <DetailCell label="Started:" value={detected} />
                {recoveredAt !== null && (
                  /* A SECOND FACT ABOUT A DIFFERENT ACTOR. This is the
                     hardware coming back, not somebody dealing with it, and
                     the pair being visibly separate is what stops a screen
                     implying an outage was handled when it simply ended. */
                  <DetailCell
                    label="Back at:"
                    value={
                      isSameSiteDay(recoveredAt, siteNow())
                        ? formatClock(recoveredAt)
                        : `${formatSiteDate(recoveredAt)}, ${formatClock(recoveredAt)}`
                    }
                  />
                )}
                {alert.cameras?.length ? (
                  <DetailCell
                    label={alert.cameras.length === 1 ? "Camera" : "Cameras"}
                    value={alert.cameras.map(deviceName).join(", ")}
                  />
                ) : null}
                {server.acknowledged_by ? (
                  /* ⚠ THE SERVER'S WORD FOR WHO, AND ONLY EVER THE SERVER'S.
                     The route reads no body: who acknowledged is the
                     authenticated caller. Not a device name, so NOT put
                     through `deviceName` — shouting a person's name is the
                     line `lib/deviceName.ts` draws and means. */
                  <DetailCell label="Noticed by:" value={server.acknowledged_by} />
                ) : null}
              </>
            ) : (
              <>
                <DetailCell label="Source" value={alert.source} />
                <DetailCell label="Detected:" value={detected} />
                <DetailCell
                  label={alert.cameras?.length === 1 ? "Camera" : "Cameras"}
                  value={
                    alert.cameras?.length ? (
                      alert.cameras.map(deviceName).join(", ")
                    ) : (
                      <span className="text-body-ink/30">None</span>
                    )
                  }
                />
                <DetailCell
                  label="AI Confidence:"
                  value={
                    alert.confidence !== undefined ? (
                      `${alert.confidence}%`
                    ) : (
                      /* Blank, not "0%" or "N/A": a hardware fault and an
                         operator talk-down are decisions and events, not
                         predictions, and a number here would invent a machine
                         judgement that was never made. */
                      <span className="text-body-ink/30">Not scored</span>
                    )
                  }
                />
              </>
            )}
          </div>
        </section>

        {/* ⭐ THE SEQUENCE, BUILT FROM THE ALERT'S OWN STAMPS.

            This section was dropped for server alerts last round, on the
            argument that coordination's five kinds are single events and the
            heading would sit over one line repeating the title. That was
            wrong on a real hub: an alert carries up to four moments — the
            event, the raise, the recovery and the acknowledgement — and the
            DELTAS between them are the reading. "Frames stopped at 03:14,
            raised at 03:15, back at 03:19" is the handoff; three separate
            cells are not.

            `lib/alertStory.ts` builds it, and every stamp on it is the
            server's with one documented exception. */}
        {server ? (
          <section className="flex flex-col gap-[16px]">
            <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
              Timeline:
            </h3>
            <ol className="flex flex-col" data-alert-story>
              {story.map((step, i) => (
                <li key={`${step.at ?? "none"}-${step.title}`} className="flex gap-[12px]">
                  <div className="flex shrink-0 flex-col items-center">
                    <img
                      src={ALERT_BADGE[alert.kind]}
                      alt=""
                      width={28}
                      height={28}
                      className="shrink-0"
                    />
                    {i < story.length - 1 && (
                      <span className="w-px flex-1 bg-overlay/10" />
                    )}
                  </div>
                  <div
                    className={`min-w-0 flex-1 ${i === story.length - 1 ? "pb-0" : "pb-[16px]"}`}
                  >
                    <p className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
                      {step.title}
                    </p>
                    {/* ⚠ A STEP CAN HAVE NO CLOCK, and it draws none rather
                        than a guess. The 2K upgrade is attached during a
                        sweep and the row carries no stamp for when; a
                        wall-clock time invented for it would be the one line
                        on a handoff that nothing can corroborate. */}
                    {step.at !== null && (
                      <p className="mt-[2px] text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted tabular-nums">
                        {formatClock(step.at)}
                        {i > 0 && firstStamp !== null && (
                          <span className="text-body-ink/25">
                            {" · "}
                            {formatDelta(firstStamp, step.at)}
                          </span>
                        )}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ) : (
        <section className="flex flex-col gap-[16px]">
          <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
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
        )}
      </div>

      {/* The state machine lives on the primary button — you cannot resolve
          what you have not acknowledged, so that transition is never offered.
          Sits above the fixed view bar on mobile: the primary action must not
          be covered by navigation. */}
      {/* ⚠ THE EXTRA BOTTOM PADDING AT lg IS NOT SPACING, IT IS CLEARANCE.
          `NotificationStack` is a fixed overlay pinned 16px from the
          bottom-right corner of the VIEWPORT, and at lg this panel ends in
          that same corner — so its "Recent" chip painted straight over the
          Escalate button, which the lab hit immediately. The chip is
          persistent once anything has passed through the stack, and alerts
          are exactly what puts things through it.

          Fixed here rather than by moving the stack: the overlay is global
          and correct where it is, and the thing that has to give way is the
          panel that chose to end in an occupied corner. 46px is the chip's
          own band (16px inset plus its height) with a hair of margin. */}
      <footer className="flex shrink-0 flex-col gap-[8px] border-t border-line px-[16px] pb-[calc(12px+env(safe-area-inset-bottom))] pt-[12px] mb-[56px] lg:mb-0 lg:pb-[46px]">
        {/* Said where it happened, next to the button that did it. */}
        <MutationError
          phase={statusPhase}
          onRetry={onRetryStatus}
          onDismiss={onDismissStatus}
        />
        <MutationError phase={rejectPhase} onRetry={onRetryReject} />
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
            className={`flex h-[39px] flex-1 items-center justify-center gap-[8px] rounded-[8px] bg-action text-[0.8125rem] font-medium tracking-[0.13px] text-action-ink transition-opacity hover:opacity-90 disabled:opacity-60 ${errorRing(statusPhase)}`}
          >
            <MutationIcon phase={statusPhase} idle={null} />
            Acknowledge
          </button>
        )}
        {/* ⚠ NO RESOLVE ON A SERVER ALERT, AND IT IS NOT AN OVERSIGHT. There
            is no resolve route and no `resolved` state on the row:
            acknowledging is ONE-WAY and the first one wins, and a camera
            coming back writes `recovered_at` onto the same alert rather than
            closing it. Those are facts about different actors — a person
            noticing, and hardware returning — and a button that collapsed
            them would let a screen imply somebody dealt with an outage that
            simply ended. The fixture path keeps the two-step, because the
            detection feed it belongs to will have one. */}
        {alert.status === "acknowledged" && !server && (
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
        {alert.status === "resolved" && !server && (
          <p className="flex-1 text-[0.75rem] text-terra">
            Resolved by {alert.acknowledgedBy ?? "you"}
          </p>
        )}
        {/* An acknowledged server alert has nothing left to press. The cells
            above say who noticed and when, which is the record; a button that
            is on screen and cannot be used is worse than a space. */}
        {server && alert.status === "acknowledged" && (
          <p className="flex-1 text-[0.75rem] text-muted">Acknowledged</p>
        )}
        {/* A match is a possibility, so the flat contradiction sits beside the
            flat agreement. Without it the only way to answer a wrong match is
            to resolve an alert that never happened. */}
        {alert.matchedPersonId && !alert.matchRejected && (
          <button
            type="button"
            onClick={onRejectMatch}
            disabled={rejectPhase.kind === "pending"}
            aria-busy={rejectPhase.kind === "pending" || undefined}
            className={`flex h-[39px] flex-1 items-center justify-center gap-[8px] rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-body-ink transition-colors hover:bg-overlay/12 disabled:opacity-60 ${errorRing(rejectPhase)}`}
          >
            <MutationIcon phase={rejectPhase} idle={null} />
            Not them
          </button>
        )}
        {alert.kind === "person" && !alert.matchedPersonId && (
          <button
            type="button"
            onClick={onWatchPerson}
            className="h-[39px] flex-1 rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-body-ink transition-colors hover:bg-overlay/12"
          >
            Add person
          </button>
        )}
        {/* Escalating hands an alert to somebody outside this room, and there
            is nowhere to hand it: coordination serves no alert routes at all,
            so there is no ticket, no rota and no recipient. It stays on screen
            and stays disabled — a button removed is a feature forgotten, and
            this one has to be wired the day alerts get a backend. Pressing it
            and having nothing happen is the worse failure on a screen whose
            whole job is escalation. */}
        <button
          type="button"
          disabled
          title="Escalate, not available yet"
          className="h-[39px] flex-1 rounded-[8px] bg-panel text-[0.8125rem] font-medium tracking-[0.13px] text-body-ink transition-colors hover:bg-overlay/12 disabled:bg-panel/60 disabled:text-body-ink/30 disabled:hover:bg-panel/60"
        >
          Escalate
        </button>
        </div>
      </footer>
    </motion.div>
  );
}
