import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useState } from "react";
import { AlertDetail } from "@/components/AlertDetail";
import { AlertRow } from "@/components/AlertRow";
import { AlertsEmpty } from "@/components/AlertsEmpty";
import { ClipPlayer } from "@/components/ClipPlayer";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import {
  NO_FILTER,
  RANGES,
  applyDateFilter,
  filterLabel,
  isFiltered,
  type DateFilter,
} from "@/lib/dateFilter";
import { useNow } from "@/lib/useNow";
import type { Alert, AlertAttachment, Tower } from "@/lib/types";
import type { Mutation } from "@/lib/useMutation";

/**
 * Every alert the fleet has raised, in one feed.
 *
 * The rail has always drawn a bell and it has always gone nowhere. What it
 * wants to be is the answer to a question the tower view cannot take: *what is
 * happening anywhere*. An operator watching one site has that site's feed
 * beside the wall; an operator arriving at a desk has four towers and no idea
 * which one to open first.
 *
 * So it is the same feed, unscoped. One chronological list rather than a
 * section per site, because triage is time-ordered — the newest thing on the
 * fleet is the next thing to look at, whichever yard it happened in. Which
 * site it was is a label on the row, not a heading above a group.
 *
 * The pieces are the ones the tower's own panel uses — `AlertRow`,
 * `AlertDetail`, the date filter, the review player — so an alert read here and
 * the same alert read there are the same object with the same actions. Two
 * feeds that diverge is how an operator learns to trust only one of them.
 */
