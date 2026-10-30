import { AnimatePresence, LayoutGroup } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { AcknowledgeAllConfirm } from "@/components/AcknowledgeAllConfirm";
import { AlertDetail } from "@/components/AlertDetail";
import { AlertRow } from "@/components/AlertRow";
import { describeAckAllFailure } from "@/lib/api/alertCounts";
import { deviceName } from "@/lib/deviceName";
import type { CameraNameOf, NameOf } from "@/lib/alertCopy";
import { alertPanes } from "@/lib/alertStory";
import { AlertsEmpty } from "@/components/AlertsEmpty";
import { PausedNotice } from "@/components/PausedNotice";
import { ClipPlayer } from "@/components/ClipPlayer";
import { DateFilterPopover } from "@/components/DateFilterPopover";
import { IconRail } from "@/components/IconRail";
import { MaskIcon } from "@/components/Icon";
import {
  NO_FILTER,
  RANGES,
  applyDateFilter,
  filterFromIso,
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
  rejectMutation,
  onWatchPerson,
  onRejectMatch,
  problem,
  paused,
  openAlertId,
  nameOf: resolveName,
  cameraNameOf,
  onRefreshAlert,
  onAcknowledgeAll,
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
  /** Keyed by alert id. */
  rejectMutation?: Mutation;
  onWatchPerson?: (alert: Alert) => void;
  onRejectMatch?: (id: string) => void;
  /**
   * Why the feed could not be read, in one sentence.
   *
   * ⚠ AN EMPTY FEED AND A FEED THAT FAILED TO LOAD LOOK IDENTICAL, and one
   * of them is the best news on this screen. "No alerts" over a read that was
   * refused is the fake-green failure this product refuses everywhere else,
   * and on the alert feed it is the worst place to make it.
   */
  problem?: string | null;
  /**
   * The live channel has been down long enough to tell somebody.
   *
   * ⭐ A FEED THAT HAS STOPPED LOOKS EXACTLY LIKE A QUIET NIGHT. Both are a
   * list that is not changing, and one of those is the best news on this
   * screen while the other is the worst. Nothing else here can tell them
   * apart, so this is the only thing standing between a silent failure and
   * an operator believing their site is calm.
   *
   * A reading, not an error: the rows on screen are still the last thing the
   * server said and the SDK is already reconnecting, so it is a quiet line
   * and never a banner. It is gated on a grace period in `useSiteAlerts` --
   * a routine reconnect must not blink it, or it stops being read.
   */
  paused?: boolean;
  /**
   * An alert to open on arrival, from somewhere outside this screen.
   *
   * The toast's "Open" sets it. ⚠ IT SEEDS THE SELECTION AND DOES NOT OWN IT:
   * the moment this screen is on, arrowing through the feed and pressing Esc
   * must work exactly as they always have, and a prop that kept forcing one
   * row would fight the arrow keys. So it is applied once per value, in an
   * effect, and the local state is the truth afterwards.
   */
  openAlertId?: string | null;
  /**
   * The customer's own name for one camera.
   *
   * ⚠ NOT DERIVED FROM `towers` HERE. A tower carries no camera list on this
   * screen, and the thing that knows the names is the fleet's feeds, which
   * the shell holds. Passing the lookup rather than the data keeps one answer
   * for "what is this camera called" across the wall, the panel and here.
   */
  cameraNameOf?: CameraNameOf;
  /**
   * Names one DEVICE, tower or hub, by id and alert type.
   *
   * Optional, and the fleet lookup stands behind it: a tower alert reads the
   * same with or without this, and a hub alert is the one that needs it.
   */
  nameOf?: NameOf;
  /** Re-read one alert for fresh clip URLs. See `useClipHealth`. */
  onRefreshAlert?: (id: string) => Promise<void>;
  /**
   * Acknowledge everything up to and including one alert.
   *
   * ⚠ THE SHELL OWNS THE WRITE, as it owns every other one. This screen
   * decides the WINDOW -- which alert is the far bound and which moment is
   * the near one -- and how many the operator is agreeing to; what happens
   * to the feed, the cards and the badge afterwards is one place above here.
   * Absent means the button is not offered at all, which is what a harness
   * with no server gets.
   */
  onAcknowledgeAll?: (upTo: string, from?: string) => Promise<void>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  const [pickerOpen, setPickerOpen] = useState(false);
  /* Applied once per id. Pressing Open on a second card for the same alert
     re-opens it, which is right; re-rendering for any other reason does not. */
  useEffect(() => {
    if (openAlertId) setSelectedId(openAlertId);
  }, [openAlertId]);
  const [playing, setPlaying] = useState<{
    alert: Alert;
    at: number;
    attachment: AlertAttachment;
    companions?: AlertAttachment[];
    /**
     * WHICH CAMERA IS THE LEADER, for a server alert.
     *
     * ⚠ THE CAMERA, NOT THE CLIP KEY, AND NOT THE ATTACHMENT. The attachment
     * captured when the hero was pressed is a SNAPSHOT, and an open player
     * holding one is the shape of the lab's bug one step further on: a 2K cut
     * landing while somebody is watching changes the alert and changes
     * nothing on screen. The clip key is no better, because the upgrade is a
     * NEW key for the same camera. A camera number is the one identity that
     * survives the swap, so the panes below are re-derived from the live
     * alert on every render and the player is handed today's URLs.
     *
     * `null` for a fixture, which has no cameras and no updates.
     */
    camera: number | null;
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

  /* ⚠ THE SHELL'S RESOLVER FIRST, AND THE FLEET ONLY AS A FALLBACK. A
     `HUB_OFFLINE` row's device is a HUB, which is not in `towers` under any
     id — the fleet holds its MAST — so the lookup below answers `undefined`
     for a box with a name somebody chose, and the row would read
     `hub-kln-lab`. The shell knows both lists; this screen is handed the one
     function that asks the right one. See `NameOf`.

     The RAW name, for the copy layer, which capitalises on its own. */
  const nameOf: NameOf = (deviceId, type) =>
    resolveName?.(deviceId, type) ??
    towers.find((t) => t.id === deviceId)?.site;
  const siteOf = (alert: Alert) =>
    deviceName(nameOf(alert.towerId, alert.site?.type) || alert.towerId);

  /* Unclaimed is the count that means anything on a fleet feed. The total is
     every alert these towers have ever raised, which on a wall that has been
     up for a week is a number nobody acts on. */
  const unclaimed = visible.filter((a) => a.status === "triggered").length;

  /* ── ACKNOWLEDGE ALL ──────────────────────────────────────────────────

     ⚠ THE BOUND IS THE NEWEST ROW ON SCREEN, AND THAT IS THE POINT OF THE
     ROUTE. An operator presses this having read a list. A camera that stops
     while the dialog is open was not in that list and nobody has seen it, so
     an unbounded bulk write would claim it -- and the single thing an
     acknowledgement means in this product is that a person noticed.

     ⚠ AND IT HAS TO BE A SERVER ALERT. This feed is the server's rows plus
     the two this side still raises (the state simulator's, and a detection
     whose identity was rejected). A local id as `up_to` is an id the server
     has never heard of, so the newest SERVER row is the bound and the local
     ones are left exactly as they are -- they were never on the wire and
     cannot be acknowledged on it. */
  const bound = visible.find((a) => a.site !== undefined) ?? null;
  const upTo = bound?.site?.id ?? null;
  /**
   * ⚠ AND THE NEAR BOUND IS THE DATE FILTER'S OWN START.
   *
   * The sweep is a window and both ends are this screen. Before the route
   * took a `from` it had only the anchor, so a filtered view's button
   * reached back past everything the operator had filtered OUT of it -- a
   * week nobody had looked at, cleared by a click on a screen showing
   * Tuesday. The dialog had to state the larger number for that reason, and
   * stating it was the honest half of a bad bargain: the operator was being
   * asked to agree to rows they could not see.
   *
   * With both ends sent, the write is the view. So the number below is
   * simply what is on screen, which is the number somebody would have
   * counted themselves.
   *
   * Computed from the same `now` that built `visible` -- the rolling presets
   * are arithmetic off the current moment, and a bound computed a second
   * later describes a slightly different list than the one on screen.
   */
  const from = filterFromIso(filter, now);
  /**
   * How many rows this will acknowledge: unacknowledged, on screen, and the
   * server's.
   *
   * Local rows are excluded: the two kinds this side still raises were never
   * on the wire and cannot be acknowledged on it. They are also why this is
   * not `unclaimed` above, which counts them because it is describing the
   * screen rather than a write.
   */
  const ackCount = visible.filter(
    (a) => a.status === "triggered" && a.site !== undefined,
  ).length;
  const canAckAll = Boolean(onAcknowledgeAll) && ackCount > 0 && upTo !== null;
  const [asking, setAsking] = useState(false);
  const [acking, setAcking] = useState(false);
  const [ackProblem, setAckProblem] = useState<string | null>(null);
  /* A synchronous latch. Two fast clicks on Acknowledge all both read the
     same stale `acking` and both post -- the shape `SignOutConfirm` and
     `AuthProvider` both document. */
  const inFlight = useRef(false);

  const confirmAckAll = async () => {
    if (inFlight.current || upTo === null || !onAcknowledgeAll) return;
    inFlight.current = true;
    setAcking(true);
    setAckProblem(null);
    try {
      await onAcknowledgeAll(upTo, from);
      setAsking(false);
    } catch (err) {
      /* ⚠ THE SERVER'S OWN SENTENCE WHEN IT HAS ONE, AND THE LIST IS LEFT
         ALONE. A refusal here is three different mistakes with three
         different remedies -- a list gone stale, a date it could not read, a
         range that ends before it starts -- and only one side knows which.
         Nothing was written optimistically, so there is nothing to roll
         back: the rows on screen are still the last thing the server said. */
      setAckProblem(describeAckAllFailure(err));
      setAsking(false);
    } finally {
      inFlight.current = false;
      setAcking(false);
    }
  };

  // What each preset would return, shown inline in the picker.
  const counts = Object.fromEntries(
    RANGES.map((r) => [
      r.id,
      applyDateFilter(alerts, { range: r.id }, now).length,
    ]),
  );


  /* ── THE OPEN PLAYER'S PANES, RE-DERIVED EVERY RENDER ────────────────
     See `playing.camera`. The alert in the feed is the truth; `playing` only
     records WHICH of its cameras is leading and where the clip starts. A
     clip arriving, a 2K cut landing, or a re-minted ticket all reach an open
     player this way and by no other route. */
  const liveAlert =
    playing !== null
      ? (alerts.find((a) => a.id === playing.alert.id) ?? playing.alert)
      : null;
  const livePanes =
    liveAlert?.site && playing?.camera !== null && playing !== null
      ? alertPanes(liveAlert.site, cameraNameOf)
      : [];
  const leadPane =
    playing?.camera !== null && playing !== null
      ? livePanes.find((p) => p.clip.camera === playing.camera)
      : undefined;
  const playAttachment = leadPane?.attachment ?? playing?.attachment;
  const playCompanions = leadPane
    ? livePanes.filter((p) => p !== leadPane).map((p) => p.attachment)
    : playing?.companions;

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
              className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-body-ink"
            >
              TOWERS
            </button>
            <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
            <span
              aria-current="page"
              className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink"
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
                : "text-muted hover:text-body-ink"
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
            <span className="text-[0.75rem] text-body-ink/35 tabular-nums">
              {visible.length} of {alerts.length}
            </span>
          </div>
        )}

        {/* WHAT IS OUTSTANDING, AND THE ONE CONTROL THAT CLEARS IT. The
            sentence used to be the whole row; the button sits beside it
            because the number is the reason anybody presses it. */}
        {onAcknowledgeAll && (
          <div className="flex shrink-0 items-center justify-between gap-[8px] border-b border-line px-[15px] py-[8px]">
            <span className="min-w-0 truncate text-[0.75rem] leading-[16px] text-muted tabular-nums">
              {visible.length > 0 && !filtered
                ? `${unclaimed} of ${visible.length} not yet acknowledged`
                : ""}
            </span>
            <button
              type="button"
              data-ack-all
              disabled={!canAckAll || acking}
              onClick={() => setAsking(true)}
              /* Disabled rather than hidden at zero. A control that comes and
                 goes with the feed is one an operator stops looking for, and
                 "there is nothing to do" is a thing worth being able to read
                 off the screen. */
              className="h-[24px] shrink-0 rounded-[4px] border border-stroke px-[10px] text-[0.75rem] text-sub transition-colors hover:bg-card-hover hover:text-body-ink disabled:cursor-not-allowed disabled:border-stroke/50 disabled:text-sub/35 disabled:hover:bg-transparent"
            >
              Acknowledge all
            </button>
          </div>
        )}
        {!onAcknowledgeAll && !filtered && visible.length > 0 && (
          <p className="shrink-0 border-b border-line px-[15px] py-[8px] text-[0.75rem] leading-[16px] text-muted tabular-nums">
            {unclaimed} of {visible.length} not yet acknowledged
          </p>
        )}

        {ackProblem && (
          <p
            data-ack-problem
            className="shrink-0 border-b border-line px-[15px] py-[8px] text-[0.75rem] leading-[16px] text-critical"
          >
            {ackProblem}
          </p>
        )}

        {problem && (
          <p
            data-alert-problem
            className="shrink-0 border-b border-line px-[15px] py-[8px] text-[0.75rem] leading-[16px] text-critical"
          >
            {problem}
          </p>
        )}
        {!problem && paused && <PausedNotice />}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[15px] pb-[20px] pt-[20px]">
          {visible.length === 0 ? (
            /* ⚠ AND NOT WHEN THE READ FAILED. `AlertsEmpty`'s own header
               says a quiet feed is a GOOD state and draws it that way, with
               no action, because there is nothing to fix. Over a request the
               server refused that is the same picture carrying the opposite
               meaning, and the operator has no way to tell. The sentence
               above has already said what happened; this would contradict
               it three inches below. */
            problem ? null : (
              <AlertsEmpty
                filtered={filtered}
                onClearFilters={() => setFilter(NO_FILTER)}
              />
            )
          ) : (
            /* Scopes the shared accent bar to this list, so it cannot be
               captured by another list mounted at the same time. */
            <LayoutGroup id="fleet-alerts">
              <ul className="flex flex-col gap-[22px]">
                {visible.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    site={siteOf(alert)}
                    selected={alert.id === selectedId}
                    onSelect={() => setSelectedId(alert.id)}
                    onPlay={
                      alert.attachment &&
                      (() =>
                        setPlaying({
                          alert,
                          at: alert.at,
                          attachment: alert.attachment!,
                          /* A fixture's own clip card. See above. */
                          camera: null,
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
              nameOf={nameOf}
              cameraNameOf={cameraNameOf}
              onRefresh={onRefreshAlert}
              onClose={() => setSelectedId(null)}
              onAcknowledge={() => onSetStatus(selected.id, "acknowledged")}
              onResolve={() => onSetStatus(selected.id, "resolved")}
              /* Keyed by alert id upstream. This feed has the same trap as the
                 tower panel's — the detail is rendered without a key so the
                 content swaps in place — and the same protection. */
              statusPhase={statusMutation?.phase(selected.id)}
              onRetryStatus={() => void statusMutation?.retry(selected.id)}
              onDismissStatus={() => statusMutation?.reset(selected.id)}
              rejectPhase={rejectMutation?.phase(`reject:${selected.id}`)}
              onRetryReject={() =>
                void rejectMutation?.retry(`reject:${selected.id}`)
              }
              onWatchPerson={() => onWatchPerson?.(selected)}
              onRejectMatch={() => onRejectMatch?.(selected.id)}
              onPlayClip={(at, attachment, companions, camera) =>
                setPlaying({
                  alert: selected,
                  at,
                  attachment,
                  camera: camera ?? null,
                  ...(companions ? { companions } : {}),
                })
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

      {asking && (
        <AcknowledgeAllConfirm
          count={ackCount}
          busy={acking}
          onCancel={() => {
            if (acking) return;
            setAsking(false);
          }}
          onConfirm={() => void confirmAckAll()}
        />
      )}

      <AnimatePresence>
        {playing && (
          <ClipPlayer
            key={`${playing.alert.id}-${playing.at}`}
            attachment={playAttachment ?? playing.attachment}
            {...(playCompanions && playCompanions.length > 0
              ? { companions: playCompanions }
              : {})}
            at={playing.at}
            alert={playing.alert}
            towerName={siteOf(playing.alert)}
            onNavigate={onNavigate}
            onClose={() => setPlaying(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
