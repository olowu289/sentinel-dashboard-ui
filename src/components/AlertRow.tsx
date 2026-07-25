import type { Alert } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { formatEventTime } from "@/lib/time";
import { ClipCard } from "./ClipCard";

export function AlertRow({
  alert,
  selected = false,
  onSelect,
}: {
  alert: Alert;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const when = formatEventTime(alert.at);
  return (
    <li className="relative">
      {/* Selection is an accent bar, not a fill — a coloured row would compete
          with the severity badge and cost scannability down the feed. */}
      {selected && (
        <span
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
          <span className="text-[14px] leading-[20px] tracking-[0.14px] text-white">
            {alert.title}
          </span>
          <span className="text-[12px] leading-[20px] tracking-[0.12px] text-muted tabular-nums">
            {when}
          </span>
        </span>
      </button>

      {alert.attachment && (
        <div className="pl-[40px] pt-[8px]">
          <ClipCard
            attachment={alert.attachment}
            at={alert.at}
            alertId={alert.id}
          />
        </div>
      )}
    </li>
  );
}
