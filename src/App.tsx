import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { AlertsPanel } from "@/components/AlertsPanel";
import { CameraTile } from "@/components/CameraTile";
import { IconRail } from "@/components/IconRail";
import { MobileViewBar, type MobileView } from "@/components/MobileViewBar";
import { NewAlertBanner } from "@/components/NewAlertBanner";
import { StateSimulator, type SimState } from "@/components/StateSimulator";
import { TopBar, type WallLayout } from "@/components/TopBar";
import { ALERTS, FEEDS, TOWER } from "@/lib/data";
import { NO_FILTER, type DateFilter } from "@/lib/dateFilter";
import type { Alert, CameraFeed } from "@/lib/types";

const STREAM_ERROR = "RTSP handshake timeout · ERR_504";

/** Each camera's resting latency, captured before the walk starts moving it. */
const BASELINE = new Map(FEEDS.map((f) => [f.id, f.latencyMs ?? 100]));

export function TowerView() {
  const [feeds, setFeeds] = useState<CameraFeed[]>(FEEDS);
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<DateFilter>(NO_FILTER);
  const [alertsEmpty, setAlertsEmpty] = useState(false);
  const [focusedFeed, setFocusedFeed] = useState<string | null>(null);
  const [fullscreenId, setFullscreenId] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(false);
  const [layout, setLayout] = useState<WallLayout>("landscape");
  /* Below lg the wall and the alerts feed each want the whole screen — at
     768px a three-pane split leaves the wall ~280px, narrower than a phone. */
  const [mobileView, setMobileView] = useState<MobileView>("wall");
  /* Desktop only. Below lg the panel is already one of two switchable views,
     so collapsing it there would just leave the operator on a blank screen. */
  const [alertsCollapsed, setAlertsCollapsed] = useState(false);
  /* The id of an alert that arrived while the feed was out of sight. Held
     separately from `alerts` because it is a notification, not a status — the
     alert stays in the list whether or not the banner is still up. */
  const [newAlertId, setNewAlertId] = useState<string | null>(null);

  const newAlert = alerts.find((a) => a.id === newAlertId) ?? null;

  /* Prototype trigger. A real deployment gets these from the alert stream;
     the shape that matters is that arrival and acknowledgement are separate. */
  const raiseAlert = useCallback(() => {
    const at = Date.now();
    const alert: Alert = {
      id: `ALT-${Math.floor(at / 1000) % 100000}`,
      kind: "alert",
      title: "Alert raised by Motion Sensor on Gas Yard",
      at,
      status: "triggered",
      source: "Motion Sensor",
      zone: "Gas Yard",
    };
    setAlerts((prev) => [alert, ...prev]);

    /* Only flag it as unseen if the feed is genuinely not on screen. CSS
       already hides the banner in that case, but leaving the id set would make
       it surface later — the operator collapses the panel an hour on and gets
       announced an alert they read when it landed. */
    const wide = window.matchMedia("(min-width: 1024px)").matches;
    const feedVisible = wide ? !alertsCollapsed : mobileView === "alerts";
    if (!feedVisible) setNewAlertId(alert.id);
  }, [alertsCollapsed, mobileView]);

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

  /* Recording timers advance client-side so the chip stays honest without
     re-fetching. Live feeds carry no counter — only capture does. */
  useEffect(() => {
    const t = setInterval(() => {
      setFeeds((prev) =>
        prev.map((f) =>
          f.state === "recording"
            ? { ...f, elapsedSec: (f.elapsedSec ?? 0) + 1 }
            : f,
        ),
      );
    }, 1000);
    return () => clearInterval(t);
  }, []);

  /* Live latency. A random walk that is pulled back toward each camera's
     baseline, rather than pure noise — real links wander and settle, they do
     not resample from scratch every tick. A degraded state raises the floor so
     the number can never contradict the word next to it. */
  useEffect(() => {
    const t = setInterval(() => {
      setFeeds((prev) =>
        prev.map((f) => {
          if (f.error || f.state === "offline" || f.state === "connecting") {
            return f;
          }
          const baseline = BASELINE.get(f.id) ?? 100;
          const floor =
            f.state === "frozen" ? 600 : f.state === "delayed" ? 320 : 0;
          const target = Math.max(baseline, floor);
          const current = f.latencyMs ?? target;
          const pull = (target - current) * 0.3;
          const jitter = (Math.random() - 0.5) * Math.max(6, target * 0.3);
          // Hold the walk inside one digit count. A number that swings 9 → 122
          // changes width every tick, and reserving a fixed box for it just
          // moves the problem into a visible gap after the separator.
          const [lo, hi] = target < 100 ? [10, 99] : [100, 999];
          const next = Math.round(current + pull + jitter);
          return { ...f, latencyMs: Math.min(hi, Math.max(lo, next)) };
        }),
      );
    }, 1400);
    return () => clearInterval(t);
  }, []);

  const setFeedState = useCallback((feedId: string, state: SimState) => {
    setFeeds((prev) =>
      prev.map((f) => {
        if (f.id !== feedId) return f;
        if (state === "error") {
          return { ...f, state: "offline", error: STREAM_ERROR };
        }
        // A reconnect is a connect that has already failed — the elapsed
        // counter is what promotes it to the "signal lost" tier.
        if (state === "reconnecting") {
          return {
            ...f,
            state: "connecting",
            elapsedSec: 12,
            error: undefined,
          };
        }
        const base: CameraFeed = { ...f, state, error: undefined };
        if (state === "recording") {
          return { ...base, elapsedSec: f.elapsedSec ?? 0 };
        }
        if (state === "frozen") return { ...base, elapsedSec: 45 };
        return { ...base, elapsedSec: undefined };
      }),
    );
  }, []);

  const retryFeed = useCallback(
    (feedId: string) => {
      setFeedState(feedId, "connecting");
      // A retry that resolves instantly reads as a no-op; hold the connecting
      // state long enough for the operator to see the attempt.
      setTimeout(() => setFeedState(feedId, "live"), 2400);
    },
    [setFeedState],
  );

  const toggleRecord = useCallback((feedId: string) => {
    setFeeds((prev) =>
      prev.map((f) =>
        f.id === feedId
          ? f.state === "recording"
            ? { ...f, state: "live", elapsedSec: undefined }
            : { ...f, state: "recording", elapsedSec: 0 }
          : f,
      ),
    );
  }, []);

  const setStatus = useCallback((id: string, status: Alert["status"]) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status, acknowledgedBy: a.acknowledgedBy ?? "A. Okafor" }
          : a,
      ),
    );
  }, []);

  /* Reads the static FEEDS rather than the live `feeds` state: camera identity
     never changes, only its telemetry does, so this stays a stable callback
     instead of being rebuilt on every latency tick. */
  const switchCamera = useCallback((delta: 1 | -1) => {
    setFullscreenId((current) => {
      if (!current) return current;
      const i = FEEDS.findIndex((f) => f.id === current);
      return FEEDS[(i + delta + FEEDS.length) % FEEDS.length].id;
    });
  }, []);

  /* Honours the OS setting for every motion component below. Complements the
     @media block in index.css, which covers the CSS keyframes motion knows
     nothing about — including the siren, which deliberately stays lit rather
     than disappearing. The two are not redundant; don't consolidate them. */
  return (
    <MotionConfig reducedMotion="user">
      {/* dvh, not vh: on mobile Safari/Chrome the URL bar makes 100vh taller
          than the visible area, which would push the bottom bar off-screen. */}
      <div className="flex h-[100dvh] w-full overflow-hidden bg-ink">
        <IconRail
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
            towerId={TOWER.id}
            online={TOWER.online}
            layout={layout}
            onToggleLayout={() =>
              setLayout((l) => (l === "landscape" ? "portrait" : "landscape"))
            }
            alertsCollapsed={alertsCollapsed}
            /* Reopening the feed is itself an answer to the banner. */
            onExpandAlerts={() => {
              setAlertsCollapsed(false);
              setNewAlertId(null);
            }}
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
                towerId={TOWER.id}
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
                layoutKey={`${fullscreenId ?? ""}|${layout}|${alertsCollapsed}|${newAlertId ?? ""}`}
                canSwitch={feeds.length > 1}
                onFocus={() => setFocusedFeed(feed.id)}
                onRetry={() => retryFeed(feed.id)}
                onToggleRecord={() => toggleRecord(feed.id)}
                onToggleFullscreen={() =>
                  setFullscreenId((id) => (id === feed.id ? null : feed.id))
                }
                onSwitchCamera={switchCamera}
              />
            ))}
          </main>
        </div>

        <AlertsPanel
          alerts={alerts}
          selectedId={selectedId}
          filter={filter}
          forceEmpty={alertsEmpty}
          onSelect={setSelectedId}
          onFilterChange={setFilter}
          onAcknowledge={(id) => setStatus(id, "acknowledged")}
          onResolve={(id) => setStatus(id, "resolved")}
          onCollapse={() => setAlertsCollapsed(true)}
          /* Collapse only removes the desktop column; the mobile view is still
             reachable from the bottom bar, so `lg:hidden` beats `lg:flex`. */
          className={`${mobileView === "alerts" ? "flex" : "hidden lg:flex"} ${
            alertsCollapsed ? "lg:hidden" : ""
          }`}
        />

        <MobileViewBar
          view={mobileView}
          alertCount={alerts.length}
          onSelect={setMobileView}
        />

        {simOpen && (
          <StateSimulator
            feeds={feeds}
            alertsEmpty={alertsEmpty}
            onSetFeedState={setFeedState}
            onToggleAlertsEmpty={() => setAlertsEmpty((e) => !e)}
            onRaiseAlert={raiseAlert}
            onClose={() => setSimOpen(false)}
          />
        )}
      </div>
    </MotionConfig>
  );
}
