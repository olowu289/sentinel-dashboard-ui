import { useCallback, useEffect, useState } from "react";
import { AlertsPanel } from "@/components/AlertsPanel";
import { CameraTile } from "@/components/CameraTile";
import { IconRail } from "@/components/IconRail";
import { StateSimulator, type SimState } from "@/components/StateSimulator";
import { TopBar } from "@/components/TopBar";
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
          return { ...f, state: "connecting", elapsedSec: 12, error: undefined };
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

  const camerasOnline = feeds.filter(
    (f) => !f.error && f.state !== "offline" && f.state !== "connecting",
  ).length;

  return (
    <div className="flex h-screen w-full overflow-hidden bg-ink">
      <IconRail onMore={() => setSimOpen((o) => !o)} moreOpen={simOpen} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          towerId={TOWER.id}
          online={TOWER.online}
          camerasOnline={camerasOnline}
          camerasTotal={feeds.length}
        />

        <main className="flex min-h-0 flex-1 flex-col gap-[6px] px-[7px] py-[5px]">
          {feeds.map((feed) => (
            <CameraTile
              key={feed.id}
              feed={feed}
              towerId={TOWER.id}
              focused={focusedFeed === feed.id}
              fullscreen={fullscreenId === feed.id}
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
      />

      {simOpen && (
        <StateSimulator
          feeds={feeds}
          alertsEmpty={alertsEmpty}
          onSetFeedState={setFeedState}
          onToggleAlertsEmpty={() => setAlertsEmpty((e) => !e)}
          onClose={() => setSimOpen(false)}
        />
      )}
    </div>
  );
}
