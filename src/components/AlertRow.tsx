import { motion } from "motion/react";
import type { Alert } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { ENTER } from "@/lib/motion";
import { formatEventTime } from "@/lib/time";
import { ClipCard } from "./ClipCard";

export function AlertRow({
  alert,
  selected = false,
  onSelect,
  onPlay,
}: {
  alert: Alert;
  selected?: boolean;
  onSelect?: () => void;
  /** Opens the review player straight from the feed. Reaching a clip should
   *  not require opening the detail first — the thumbnail is right there, and
   *  a play button that needs a preceding click is a play button that does
   *  nothing. */
  onPlay?: () => void;
}) {
  const when = formatEventTime(alert.at);
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
        aria-label={`${alert.id}: ${alert.title}, ${when}`}
        aria-current={selected ? "true" : undefined}
        className={`-mx-[8px] flex w-[calc(100%+16px)] items-center gap-[12px] rounded-[6px] px-[8px] py-[0px] text-left transition-colors ${
          selected ? "bg-white/6" : "hover:bg-white/4"
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
          <span className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
            {alert.title}
          </span>
          <span className="text-[0.75rem] leading-[20px] tracking-[0.12px] text-muted tabular-nums">
            {when}
          </span>
        </span>
      </button>

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
