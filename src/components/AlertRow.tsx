import { motion } from "motion/react";
import type { Alert } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { alertColour, recoveryDetail, recoveryProgress } from "@/lib/alertCopy";
import { ENTER } from "@/lib/motion";
import { formatEventTime } from "@/lib/time";
import { ClipCard } from "./ClipCard";

export function AlertRow({
  alert,
  site,
  selected = false,
  onSelect,
  onPlay,
}: {
  alert: Alert;
  /** Which site raised it. Set only on the fleet feed, where the list mixes
   *  towers — inside one tower's panel every row has the same answer and
   *  printing it on all of them is noise the eye has to skip past. */
  site?: string;
  selected?: boolean;
  onSelect?: () => void;
  /** Opens the review player straight from the feed. Reaching a clip should
   *  not require opening the detail first — the thumbnail is right there, and
   *  a play button that needs a preceding click is a play button that does
   *  nothing. */
  onPlay?: () => void;
}) {
  const when = formatEventTime(alert.at);
  /* THE SERVER'S COLOUR, or nothing at all for a fixture. Keyed by the colour
     the hub sent rather than by the type, so an alert kind this bundle was
     built before still arrives wearing the hub's own judgement of it. */
  const colour = alert.site ? alertColour(alert.site.colour) : null;
  /* Footage catching up after an outage is the one alert with a QUANTITY and
     an end in sight, and both move: the hub re-reports progress on every
     footage report and the row is updated in place off the event stream. */
  const recovering = alert.site ? recoveryDetail(alert.site) : undefined;
  const progress = alert.site ? recoveryProgress(alert.site) : undefined;
  return (
    <li className="relative">
      {/* Selection is an accent bar, not a fill — a coloured row would compete
          with the severity badge and cost scannability down the feed. */}
      {/* One bar shared across the whole list rather than one per row: it
          slides to the row you picked, so arrowing through the feed tracks
          where you are instead of blinking between positions. */}
      {selected && (
        <motion.span
          layoutId="alert-accent"
          transition={ENTER}
          aria-hidden
          className="absolute -left-[15px] top-0 h-[42px] w-[2px] rounded-r bg-terra"
        />
      )}

      <button
        type="button"
        onClick={onSelect}
        aria-label={`${alert.id}: ${alert.title}, ${site ? `${site}, ` : ""}${when}`}
        aria-current={selected ? "true" : undefined}
        className={`-mx-[8px] flex w-[calc(100%+16px)] items-center gap-[12px] rounded-[6px] px-[8px] py-[0px] text-left transition-colors ${
          selected ? "bg-overlay/6" : "hover:bg-overlay/4"
        }`}
      >
        <img
          src={ALERT_BADGE[alert.kind]}
          alt=""
          width={28}
          height={28}
          className="shrink-0"
        />
        <span className="flex min-w-0 flex-1 flex-col gap-[2px] py-[1px]">
          <span className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
            {alert.title}
          </span>
          {/* Site and time on one line, the site first: on a fleet feed the
              question is *where* before it is *when*, and the times are
              already ordered by the list itself. */}
          <span className="flex min-w-0 items-center gap-[6px] text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted">
            {/* ⚠ A DOT, AND IT IS THE ONLY COLOURED PIXEL ON THE ROW. The
                badge says what KIND of thing happened and the words say what;
                this says how bad the hub thinks it is, which is the one thing
                neither of the others carries. A coloured title would be four
                coloured headlines down a feed and the eye would stop sorting
                them; a 6px dot in the line that already holds the separators
                reads at a glance and still lets the titles scan as a column. */}
            {colour && (
              <span
                aria-hidden
                data-alert-dot
                className={`size-[6px] shrink-0 rounded-full ${colour.strip}`}
              />
            )}
            {site && (
              <>
                <span className="truncate">{site}</span>
                <span
                  aria-hidden
                  className="size-[2px] shrink-0 rounded-full bg-muted"
                />
              </>
            )}
            <span className="shrink-0 tabular-nums">{when}</span>
          </span>
        </span>
      </button>

      {/* HOW MUCH IS LEFT, AND HOW LONG. Only ever on a recovery alert, and
          only while the hub is still sending a `progress` block -- when the
          backlog clears the block goes and so does this, which is the right
          way round: a bar sitting at 100% is a job that looks unfinished. */}
      {(recovering || progress !== undefined) && (
        <div className="flex flex-col gap-[4px] pt-[6px] lg:pl-[40px]" data-recovery>
          {recovering && (
            <span className="text-[0.75rem] leading-[16px] text-muted tabular-nums">
              {recovering}
            </span>
          )}
          {progress !== undefined && (
            <span
              aria-hidden
              className="h-[3px] w-full overflow-hidden rounded-full bg-overlay/10"
            >
              <span
                className={`block h-full rounded-full ${colour?.strip ?? "bg-muted"}`}
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </span>
          )}
        </div>
      )}

      {/* The 40px indent aligns the clip under the alert title on desktop. On a
          phone that rhythm costs more than it buys: it was squeezing the clip's
          own title into 57px against the 123px it needs. */}
      {alert.attachment && (
        <div className="pt-[8px] lg:pl-[40px]">
          <ClipCard
            attachment={alert.attachment}
            at={alert.at}
            alertId={alert.id}
            onPlay={alert.attachment.kind === "clip" ? onPlay : undefined}
          />
        </div>
      )}
    </li>
  );
}
