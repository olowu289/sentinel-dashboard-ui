import { MotionConfig } from "motion/react";
import { useCallback, useEffect, useState } from "react";
import { AddTowerView } from "@/components/AddTowerView";
import { DashboardView } from "@/components/DashboardView";
import { PeopleView } from "@/components/PeopleView";
import { TowerView } from "@/components/TowerView";
import { DEFAULT_CAMERA_SETTINGS } from "@/lib/types";
import type { SimState } from "@/components/StateSimulator";
import {
  ALERTS,
  FEEDS,
  PEOPLE,
  TOWERS,
  alertsForTower,
  feedsForTower,
  findTower,
} from "@/lib/data";
import type {
  Alert,
  CameraFeed,
  CameraSettings,
  PendingTower,
  Person,
  Tower,
} from "@/lib/types";

const STREAM_ERROR = "RTSP handshake timeout · ERR_504";

/** Whose name goes on an enrolment. Stands in for the signed-in operator —
 *  putting somebody on a watchlist is an act with an author. */
const OPERATOR = "A. Bello";

/** Each camera's resting latency, captured before the walk starts moving it. */
const BASELINE = new Map(FEEDS.map((f) => [f.id, f.latencyMs ?? 100]));

/**
 * The shell. Two screens — the fleet dashboard and one tower — and the camera
 * and alert state they share.
 *
 * That state is here rather than in either view for one reason: the recording
 * tick and the latency walk are live. Given a copy each, the fleet wall and the
 * tower wall would show different numbers for the same camera within a second
 * of each other, and an operator drilling in to check a figure would find it
 * had changed on the way. There is no router; a prototype with two screens does
 * not need URLs, and adding them would be the only thing in the repo pretending
 * to be a deployment.
 */
