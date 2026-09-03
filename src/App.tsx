import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AddTowerView } from "@/components/AddTowerView";
import { AlertsView } from "@/components/AlertsView";
import { useSession } from "@/components/AuthProvider";
import { DashboardView } from "@/components/DashboardView";
import { PeopleView } from "@/components/PeopleView";
import { TowerView } from "@/components/TowerView";
import { DEFAULT_CAMERA_SETTINGS } from "@/lib/types";
import { isSeededFleet } from "@/lib/config";
import { listFleet } from "@/lib/api/fleet";
import { classifyReach, type ReachProblem } from "@/lib/api/reach";
import { CoordinationBanner } from "@/components/CoordinationBanner";
import { usePlayback, type PlaybackTarget } from "@/lib/usePlayback";
import { useMutation } from "@/lib/useMutation";
import type { SimState } from "@/components/StateSimulator";
import {
  ALERTS,
  FEEDS,
  PEOPLE,
  TOWERS,
  alertsForTower,
  feedsForTower,
} from "@/lib/data";
import type {
  Alert,
  CameraFeed,
  CameraSettings,
  PendingTower,
  Person,
  Tower,
} from "@/lib/types";

/**
 * The error the SIMULATOR raises, and the only fabricated transport string
 * left in the app.
 *
 * It says so in the text. A real stream failure now carries coordination's own
 * message through `PlaybackError`, printed verbatim by the tile — so the only
 * way to see this string is to have pressed the review button that produces it,
 * and an operator reviewing states should be able to tell the review apart from
 * the thing being reviewed.
 *
 * The shape is kept because it is the shape a real one takes: a transport name
 * and a code, not a sentence. `ErrorFallback` prints whatever it is given in
 * mono and never paraphrases it, which is the behaviour worth exercising.
 */
const SIMULATED_STREAM_ERROR = "SIMULATED · RTSP handshake timeout · ERR_504";

/* How long a live session runs before the tower's battery is worth mentioning.
   Ten minutes is the design's number and it is a reasonable one: long enough
   that the operator is watching rather than checking, short enough to still be
   useful on a site that is running down. Counted only while a camera is
   actually streaming, so a wall of dead feeds never accrues it. */
const LIVE_VIEW_WARNING_SEC = 10 * 60;

/** Each camera's resting latency, captured before the walk starts moving it. */
const BASELINE = new Map(FEEDS.map((f) => [f.id, f.latencyMs ?? 100]));

/**
 * A tower that is not there any more.
 *
 * Reached when an operator drills into a tower that has since gone — revoked,
 * or removed between the fleet load and the click. It says "unavailable" and
 * never "does not exist", because coordination deliberately returns one
 * indistinguishable answer for "no such tower" and "not yours" so that the
 * endpoint cannot be used to enumerate a fleet. Claiming non-existence would
 * hand back the very fact the server withheld.
 */
