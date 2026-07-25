import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useRef, useState, type ReactNode } from "react";
import type { Alert } from "@/lib/types";
import { ALERT_BADGE } from "@/lib/data";
import { ENTER, EXIT, FADE } from "@/lib/motion";
import { SITE_TZ_LABEL, formatClock, formatEventTime } from "@/lib/time";

const TIMELINE = [
  {
    time: "23:10",
    title: "Alert raised",
    sub: "Motion Sensor · confidence 94%",
  },
  { time: "23:10", title: "Clip captured", sub: "15s · 1080p · stored" },
  {
    time: "23:10",
    title: "Notified on-call",
    sub: "Push · SMS to 2 responders",
  },
];

const TABS = ["details", "timeline"] as const;
type Tab = (typeof TABS)[number];

function MetaRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-[12px] border-b border-white/6 py-[10px] last:border-b-0">
      <span className="shrink-0 text-[0.75rem] text-white/40">{label}</span>
      <span className="min-w-0 truncate text-right text-[0.75rem] text-white/85">
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
  const [tab, setTab] = useState<Tab>("details");
  const critical = alert.kind === "alert" || alert.kind === "fault";
  const isPresent = useIsPresent();

  /* Horizontal tablist per the ARIA authoring practices: arrows move between
     tabs, Home/End jump to the ends, and selection follows focus. Declaring
     role="tab" promises this behaviour, so it has to actually be here.

     stopPropagation keeps these keys off the window-level handlers. Nothing
     traps focus inside the takeover, so this panel is still tabbable while a
     tile is fullscreen — where Left/Right would otherwise switch camera. */
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  const onTabKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.indexOf(tab);
    const to =
      e.key === "ArrowRight"
        ? (i + 1) % TABS.length
        : e.key === "ArrowLeft"
          ? (i - 1 + TABS.length) % TABS.length
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? TABS.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    e.stopPropagation();
    setTab(TABS[to]);
    tabRefs.current[TABS[to]]?.focus();
  };

  /* A short slide from the right edge, not a full panel width — the list is
     still conceptually behind this, so it should read as sliding over its own
     list rather than arriving from off-screen.

     `inert` while leaving: the panel stays mounted for the exit, and its back,
     close, tab and action buttons must not be tabbable or clickable while it
     is on its way out. */
  return (
    <motion.div
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 12, transition: EXIT }}
      transition={ENTER}
      inert={!isPresent}
      className="absolute inset-0 z-20 flex flex-col bg-[#0e0e10]"
    >
      <header className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to alerts"
          className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden
          >
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
        <span className="font-display text-[0.75rem] tracking-[0.12px] text-white/50">
          {alert.id}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto flex size-[24px] items-center justify-center rounded-[4px] text-white/50 transition-colors hover:bg-white/8 hover:text-white"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
          >
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
          <h2 className="text-[0.9375rem] font-semibold leading-[1.35] text-white">
            {alert.title}
          </h2>
        </div>

        <div className="mt-[12px] flex flex-wrap gap-[6px]">
          <span
            className={`rounded-[3px] px-[6px] py-[2px] font-display text-[0.75rem] lg:text-[0.6875rem] uppercase tracking-[0.11px] ${
              alert.status === "resolved"
                ? "bg-terra/15 text-terra"
                : alert.status === "acknowledged"
                  ? "bg-warn/15 text-warn"
                  : "bg-critical/15 text-critical"
            }`}
          >
            {alert.status}
          </span>
          <span className="rounded-[3px] bg-white/6 px-[6px] py-[2px] font-display text-[0.75rem] lg:text-[0.6875rem] uppercase tracking-[0.11px] text-white/70">
            {alert.zone}
          </span>
          <span className="rounded-[3px] bg-white/6 px-[6px] py-[2px] font-display text-[0.75rem] lg:text-[0.6875rem] tracking-[0.11px] text-white/70 tabular-nums">
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
            <div className="flex size-full items-center justify-center text-[0.75rem] text-white/30">
              No clip attached
            </div>
          )}
        </div>

        {/* The underline is one element that slides, not a border toggled per
            button — so the buttons carry no border of their own to fight it. */}
        <div
          role="tablist"
          aria-label="Alert detail sections"
          onKeyDown={onTabKeys}
          className="relative mt-[16px] flex gap-[16px] border-b border-white/8"
        >
          {TABS.map((t) => (
            <button
              key={t}
              ref={(el) => {
                tabRefs.current[t] = el;
              }}
              role="tab"
              id={`alert-tab-${t}`}
              aria-controls={`alert-panel-${t}`}
              aria-selected={tab === t}
              // Roving tabindex: the tablist is one tab stop, arrows move within it.
              tabIndex={tab === t ? 0 : -1}
              onClick={() => setTab(t)}
              className={`relative pb-[8px] text-[0.8125rem] capitalize transition-colors ${
                tab === t ? "text-white" : "text-white/40 hover:text-white/70"
              }`}
            >
              {t}
              {tab === t && (
                <motion.span
                  layoutId="alert-tab-underline"
                  transition={ENTER}
                  aria-hidden
                  className="absolute -bottom-px left-0 h-[1.5px] w-full bg-white"
                />
              )}
            </button>
          ))}
        </div>

        {/* Opacity only. `mode="wait"` means the two bodies never coexist, so
            there is nothing for a layout animation to interpolate between —
            and the panel sits in a scrolling region, where animating height
            would fight the scroll position. tabIndex on the panels because
            neither contains a focusable element, so the tab pattern needs them
            reachable in their own right. */}
        <AnimatePresence mode="wait" initial={false}>
          {tab === "details" ? (
            <motion.div
              key="details"
              role="tabpanel"
              id="alert-panel-details"
              aria-labelledby="alert-tab-details"
              tabIndex={0}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
              className="mt-[4px]"
            >
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
            </motion.div>
          ) : (
            <motion.div
              key="timeline"
              role="tabpanel"
              id="alert-panel-timeline"
              aria-labelledby="alert-tab-timeline"
              tabIndex={0}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={FADE}
              className="mt-[12px]"
            >
              <p className="mb-[10px] text-[0.75rem] lg:text-[0.6875rem] text-white/30">
                Times shown in {SITE_TZ_LABEL} (GMT+1)
              </p>
              <ol>
                {TIMELINE.map((e, i) => (
                  <li key={i} className="flex gap-[12px] pb-[14px]">
                    <span className="w-[38px] shrink-0 font-display text-[0.75rem] lg:text-[0.6875rem] text-white/40 tabular-nums">
                      {e.time}
                    </span>
                    <span className="relative flex flex-col gap-[2px] border-l border-white/10 pb-[2px] pl-[14px]">
                      <span className="absolute -left-[4px] top-[5px] size-[7px] rounded-full border border-white/25 bg-[#0e0e10]" />
                      <span className="text-[0.8125rem] text-white">
                        {e.title}
                      </span>
                      <span className="text-[0.75rem] text-white/40">
                        {e.sub}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* The state machine lives on the primary button — you cannot resolve
          what you have not acknowledged, so that transition is never offered. */}
      {/* Sits above the fixed view bar on mobile — the primary action must not
          be covered by navigation. */}
      <footer className="flex shrink-0 items-center gap-[8px] border-t border-line px-[16px] pb-[calc(12px+env(safe-area-inset-bottom))] pt-[12px] lg:h-[56px] lg:py-0 mb-[56px] lg:mb-0">
        {alert.status === "triggered" && (
          <button
            type="button"
            onClick={onAcknowledge}
            className="h-[32px] flex-1 rounded-[6px] bg-white text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90"
          >
            Acknowledge
          </button>
        )}
        {alert.status === "acknowledged" && (
          <button
            type="button"
            onClick={onResolve}
            className="h-[32px] flex-1 rounded-[6px] bg-terra text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90"
          >
            Resolve
          </button>
        )}
        {alert.status === "resolved" && (
          <p className="flex-1 text-[0.75rem] text-terra">
            Resolved by {alert.acknowledgedBy ?? "you"}
          </p>
        )}
        <button
          type="button"
          className="h-[32px] rounded-[6px] border border-white/12 px-[12px] text-[0.8125rem] text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Escalate
        </button>
      </footer>
    </motion.div>
  );
}
