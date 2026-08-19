import { AnimatePresence } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertsPanel } from "@/components/AlertsPanel";
import { CameraSettingsPanel } from "@/components/CameraSettingsPanel";
import { CameraTile } from "@/components/CameraTile";
import { IconRail } from "@/components/IconRail";
import { MobileViewBar, type MobileView } from "@/components/MobileViewBar";
import { LiveViewBanner } from "@/components/LiveViewBanner";
import { NewAlertBanner } from "@/components/NewAlertBanner";
import { StateSimulator, type SimState } from "@/components/StateSimulator";
import { TopBar, type WallLayout } from "@/components/TopBar";
import { NO_FILTER, type DateFilter } from "@/lib/dateFilter";
import type { Alert, CameraFeed, CameraSettings, Tower } from "@/lib/types";

/**
 * One tower: its camera wall and its alerts feed.
 *
 * Reached by drilling in from the fleet dashboard, which is what the breadcrumb
 * at the top of this view goes back to. Camera and alert state are owned by the
 * app shell rather than here, so the fleet wall and this one are looking at the
 * same telemetry — two copies of a ticking latency walk would disagree within a
 * second of each other.
 */
export function TowerView({
  tower,
  feeds,
  alerts,
  showAlerts = false,
  onBack,
  onSetFeedState,
  onRetryFeed,
  onToggleRecord,
  onRaiseAlert,
  onNavigate,
  cameraSettings,
  onChangeSettings,
  onRenameTower,
  settingsOpen,
  onToggleSettings,
  onCloseSettings,
  onSetStatus,
  onWatchPerson,
  onRejectMatch,
  liveViewWarning = false,
  onDismissLiveViewWarning,
  onToggleLiveViewWarning,
}: {
  tower: Tower;
  /** This tower's cameras, already filtered by the shell. */
  feeds: CameraFeed[];
  /** This tower's alerts, already filtered by the shell. */
  alerts: Alert[];
  /** Arrive on the alerts feed rather than the wall. Set when the operator
   *  came in through a fleet card's alert count — they asked a question about
   *  alerts, and the answer should not be one more click away. */
  showAlerts?: boolean;
  onBack: () => void;
  onSetFeedState: (feedId: string, state: SimState) => void;
  onRetryFeed: (feedId: string) => void;
  onToggleRecord: (feedId: string) => void;
  /** Returns the alert it created, so the banner can be armed against it. */
  onRaiseAlert: (towerId: string) => Alert;
  /** Rail destinations, routed by the shell. */
  onNavigate: (id: string) => void;
  /** One camera's settings, defaulted by the shell so this view never has to
   *  decide what an unset camera does. */
  cameraSettings: (towerId: string) => CameraSettings;
  onChangeSettings: (towerId: string, next: Partial<CameraSettings>) => void;
  /** Rename the tower. Sweeps every reference — see App. */
  onRenameTower: (from: string, to: string) => void;
  /** Owned by the shell — see the note there on renaming. */
  settingsOpen: boolean;
  onToggleSettings: () => void;
  onCloseSettings: () => void;
  onSetStatus: (id: string, status: Alert["status"]) => void;
  /** Enrol the person in a detection. Hands the whole alert up because the
   *  watchlist wants its frame and its zone, not just an id. */
  onWatchPerson?: (alert: Alert) => void;
  onRejectMatch?: (id: string) => void;
  /** This tower has been streaming for long enough to be worth mentioning —
   *  the shell keeps the clock, because this view remounts on every drill-in.
   *  See `LIVE_VIEW_WARNING_SEC` in App. */
  liveViewWarning?: boolean;
  onDismissLiveViewWarning?: () => void;
  /** Wind the viewing clock to the threshold and back — the simulator's only
   *  way to reach a state that otherwise takes ten real minutes. */
  onToggleLiveViewWarning?: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  const [alertsEmpty, setAlertsEmpty] = useState(false);
  const [focusedFeed, setFocusedFeed] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  /* Portrait by default: side by side gives each camera the full height of the
     wall, which is the axis a fixed camera watching a yard actually needs.
     Only applies at lg and up; below that the wall is always stacked. */
  const [layout, setLayout] = useState<WallLayout>("portrait");
  /* Below lg the wall and the alerts feed each want the whole screen — at
     768px a three-pane split leaves the wall ~280px, narrower than a phone.
     Both this and the collapse below open on the feed when that is what the
     operator came for; the two are separate because they are the desktop and
     mobile halves of the same question, and only one of them is on screen. */
  const [mobileView, setMobileView] = useState<MobileView>(
    showAlerts ? "alerts" : "wall",
  );
  /* Collapsed by default: the wall is the job, and the alerts feed announces
     itself when it has something (banner plus a dot on the bell). It also keeps
     portrait tiles at a usable aspect — with the panel open they narrow to 0.55
     and object-cover throws away roughly two thirds of each frame's width.

     Desktop only. Below lg the panel is already one of two switchable views,
     so collapsing it there would just leave the operator on a blank screen. */
  const [alertsCollapsed, setAlertsCollapsed] = useState(!showAlerts);
  /* The id of an alert that arrived while the feed was out of sight. Held
     separately from `alerts` because it is a notification, not a status — the
     alert stays in the list whether or not the banner is still up. */
  const [newAlertId, setNewAlertId] = useState<string | null>(null);

  const newAlert = alerts.find((a) => a.id === newAlertId) ?? null;

  /* Prototype trigger. A real deployment gets these from the alert stream;
     the shape that matters is that arrival and acknowledgement are separate. */
  const raiseAlert = useCallback(() => {
    const alert = onRaiseAlert(tower.id);

    /* Only flag it as unseen if the feed is genuinely not on screen. CSS
       already hides the banner in that case, but leaving the id set would make
       it surface later — the operator collapses the panel an hour on and gets
       announced an alert they read when it landed. */
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const feedVisible = wide ? !alertsCollapsed : mobileView === "alerts";
    if (!feedVisible) setNewAlertId(alert.id);
  }, [alertsCollapsed, mobileView, onRaiseAlert, tower.id]);

  /* The simulator lost its rail button along with the nav icons, so it lives on
     Shift+S until the new icon set lands. Ignored while typing in a field. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (e.shiftKey && (e.key === "S" || e.key === "s")) {
        e.preventDefault();
        setSimOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  /* Camera identity never changes, only telemetry does, so the switcher reads
     the ids from a ref rather than depending on `feeds` — depending on it
     directly would rebuild this callback on every latency tick and tear down
     the key handler that owns it. */
  const feedIds = useRef<string[]>([]);
  feedIds.current = feeds.map((f) => f.id);
  const switchCamera = useCallback((delta: 1 | -1) => {
    setFullscreenId((current) => {
      const ids = feedIds.current;
      if (!current || ids.length === 0) return current;
      const i = ids.indexOf(current);
      return ids[(i + delta + ids.length) % ids.length];
    });
  }, []);

  return (
    /* dvh, not vh: on mobile Safari/Chrome the URL bar makes 100vh taller
       than the visible area, which would push the bottom bar off-screen. */
    <div className="flex h-[100dvh] w-full overflow-hidden bg-ink">
      <IconRail
        active="towers"
        onSelect={onNavigate}
        onMore={() => setSimOpen((o) => !o)}
        moreOpen={simOpen}
        className="hidden lg:block"
      />

      <div
        className={`min-w-0 flex-1 flex-col ${
          mobileView === "wall" ? "flex" : "hidden lg:flex"
        }`}
      >
        <TopBar
          towerName={tower.site}
          batteryPct={tower.batteryPct}
          online={tower.status !== "offline"}
          onNavigateUp={onBack}
          layout={layout}
          onToggleLayout={() =>
            setLayout((l) => (l === "landscape" ? "portrait" : "landscape"))
          }
          alertsCollapsed={alertsCollapsed}
          alertsUnread={Boolean(newAlertId)}
          /* Reopening the feed is itself an answer to the banner. */
          onExpandAlerts={() => {
            setAlertsCollapsed(false);
            setNewAlertId(null);
          }}
          onOpenSettings={onToggleSettings}
          settingsOpen={settingsOpen}
        />

        {/* Shown only where the alerts feed itself is not: collapsed on
            desktop, or on the camera view on a phone. If the feed is on
            screen the banner would be reporting something already visible. */}
        <AnimatePresence>
          {newAlert && (
            <NewAlertBanner
              alert={newAlert}
              className={`${mobileView === "wall" ? "flex" : "hidden"} ${
                alertsCollapsed ? "lg:flex" : "lg:hidden"
              }`}
              onView={() => {
                setAlertsCollapsed(false);
                setMobileView("alerts");
                setSelectedId(newAlert.id);
                setNewAlertId(null);
              }}
              onDismiss={() => setNewAlertId(null)}
            />
          )}
        </AnimatePresence>

        {/* Under the alert banner when both are up. They are the same bar in
            two tones and the order is the priority: something that just
            happened at the site outranks a standing note about the battery,
            so the red stays against the top bar and the amber gives way. */}
        <AnimatePresence>
          {liveViewWarning && (
            <LiveViewBanner
              onDismiss={() => onDismissLiveViewWarning?.()}
            />
          )}
        </AnimatePresence>

        {/* Always stacked below lg — side-by-side would give each tile ~180px,
            too small to identify anyone, which is the whole job. The bottom
            bar overlays the last ~60px, so the wall pads clear of it. */}
        <main
          className={`flex min-h-0 flex-1 flex-col gap-[6px] px-[7px] py-[5px] pb-[calc(60px+env(safe-area-inset-bottom))] lg:pb-[5px] ${
            layout === "landscape" ? "lg:flex-col" : "lg:flex-row"
          }`}
        >
          {feeds.map((feed) => (
            <CameraTile
              key={feed.id}
              feed={feed}
              towerId={tower.id}
              focused={focusedFeed === feed.id}
              fullscreen={fullscreenId === feed.id}
              /* Shared across every tile on purpose. The takeover changes
                 one tile's `fullscreen` but reflows all of them, so gating
                 the layout measurement on a per-tile boolean would leave the
                 siblings unmeasured — and snapping. The layout axis is in
                 here for the same reason: it reflows the wall, so it has to
                 open the measurement gate or the toggle jumps. Same for
                 collapsing the alerts panel — anything that changes a tile's
                 box belongs in this key. */
              layoutKey={`${fullscreenId ?? ""}|${layout}|${alertsCollapsed}|${newAlertId ?? ""}|${liveViewWarning}`}
              canSwitch={feeds.length > 1}
              onFocus={() => setFocusedFeed(feed.id)}
              onRetry={() => onRetryFeed(feed.id)}
              onToggleRecord={() => onToggleRecord(feed.id)}
              onToggleFullscreen={() =>
                setFullscreenId((id) => (id === feed.id ? null : feed.id))
              }
              onSwitchCamera={switchCamera}
            />
          ))}
        </main>
      </div>

      {/* Over the alerts rail rather than beside it. The operator needs the
          wall in view while they change what the camera reports, and the rail
          is the one thing on this screen they are not reading at that moment —
          it is a list of what already happened. */}
      {settingsOpen ? (
        <CameraSettingsPanel
          tower={tower}
          feeds={feeds}
          settings={cameraSettings(tower.id)}
          onRename={(next) => onRenameTower(tower.id, next)}
          onChange={(next) => onChangeSettings(tower.id, next)}
          onClose={onCloseSettings}
          /* It stands where the alerts feed stands, so it takes that column's
             breakpoint rule: below lg this column is one of two switchable
             views, and a panel that ignored that rendered *beside* the wall
             with both squeezed to half a phone.

             It does *not* take that column's collapse. `alertsCollapsed` is
             true on every ordinary drill-in — the wall is the job and the feed
             announces itself — so copying the whole class string from
             `AlertsPanel`, `lg:hidden` included, meant the gear mounted a panel
             that was display:none and looked like a dead button. Collapse is a
             state of the alerts feed; this panel is what replaces it. */
          className={mobileView === "alerts" ? "flex" : "hidden lg:flex"}
        />
      ) : (
      <AlertsPanel
        alerts={alerts}
        towerName={tower.site}
        onNavigate={onNavigate}
        selectedId={selectedId}
        filter={filter}
        forceEmpty={alertsEmpty}
        onSelect={setSelectedId}
        onFilterChange={setFilter}
        onAcknowledge={(id) => onSetStatus(id, "acknowledged")}
        onResolve={(id) => onSetStatus(id, "resolved")}
        onWatchPerson={onWatchPerson}
        onRejectMatch={onRejectMatch}
        onCollapse={() => setAlertsCollapsed(true)}
        /* Collapse only removes the desktop column; the mobile view is still
           reachable from the bottom bar, so `lg:hidden` beats `lg:flex`. */
        className={`${mobileView === "alerts" ? "flex" : "hidden lg:flex"} ${
          alertsCollapsed ? "lg:hidden" : ""
        }`}
      />
      )}

      <MobileViewBar
        view={mobileView}
        alertCount={alerts.length}
        onSelect={setMobileView}
      />

      {simOpen && (
        <StateSimulator
          feeds={feeds}
          alertsEmpty={alertsEmpty}
          liveViewWarning={liveViewWarning}
          onSetFeedState={onSetFeedState}
          onToggleAlertsEmpty={() => setAlertsEmpty((e) => !e)}
          onToggleLiveViewWarning={() => onToggleLiveViewWarning?.()}
          onRaiseAlert={raiseAlert}
          onClose={() => setSimOpen(false)}
        />
      )}
    </div>
  );
}
