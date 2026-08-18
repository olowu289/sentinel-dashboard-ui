import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useState } from "react";
import type { Alert } from "@/lib/types";
import {
  NO_FILTER,
  RANGES,
  applyDateFilter,
  filterLabel,
  isFiltered,
  type DateFilter,
} from "@/lib/dateFilter";
import { SESSION_NOW } from "@/lib/time";
import type { AlertAttachment } from "@/lib/types";
import { AlertDetail } from "./AlertDetail";
import { AlertRow } from "./AlertRow";
import { ClipPlayer } from "./ClipPlayer";
import { AlertsEmpty } from "./AlertsEmpty";
import { DateFilterPopover } from "./DateFilterPopover";
import { MaskIcon } from "./Icon";

export function AlertsPanel({
  alerts,
  selectedId,
  filter,
  forceEmpty = false,
  onSelect,
  onFilterChange,
  onAcknowledge,
  onResolve,
  onCollapse,
  className = "",
}: {
  alerts: Alert[];
  selectedId: string | null;
  filter: DateFilter;
  forceEmpty?: boolean;
  className?: string;
  onSelect: (id: string | null) => void;
  onFilterChange: (next: DateFilter) => void;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
  /** Omitted below lg, where the panel is a whole view rather than a column. */
  onCollapse?: () => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  /* The clip open in the review player. It lives here rather than in the feed
     row or the detail because both of them can open one, and because the
     detail is never remounted — state parked in there survives an alert swap.
     Carrying the alert alongside the clip is what lets the player mark the
     scrubber with that incident's own timeline. */
  const [playing, setPlaying] = useState<{
    alert: Alert;
    at: number;
    attachment: AlertAttachment;
  } | null>(null);

  const visible = forceEmpty
    ? []
    : applyDateFilter(alerts, filter, SESSION_NOW);
  const selected = visible.find((a) => a.id === selectedId) ?? null;
  const filtered = isFiltered(filter);

  // What each preset would return, shown inline in the picker.
  const counts = Object.fromEntries(
    RANGES.map((r) => [
      r.id,
      applyDateFilter(alerts, { range: r.id }, SESSION_NOW).length,
    ]),
  );

  /* Arrow keys step through alerts without closing the detail view — operators
     triage in bulk, and reopening the drawer for every row is a tax. */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedId) {
        onSelect(null);
        return;
      }
      if (!selectedId) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = visible.findIndex((a) => a.id === selectedId);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      if (next >= 0 && next < visible.length) onSelect(visible[next].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId, onSelect]);

  return (
    <aside
      aria-label="Alerts"
      /* Full width below lg — it owns the screen there. The left border only
         makes sense once it sits beside the wall. */
      className={`relative min-w-0 flex-1 flex-col bg-ink lg:w-[417px] lg:flex-none lg:shrink-0 lg:border-l lg:border-line-panel ${className}`}
    >
      <header className="relative flex h-[46px] shrink-0 items-center justify-between border-b border-line px-[16px]">
        <h2 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-dim">
          ALERTS
        </h2>
        {/* Bare glyphs, no chip around them — with the container gone, colour
            is the only thing left to carry the filter's active state. */}
        <div className="flex items-center gap-[8px]">
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            aria-label="Filter alerts by date"
            title="Filter by date"
            className={`flex size-[24px] items-center justify-center rounded-[4.364px] transition-colors ${
              filtered || pickerOpen
                ? "text-terra"
                : "text-white/70 hover:text-white"
            }`}
          >
            <MaskIcon src="/icons/calendar.svg" size={20} />
          </button>

          {/* Only at lg: below it the panel is already a whole view of its own,
              reached from the bottom bar, so there is nothing to collapse. */}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              aria-label="Collapse alerts panel"
              title="Collapse alerts"
              className="hidden size-[24px] items-center justify-center rounded-[4.364px] text-white/70 transition-colors hover:text-white lg:flex"
            >
              <MaskIcon src="/icons/panel-collapse.svg" size={20} />
            </button>
          )}
        </div>

        {pickerOpen && (
          <DateFilterPopover
            value={filter}
            counts={counts}
            onApply={onFilterChange}
            onClose={() => setPickerOpen(false)}
          />
        )}
      </header>

      {/* A filtered feed must announce itself. The single worst failure here is
          an operator reading a filtered list as the whole picture. */}
      {filtered && (
        <div className="flex shrink-0 items-center gap-[8px] border-b border-line px-[15px] py-[8px]">
          <span className="flex items-center gap-[6px] rounded-[4px] bg-terra/10 py-[3px] pl-[8px] pr-[4px] text-[0.75rem] text-terra">
            {filterLabel(filter)}
            <button
              type="button"
              onClick={() => onFilterChange(NO_FILTER)}
              aria-label="Clear date filter"
              className="flex size-[16px] items-center justify-center rounded-[3px] transition-colors hover:bg-terra/20"
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 14 14"
                fill="none"
                aria-hidden
              >
                <path
                  d="m3 3 8 8M11 3l-8 8"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </span>
          <span className="text-[0.75rem] text-white/35 tabular-nums">
            {visible.length} of {alerts.length}
          </span>
        </div>
      )}

      {/* Extra bottom padding clears the fixed view bar; the last alert in the
          feed must be scrollable clear of it, not trapped underneath. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[15px] pb-[calc(76px+env(safe-area-inset-bottom))] pt-[20px] lg:pb-[20px]">
        {visible.length === 0 ? (
          <AlertsEmpty
            filtered={filtered}
            onClearFilters={() => onFilterChange(NO_FILTER)}
          />
        ) : (
          /* Scopes the shared accent bar to this list. Without it the layoutId
             would be global and any future list could capture it. */
          <LayoutGroup id="alerts">
            <ul className="flex flex-col gap-[22px]">
              {visible.map((alert) => (
                <AlertRow
                  key={alert.id}
                  alert={alert}
                  selected={alert.id === selectedId}
                  onSelect={() => onSelect(alert.id)}
                  onPlay={
                    alert.attachment &&
                    (() =>
                      setPlaying({
                        alert,
                        at: alert.at,
                        attachment: alert.attachment!,
                      }))
                  }
                />
              ))}
            </ul>
          </LayoutGroup>
        )}
      </div>

      {/* Not keyed on the alert id, deliberately: arrowing through the feed
          swaps the content without remounting, so bulk triage stays instant
          and only opening and closing the drawer animates. */}
      <AnimatePresence>
        {selected && (
          <AlertDetail
            alert={selected}
            onClose={() => onSelect(null)}
            onAcknowledge={() => onAcknowledge(selected.id)}
            onResolve={() => onResolve(selected.id)}
            onPlayClip={(at, attachment) =>
              setPlaying({ alert: selected, at, attachment })
            }
          />
        )}
      </AnimatePresence>

      {/* Keyed on the clip, so playing a second one without closing the first
          swaps the media rather than cross-fading two players. */}
      <AnimatePresence>
        {playing && (
          <ClipPlayer
            key={`${playing.alert.id}-${playing.at}`}
            attachment={playing.attachment}
            at={playing.at}
            alert={playing.alert}
            onClose={() => setPlaying(null)}
          />
        )}
      </AnimatePresence>
    </aside>
  );
}
