import { useState, type ReactNode } from "react";
import type { Alert } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { SITE_TZ_LABEL, formatClock, formatEventTime } from "@/lib/time";

const TIMELINE = [
  { time: "23:10", title: "Alert raised", sub: "Motion Sensor · confidence 94%" },
  { time: "23:10", title: "Clip captured", sub: "15s · 1080p · stored" },
  { time: "23:10", title: "Notified on-call", sub: "Push · SMS to 2 responders" },
];

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-[12px] border-b border-white/6 py-[10px] last:border-b-0">
      <span className="shrink-0 text-[12px] text-white/40">{label}</span>
      <span className="min-w-0 truncate text-right text-[12px] text-white/85">
        {value}
      </span>
    </div>
  );
}

export function AlertDetail({
  alert,
  onClose,
  onAcknowledge,
  onResolve,
}: {
  alert: Alert;
  onClose: () => void;
  onAcknowledge: () => void;
  onResolve: () => void;
}) {
  const [tab, setTab] = useState<"details" | "timeline">("details");
  const critical = alert.kind === "alert" || alert.kind === "fault";

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#0e0e10]">
      <header className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to alerts"
          className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
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
        <span
          aria-hidden
          className={`size-[8px] shrink-0 rounded-full ${
            critical ? "bg-critical" : "bg-detect"
          }`}
        />
        {/* Stable short ID before the human title — this is what gets read out
            over the radio during a handoff. */}
        <span className="font-display text-[12px] tracking-[0.12px] text-white/50">
          {alert.id}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
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

      <div className="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[16px] pt-[16px]">
        <div className="flex items-start gap-[12px]">
          <img
            src={ALERT_BADGE[alert.kind]}
            alt=""
            width={28}
            height={28}
            className="mt-[2px] shrink-0"
          />
          <h2 className="text-[15px] font-semibold leading-[1.35] text-white">
            {alert.title}
          </h2>
        </div>

        <div className="mt-[12px] flex flex-wrap gap-[6px]">
          <span
            className={`rounded-[3px] px-[6px] py-[2px] font-display text-[11px] uppercase tracking-[0.11px] ${
              alert.status === "resolved"
                ? "bg-terra/15 text-terra"
                : alert.status === "acknowledged"
                  ? "bg-warn/15 text-warn"
                  : "bg-critical/15 text-critical"
            }`}
          >
            {alert.status}
          </span>
          <span className="rounded-[3px] bg-white/6 px-[6px] py-[2px] font-display text-[11px] uppercase tracking-[0.11px] text-white/70">
            {alert.zone}
          </span>
          <span className="rounded-[3px] bg-white/6 px-[6px] py-[2px] font-display text-[11px] tracking-[0.11px] text-white/70 tabular-nums">
            {formatEventTime(alert.at)}
          </span>
        </div>

        {/* The triggering frame goes above the fold, above every metadata row —
            an operator confirms with their eyes before they read anything. */}
        <div className="relative mt-[16px] aspect-video w-full overflow-hidden rounded-[8px] bg-tile-dead">
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
            </>
          ) : (
            <div className="flex size-full items-center justify-center text-[12px] text-white/30">
              No clip attached
            </div>
          )}
        </div>

        <div
          role="tablist"
          className="mt-[16px] flex gap-[16px] border-b border-white/8"
        >
          {(["details", "timeline"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-[1.5px] pb-[8px] text-[13px] capitalize transition-colors ${
                tab === t
                  ? "border-white text-white"
                  : "border-transparent text-white/40 hover:text-white/70"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "details" ? (
          <div className="mt-[4px]">
            <MetaRow label="Camera" value={alert.source} />
            <MetaRow label="Zone" value={alert.zone} />
            <MetaRow label="Detected" value={formatClock(alert.at)} />
            <MetaRow label="Rule" value={`${alert.source} · default`} />
            {/* Empty fields stay visible — in security, absence is itself
                diagnostic information. */}
            <MetaRow
              label="Acknowledged by"
              value={
                alert.acknowledgedBy ?? (
                  <span className="text-white/30">Not acknowledged</span>
                )
              }
            />
          </div>
        ) : (
          <div className="mt-[12px]">
            <p className="mb-[10px] text-[11px] text-white/30">
              Times shown in {SITE_TZ_LABEL} (GMT+1)
            </p>
            <ol>
              {TIMELINE.map((e, i) => (
                <li key={i} className="flex gap-[12px] pb-[14px]">
                  <span className="w-[38px] shrink-0 font-display text-[11px] text-white/40 tabular-nums">
                    {e.time}
                  </span>
                  <span className="relative flex flex-col gap-[2px] border-l border-white/10 pb-[2px] pl-[14px]">
                    <span className="absolute -left-[4px] top-[5px] size-[7px] rounded-full border border-white/25 bg-[#0e0e10]" />
                    <span className="text-[13px] text-white">{e.title}</span>
                    <span className="text-[12px] text-white/40">{e.sub}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {/* The state machine lives on the primary button — you cannot resolve
          what you have not acknowledged, so that transition is never offered. */}
      <footer className="flex h-[56px] shrink-0 items-center gap-[8px] border-t border-line px-[16px]">
        {alert.status === "triggered" && (
          <button
            type="button"
            onClick={onAcknowledge}
            className="h-[32px] flex-1 rounded-[6px] bg-white text-[13px] font-medium text-black transition-opacity hover:opacity-90"
          >
            Acknowledge
          </button>
        )}
        {alert.status === "acknowledged" && (
          <button
            type="button"
            onClick={onResolve}
            className="h-[32px] flex-1 rounded-[6px] bg-terra text-[13px] font-medium text-black transition-opacity hover:opacity-90"
          >
            Resolve
          </button>
        )}
        {alert.status === "resolved" && (
          <p className="flex-1 text-[12px] text-terra">
            Resolved by {alert.acknowledgedBy ?? "you"}
          </p>
        )}
        <button
          type="button"
          className="h-[32px] rounded-[6px] border border-white/12 px-[12px] text-[13px] text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Escalate
        </button>
      </footer>
    </div>
  );
}
