import { AnimatePresence, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AddTowerView } from "@/components/AddTowerView";
import { AlertsView } from "@/components/AlertsView";
import { AlertNotifications } from "@/components/AlertNotifications";
import { FootageView } from "@/components/FootageView";
import { useSession } from "@/components/AuthProvider";
import { can, navAllowed, navVisible } from "@/lib/features";
import {
  clearSection,
  sectionFromHash,
  subscribeToSettingsHash,
  writeSection,
  type SettingsSection,
} from "@/lib/settingsRoute";
import { DashboardView } from "@/components/DashboardView";
import { PeopleView } from "@/components/PeopleView";
import { SettingsView } from "@/components/SettingsView";
import { AdministrationView } from "@/components/AdministrationView";
import { NotificationStack } from "@/components/NotificationStack";
import { NotificationProvider } from "@/lib/notifications";
import { useSiteAlerts, type ArrivedAlert } from "@/lib/useSiteAlerts";
import { ShareFeedProvider } from "@/lib/useShareFeed";
import { FleetFollowsShares, WatchProvider } from "@/lib/watch";
import {
  AccessEnded,
  CameraGone,
  useEndedShareFor,
} from "@/components/AccessEnded";
import { FleetFeedProvider } from "@/lib/useFleetFeed";
import { ShareDeck } from "@/components/sharing/ShareNotifications";
import { SharesView } from "@/components/SharesView";
import { useCapabilities } from "@/lib/useSites";
import { hasSites, isHubMode } from "@/lib/hubMode";
import { setPatrol } from "@/lib/api/fleet";
import type { PatrolEdit } from "@/lib/patrol";
import type { PatrolPhase } from "@/components/PatrolControl";
import type { Reach } from "@/lib/liveRecovery";
import { HeldWrites, holdKey } from "@/lib/heldWrites";
import { isAdminRole } from "@kallon/sentry-sdk";
import { TowerView } from "@/components/TowerView";
import { TowersView } from "@/components/TowersView";
import { DEFAULT_CAMERA_SETTINGS } from "@/lib/types";
import { isSeededFleet } from "@/lib/config";
import { listFleet, renameTower as renameTowerOnServer } from "@/lib/api/fleet";
import type { CloudReading } from "@/lib/api/fleet";
import { setHome, stopOrHome } from "@/lib/api/ptz";
import { classifyReach, type ReachProblem } from "@/lib/api/reach";
import { listClaims, type Claim } from "@/lib/api/claim";
import { loadPrefs, savePrefs } from "@/lib/prefs";
import { wallOrder } from "@/lib/fleetOrder";
import { CoordinationBanner } from "@/components/CoordinationBanner";
import { cameraKey, usePlayback, type PlaybackTarget } from "@/lib/usePlayback";
import { useVisibleTiles } from "@/lib/useVisibleTiles";
import { useMutation } from "@/lib/useMutation";
import type { SimState } from "@/components/StateSimulator";
import {
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
/* ⚠ A SENTENCE, EVEN IN THE SIMULATOR. This read
   "SIMULATED · RTSP handshake timeout · ERR_504" on the reasoning that a
   review tool should show a verbatim technical string -- but it renders in the
   same place a real failure does, so it was both the example of what a tile
   must never say and a way for one to say it. The word SIMULATED stays,
   because a fabricated fault on a camera tile has to announce itself. */
const SIMULATED_STREAM_ERROR =
  "Simulated: this camera stopped answering. Nothing is really wrong.";

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
 * Reached when an operator drills into a tower that has since gone: a share
 * that ended, or a tower removed between the fleet load and the click.
 *
 * ⚠ IT USED TO SAY `kln_lab_000002 IS UNAVAILABLE` and then offer two
 * possible causes for the person to choose between. See `AccessEnded`: the
 * common case is a loan that finished, which is ordinary and has an obvious
 * next step, so this asks the share feed which of the two it was and says the
 * right one.
 *
 * It still never says "does not exist": coordination returns one
 * indistinguishable answer for "no such tower" and "not yours" so the endpoint
 * cannot enumerate a fleet, and claiming non-existence would hand back the
 * very fact the server withheld. "No longer available" is true either way.
 */
function TowerUnavailable({ id, onBack }: { id: string; onBack: () => void }) {
  /* WHICH OF THE THREE THINGS HAPPENED, asked rather than guessed. A share
     that lent this camera and has finished is the common case by far, and it
     is the one with something to do about it. */
  const ended = useEndedShareFor(id);
  if (ended) return <AccessEnded share={ended} onClose={onBack} />;
  return <CameraGone reason="removed" onClose={onBack} />;
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
  /* ONE useSession call. `features` is what this account may see — the server
     decided it; lib/features.ts says why this is not the access control and why
     its fallback is restrictive. */
  const { operator: OPERATOR, account, features } = useSession();

  /**
   * View preferences, remembered per account.
   *
   * Hydrated once from `localStorage` and written back whenever one changes.
   * Keyed by `account_id` so one machine can serve several operators without
   * handing the next one the last one's wall.
   *
   * ⚠ VIEW PREFERENCES ONLY. Not the session token (that stays in
   * `sessionStorage` and dies with the tab), not the pending claim (already
   * server-side ownership), and NOT seeded domain mutations — an acknowledgement
   * persisted here would look durable while living in one browser, invisible to
   * the next shift and to any audit. See `lib/prefs.ts`.
   */
  const accountId = account?.account_id ?? null;
  const prefsLoaded = useRef(false);

  /* ── THE FLEET SOURCE ─────────────────────────────────────────────────
     `sdk` is the real thing; `seed` is the fixture, kept as the way back and
     as an offline dev loop. Read once — flipping it is a restart, not a
     runtime toggle, because half a screen of each would be worse than either. */
  const seededFleet = isSeededFleet();

  const [feeds, setFeeds] = useState<CameraFeed[]>(seededFleet ? FEEDS : []);
  /*
   * ⭐⭐ THE ALERT FEED IS REAL. ⭐⭐
   *
   * What stood here was a block headed "FIXTURE ALERTS, ON EVERY FLEET -- NOT
   * REAL DETECTIONS", and it was the longest-standing knowing lie in this app:
   * six seeded alerts naming TWR-1042 and TWR-2071, towers no account has,
   * counted on real tower cards and spoken for by the new-alert banner. The
   * note finished "the way out is a real feed, or a mark on screen -- swap the
   * line below back the moment coordination serves alerts."
   *
   * Coordination serves alerts. `useSiteAlerts` reads
   * `GET /v1/viewer/site-alerts` once and then holds the event stream open;
   * every row below this line was raised by a hub watching a mast.
   *
   * ⚠ STILL GATED AT THE SOURCE, and the gate now does almost nothing.
   * `alerts` is DEFAULT-ON on both tiers (`registry/features.py` DEFAULT_ON,
   * mirrored in `lib/features.ts`), so every account that has not been
   * explicitly stripped of it reads the feed. What is left is the explicit
   * revoke, which is a row in the server's own table and a real answer: an
   * account told it may not see alerts must not have one on the wire.
   *
   * The gate is at the SOURCE rather than at the screens for the original
   * reason, which stands: the tower cards, the banner and the badge totals all
   * read `alerts` rather than asking the rail what is reachable, so hiding
   * only the screen would leave a card counting rows its owner may not see.
   */
  const alertsEnabled = can(features, "alerts");
  /*
   * SIMULATED AND LOCALLY-EDITED ALERTS, kept apart from the feed.
   *
   * Two things still write an alert on this side and neither is a lie: the
   * state simulator raises one on demand (behind `simulator`, ours alone), and
   * "Not them" drops an identity from a detection that keeps its own record.
   * Both are about the DETECTION vocabulary -- a matched face, a zone, a
   * sensor -- which coordination raises none of today and which the rows, the
   * timeline steps and the clip cards are all still built for.
   *
   * ⚠ A SEPARATE ARRAY, NOT A COPY OF THE FEED. Merging them into one piece
   * of state would mean the stream's next update to a real alert has to
   * preserve whatever was edited locally on top of it, and the first thing
   * that goes wrong there is a server row quietly keeping a local edit after
   * the server changed its mind. Two lists, concatenated for display, and the
   * server's copy is never written to by this side.
   */
  const [localAlerts, setLocalAlerts] = useState<Alert[]>([]);
  /* State rather than the module constant, because a seeded battery actually
     fills: those towers are off-grid and the panel is the only thing that
     refills them, so a card claiming to be charging while the number sits
     still is the one reading on that screen an operator could catch out. Up
     here with the feeds for the same reason they are — both screens show
     towers, and two copies of a moving number disagree within a second.

     A REAL tower reports no battery at all, so nothing moves and the card says
     so. See the note on `Tower`. */
  const [towers, setTowers] = useState<Tower[]>(seededFleet ? TOWERS : []);
  /* ── THE FEED, AND THE NAMES IT IS READ IN ────────────────────────────

     An alert names a tower, and the wire carries only a device id. The fleet
     has the names, so the lookup is handed down rather than the feed guessing:
     a title reading "KLN_LAB_000002 OFFLINE" is a code on a screen, which is
     the third writing rule, and it is the one line a customer reads out over
     a radio.

     ⚠ NOT A DEPENDENCY OF THE SUBSCRIPTION. `useSiteAlerts` holds this in a
     ref: a stream rebuilt every time the fleet re-renders is a stream the
     server closes for being the 64th. */
  const nameOf = useCallback(
    (deviceId: string) => towers.find((t) => t.id === deviceId)?.site,
    [towers],
  );

  /* Newest first and bounded. Each entry is handed to `AlertNotifications`,
     which lives inside the provider and is the only thing that may call
     `notify` — this component is OUTSIDE it. Bounded because an app left open
     through a bad night would otherwise accumulate every alert of the night
     in an array nothing ever reads again. */
  const [arrivals, setArrivals] = useState<ArrivedAlert[]>([]);
  /* Which alert a toast asked to open, handed to `AlertsView` as a seed. It
     is not cleared: the screen takes it once per value and owns the selection
     afterwards, so clearing it would be a second write for no reader. */
  const [openAlertId, setOpenAlertId] = useState<string | null>(null);
  const onArrived = useCallback((arrived: ArrivedAlert) => {
    setArrivals((prev) => [arrived, ...prev].slice(0, 20));
  }, []);

  /* ⚠ `label`, NOT `name`. `CameraFeed.name` is always populated — it is the
     customer's label or `CAMERA 2` — and reading it here would make every
     camera look named, which is what put "CAMERA 1 camera stopped working" on
     a mast whose cameras are called NORTH GATE and YARD. `label` is present
     only when somebody actually named one, and that distinction is the whole
     difference between the two sentences the copy layer can write. */
  const cameraNameOf = useCallback(
    (deviceId: string, camera: number) =>
      feeds.find((f) => f.towerId === deviceId && f.index === camera)?.label,
    [feeds],
  );

  const alertFeed = useSiteAlerts({
    enabled: alertsEnabled,
    nameOf,
    cameraNameOf,
    onArrived,
  });

  /* The server's rows and this side's two, in one list for every screen that
     counts or filters them. The server's copies are never written to here. */
  const alerts = useMemo(
    () => [...alertFeed.alerts, ...localAlerts].sort((a, b) => b.at - a.at),
    [alertFeed.alerts, localAlerts],
  );

  /* THE SITE'S LINK TO KALLON CLOUD. One fact about the server that answered,
     so it is held once here rather than copied into every tower -- see
     `CloudReading`. Set only by `listFleet`: the single-tower routes answer
     about a tower and carry no such block, and overwriting this from one of
     them would blank a row that is still true. `undefined` is "the server did
     not say", which the Network group renders in words. */
  const [cloud, setCloud] = useState<CloudReading | undefined>(undefined);
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
        takeSnapshot(snapshot);
        setCloud(snapshot.cloud);
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
  /**
   * What the server has just confirmed, until a refresh agrees.
   *
   * ⚠ A REF, NOT STATE. Nothing renders from it: what renders is the array
   * it corrects on the way into state. Holding it in state would re-render
   * the whole app twice per poll to change nothing anybody can see.
   */
  const held = useRef(new HeldWrites());

  /**
   * THE ONE DOOR EVERY SERVER ANSWER COMES THROUGH.
   *
   * ⚠ FOUR PLACES READ THE FLEET -- the first load, the operator's reload,
   * the quiet refresh after a share, and the reload after a camera is added
   * -- and every one of them used to call `setFeeds(snapshot.feeds)`
   * directly. That is four chances to overwrite a value somebody had just
   * saved, and it only took one: a save showed "2 hours", then "1 hour"
   * again, then "2 hours", because a `listFleet` already in flight carried
   * the old patrol and replaced every feed wholesale.
   *
   * Narrow on purpose. Only the fields somebody has just changed are held;
   * link state, battery, cameras coming back and a tower going dark all come
   * through untouched, because freezing the fleet view to steady one row
   * would be the worse trade.
   */
  const takeSnapshot = useCallback(
    (snapshot: { towers: Tower[]; feeds: CameraFeed[] }) => {
      setTowers(
        held.current.apply(
          snapshot.towers,
          "tower",
          "site",
          (t) => t.id,
          (t) => t.site,
          (t, v) => ({ ...t, site: v as string }),
        ) as Tower[],
      );
      const withPatrol = held.current.apply(
        snapshot.feeds,
        "camera",
        "patrol",
        (f) => f.id,
        (f) => f.patrol,
        (f, v) => ({ ...f, patrol: v as CameraFeed["patrol"] }),
      );
      setFeeds(
        held.current.apply(
          withPatrol,
          "camera",
          "label",
          (f) => f.id,
          (f) => f.label,
          /* ⚠ `name` IS DERIVED FROM `label`, SO IT HAS TO MOVE WITH IT.
             Restoring the label alone leaves `name` as whatever the stale
             answer computed -- "CAMERA 1" -- and `name` is what every tile
             caption, the wall, the playback picker and the evidence file name
             actually print. The held camera would read "Gate test" in the
             settings box and CAMERA 1 everywhere else, which is worse than
             the flicker this whole mechanism removes. The fallback is the
             mapper's, repeated here because it is the same rule. */
          (f, v) => {
            const label = typeof v === "string" && v.trim() ? v : undefined;
            return {
              ...f,
              ...(label ? { label } : { label: undefined }),
              name: label ?? `CAMERA ${f.index ?? ""}`.trim(),
            };
          },
        ) as CameraFeed[],
      );
    },
    [],
  );

  const reloadFleet = useCallback(
    () =>
      fleetReload.run("fleet", async () => {
        try {
          const snapshot = await listFleet();
          takeSnapshot(snapshot);
          setCloud(snapshot.cloud);
          setReachProblem(null);
        } catch (err) {
          setReachProblem(classifyReach(err));
          throw err;
        }
      }),
    [fleetReload],
  );

  /**
   * Read the fleet again, quietly, because something changed what the server
   * would answer.
   *
   * ⚠ NOT `reloadFleet`, AND THE DIFFERENCE IS THE BANNER. That one is the
   * operator pressing a button after being told the fleet could not be read,
   * so it reports failures loudly and re-throws. This one is a share landing:
   * nobody asked, so a transient failure must not raise a banner over the
   * video. It keeps the towers it has and the next change tries again.
   *
   * It does NOT clear `reachProblem` on success either -- that banner belongs
   * to the load that failed, and whether the fleet is reachable is the
   * operator's question to re-ask.
   */
  const refreshFleetQuietly = useCallback(async () => {
    try {
      const snapshot = await listFleet();
      takeSnapshot(snapshot);
      setCloud(snapshot.cloud);
    } catch {
      /* Deliberately silent. See above. */
    }
  }, []);
  /* The setup flow is a third screen rather than a modal. It is six steps deep
     with a phone hand-off in the middle — a dialog that size is a screen
     wearing a scrim, and it would put the fleet behind it pretending the
     operator could still reach it. */
  const [adding, setAdding] = useState(false);
  /* Bumped when a claim is registered, so the poll picks it up at once rather
     than on its next tick. */
  const [claimTick, setClaimTick] = useState(0);
  /**
   * Open registrations, from the server.
   *
   * ⚠ THIS USED TO BE LOCAL STATE holding a fabricated unit, which meant a
   * claim survived navigation and died on a reload. A claim is ownership: it
   * belongs on the server, and `GET /v1/viewer/claims` is the only reason a
   * registered-but-not-yet-connected tower is anywhere at all — no tower record
   * exists until enrolment binds one, so the pending window is invisible in
   * `/v1/viewer/towers`.
   */
  const [claims, setClaims] = useState<Claim[]>([]);
  const openClaim = claims.find((c) => c.status === "open") ?? null;

  /* The watchlist, and the screen that edits it. Up here with the feeds and the
     towers because a match is an alert like any other — the roster and the feed
     have to be reading the same list, or a person could be removed while their
     sightings still name them. */
  /* The watchlist fixture. Same gate, same reason: `PEOPLE` is six invented
     people, and a customer's "people of interest" count must not be six. */
  const [people, setPeople] = useState<Person[]>(
    can(features, "watchlist") ? PEOPLE : [],
  );
  const [onPeople, setOnPeople] = useState(false);
  /* The fleet-wide alerts feed, off the rail's bell. A screen rather than a
     panel: it is not scoped to a tower, so there is no wall for it to sit
     beside. */
  const [onAlerts, setOnAlerts] = useState(false);
  /* The towers board — every tower's status on one screen (`TowersView`). A
     flag like the other rail destinations, because it replaces the wall rather
     than opening a tower. */
  const [onTowers, setOnTowers] = useState(false);
  /* Where the tower view's way back goes. Its breadcrumb reads TOWERS, and an
     operator who opened the tower from the board means the board — landing
     them on the camera wall instead would be a breadcrumb lying about where it
     leads. A ref, because only the back press ever reads it. */
  const backToBoard = useRef(false);
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

  /* THE WALL'S ORDER IS THE LIST'S, AND IT IS NOT STATE ANY MORE.
     It used to be: a flat arrangement of feed ids, held up here so it survived
     the dashboard unmounting on every drill-in, seeded from the fixtures and
     reconciled by appending whatever the fleet had gained to the end. That is
     precisely how the two panels came to disagree — the wall accumulated the
     order of every fleet this browser had read while the list showed the one
     it was serving now. Derived from `towers` and `feeds`, there is nothing to
     hold, nothing to reconcile and nothing to survive: see `lib/fleetOrder.ts`.

     ⚠ STILL COMPUTED BEFORE THE PLAYBACK BLOCK. The session cap is applied in
     wall order, so what an operator sees first is what streams — which means
     the order has to exist before the targets below are built. */
  const wallIds = useMemo(() => wallOrder(towers, feeds), [towers, feeds]);

  /* Whether Footage's clips drawer is open. Up here with the other remembered
     view preferences, and restored from ViewPrefs on sign-in. */
  const [footageClips, setFootageClips] = useState(false);

  /* ── THERE IS NO CHOSEN PROFILE ANY MORE ───────────────────────

     `cameraProfiles` lived here, remembered per account, and fed the Picture
     quality row in the tower's settings. The row is gone (see the note where
     it was, in `CameraSettingsPanel`): live video is standard on every tier
     now and a mast advertises one profile, so it chose between one thing.

     What that leaves is simpler than what it replaced, and it is the
     behaviour the session manager already preferred. No open names a profile
     as a REQUIREMENT, so drilling into a tower always reuses the session the
     wall already holds for that camera rather than renegotiating it — which
     is exactly the rule in CLAUDE.md, now true by construction instead of by
     an operator happening not to have picked anything.

     `defaultProfileField` below stays, and is a different thing: it tells the
     manager what "opened with nothing" resolves to, so it can tell that case
     apart from a deliberate open of the same stream. */

  /* Whether the Playback screen is open.
     ⚠ IT DOES NOT CALL show(null), AND THAT IS THE REQUIREMENT, NOT AN
     OVERSIGHT. Playback is layered OVER the live screen rather than replacing
     it — its back button returns to exactly where the operator was — so what
     that screen attached stays attached underneath: `attachedTargets` below is
     derived from `open`, and this flag leaves `open` alone. An operator
     checking what happened a minute ago comes back to a wall that never
     stopped, however long the minute was. */
  const [onPlayback, setOnPlayback] = useState(false);
  /* Account settings — the organization's own name and password. A screen like
     the others rather than a modal, because a forced re-login lands on the sign-in
     screen and a modal would have had to survive the app unmounting under it. */
  const [onSettings, setOnSettings] = useState(false);
  /* SHARES and ADMINISTRATION. Screens like the others, and gated on what the
     SERVER is rather than on what the account bought: `useCapabilities` asks
     `GET /v1/capabilities`, and a hub answers `sites: false` for ever. See
     `lib/api/sites.ts` for why that is not a build flag. */
  const [onShares, setOnShares] = useState(false);
  const [onAdmin, setOnAdmin] = useState(false);
  /* WHAT THIS SERVER IS, and whether this account administers it. `null` from
     `useCapabilities` means "not answered yet", and is treated as NO: showing
     the destinations and then removing them a moment later looks like a bug
     even though it is only a race. */
  const caps = useCapabilities();
  const sitesEnabled = hasSites(caps);
  /* THE WHOLE PRODUCT DECISION, from `GET /v1/capabilities`. See
     `lib/hubMode.ts` for why this is the server's answer and not a flag. */
  const hubMode = isHubMode(caps);
  const isAdmin = sitesEnabled && isAdminRole(account?.role);
  /* THE SHARES THEMSELVES LIVE IN `ShareFeedProvider` (see main.tsx), which
     is one list read by the cards, the Sharing page and the shared-feed badge
     alike. Asking for them here as well would be a second copy that can
     disagree with the first, which is the whole thing that provider exists to
     make impossible. */
  /**
   * Which Settings section is open, and the ONE piece of this app's state that
   * lives in the URL.
   *
   * Seeded from the hash SYNCHRONOUSLY, in the initialiser rather than an
   * effect, so a pasted `#settings/cameras` renders Cameras on the first frame
   * instead of flashing Account. `lib/settingsRoute.ts` explains why it is a
   * hash and not a path.
   */
  const [settingsSection, setSettingsSection] = useState<SettingsSection>(
    () => sectionFromHash() ?? "account",
  );

  /* Which fleet tiles are on screen, settled rather than instantaneous.
     The hysteresis and the reasoning for it are in `useVisibleTiles`.

     ⚠ FROZEN WHENEVER THE WALL IS NOT THE SCREEN — under Playback, in a tower,
     on alerts, people, setup or the towers board. The dashboard unmounts under every one of
     them, which detaches each tile's observer ref and would drain the set, so
     the wall would come back believing nothing was on screen and sit out the
     settle before showing pictures it was holding all along. Frozen, it comes
     back to the tiles it left and they attach on the first frame. The flags
     are declared above for this reason: a ref read here would carry the
     previous render's value, which is one render too late — the tiles detach
     in the very commit the flag flips. */
  const wallOffScreen =
    onPlayback || onAlerts || onPeople || adding || onTowers || onSettings
    || open !== null;
  const { observe: observeTile, visible: visibleTiles } =
    useVisibleTiles(wallOffScreen);

  /* ── WHAT IS ACTUALLY BEING STREAMED ──────────────────────────────────

     A session costs a grant on coordination and a busy camera on the tower, so
     the set has to match what the operator is looking at.

     ⚠ THIS USED TO MEAN "ONLY THE OPEN TOWER". The fleet wall drew stills, on
     the argument that these are off-grid sites, that this app carries its own
     banner warning that live viewing drains a battery, and that opening four
     streams on the landing screen would contradict its own advice.

     That argument was half right and the half it got wrong was the arithmetic.
     "The fleet screen" is not the fleet: it is the handful of tiles that fit on
     a monitor, and that number does not grow when the estate does. A hundred
     towers cost exactly what two do. What the old rule actually bought was not
     a smaller number of sessions — it was ZERO, in exchange for a wall of
     stills on the screen whose whole job is to show the operator what is
     happening right now.

     So the fleet wall streams what is visible, bounded three ways: by the
     viewport, by the session manager's MAX_LIVE_TILES, and by the sub profile.
     The battery argument survives in all three.

     What a screen shows is ATTACHED; what is open is HELD — by `usePlayback`,
     keyed by camera, and shared by every screen. The two screens attach one or
     the other, never both, but they share the sessions: drilling into a tower
     attaches that tower's cameras to the sessions the wall already had, and
     coming back attaches the wall to them again. Nothing is handed over,
     because nothing was ever the screen's. What is not attached idles and then
     closes — the rules are in `usePlayback`'s header.

     Cameras the tower reports as anything but live are excluded — asking for a
     session on a camera that has already said it is down burns a grant to be
     refused, and the tile has a truer thing to show. Seeded feeds are excluded
     because there is no session to open for a fixture. */

  /* What an open that names no profile resolves to, so the manager can tell
     that "opened with nothing" and "asked for the default" are the same
     stream, and does not renegotiate one into the other. */
  const defaultProfileField = (f: CameraFeed) => {
    const id = f.profiles?.find((p) => p.default)?.id;
    return id ? { defaultProfile: id } : {};
  };

  const towerTargets: PlaybackTarget[] = feeds
    .filter(
      (f) =>
        open !== null &&
        f.towerId === open.id &&
        f.state === "live" &&
        f.index !== undefined,
    )
    .map((f) => {
      /* ⚠ NO `profile` FIELD, EVER, AND THAT IS THE WHOLE OF IT NOW. It was
         set when an operator picked one in the tower's settings, and that
         picker is gone with the single-profile mast. A target that names no
         profile attaches to whatever the camera is already streaming —
         usually the session the wall opened — instead of renegotiating the
         camera the operator has just clicked on. */
      return {
        id: f.id,
        towerId: f.towerId,
        index: f.index!,
        ...defaultProfileField(f),
      };
    });

  /* Wall order, not feed order, so the cap is decided by where a tile sits on
     the screen rather than by whatever order the fleet came back in. Two
     operators looking at the same wall drop the same tiles. */
  const fleetTargets: PlaybackTarget[] = wallIds
    .map((id) => feeds.find((f) => f.id === id))
    .filter(
      (f): f is CameraFeed =>
        f !== undefined &&
        f.state === "live" &&
        f.index !== undefined &&
        visibleTiles.has(f.id),
    )
    /* No slice here: the manager applies MAX_LIVE_TILES to whatever is
       attached, in this order, so wall order still decides which eight. */
    .map((f) => ({
      id: f.id,
      towerId: f.towerId,
      index: f.index!,
      /* ⚠ SUB, WHENEVER THIS WALL IS THE ONE OPENING THE SESSION. Twelve
         tiles at 2K is a different order of magnitude of uplink and battery
         than twelve at 704×576, and nobody is reading detail off a tile this
         size — the main stream is what the tower view is for. The operator's
         per-camera profile choice is deliberately NOT consulted here: it is a
         choice about how they watch ONE camera, not licence to pull 2K twelve
         times over.

         A PREFERENCE, NOT A REQUIREMENT. A camera the operator is already
         watching at main — chosen in its tower — is reused as it is when the
         wall attaches to it, not renegotiated down: one tile at main costs
         less than tearing a working stream down to open a smaller one, and it
         idles out with everything else once nobody is looking.

         Named only when the camera advertises it, because a tower running an
         older agent advertises no profiles at all and its default already IS
         the sub stream — naming one it never offered would be asking for a
         stream by a name it does not know. */
      ...(f.profiles?.some((p) => p.id === "sub") ? { prefer: "sub" } : {}),
      ...defaultProfileField(f),
    }));

  /* What the current screen ATTACHES. Playback falls through to the screen it
     covers (see `onPlayback`); alerts, people, setup and the towers board show
     no live camera, so they attach nothing and whatever the wall held idles
     behind them. */
  const attachedTargets: PlaybackTarget[] =
    seededFleet || onAlerts || onPeople || adding || onTowers || onSettings
      ? []
      : open !== null
        ? towerTargets
        : fleetTargets;

  /* Every camera a session may be held for at all. Leaving this set is the one
     thing that closes a session at once — a camera that has said it is down is
     not coming back because nobody closed it. Empty for a seeded fleet, which
     has no sessions to open. */
  const eligibleCameras = new Set(
    seededFleet
      ? []
      : feeds
          .filter((f) => f.state === "live" && f.index !== undefined)
          .map((f) => cameraKey(f.towerId, f.index!)),
  );

  /**
   * Is anything between a camera and a picture right now?
   *
   * ⚠ READ OFF THE FLEET THIS PAGE IS ALREADY DRAWING, which is the point:
   * the player makes no requests at a box the board is showing as down, so a
   * site that goes dark for an hour costs nothing instead of a grant every
   * few seconds from every tile it had.
   *
   * ⚠ ONE HUB IS ATTRIBUTED, SEVERAL ARE NOT, and that is a limit of the
   * record rather than a choice. `Tower` carries no hub id -- a mast does not
   * know which hub it is on, and the fleet reply does not say -- so with a
   * single hub in view its being down is necessarily the reason its masts are
   * unreachable, and with two there is no way to tell whose mast is whose.
   * The masts still say "Tower offline" then, which is true and is what the
   * fleet reports; only the attribution to the hub is lost. A `hub_id` on the
   * tower projection would close it.
   */
  const reachOf = useCallback(
    (towerId: string): Reach => {
      const device = towers.find((t) => t.id === towerId);
      if (!device) return null;
      /* A hub's OWN mast. Its being down is the hub being down. */
      if (device.kind === "hub") return device.online === false ? "hub-offline" : null;
      if (device.online !== false) return null;
      const hubs = towers.filter((t) => t.kind === "hub");
      /* The single-hub site: its state explains every mast on it. */
      if (hubs.length === 1 && hubs[0].online === false) return "hub-offline";
      return "tower-offline";
    },
    [towers],
  );

  const {
    phases: playback,
    retry: retryPlayback,
    sessionFor,
  } = usePlayback({
    attached: attachedTargets,
    eligible: eligibleCameras,
    focusTower: open?.id ?? null,
    reach: reachOf,
  });

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

  /**
   * Camera settings, KEYED BY TOWER ID.
   *
   * Keyed off to the side rather than carried on the feed itself: `feeds` is
   * rebuilt on every latency tick and recording tick, and a settings object
   * copied through that loop is one more thing a careless `map` can drop.
   * Undefined means untouched, which is what `DEFAULT_CAMERA_SETTINGS` is for —
   * the shell answers "what does this camera do" so no view has to.
   *
   * ⚠ THE KEY IS THE TOWER'S, AND THESE PARAMETERS USED TO SAY `feedId`. Every
   * caller passed `tower.id` — `TowerView` opens one panel from the tower bar
   * and there is no per-camera settings surface — so the stored key was always
   * a tower id and the name was simply wrong. Nothing read the wrong record,
   * because nothing ever wrote a feed id; the hazard was the next person to
   * trust the name and look one up by feed, at which point a two-camera site
   * silently gets defaults instead of its own configuration.
   *
   * It is per-tower because that is what the panel edits: detection zones, the
   * uplink, retention and power are properties of a site, not of one lens. If
   * settings ever become per-camera, this key must change WITH a migration —
   * `lib/prefs.ts` persists this map verbatim, so a bare reinterpretation would
   * hand every operator back defaults on their next visit.
   */
  const [settings, setSettings] = useState<Record<string, CameraSettings>>({});

  const cameraSettings = useCallback(
    (towerId: string) => settings[towerId] ?? DEFAULT_CAMERA_SETTINGS,
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
   * CONSUMER 3 — renaming a tower. REAL as of the `PATCH` route landing.
   *
   * `quiet`: once the write lands, the new name appears on the fleet card, the
   * band header, the breadcrumb and the panel at once, and that IS the
   * confirmation. A check beside a field that already shows the answer is
   * noise. The spinner during the flight is not — see below.
   *
   * The client half was written before the server half existed and edited local
   * state, so a renamed tower reverted on the next load. It now calls
   * `PATCH /v1/viewer/towers/{device_id}` and the local-only path is GONE:
   * keeping it as a fallback would give this app two names for one site and no
   * way to tell which the registry actually holds.
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

  /**
   * ⚠ NOTHING IS WRITTEN BEFORE THE SERVER ANSWERS.
   *
   * The optimistic version of this is what shipped first, and it produced
   * exactly the bug being fixed: the name changed on screen, the write went
   * nowhere, and the old one came back on reload. A rename that can revert is
   * worse than one that takes a moment, because the operator has already moved
   * on by the time it un-happens.
   *
   * So the order is: run → the field shows it is saving → the registry
   * answers → and the name that lands is the one in `renamed.site`, read back
   * out of the server's own projection rather than the string that was typed.
   * If the write fails, `towers` is untouched and the panel shows why.
   */
  /**
   * Save a camera's current pan/tilt as its home.
   *
   * ⚠ NOTHING IS WRITTEN HERE ON SUCCESS, AND THERE IS NOTHING TO WRITE. The
   * home lives on the tower; this shell holds no copy of it, so there is no
   * local state to keep in step and no chance of the revert bug the note above
   * describes. What the operator gets back is the check, which is the whole
   * reason this uses `deliberate` rather than `routine`: a saved home changes
   * nothing on screen, so a silent success would be indistinguishable from
   * nothing having happened.
   *
   * The refusal path matters as much as the success one. A camera whose home
   * comes from a calibration bundle answers HOME_NOT_SETTABLE, and that lands
   * in the error phase with the tower's own words rather than as a fault.
   */
  const setCameraHome = useCallback(
    (feedId: string) =>
      deliberate.run(`home:${feedId}`, async () => {
        const feed = feeds.find((f) => f.id === feedId);
        if (!feed) throw new Error("that camera is no longer on this site");
        await setHome(feed, sessionFor(feedId));
      }),
    [deliberate, feeds, sessionFor],
  );

  /* Send a camera back to its home position: the same command the pad's home
     button sends, offered from settings because that is where a customer
     reading "Home position" looks for it. Through the same keyed mutation as
     the save beside it, so one camera's failure is reported on that camera. */
  const goCameraHome = useCallback(
    (feedId: string) =>
      deliberate.run(`home:${feedId}`, async () => {
        const feed = feeds.find((f) => f.id === feedId);
        if (!feed) throw new Error("that camera is no longer on this site");
        await stopOrHome(feed, sessionFor(feedId), true);
      }),
    [deliberate, feeds, sessionFor],
  );

  /**
   * Change one camera's patrol.
   *
   * ⚠ THE DEVICE'S ANSWER REPLACES THE CAMERA'S BLOCK, never the request.
   * Every refusal in the contract changes nothing, and the 200 carries the
   * whole patrol object -- including a `next_at` only the device can compute.
   * Writing the operator's choice into state and hoping would show a patrol
   * running at a time nobody scheduled.
   *
   * Keyed per camera like the home save beside it, so one camera's refusal is
   * reported on that camera and the other keeps working.
   */
  const setCameraPatrol = useCallback(
    (feedId: string, edit: PatrolEdit) =>
      deliberate.run(`patrol:${feedId}`, async () => {
        const feed = feeds.find((f) => f.id === feedId);
        if (!feed || feed.index === undefined) {
          throw new Error("that camera is no longer on this site");
        }
        try {
          const patrol = await setPatrol(feed.towerId, feed.index, edit);
          /* ⚠ CONFIRMED BEFORE IT IS DRAWN. The hold is what stops the next
             fleet refresh -- possibly one already in flight -- putting the
             old patrol back over it. */
          held.current.confirm(holdKey("camera", feedId, "patrol"), patrol);
          setFeeds((prev) =>
            prev.map((f) => (f.id === feedId ? { ...f, patrol } : f)),
          );
        } catch (err) {
          /* Nothing was changed, by contract, so there is nothing to hold:
             the last confirmed value is whatever is already on screen. */
          held.current.release(holdKey("camera", feedId, "patrol"));
          throw err;
        }
      }),
    [deliberate, feeds],
  );

  /**
   * What a camera's patrol save is doing, in the control's own vocabulary.
   *
   * ⚠ THE SERVER'S SENTENCE, ALREADY CHOSEN. `PatrolRefusedError` builds its
   * message from the code and the server's own words in `lib/patrol.ts`, so
   * this hands over what the mutation recorded rather than mapping a code a
   * second time here.
   */
  const patrolPhaseFor = useCallback(
    (feedId: string): PatrolPhase => {
      const phase = deliberate.phase(`patrol:${feedId}`);
      if (phase.kind === "pending") return { kind: "pending" };
      if (phase.kind === "error") return { kind: "failed", message: phase.message };
      return { kind: "idle" };
    },
    [deliberate],
  );

  const changeTowerName = useCallback(
    (towerId: string, to: string) =>
      renameMutation.run(towerId, async () => {
        const { towers: [renamed] } = await renameTowerOnServer(towerId, to);
        if (!renamed) return;
        /* The third field edited this way, and the third that flickered. */
        held.current.confirm(holdKey("tower", towerId, "site"), renamed.site);
        setTowers((prev) =>
          prev.map((t) =>
            t.id === towerId
              ? {
                  ...renamed,
                  /* One exception to taking the projection wholesale. The
                     battery is a DEMO reading that this shell ticks upward
                     while a tower charges, and the fresh projection reseeds it
                     from the device id — so replacing it would rewind a number
                     the operator has been watching climb. Everything else here
                     is either served or deterministic per tower, and identical
                     in both copies. */
                  ...(t.batteryPct !== undefined
                    ? { batteryPct: t.batteryPct }
                    : {}),
                }
              : t,
          ),
        );
      }),
    [renameMutation],
  );

  const applySettings = useCallback(
    (towerId: string, next: Partial<CameraSettings>) => {
      setSettings((prev) => ({
        ...prev,
        [towerId]: {
          ...(prev[towerId] ?? DEFAULT_CAMERA_SETTINGS),
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
    (towerId: string, next: Partial<CameraSettings>) =>
      routine.run(`settings:${towerId}`, async () => {
        applySettings(towerId, next);
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


  /**
   * The URL, in both directions.
   *
   * ON LOAD: a link to `#settings/cameras` must OPEN Settings, not merely be
   * remembered — otherwise the link does nothing for the person who was sent
   * it, which is the whole point of having one.
   *
   * ON hashchange: back, forward, or a second paste into the same tab. `null`
   * means the hash stopped naming Settings, so the screen CLOSES — leaving it
   * open would make the back button appear broken.
   *
   * ⚠ GATED ON THE FEATURE. A pasted settings link must not open a screen this
   * account may not have; `navAllowed` is the same check the rail and the
   * router use, so a URL cannot be the one way past the gate.
   */
  useEffect(() => {
    const open = (next: SettingsSection | null) => {
      if (next === null) {
        setOnSettings(false);
        return;
      }
      if (!navAllowed(features, "settings")) return;
      setSettingsSection(next);
      setOnSettings(true);
    };
    /* The initial read, for a cold load on a deep link. The state initialiser
       above already has the section; this is what OPENS the screen. */
    open(sectionFromHash());
    return subscribeToSettingsHash(open);
  }, [features]);

  /* Keep the URL in step with the screen. Writing it here rather than in the
     click handlers means every route INTO Settings — the rail, a pasted link,
     the back button — ends with the address bar telling the truth, instead of
     each caller having to remember to update it. */
  useEffect(() => {
    if (onSettings) writeSection(settingsSection);
    else clearSection();
  }, [onSettings, settingsSection]);

  const navigate = useCallback(
    (id: string) => {
      /* ── THE ROUTER'S HALF OF THE FEATURE GATE ─────────────────────────────

         `IconRail` removes a destination this account does not have; this
         refuses it. BOTH, because either alone is a bug: the rail alone leaves
         the destination reachable by any other caller (and there are several —
         `TowerView`, `AlertsView` and `PlaybackView` all call `onNavigate`,
         and `watchPerson` navigates to the watchlist from an alert), while this
         alone leaves an item on screen that does nothing.

         THERE ARE NO URLs TO GATE. This app has no router and no URL state —
         `grep -rn "URLSearchParams\|location.search\|location.hash" src/`
         finds nothing — so a screen cannot be reached by typing an address.
         Every way in goes through this function, which makes it the whole
         client-side surface. The server gates its own routes regardless. */
      if (!navVisible(id, { features, serverHasSites: sitesEnabled, isAdmin })) {
        return;
      }
      /* Every destination but Playback leaves the board. Playback is layered
         over whatever it was opened from, the board included. */
      if (id !== "playback") {
        setOnTowers(false);
        backToBoard.current = false;
      }
      /* Every destination leaves Settings. It is not layered over anything the
         way Playback is, and a settings screen that survived navigating away
         would keep a half-typed password in state behind another view. */
      if (id !== "settings") setOnSettings(false);
      /* Same rule as Settings, for the same reason: these screens hold
         half-finished forms (a share being composed, a password being set) and
         one that survived navigating away would keep them behind another view. */
      if (id !== "shares") setOnShares(false);
      if (id !== "admin") setOnAdmin(false);
      if (id === "shares" || id === "admin") {
        setOnPlayback(false);
        setOnPeople(false);
        setAdding(false);
        setOnAlerts(false);
        show(null);
        if (id === "shares") setOnShares(true);
        else setOnAdmin(true);
        return;
      }
      if (id === "dashboard") {
        setOnPlayback(false);
        setOnPeople(false);
        setAdding(false);
        setOnAlerts(false);
        show(null);
        return;
      }
      if (id === "settings") {
        setOnPlayback(false);
        setOnPeople(false);
        setAdding(false);
        setOnAlerts(false);
        show(null);
        setOnSettings(true);
        return;
      }
      if (id === "add") {
        setOnPlayback(false);
        setOnPeople(false);
        setOnAlerts(false);
        show(null);
        setAdding(true);
        return;
      }
      if (id === "poi") {
        setOnPlayback(false);
        setAdding(false);
        setOnAlerts(false);
        show(null);
        setOnPeople(true);
        return;
      }
      if (id === "alerts") {
        setOnPlayback(false);
        setAdding(false);
        setOnPeople(false);
        show(null);
        setOnAlerts(true);
        return;
      }
      if (id === "playback") {
        // Deliberately no show(null) — see the note on `onPlayback`.
        setAdding(false);
        setOnPeople(false);
        setOnAlerts(false);
        setOnPlayback(true);
        return;
      }
      if (id === "towers") {
        /* The board: every tower's status, one panel each.

           This USED to jump into a single tower — the one with the newest
           alert, else the first. With the alert fixtures loaded into a live
           fleet that was always TWR-1042, a tower no account has, so the item
           opened "TWR-1042 IS UNAVAILABLE" on every click. The rail's Towers
           means all of them now, which is what its label always said. */
        setOnPlayback(false);
        setOnPeople(false);
        setAdding(false);
        setOnAlerts(false);
        show(null);
        setOnTowers(true);
      }
    },
    /* `features` is a dependency because this callback READS it. Without it
       the memoised router keeps the set it was built with, so a feature
       revoked while somebody is signed in would be enforced by the rail and
       not by the router -- the exact split this gate exists to avoid. The
       same goes for the two site values: the capability probe answers AFTER
       the first render, and a router memoised before it would refuse Shares
       and Administration for the life of the session. */
    [show, features, sitesEnabled, isAdmin],
  );

  /* Only a LOCAL alert can carry a match to reject: coordination raises five
     kinds and none of them is a detection, so nothing in the server feed has
     a `matchedPersonId` and nothing in it is written to here. */
  const applyRejectMatch = useCallback((id: string) => {
    setLocalAlerts((prev) =>
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

  /* `addTower` is gone, and its absence is the point.
   *
   * It used to take a fabricated `Tower` and splice it into local state, which
   * is how the old flow "added" a site that had never spoken to coordination.
   * A real tower arrives the only way it can: it enrols against the pairing
   * code, coordination binds it to this account, and it turns up in the next
   * read of `GET /v1/viewer/towers`. Nothing client-side mints one, so there is
   * no longer any path in this app that can put a tower on a fleet that the
   * server does not already have. */
  const openTower = useCallback(
    (id: string, showAlerts = false) => {
      backToBoard.current = false;
      show({ id, showAlerts });
    },
    [show],
  );

  /* A panel on the board opens its tower, and remembers the way back. */
  const openFromBoard = useCallback(
    (id: string) => {
      backToBoard.current = true;
      setOnTowers(false);
      show({ id, showAlerts: false });
    },
    [show],
  );

  /* The tower view's way up: to the board if that is where the operator came
     from, otherwise to the wall. Read once and cleared, so a later drill-in
     from anywhere else cannot inherit it. */
  const leaveTower = useCallback(() => {
    const toBoard = backToBoard.current;
    backToBoard.current = false;
    show(null);
    if (toBoard) setOnTowers(true);
  }, [show]);

  /**
   * Towers whose alert notice this operator has read.
   *
   * ⚠ LIFTED OUT OF `TowersPanel`, where it was component-local — and that panel
   * unmounts on every drill-in, so a dismissed notice came back the moment an
   * operator visited a tower and returned. Dismissing meant "I have read this",
   * and having it reappear taught them the control did not work.
   *
   * Optimistic and unwrapped, deliberately: it is a view preference, instant is
   * correct, and a spinner would be an apology for nothing.
   */
  const [dismissedNotices, setDismissedNotices] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  /* Hydrate once, when the account is known. A later run must not clobber an
     arrangement the operator has already changed this session, which is what
     the ref guards. */
  useEffect(() => {
    if (!accountId || prefsLoaded.current) return;
    prefsLoaded.current = true;
    const stored = loadPrefs(accountId);
    setDismissedNotices(new Set(stored.dismissedNotices));
    if (Object.keys(stored.cameraSettings).length > 0) {
      setSettings(stored.cameraSettings);
    }
    setFootageClips(stored.footageClips);
  }, [accountId]);

  /* Write back whenever a preference moves. Cheap, and it means a browser that
     is closed rather than navigated away from still remembers. */
  useEffect(() => {
    if (!accountId || !prefsLoaded.current) return;
    savePrefs(accountId, {
      dismissedNotices: [...dismissedNotices],
      cameraSettings: settings,
      footageClips,
    });
    /* Deliberately no mirrored `prefs` state. It would be a second copy of
       what the three sources already say, and the first time it drifted the
       stale one would be what got written to disk. */
  }, [accountId, dismissedNotices, settings, footageClips]);

  const dismissNotice = useCallback((towerId: string) => {
    setDismissedNotices((prev) => new Set(prev).add(towerId));
  }, []);

  /* ⚠ THE RECONCILE THAT USED TO BE HERE IS GONE WITH THE ARRANGEMENT IT
     RECONCILED. It kept a stored wall order in step with the fleet by dropping
     ids that had left and appending ids that were new — which is how a tower
     that arrived late ended up last on the wall and third in the list, for
     ever. A derived order has nothing to keep in step: a tower appearing or
     going dark changes the wall on the next render, in the same place the
     list puts it. */

  /**
   * Poll while a registration is open.
   *
   * Only while one is open: there is nothing to watch otherwise, and a fleet
   * screen quietly polling forever is the kind of traffic nobody notices until
   * it matters. When a claim flips to `consumed` the tower appears in the fleet,
   * so the fleet is re-read once and the polling stops.
   */
  useEffect(() => {
    if (seededFleet) return;
    const controller = new AbortController();
    let stopped = false;

    const read = async () => {
      try {
        const next = await listClaims(controller.signal);
        if (controller.signal.aborted || stopped) return;
        setClaims(next);
        /* A claim that has just been consumed means a real tower now exists
           that the fleet has not seen. One re-read, not a poll. */
        const consumed = next.some((c) => c.status === "consumed");
        if (consumed) {
          const snapshot = await listFleet(controller.signal);
          if (!controller.signal.aborted && !stopped) {
            takeSnapshot(snapshot);
            setCloud(snapshot.cloud);
          }
        }
      } catch {
        /* A failed claims read is not a reason to shout — the fleet banner
           already reports an unreachable coordination, and a second notice
           about the same outage would be noise. */
      }
    };

    void read();
    const t = setInterval(() => void read(), 5000);
    return () => {
      stopped = true;
      controller.abort();
      clearInterval(t);
    };
  }, [seededFleet, adding, claimTick]);

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

     ⭐ IT DOES NOW. `POST /v1/viewer/site-alerts/{id}/ack` sends NO BODY and
     returns the updated alert; who acknowledged is the authenticated caller
     and never a name in a request. The visibly-fake "A. Okafor" placeholder
     that stood here, precisely so an unverified claim could not be mistaken
     for a verified one, is gone with the route that made it unnecessary. */
  /**
   * CONSUMER 2 — acknowledging an alert.
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

  /**
   * Run a status change through the honesty pattern.
   *
   * ⭐ THE `fn` BODY IS A REAL ROUND TRIP NOW. The note here used to say
   * "this is the only thing that changes when alerts get a backend — when
   * `fn` becomes `await api.acknowledge(id)` the keying, the in-flight latch,
   * the retry path, the inline failure and the announcement all start carrying
   * weight without another component changing." That is exactly what happened,
   * and no other component changed.
   *
   * ⚠ A SERVER ALERT CANNOT BE RESOLVED, and nothing offers to. There is no
   * resolve route and no `resolved` state on the row: acknowledging is
   * one-way, and a camera coming back writes `recovered_at` onto the SAME
   * alert rather than closing it. Those are different facts about different
   * actors — one is a person noticing, one is hardware returning — and
   * collapsing them would let a screen imply somebody dealt with an outage
   * that simply ended. A local alert keeps the old two-step, because the
   * detection feed it belongs to will have one.
   */
  const changeStatus = useCallback(
    (id: string, status: Alert["status"]) =>
      statusMutation.run(id, async () => {
        if (alertFeed.alerts.some((a) => a.id === id)) {
          await alertFeed.acknowledge(id);
          return;
        }
        setLocalAlerts((prev) =>
          prev.map((a) => (a.id === id ? { ...a, status } : a)),
        );
      }),
    [alertFeed, statusMutation],
  );

  /* Returns the alert so the caller can arm its own banner against it —
     arrival and acknowledgement stay separate concerns. */
  /* Same rule as the watchlist counter above. The id used to be the clock
     truncated to seconds, which collides for two alerts raised inside one
     second — and the simulator's button can be pressed twice that fast — and
     wraps every 27.8 hours besides. Two alerts sharing an id acknowledge
     together and the feed cannot arrow onto the second of them. */
  /* Starts at zero, because the fixtures no longer load. It used to be seeded
     off `ALERTS` so a simulated alert could not collide with one of the six. */
  const nextAlert = useRef(0);

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
    setLocalAlerts((prev) => [alert, ...prev]);
    return alert;
  }, []);

  /* Honours the OS setting for every motion component below. Complements the
     @media block in index.css, which covers the CSS keyframes motion knows
     nothing about — including the siren, which deliberately stays lit rather
     than disappearing. The two are not redundant; don't consolidate them. */
  return (
    <MotionConfig reducedMotion="user">
      {/* ── THE TWO PROVIDERS THE CARDS NEED ──────────────────────────────

          `ShareFeedProvider` is ONE share list, read by the floating cards,
          by the Sharing page and by the badge on a borrowed feed. The brief's
          hardest line is "cards and page must always agree", and two copies of
          a list can only approach that by polling faster; one copy does it by
          construction.

          It is `enabled` on the server's answer, so a HUB -- same bundle, no
          sites -- puts no share request on the wire at all.

          `NotificationProvider` owns the stack and the history. It knows
          nothing about sharing: share cards are the first kind through it and
          deliberately not the shape of it. */}
      <NotificationProvider>
        <ShareFeedProvider enabled={sitesEnabled}>
        {/* ── AND THE FLEET FOLLOWS THE SHARES ─────────────────────────

            Renders nothing. It re-reads `GET /v1/viewer/towers` when the set
            of cameras lent TO this account changes, which is the thing that
            was missing when a borrower pressed Watch and was told the tower
            was "not on your fleet any more": the fleet is read once on mount,
            and a share that lands afterwards changed the answer without
            anybody going to ask. See lib/watch.tsx. */}
        <FleetFollowsShares refreshFleet={refreshFleetQuietly} />
        {/* Going to a camera, from the card deck, from Sharing > Active and
            from the badge on a borrowed tile, through one function that reads
            the fleet again first when the camera is not in it yet. */}
        <WatchProvider
          open={(deviceId) => {
            setOnShares(false);
            setOnAdmin(false);
            setOnSettings(false);
            openTower(deviceId);
          }}
          hasDevice={(deviceId) => towers.some((t) => t.id === deviceId)}
          refreshFleet={refreshFleetQuietly}
        >
        {/* `FleetFeedProvider` turns the AUDIT LOG into cards: a cell or a
            tower added, moved, replaced or removed, and a person disabled.

            ADMIN ONLY, and not by a decision here -- /v1/admin/audit answers
            403 for anybody else. The case it exists for is a SITE USER
            adding a device: they may do that without asking, and this is how
            the office finds out the same minute rather than next month. */}
        <FleetFeedProvider enabled={isAdmin} meAccountId={accountId}>
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
        {/* THE SHARE BANNER IS GONE, AND THAT WAS THE POINT.

            It sat across the top, pushed the whole wall down, and its one
            control sent whoever pressed it to another screen. Answering a
            question about a gate meant stopping watching the gate.

            What replaced it is `ShareDeck` plus `NotificationStack` at the
            bottom of this file: cards in the corner, over the video, with the
            whole decision inside them. Nothing here pushes anything down. */}
        <div className="min-h-0 flex-1">
      {onAdmin ? (
        <AdministrationView onNavigate={navigate} />
      ) : onShares ? (
        <SharesView onNavigate={navigate} />
      ) : onSettings ? (
        <SettingsView
          onNavigate={navigate}
          onBack={() => setOnSettings(false)}
          section={settingsSection}
          onSectionChange={setSettingsSection}
          towers={towers}
          feeds={feeds}
          onSetPatrol={setCameraPatrol}
          patrolPhase={patrolPhaseFor}
          /* A renamed camera comes straight back up here. The server returns
             the whole re-projected tower, so both lists are replaced rather
             than patched — patching one field is how the wall ends up showing
             the old name while the settings screen shows the new one. */
          onCameraRenamed={(tower, renamedFeeds) => {
            /* ⚠ HELD LIKE A PATROL, AND FOR THE SAME REASON. The server
               answers with the re-projected tower, and a `listFleet` already
               in flight carries the OLD name -- so a rename flickered back
               exactly the way a patrol did. */
            for (const f of renamedFeeds) {
              held.current.confirm(holdKey("camera", f.id, "label"), f.label);
            }
            setTowers((prev) =>
              prev.map((t) => (t.id === tower.id ? tower : t)),
            );
            setFeeds((prev) => [
              ...prev.filter((f) => f.towerId !== tower.id),
              ...renamedFeeds,
            ]);
          }}
        />
      ) : onPlayback ? (
        /* FOOTAGE. The route id stays `playback` because that is the server's
           feature name; everything an operator reads says Footage. It takes no
           `towers`/`feeds`: the LIVE fleet is the wrong source here, because an
           offline tower still has footage on the archive and used to vanish
           from this screen. It asks the archive what is reviewable instead. */
        <FootageView
          /* The drawer is a remembered view preference, so it is App's like
             every other one -- see ViewPrefs.footageClips. */
          clipsOpen={footageClips}
          onClipsOpen={setFootageClips}
          onBack={() => setOnPlayback(false)}
        />
      ) : onAlerts ? (
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
          /* ⚠ THE READ FAILING IS NOT AN EMPTY FEED, and the two look the
             same unless one of them says so. An alert screen reading "No
             alerts" over a request that was refused is the fake-green failure
             in the one place it costs most. */
          problem={alertFeed.phase.kind === "error" ? alertFeed.phase.message : null}
          paused={alertFeed.paused}
          openAlertId={openAlertId}
          cameraNameOf={cameraNameOf}
          onRefreshAlert={alertFeed.refresh}
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
          pendingClaim={openClaim}
          onNavigate={navigate}
          onCancel={() => setAdding(false)}
          onClaimed={(claim) => {
            setClaims((prev) => [claim, ...prev.filter((c) => c.claim_id !== claim.claim_id)]);
            setClaimTick((n) => n + 1);
          }}
          onDone={() => {
            setAdding(false);
            setClaimTick((n) => n + 1);
          }}
        />
      ) : onTowers ? (
        <TowersView
          towers={towers}
          feeds={feeds}
          alerts={alerts}
          /* For the hub rows' Uplink cell, which names the site's way out.
             The same reading the settings panel's Internet row takes. */
          cloud={cloud}
          /* There IS an alert list now, on every fleet — see the note on
             `alerts`. Saying "no alert feed yet" here while the Alerts screen
             is full of them would be the board contradicting the screen next
             door. A tower with none of the fixtures reads 0, which is true of
             the list it is counting. */
          alertFeed
          seeded={seededFleet}
          loading={fleetLoading}
          problem={reachProblem?.headline ?? null}
          onNavigate={navigate}
          onOpenTower={openFromBoard}
        />
      ) : open === null ? (
        <DashboardView
          towers={towers}
          feeds={feeds}
          alerts={alerts}
          pendingClaim={openClaim}
          onNavigate={navigate}
          onResumeSetup={() => setAdding(true)}
          onOpenTower={openTower}
          onRetryFeed={retryFeed}
          onToggleRecord={toggleRecord}
          playback={playback}
          sessionFor={sessionFor}
          onScreenTiles={visibleTiles}
          observeTile={observeTile}
          dismissedNotices={dismissedNotices}
          onDismissNotice={dismissNotice}
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
        <TowerUnavailable id={open.id} onBack={leaveTower} />
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
          cloud={cloud}
          feeds={feedsForTower(feeds, open.id)}
          alerts={alertsForTower(alerts, open.id)}
          onRefreshAlert={alertFeed.refresh}
          alertsPaused={alertFeed.paused}
          playback={playback}
          sessionFor={sessionFor}
          onRetryPlayback={retryPlayback}
          showAlerts={open.showAlerts}
          onBack={leaveTower}
          onSetFeedState={setFeedState}
          onRetryFeed={retryFeed}
          onToggleRecord={toggleRecord}
          onRaiseAlert={raiseAlert}
          onNavigate={navigate}
          cameraSettings={cameraSettings}
          onRenameTower={changeTowerName}
          onSetHome={setCameraHome}
          onGoHome={goCameraHome}
          onSetPatrol={setCameraPatrol}
          patrolPhase={patrolPhaseFor}
          homeMutation={deliberate}
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

        {/* The deck turns changes in the feed into cards; the stack draws
            them. Last in the tree so nothing can render over them, and
            `fixed` so they belong to the viewport rather than to whichever
            screen happens to be open. */}
        {/* "Watch now" lands on the tower the share just granted, which is
            the one thing anybody wants next and the thing the old banner made
            somebody find for themselves. It goes through `WatchProvider` so it
            re-reads the fleet first: the accept and the press can be in the
            same second, before any poll has run. */}
        {/* ⚠ NO SHARE CARDS ON A HUB. A share is between two sites over the
            internet, and a hub has neither. The deck is one of the few things
            that draws itself over whatever screen is open, so a stray card
            would be the one piece of Sharing a kiosk could still show. */}
        {hubMode ? null : <ShareDeck />}
        {/* ⚠ NOT GATED ON `hubMode`, UNLIKE THE DECK ABOVE IT. A share is
            between two sites over the internet and a hub has neither, which is
            why that one is hidden. An alert is the hub's OWN judgement about
            its own masts — it is the thing a local dashboard in a control room
            exists to show, and the kiosk standing in that room is the screen
            most likely to be the only one anybody is looking at. The feed
            behind this is the same three routes on both tiers. */}
        <AlertNotifications
          arrivals={arrivals}
          onOpen={(id) => {
            /* The feed, at that alert. The card is the interruption and the
               feed is the record, so "Open" lands where the record is rather
               than opening a second detail view over the wall. */
            setOpenAlertId(id);
            navigate("alerts");
          }}
        />
        <NotificationStack />
        </FleetFeedProvider>
        </WatchProvider>
        </ShareFeedProvider>
      </NotificationProvider>
    </MotionConfig>
  );
}