function TowerUnavailable({ id, onBack }: { id: string; onBack: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-[14px] bg-ink px-[24px] text-center">
      <p className="font-display text-[0.875rem] tracking-[0.14px] text-white">
        {id} IS UNAVAILABLE
      </p>
      <p className="max-w-[360px] text-[0.8125rem] leading-[20px] text-muted">
        This tower is not on your fleet any more. It may have been removed, or
        access to it may have ended.
      </p>
      <button
        type="button"
        onClick={onBack}
        className="h-[36px] rounded-[8px] bg-panel px-[16px] text-[0.8125rem] font-medium text-white transition-colors hover:bg-[#2a2a2e]"
      >
        Back to all towers
      </button>
    </div>
  );
}

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
  /* Whose name goes on an authored act — a settings change, an enrolment, a
     stopped watch. Read from the session rather than a constant, so the record
     names whoever is actually signed in.

     ⚠ It is an ORGANIZATION name, not a person's. Coordination authenticates an
     organization and its account record carries no per-user identity, so
     provenance is org-level until the protocol grows individual accounts. That
     is a real reduction against what this app's design asked for — the
     watchlist's position is that enrolling somebody is an act with a *name* on
     it — and it is recorded in `operatorName` rather than papered over.

     This component only ever renders inside `AuthGate`, so a session is always
     present here. */
  const { operator: OPERATOR } = useSession();

  /* ── THE FLEET SOURCE ─────────────────────────────────────────────────
     `sdk` is the real thing; `seed` is the fixture, kept as the way back and
     as an offline dev loop. Read once — flipping it is a restart, not a
     runtime toggle, because half a screen of each would be worse than either. */
  const seededFleet = isSeededFleet();

  const [feeds, setFeeds] = useState<CameraFeed[]>(seededFleet ? FEEDS : []);
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS);
  /* State rather than the module constant, because a seeded battery actually
     fills: those towers are off-grid and the panel is the only thing that
     refills them, so a card claiming to be charging while the number sits
     still is the one reading on that screen an operator could catch out. Up
     here with the feeds for the same reason they are — both screens show
     towers, and two copies of a moving number disagree within a second.

     A REAL tower reports no battery at all, so nothing moves and the card says
     so. See the note on `Tower`. */
  const [towers, setTowers] = useState<Tower[]>(seededFleet ? TOWERS : []);
  /* Loading and failure for the real fleet. `null` problem means fine.
     Deliberately not a spinner-forever: an absent tower is an answer. */
  const [fleetLoading, setFleetLoading] = useState(!seededFleet);
  /* Classified rather than stringified, because the four ways this can fail
     want four different things said — and one of them is "the bug is ours".
     See `api/reach.ts`. */
  const [reachProblem, setReachProblem] = useState<ReachProblem | null>(null);
  /**
   * CONSUMER 1 — reloading the fleet. The one action in the app today that
   * reaches a real server, can really fail, and can really be retried.
   *
   * Deliberate and operator-driven: there is no automatic retry anywhere,
   * because an absent answer is an answer, and a retry storm against a tower
   * is what wedged a camera in v1.
   *
   * `quiet`, because the fleet appearing IS the confirmation — a tick on a
   * banner that is about to disappear would be the control congratulating
   * itself.
   */
  const fleetReload = useMutation({ quiet: true });

  /**
   * Load the real fleet.
   *
   * One attempt, no retry loop — an absent tower is an ANSWER, NOT A WAIT.
   * StrictMode-guarded on the per-run controller, for the reason written up in
   * `AuthProvider`: our own abort is not a verdict and must not be interpreted
   * as one.
   *
   * This only ever runs inside `AuthGate`, so there is always a session to
   * carry; a 401 here is a revocation rather than a missing login, and
   * `listFleet` routes that through the single session guard.
   */
  useEffect(() => {
    if (seededFleet) return;
    const controller = new AbortController();

    void (async () => {
      try {
        const snapshot = await listFleet(controller.signal);
        if (controller.signal.aborted) return;
        setTowers(snapshot.towers);
        setFeeds(snapshot.feeds);
        setReachProblem(null);
      } catch (err) {
        if (controller.signal.aborted) return;
        /* A 401 has already dropped the gate to login by this point, so
           anything reaching here is a genuine failure to READ the fleet rather
           than a failure to be allowed one — and an empty wall with no
           explanation is what this app refuses everywhere else. */
        setReachProblem(classifyReach(err));
      } finally {
        if (!controller.signal.aborted) setFleetLoading(false);
      }
    })();

    return () => controller.abort();
    /* `fleetReload` is deliberately NOT a dependency and the mount load does
       NOT go through it. The hook coalesces concurrent runs for one key, which
       is exactly right for a button and exactly wrong here: StrictMode aborts
       the first run and starts a second, and the second would join the first's
       already-aborted promise and never fetch anything. The mount path keeps
       its own abort discipline; the hook wraps the operator's button. */
  }, [seededFleet]);

  /**
   * Reload, on purpose, from the banner.
   *
   * Sets `reachProblem` so the banner's own text stays accurate, and re-throws
   * so the mutation sees the failure and can offer a retry. Two different
   * things: the banner says what is wrong with the fleet, the mutation says
   * what the button is doing about it.
   */
  const reloadFleet = useCallback(
    () =>
      fleetReload.run("fleet", async () => {
        try {
          const snapshot = await listFleet();
          setTowers(snapshot.towers);
          setFeeds(snapshot.feeds);
          setReachProblem(null);
        } catch (err) {
          setReachProblem(classifyReach(err));
          throw err;
        }
      }),
    [fleetReload],
  );
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
  /* The fleet-wide alerts feed, off the rail's bell. A screen rather than a
     panel: it is not scoped to a tower, so there is no wall for it to sit
     beside. */
  const [onAlerts, setOnAlerts] = useState(false);
  /* Up here rather than in the tower view, because that view is keyed on the
     tower id and renaming a tower therefore remounts it — a settings panel
     that closes the moment you use it is the flaw the rename introduced. */
  const [settingsOpen, setSettingsOpen] = useState(false);
  /* null is the fleet. The dashboard is the landing screen because it is the
     parent the tower view's breadcrumb has always named.

     `showAlerts` rides along because there are two reasons to open a tower —
     to watch it, or to read what it has raised — and the fleet card offers
     both as separate targets. It is part of the key below, so arriving with a
     different intent is a fresh entry rather than a stale panel. */
  const [open, setOpen] = useState<{ id: string; showAlerts: boolean } | null>(
    null,
  );

  /* ── WHAT IS ACTUALLY BEING STREAMED ──────────────────────────────────
     Only the open tower's live cameras. Two reasons, and the second is the
     one that decided it.

     A session costs a grant on coordination and a busy camera on the tower,
     so the set has to match what the operator is looking at rather than what
     is on screen somewhere. And these are off-grid sites: this app already
     carries a banner telling an operator that live viewing drains a tower's
     battery, so opening four simultaneous streams on the *landing* screen
     would contradict its own advice. The fleet wall stays on stills.

     Cameras the tower reports as anything but live are excluded — asking for a
     session on a camera that has already said it is down burns a grant to be
     refused, and the tile has a truer thing to show. Seeded feeds are excluded
     because there is no session to open for a fixture. */
  const playbackTargets: PlaybackTarget[] = seededFleet
    ? []
    : feeds
        .filter(
          (f) =>
            open !== null &&
            f.towerId === open.id &&
            f.state === "live" &&
            f.index !== undefined,
        )
        .map((f) => ({ id: f.id, towerId: f.towerId, index: f.index! }));

  const { phases: playback, retry: retryPlayback } = usePlayback(playbackTargets);

  /* Looked up once, so the render below and the guard above cannot disagree. */
  const openTowerRecord = open ? towers.find((t) => t.id === open.id) : undefined;

  /* Every change of screen goes through here, and it closes the settings
     panel on the way. The panel belongs to the tower the operator opened it
     on: `TowerView` renders it *instead of* the alerts feed, so leaving it
     armed meant the next tower opened on its settings with no alerts at all —
     an operator who asked for a site's cameras got its configuration. Reset it
     beside `setOpen` rather than in each caller, so a new destination cannot
     forget. */
  const show = useCallback((next: { id: string; showAlerts: boolean } | null) => {
    setSettingsOpen(false);
    setOpen(next);
  }, []);

  /* A detection carried out of the alert feed and into enrolment, so the face
     the operator is already looking at is the face that gets watched for. */
  const [enrolFrom, setEnrolFrom] = useState<Alert | null>(null);

  /* Seconds the open tower has been streaming to this operator, and whether
     they have waved the notice away. Up here rather than in `TowerView`
     because that view is keyed on the tower and remounts on every drill-in —
     left down there, ducking out to the fleet and straight back would reset
     the clock, which is a way to watch a camera all afternoon and never be
     told. It resets when the *tower* changes, because then it is a different
     battery. */
  const [liveViewSec, setLiveViewSec] = useState(0);
  const [liveViewDismissed, setLiveViewDismissed] = useState(false);

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
  /* One name, everywhere it is shown. The id stays the key — feeds, alerts and
     the settings map all hang off it, and renaming a key to fix a typo is how a
     site loses its cameras — so what an operator edits is the *name*, which is
     the same field the fleet card, the band header and the breadcrumb already
     read. Editing it in settings changes all four because there is only one. */
  /**
   * CONSUMER 3 — renaming a tower.
   *
   * `quiet`: the new name appears on the fleet card, the band header, the
   * breadcrumb and the panel at once, and that IS the confirmation. A check
   * beside a field that already shows the answer is noise.
   *
   * Local today. Coordination's registry has `set_label` but serves no route
   * for it — `do_PATCH` handles only session ICE — so this is the same shape
   * auth was in before its route landed: the client half is ready and the
   * server half is not.
   */
  const renameMutation = useMutation({ quiet: true });

  /**
   * The two shared mutation instances, and the split between them is the
   * pending/success decision made once rather than argued per call site.
   *
   * ROUTINE — the new value IS the confirmation, so a check would be the
   * control congratulating itself. A renamed tower already reads as renamed; a
   * flipped setting already shows its new value; a tile that starts recording
   * changes its own glyph from a circle to a square.
   *
   * DELIBERATE — an act whose result is not obviously visible where it was
   * performed, or whose consequence is worth confirming. Stopping a watch,
   * deleting an entry, rejecting an identity: the row does not move much, and
   * "did that land?" is a question an operator should not have to ask about an
   * auditable act.
   *
   * Keys are prefixed by action, not just by target, so two different acts on
   * one person cannot collide — `stop:POI-03` and `delete:POI-03` are separate
   * even though the UI only ever offers one of them at a time.
   */
  const routine = useMutation({ quiet: true });
  const deliberate = useMutation();

  const renameTower = useCallback((towerId: string, to: string) => {
    const next = to.trim().toUpperCase();
    if (!next) return;
    setTowers((prev) =>
      prev.map((t) => (t.id === towerId ? { ...t, site: next } : t)),
    );
  }, []);

  const changeTowerName = useCallback(
    (towerId: string, to: string) =>
      renameMutation.run(towerId, async () => {
        renameTower(towerId, to);
      }),
    [renameMutation, renameTower],
  );

  const applySettings = useCallback(
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
    /* `OPERATOR` comes from the session now, so it belongs in the deps. It only
       changes on a sign-in or sign-out, and the gate unmounts this whole tree on
       either — so in practice this identity is as stable as `[]` was. */
    [OPERATOR],
  );

  /* Routine: every one of these rows shows its own new value the moment it
     lands, so there is nothing a tick would add. Zones go through here too —
     the drawn rectangle appearing on the frame is the confirmation. */
  const changeSettings = useCallback(
    (feedId: string, next: Partial<CameraSettings>) =>
      routine.run(`settings:${feedId}`, async () => {
        applySettings(feedId, next);
      }),
    [applySettings, routine],
  );

  const watchPerson = useCallback(
    (alert: Alert) => {
      setEnrolFrom(alert);
      show(null);
      setOnAlerts(false);
      setOnPeople(true);
    },
    [show],
  );

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
        setOnAlerts(false);
        show(null);
        return;
      }
      if (id === "add") {
        setOnPeople(false);
        setOnAlerts(false);
        show(null);
        setAdding(true);
        return;
      }
      if (id === "poi") {
        setAdding(false);
        setOnAlerts(false);
        show(null);
        setOnPeople(true);
        return;
      }
      if (id === "alerts") {
        setAdding(false);
        setOnPeople(false);
        show(null);
        setOnAlerts(true);
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
        setOnAlerts(false);
        show({ id: target, showAlerts: false });
      }
      /* `settings` is drawn by the frame and goes nowhere yet. */
    },
    [alerts, show, towers],
  );

  const applyRejectMatch = useCallback((id: string) => {
    setAlerts((prev) =>
      prev.map((a) => (a.id === id ? { ...a, matchRejected: true } : a)),
    );
  }, []);

  /* Deliberate. Saying "not them" drops an identity from a detection that keeps
     its own record, which is a judgement worth confirming — and it happens on
     the alerts surface, so it is keyed by alert id and held here, above the
     panel that never remounts. */
  const rejectMatch = useCallback(
    (id: string) =>
      deliberate.run(`reject:${id}`, async () => {
        applyRejectMatch(id);
      }),
    [applyRejectMatch, deliberate],
  );

  /* Monotonic, and deliberately not derived from the list. Numbering off
     `people.length` reused an id the moment anything was deleted — remove the
     first of three and the next enrolment is issued the id the third already
     holds, after which one lookup answers for two people and a stopped watch
     stops both. Reusing the id of somebody *deleted* is no better: their
     sightings are still in the alert feed under `matchedPersonId`, and they
     would silently re-attach to whoever inherited the number. The counter only
     ever goes up. */
  const nextPoi = useRef(
    PEOPLE.reduce((max, p) => Math.max(max, Number(p.id.slice(4)) || 0), 0),
  );

  const applyEnrol = useCallback((person: Omit<Person, "id">) => {
    nextPoi.current += 1;
    const id = `POI-${String(nextPoi.current).padStart(2, "0")}`;
    setPeople((prev) => [{ ...person, id }, ...prev]);
  }, []);

  /* Deliberate, and of everything in this file the one most worth confirming:
     it puts a named person under fleet-wide automated matching on one
     operator's say-so, and that person is not in the room. */
  const enrolPerson = useCallback(
    (person: Omit<Person, "id">) =>
      deliberate.run("enrol", async () => {
        applyEnrol(person);
      }),
    [applyEnrol, deliberate],
  );

  /* Two halves of one removal, and the split is the point. Stopping is what an
     operator does when somebody should not be watched any more: matching ends
     immediately, and the entry drops to EXPIRED where it can still be read.
     Deleting is only offered once it is already stopped — you cannot erase the
     record of somebody the fleet is still looking for, and by then the entry is
     a record rather than an instruction. */
  const applyStopWatching = useCallback((personId: string, reason: string) => {
    const at = Date.now();
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId
          ? {
              ...p,
              expiresAt: at,
              stoppedReason: reason,
              stoppedBy: OPERATOR,
              stoppedAt: at,
            }
          : p,
      ),
    );
  }, [OPERATOR]);

  /* Deliberate. Matching ends immediately and the entry drops to EXPIRED, and
     neither of those is loud on the card that triggered it. */
  const stopWatching = useCallback(
    (personId: string, reason: string) =>
      deliberate.run(`stop:${personId}`, async () => {
        applyStopWatching(personId, reason);
      }),
    [applyStopWatching, deliberate],
  );

  /* The alerts a person's matches raised are not touched. They record what a
     camera saw, which happened whether or not the entry still exists. */
  const applyDeletePerson = useCallback((personId: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== personId));
  }, []);

  /* Deliberate, and irreversible. The one act here with no way back, so it is
     also the one where a silent success would be least acceptable. */
  const deletePerson = useCallback(
    (personId: string) =>
      deliberate.run(`delete:${personId}`, async () => {
        applyDeletePerson(personId);
      }),
    [applyDeletePerson, deliberate],
  );

  /* Extending is always a deliberate act, and always from *now* rather than
     from the old expiry — renewing a lapsed entry is a fresh decision to watch
     somebody, not a correction of a clerical slip. */
  const applyExtendWatch = useCallback((personId: string, days: number) => {
    setPeople((prev) =>
      prev.map((p) =>
        p.id === personId
          ? {
              ...p,
              expiresAt: Date.now() + days * 86_400_000,
              /* Watching again clears why it stopped. The note describes an
                 entry that is no longer matching; left on a live one it is a
                 record contradicting the thing it is attached to. */
              stoppedReason: undefined,
              stoppedBy: undefined,
              stoppedAt: undefined,
            }
          : p,
      ),
    );
  }, []);

  /* Deliberate. Renewing is a fresh decision to keep watching somebody, and the
     only visible change is a date further down the panel. */
  const extendWatch = useCallback(
    (personId: string, days: number) =>
      deliberate.run(`extend:${personId}`, async () => {
        applyExtendWatch(personId, days);
      }),
    [applyExtendWatch, deliberate],
  );

  /* A claimed tower arrives whole: the unit reported its own readings and the
     operator named the site and the cameras. Landing straight on it is the
     honest end of the flow — "added" is a claim you should be able to check. */
  const applyAddTower = useCallback(
    (tower: Tower, feeds: CameraFeed[]) => {
      setTowers((prev) => [...prev, tower]);
      setFeeds((prev) => [...prev, ...feeds]);
      setPending(null);
      setAdding(false);
      show({ id: tower.id, showAlerts: false });
    },
    [show],
  );

  /* Routine, and the one place that word needs defending: adding a tower is
     enormously consequential, but the flow LANDS ON THE TOWER — the operator is
     looking at the site they just added. A check on a screen that has already
     been replaced would be shown to nobody. */
  const addTower = useCallback(
    (tower: Tower, feeds: CameraFeed[]) =>
      routine.run(`add:${tower.id}`, async () => {
        applyAddTower(tower, feeds);
      }),
    [applyAddTower, routine],
  );
  const openTower = useCallback(
    (id: string, showAlerts = false) => show({ id, showAlerts }),
    [show],
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

  /* Only counts while something is actually on air. A tower whose cameras are
     offline or reconnecting is not being streamed from and its battery is not
     being spent on this operator, so the clock holds rather than running. The
     dependency is the boolean, not `feeds` — the latency walk rebuilds that
     array every 1.4s and would restart the interval before it ever fired. */
  const streaming =
    open !== null &&
    feeds.some(
      (f) =>
        f.towerId === open.id &&
        (f.state === "live" || f.state === "recording"),
    );

  /* Reset on a different tower, not on leaving one. Keying this to `open?.id`
     would have reset it every time that went null — which is exactly the trip
     to the fleet and back that the clock lives up here to survive. Stepping
     out genuinely stops the stream and the clock holds, because `streaming`
     below is false with no tower open; stepping back in resumes the same
     session, dismissal included. */
  const watchedTower = useRef<string | null>(null);
  useEffect(() => {
    if (!open || watchedTower.current === open.id) return;
    watchedTower.current = open.id;
    setLiveViewSec(0);
    setLiveViewDismissed(false);
  }, [open]);

  useEffect(() => {
    if (!streaming) return;
    const t = setInterval(() => setLiveViewSec((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [streaming]);

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
          /* A tower that reports no battery is skipped entirely. Coordination
             carries no battery or solar state, so a real tower has neither —
             and filling one in from a timer would be inventing telemetry,
             which is exactly what this integration refuses. */
          if (tower.batteryPct === undefined || tower.solar === undefined)
            return tower;
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
    /* Seed only. The walk is a simulation — coordination reports no latency at
       all, and `FeedChip` correctly omits the segment when it is absent. Left
       running on real feeds it would attach a plausible invented number to a
       real camera, which is the most quietly dishonest thing in this file. */
    if (!seededFleet) return;
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
  }, [seededFleet]);

  const setFeedState = useCallback((feedId: string, state: SimState) => {
    setFeeds((prev) =>
      prev.map((f) => {
        if (f.id !== feedId) return f;
        if (state === "error") {
          return { ...f, state: "offline", error: SIMULATED_STREAM_ERROR };
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

  const applyRetryFeed = useCallback(
    (feedId: string) => {
      setFeedState(feedId, "connecting");
      /* A retry that resolves instantly reads as a no-op; hold the connecting
         state long enough for the operator to see the attempt.

         The timer promotes the feed only if it is still the one this retry put
         in `connecting`. It used to fire unconditionally, so a camera the
         operator marked offline in the 2.4s after pressing Retry came back
         reporting itself live — the pending attempt overwriting a later, more
         deliberate decision about the same camera. */
      setTimeout(() => {
        setFeeds((prev) =>
          prev.map((f) =>
            f.id === feedId && f.state === "connecting" && !f.error
              ? { ...f, state: "live", elapsedSec: undefined }
              : f,
          ),
        );
      }, 2400);
    },
    [setFeedState],
  );

  const applyToggleRecord = useCallback((feedId: string) => {
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

  /**
   * Routine in appearance, consequential in fact — and wrapped now precisely
   * because of the second half.
   *
   * The control changes shape on success (a ring around a circle becomes a ring
   * around a square), so it confirms itself and needs no tick. But recording
   * decides whether evidence exists, and once Stage 7 makes this a real command
   * to a real tower it must not be fire-and-forget: an operator who pressed
   * record and got silence would believe a camera was capturing when it was
   * not. The failure half is here waiting for that.
   */
  /* Routine: the tile immediately shows CONNECTING, which is the confirmation.
     Wrapped because Stage 7's real retry reaches a tower and can be refused. */
  const retryFeed = useCallback(
    (feedId: string) =>
      routine.run(`retry:${feedId}`, async () => {
        applyRetryFeed(feedId);
      }),
    [applyRetryFeed, routine],
  );

  const toggleRecord = useCallback(
    (feedId: string) =>
      routine.run(`record:${feedId}`, async () => {
        applyToggleRecord(feedId);
      }),
    [applyToggleRecord, routine],
  );

  /* `acknowledgedBy` is deliberately NOT collapsed into the session, unlike
     `changedBy` and `stoppedBy` above, and the difference is a real one rather
     than an oversight.

     Those two are *authoring* stamps: the client is describing a change it is
     making, and the server will re-verify the account behind it. This one
     records who *performed* an auditable action on an alert — and having the
     client assert that is exactly the boundary that gets weakened when proven
     logic is adapted to a UI that never had one. It has to come back from the
     server's response to the acknowledgement.

     There is no such response: alerts have no backend at all — no type in the
     SDK's contract, no route in coordination. So the honest state is the seed's
     own placeholder, left visibly fake, rather than a session name that would
     make an unverified claim look verified. It becomes server-supplied in the
     same change that gives alerts a real API. See docs/integration §6. */
  /**
   * CONSUMER 2 — acknowledging and resolving an alert.
   *
   * ⚠ HELD HERE, AND KEYED BY ALERT ID, AND THAT IS THE WHOLE POINT.
   * `AlertDetail` is deliberately never remounted — `AlertsPanel` renders it
   * without a `key` so arrowing through the feed swaps its content in place
   * and bulk triage stays instant. A `useState` for a pending acknowledgement
   * placed inside it would survive that swap and appear against the NEXT
   * alert: a spinner, or a red failure, on an alert nobody touched. That is a
   * lie about an auditable action, and it is the trap `CLAUDE.md` documents.
   *
   * Keyed state above the panel makes it unrepresentable rather than merely
   * discouraged. `PersonDetail` is keyed and would be safe either way; the
   * asymmetry is worth knowing.
   *
   * Not `quiet`: an acknowledgement changes an auditable record and its own row
   * does not visibly move, so the check is the only thing that says it landed.
   */
  const statusMutation = useMutation();

  const setStatus = useCallback((id: string, status: Alert["status"]) => {
    setAlerts((prev) =>
      prev.map((a) =>
        a.id === id
          ? { ...a, status, acknowledgedBy: a.acknowledgedBy ?? "A. Okafor" }
          : a,
      ),
    );
  }, []);

  /**
   * Run a status change through the honesty pattern.
   *
   * ⚠ THE `fn` BODY IS THE ONLY THING THAT CHANGES when alerts get a backend.
   * Today it awaits a local write, so it resolves at once and the pending flash
   * is genuinely brief — which is honest, because the work genuinely is
   * instant. There is deliberately NO artificial delay and no synthetic
   * failure: faking a round trip that cannot fail would train an operator to
   * read a wait that means nothing, and would make the first real one
   * indistinguishable from theatre.
   *
   * What IS real today: the keying, the in-flight latch, the retry path, the
   * inline failure and the screen-reader announcement. When `fn` becomes
   * `await api.acknowledge(id)` they all start carrying weight without another
   * component changing.
   */
  const changeStatus = useCallback(
    (id: string, status: Alert["status"]) =>
      statusMutation.run(id, async () => {
        setStatus(id, status);
      }),
    [setStatus, statusMutation],
  );

  /* Returns the alert so the caller can arm its own banner against it —
     arrival and acknowledgement stay separate concerns. */
  /* Same rule as the watchlist counter above. The id used to be the clock
     truncated to seconds, which collides for two alerts raised inside one
     second — and the simulator's button can be pressed twice that fast — and
     wraps every 27.8 hours besides. Two alerts sharing an id acknowledge
     together and the feed cannot arrow onto the second of them. */
  const nextAlert = useRef(
    ALERTS.reduce((max, a) => Math.max(max, Number(a.id.slice(4)) || 0), 0),
  );

  const raiseAlert = useCallback((towerId: string) => {
    const at = Date.now();
    nextAlert.current += 1;
    const alert: Alert = {
      id: `ALT-${nextAlert.current}`,
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
      {/* Above every screen, because it is not a fact about any one of them.
          A column so the banner takes space rather than floating over the
          wall — the frames are the job, and this app never covers them with a
          notice it could sit above instead. */}
      {/* The shell owns the viewport height now, and every screen below is
          `h-full`. That inverted when the banner arrived: five screens each
          claiming `100dvh` inside a column that had already given the banner
          43px would each overflow by exactly that much, and the bottom of every
          wall would sit under the fold. */}
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-ink">
        <AnimatePresence>
          {reachProblem && (
            <CoordinationBanner
              problem={reachProblem}
              phase={fleetReload.phase("fleet")}
              onRetry={() => void reloadFleet()}
            />
          )}
        </AnimatePresence>
        <div className="min-h-0 flex-1">
      {onAlerts ? (
        <AlertsView
          alerts={alerts}
          towers={towers}
          onNavigate={navigate}
          onBack={() => setOnAlerts(false)}
          onSetStatus={changeStatus}
          statusMutation={statusMutation}
          rejectMutation={deliberate}
          onWatchPerson={watchPerson}
          onRejectMatch={rejectMatch}
        />
      ) : onPeople ? (
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
          mutation={deliberate}
        />
      ) : adding ? (
        <AddTowerView
          pending={pending}
          taken={towers.map((t) => t.id)}
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
          onToggleRecord={toggleRecord}
          fleetLoading={fleetLoading}
          fleetProblem={reachProblem?.headline ?? null}
          seededFleet={seededFleet}
        />
      ) : openTowerRecord === undefined ? (
        /* The tower is gone from under the operator — revoked, or removed
           between the fleet load and the drill-in.

           This replaces `?? findTower(open.id)`, which returned a DIFFERENT
           tower's data for an id it could not find. Under real per-account
           scoping that would have drawn another account's telemetry under the
           requested tower's name, which is the sharpest correctness hazard the
           study pass found. And the copy says "unavailable", never "does not
           exist": coordination returns one indistinguishable 404 for "no such
           tower" and "not yours" precisely so the endpoint cannot enumerate a
           fleet, and claiming non-existence would make it an oracle. */
        <TowerUnavailable id={open.id} onBack={() => show(null)} />
      ) : (
        <TowerView
          /* Keyed on the tower so drilling into a second site starts from a
             clean panel — the collapse, filter and selection below are that
             tower's, and carrying them across would show one site's selected
             alert against another's feed. The intent is in the key for the
             same reason: opening the same tower for its alerts has to start
             on them, not on wherever the last visit was left. */
          key={`${open.id}|${open.showAlerts}`}
          tower={openTowerRecord}
          feeds={feedsForTower(feeds, open.id)}
          alerts={alertsForTower(alerts, open.id)}
          playback={playback}
          onRetryPlayback={retryPlayback}
          showAlerts={open.showAlerts}
          onBack={() => show(null)}
          onSetFeedState={setFeedState}
          onRetryFeed={retryFeed}
          onToggleRecord={toggleRecord}
          onRaiseAlert={raiseAlert}
          onNavigate={navigate}
          cameraSettings={cameraSettings}
          onRenameTower={changeTowerName}
          renameMutation={renameMutation}
          settingsOpen={settingsOpen}
          onToggleSettings={() => setSettingsOpen((o) => !o)}
          onCloseSettings={() => setSettingsOpen(false)}
          onChangeSettings={changeSettings}
          settingsMutation={routine}
          recordMutation={routine}
          rejectMutation={deliberate}
          onSetStatus={changeStatus}
          statusMutation={statusMutation}
          onWatchPerson={watchPerson}
          onRejectMatch={rejectMatch}
          liveViewWarning={
            liveViewSec >= LIVE_VIEW_WARNING_SEC && !liveViewDismissed
          }
          onDismissLiveViewWarning={() => setLiveViewDismissed(true)}
          /* Winds the clock rather than overriding the banner, so everything
             downstream of it — the dismissal, the wall reflow — behaves the
             way it does for an operator who actually waited. */
          onToggleLiveViewWarning={() => {
            setLiveViewDismissed(false);
            setLiveViewSec((s) =>
              s >= LIVE_VIEW_WARNING_SEC ? 0 : LIVE_VIEW_WARNING_SEC,
            );
          }}
        />
      )}
        </div>
      </div>
    </MotionConfig>
  );
}