export function SentinelApp() {
  const [feeds, setFeeds] = useState<CameraFeed[]>(FEEDS);
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS);
  /* State rather than the module constant, because the batteries actually fill:
     these towers are off-grid and the panel is the only thing that refills
     them, so a card claiming to be charging while the number sits still is the
     one reading on this screen an operator could catch out. Up here with the
     feeds for the same reason they are — both screens show towers, and two
     copies of a moving number disagree within a second. */
  const [towers, setTowers] = useState<Tower[]>(TOWERS);
  /* The setup flow is a third screen rather than a modal. It is six steps deep
     with a phone hand-off in the middle — a dialog that size is a screen
     wearing a scrim, and it would put the fleet behind it pretending the
     operator could still reach it. */
  const [adding, setAdding] = useState(false);
  /* A claim survives leaving the flow. The unit belongs to this operator from
     the moment the phone scans, so dropping it on a navigation would strand a
     tower nobody can see and nobody else can claim — it waits in the panel
     instead, with whatever naming was done. */
  const [pending, setPending] = useState<PendingTower | null>(null);

  /* The watchlist, and the screen that edits it. Up here with the feeds and the
     towers because a match is an alert like any other — the roster and the feed
     have to be reading the same list, or a person could be removed while their
     sightings still name them. */
  const [people, setPeople] = useState<Person[]>(PEOPLE);
  const [onPeople, setOnPeople] = useState(false);
  /* A detection carried out of the alert feed and into enrolment, so the face
     the operator is already looking at is the face that gets watched for. */
  const [enrolFrom, setEnrolFrom] = useState<Alert | null>(null);

  /* Keyed by feed id rather than carried on the feed itself. `feeds` is rebuilt
     on every latency tick and recording tick, and a settings object copied
     through that loop is one more thing that can be dropped by a careless
     `map`. Undefined means untouched, which is what `DEFAULT_CAMERA_SETTINGS`
     is for — the shell answers "what does this camera do" so no view has to. */
  const [settings, setSettings] = useState<Record<string, CameraSettings>>({});

  const cameraSettings = useCallback(
    (feedId: string) => settings[feedId] ?? DEFAULT_CAMERA_SETTINGS,
    [settings],
  );

  /* Stamped on write. These decide what reaches the alert feed, so a change
     with no name on it is an unanswerable question three shifts later. */
  const changeSettings = useCallback(
    (feedId: string, next: Partial<CameraSettings>) => {
      setSettings((prev) => ({
        ...prev,
        [feedId]: {
          ...(prev[feedId] ?? DEFAULT_CAMERA_SETTINGS),
          ...next,
          changedBy: OPERATOR,
          changedAt: Date.now(),
        },
      }));
    },
    [],
  );

  const watchPerson = useCallback((alert: Alert) => {
    setEnrolFrom(alert);
    setOpen(null);
    setOnPeople(true);
  }, []);

  /* Rejecting keeps the alert and drops the identity — the camera did see
     somebody, and deleting the detection would lose that. */
  /* One rail, one router.
     Every screen renders the same `IconRail`, and until now each one wired its
     own `onSelect` — which drifted four ways: two screens had no handler at all
     and so shipped a nav bar that did not navigate, and the two that did
     disagreed about what "Towers" meant. Routing belongs to the shell that owns
     the screens, not to the screens. Add a destination here and every rail
     picks it up; wire it in a view and only that view will have it. */
  const navigate = useCallback(
    (id: string) => {
      if (id === "dashboard") {
        setOnPeople(false);
        setAdding(false);
        setOpen(null);
        return;
      }
      if (id === "add") {
        setOnPeople(false);
        setOpen(null);
        setAdding(true);
        return;
      }
      if (id === "poi") {
        setAdding(false);
        setOpen(null);
        setOnPeople(true);
        return;
      }
      if (id === "towers") {
        /* The site something last happened at. Derived here rather than in the
           dashboard so the rail means the same thing from every screen. */
        const newest = alerts.reduce<Alert | undefined>(
          (best, a) => (!best || a.at > best.at ? a : best),
          undefined,
        );
        const target = newest?.towerId ?? towers[0]?.id;
        if (!target) return;
        setOnPeople(false);
        setAdding(false);
        setOpen({ id: target, showAlerts: false });
      }
      /* `alerts` and `settings` are drawn by the frame and go nowhere yet. */
    },
    [alerts, towers],
  );

  const rejectMatch = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, matchRejected: true } : a)),
    );
  }, []);

  const enrolPerson = useCallback((person: Omit<Person, "id">) => {
    setPeople((prev) => [
      { ...person, id: `POI-${String(prev.length + 1).padStart(2, "0")}` },
      ...prev,
    ]);
  }, []);

  /* Two halves of one removal, and the split is the point. Stopping is what an
     operator does when somebody should not be watched any more: matching ends
     immediately, and the entry drops to EXPIRED where it can still be read.
     Deleting is only offered once it is already stopped — you cannot erase the
     record of somebody the fleet is still looking for, and by then the entry is
     a record rather than an instruction. */
  const stopWatching = useCallback((personId: string) => {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId ? { ...p, expiresAt: Date.now() } : p,
      ),
    );
  }, []);

  /* The alerts a person's matches raised are not touched. They record what a
     camera saw, which happened whether or not the entry still exists. */
  const deletePerson = useCallback((personId: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== personId));
  }, []);

  /* Extending is always a deliberate act, and always from *now* rather than
     from the old expiry — renewing a lapsed entry is a fresh decision to watch
     somebody, not a correction of a clerical slip. */
  const extendWatch = useCallback((personId: string, days: number) => {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId
          ? { ...p, expiresAt: Date.now() + days * 86_400_000 }
          : p,
      ),
    );
  }, []);

  /* A claimed tower arrives whole: the unit reported its own readings and the
     operator named the site and the cameras. Landing straight on it is the
     honest end of the flow — "added" is a claim you should be able to check. */
  const addTower = useCallback((tower: Tower, feeds: CameraFeed[]) => {
    setTowers((prev) => [...prev, tower]);
    setFeeds((prev) => [...prev, ...feeds]);
    setPending(null);
    setAdding(false);
    setOpen({ id: tower.id, showAlerts: false });
  }, []);
  /* null is the fleet. The dashboard is the landing screen because it is the
     parent the tower view's breadcrumb has always named.

     `showAlerts` rides along because there are two reasons to open a tower —
     to watch it, or to read what it has raised — and the fleet card offers
     both as separate targets. It is part of the key below, so arriving with a
     different intent is a fresh entry rather than a stale panel. */
  const [open, setOpen] = useState<{ id: string; showAlerts: boolean } | null>(
    null,
  );

  const openTower = useCallback(
    (id: string, showAlerts = false) => setOpen({ id, showAlerts }),
    [],
  );

  /* The fleet wall's arrangement, as feed ids. Up here rather than in the
     dashboard because that view unmounts on every drill-in — arranging a wall
     is work, and handing it back reset would teach operators not to arrange it.
     Ids rather than a reordered copy of the feeds: `feeds` is rebuilt on every
     latency tick, so anything holding the objects would go stale immediately. */
  const [wallOrder, setWallOrder] = useState<string[]>(() =>
    FEEDS.map((f) => f.id),
  );

  /* Committing a whole arrangement, for the band drag: moving a site moves
     every tile in it, and doing that through `moveTile` would walk the wall
     through intermediate arrangements nobody asked for. */
  const reorderWall = useCallback((next: string[]) => setWallOrder(next), []);

  /* Reconcile if the fleet ever gains or loses a camera. New ones land at the
     end rather than resetting the order, for the same reason. */
  const fleet = feeds.map((f) => f.id).join("|");
  useEffect(() => {
    setWallOrder((prev) => {
      const ids = fleet.split("|");
      const live = new Set(ids);
      const kept = prev.filter((id) => live.has(id));
      const added = ids.filter((id) => !prev.includes(id));
      return kept.length === prev.length && added.length === 0
        ? prev
        : [...kept, ...added];
    });
  }, [fleet]);

  /* Solar charge, 1% a second, stopping at full. The gauge on the mast sweeps
     on its own to say "taking on charge"; this is the number underneath it
     actually moving, and without it the sweep is a decoration that never
     resolves. Charging stops meaning anything at 100, so it caps there rather
     than wrapping — a battery that quietly reset to 34% would be reporting a
     fault it does not have. */
  useEffect(() => {
    const t = setInterval(() => {
      setTowers((prev) => {
        let changed = false;
        const next = prev.map((tower) => {
          if (tower.solar !== "charging" || tower.batteryPct >= 100)
            return tower;
          changed = true;
          return { ...tower, batteryPct: Math.min(100, tower.batteryPct + 1) };
        });
        // Same array when nothing moved, so a full fleet stops re-rendering.
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(t);
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

  /* Returns the alert so the caller can arm its own banner against it —
     arrival and acknowledgement stay separate concerns. */
  const raiseAlert = useCallback((towerId: string) => {
    const at = Date.now();
    const alert: Alert = {
      id: `ALT-${Math.floor(at / 1000) % 100000}`,
      towerId,
      kind: "alert",
      title: "Alert raised by Motion Sensor on Gas Yard",
      at,
      status: "triggered",
      source: "Motion Sensor",
      zone: "Gas Yard",
    };
    setAlerts((prev) => [alert, ...prev]);
    return alert;
  }, []);

  /* Honours the OS setting for every motion component below. Complements the
     @media block in index.css, which covers the CSS keyframes motion knows
     nothing about — including the siren, which deliberately stays lit rather
     than disappearing. The two are not redundant; don't consolidate them. */
  return (
    <MotionConfig reducedMotion="user">
      {onPeople ? (
        <PeopleView
          people={people}
          alerts={alerts}
          operator={OPERATOR}
          enrolFrom={enrolFrom}
          onNavigate={navigate}
          onBack={() => {
            setEnrolFrom(null);
            setOnPeople(false);
          }}
          onEnrol={(person) => {
            enrolPerson(person);
            setEnrolFrom(null);
          }}
          onExtend={extendWatch}
          onStopWatching={stopWatching}
          onDelete={deletePerson}
        />
      ) : adding ? (
        <AddTowerView
          pending={pending}
          onNavigate={navigate}
          onCancel={(draft) => {
            setPending(draft);
            setAdding(false);
          }}
          onAdd={addTower}
        />
      ) : open === null ? (
        <DashboardView
          towers={towers}
          feeds={feeds}
          alerts={alerts}
          order={wallOrder}
          onReorder={reorderWall}
          pending={pending}
          onNavigate={navigate}
          onResumeSetup={() => setAdding(true)}
          onOpenTower={openTower}
          onRetryFeed={retryFeed}
        />
      ) : (
        <TowerView
          /* Keyed on the tower so drilling into a second site starts from a
             clean panel — the collapse, filter and selection below are that
             tower's, and carrying them across would show one site's selected
             alert against another's feed. The intent is in the key for the
             same reason: opening the same tower for its alerts has to start
             on them, not on wherever the last visit was left. */
          key={`${open.id}|${open.showAlerts}`}
          tower={towers.find((t) => t.id === open.id) ?? findTower(open.id)}
          feeds={feedsForTower(feeds, open.id)}
          alerts={alertsForTower(alerts, open.id)}
          showAlerts={open.showAlerts}
          onBack={() => setOpen(null)}
          onSetFeedState={setFeedState}
          onRetryFeed={retryFeed}
          onToggleRecord={toggleRecord}
          onRaiseAlert={raiseAlert}
          onNavigate={navigate}
          cameraSettings={cameraSettings}
          onChangeSettings={changeSettings}
          onSetStatus={setStatus}
          onWatchPerson={watchPerson}
          onRejectMatch={rejectMatch}
        />
      )}
    </MotionConfig>
  );
}