export function AlertsView({
  alerts,
  towers,
  onNavigate,
  onBack,
  onSetStatus,
  statusMutation,
  onWatchPerson,
  onRejectMatch,
}: {
  /** Every alert on the fleet, newest first — see the sort in `data.ts`. */
  alerts: Alert[];
  /** For naming the site each alert came from. */
  towers: Tower[];
  onNavigate: (id: string) => void;
  onBack: () => void;
  onSetStatus: (id: string, status: Alert["status"]) => void;
  /** Keyed by alert id, owned by the shell. Never held below this. */
  statusMutation?: Mutation;
  onWatchPerson?: (alert: Alert) => void;
  onRejectMatch?: (id: string) => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [playing, setPlaying] = useState<{
    alert: Alert;
    at: number;
    attachment: AlertAttachment;
  } | null>(null);

  /* Ticking, not captured — see `useNow`. The fleet feed is the one most
     likely to be left open all shift, so the frozen clock hurt most here. */
  const now = useNow();
  const visible = applyDateFilter(alerts, filter, now);
  const selected = visible.find((a) => a.id === selectedId) ?? null;
  const filtered = isFiltered(filter);

  /**
   * Arrow keys step through the feed without closing the detail — operators
   * triage in bulk, and reopening the drawer for every row is a tax.
   *
   * The per-tower panel has had this since it was written and this feed never
   * did, which is exactly the divergence that sharing `AlertRow`, `AlertDetail`
   * and the filter between the two surfaces was meant to prevent: one alert
   * read here and the same alert read there should behave the same way. The
   * behaviour is deliberately identical rather than merely similar — bounds
   * check included, so stepping off either end does nothing rather than
   * wrapping.
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedId) {
        setSelectedId(null);
        return;
      }
      if (!selectedId) return;
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const i = visible.findIndex((a) => a.id === selectedId);
      const next = e.key === "ArrowDown" ? i + 1 : i - 1;
      if (next >= 0 && next < visible.length) setSelectedId(visible[next].id);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, selectedId]);

  const siteOf = (towerId: string) =>
    towers.find((t) => t.id === towerId)?.site ?? towerId;

  /* Unclaimed is the count that means anything on a fleet feed. The total is
     every alert these towers have ever raised, which on a wall that has been
     up for a week is a number nobody acts on. */
  const unclaimed = visible.filter((a) => a.status === "triggered").length;

  // What each preset would return, shown inline in the picker.
  const counts = Object.fromEntries(
    RANGES.map((r) => [
      r.id,
      applyDateFilter(alerts, { range: r.id }, now).length,
    ]),
  );

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail
        active="alerts"
        onSelect={onNavigate}
        className="hidden lg:block"
      />

      <aside
        aria-label="Fleet alerts"
        className="flex w-full min-w-0 flex-col bg-ink lg:w-[417px] lg:shrink-0 lg:border-r lg:border-line-panel"
      >
        <header className="relative flex h-[46px] shrink-0 items-center justify-between border-b border-line pl-[16px] pr-[14px]">
          {/* A breadcrumb, like every other way up in this app. */}
          <nav
            aria-label="Breadcrumb"
            className="flex min-w-0 items-center gap-[4px]"
          >
            <button
              type="button"
              onClick={onBack}
              title="Back to all towers"
              className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span
              aria-current="page"
              className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white"
            >
              ALERTS
            </span>
          </nav>

          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-label="Filter alerts by date"
            aria-expanded={pickerOpen}
            title="Filter by date"
            className={`flex size-[24px] shrink-0 items-center justify-center rounded-[4px] transition-colors ${
              filtered || pickerOpen
                ? "text-terra"
                : "text-muted hover:text-white"
            }`}
          >
            <MaskIcon src="/icons/calendar.svg" size={20} />
          </button>

          {pickerOpen && (
            <DateFilterPopover
              value={filter}
              counts={counts}
              onApply={setFilter}
              onClose={() => setPickerOpen(false)}
            />
          )}
        </header>

        {/* A filtered feed must announce itself. The single worst failure here
            is an operator reading a filtered list as the whole picture. */}
        {filtered && (
          <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-line px-[15px] py-[8px]">
            <span className="flex items-center gap-[6px] rounded-[4px] bg-terra/10 py-[3px] pl-[8px] pr-[4px] text-[0.75rem] text-terra">
              {filterLabel(filter)}
              <button
                type="button"
                onClick={() => setFilter(NO_FILTER)}
                aria-label="Clear date filter"
                className="flex size-[16px] items-center justify-center rounded-[3px] transition-colors hover:bg-terra/20"
              >
                <svg width="9" height="9" viewBox="0 0 14 14" fill="none" aria-hidden>
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

        {!filtered && visible.length > 0 && (
          <p className="shrink-0 border-b border-line px-[15px] py-[8px] text-[0.75rem] leading-[16px] text-muted tabular-nums">
            {unclaimed} of {visible.length} not yet acknowledged
          </p>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[15px] pb-[20px] pt-[20px]">
          {visible.length === 0 ? (
            <AlertsEmpty
              filtered={filtered}
              onClearFilters={() => setFilter(NO_FILTER)}
            />
          ) : (
            /* Scopes the shared accent bar to this list, so it cannot be
               captured by another list mounted at the same time. */
            <LayoutGroup id="fleet-alerts">
              <ul className="flex flex-col gap-[22px]">
                {visible.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    site={siteOf(alert.towerId)}
                    selected={alert.id === selectedId}
                    onSelect={() => setSelectedId(alert.id)}
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
      </aside>

      {/* `AlertDetail` is `absolute inset-0`, so it fills this pane rather than
          covering the list the way it does inside the tower's 417px column.
          Not keyed on the alert id, deliberately: arrowing through the feed
          swaps the content without remounting, so bulk triage stays instant. */}
      <main className="relative hidden min-w-0 flex-1 lg:block">
        <AnimatePresence>
          {selected && (
            <AlertDetail
              alert={selected}
              onClose={() => setSelectedId(null)}
              onAcknowledge={() => onSetStatus(selected.id, "acknowledged")}
              onResolve={() => onSetStatus(selected.id, "resolved")}
              /* Keyed by alert id upstream. This feed has the same trap as the
                 tower panel's — the detail is rendered without a key so the
                 content swaps in place — and the same protection. */
              statusPhase={statusMutation?.phase(selected.id)}
              onRetryStatus={() => void statusMutation?.retry(selected.id)}
              onDismissStatus={() => statusMutation?.reset(selected.id)}
              onWatchPerson={() => onWatchPerson?.(selected)}
              onRejectMatch={() => onRejectMatch?.(selected.id)}
              onPlayClip={(at, attachment) =>
                setPlaying({ alert: selected, at, attachment })
              }
            />
          )}
        </AnimatePresence>

        {!selected && (
          <div className="flex size-full items-center justify-center px-[24px] text-center">
            <p className="max-w-[360px] text-[0.875rem] leading-[20px] text-muted">
              {visible.length === 0
                ? "No alerts on the fleet. Every tower is quiet."
                : "Choose an alert to see what the camera saw and what has been done about it."}
            </p>
          </div>
        )}
      </main>

      <AnimatePresence>
        {playing && (
          <ClipPlayer
            key={`${playing.alert.id}-${playing.at}`}
            attachment={playing.attachment}
            at={playing.at}
            alert={playing.alert}
            towerName={siteOf(playing.alert.towerId)}
            onNavigate={onNavigate}
            onClose={() => setPlaying(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
