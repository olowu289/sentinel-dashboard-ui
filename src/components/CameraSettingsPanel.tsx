import { motion } from "motion/react";
import { QuickShare } from "@/components/sharing/QuickShare";
import { useCapabilities } from "@/lib/useSites";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { solarState } from "@/lib/data";
import { MaskIcon } from "./Icon";
import { batteryCharging } from "@/lib/battery";
import { batteryFill, batteryTone, TowerBattery } from "./TowerBattery";
import { ENTER, FADE } from "@/lib/motion";
import { formatEventTime, formatUptime } from "@/lib/time";
import { storageTone } from "@/lib/storage";
import { classifyFirmware } from "@/lib/firmware";
import { uplinkReading, type UplinkReading } from "@/lib/api/map";
import type { CloudReading } from "@/lib/api/fleet";
import { radioGrade, radioStateNote } from "@/lib/radio";
import { useNow } from "@/lib/useNow";
import {
  MutationError,
  MutationIcon,
  MutationSpinner,
  MutationStatus,
  errorRing,
} from "./MutationFeedback";
import type { MutationPhase } from "@/lib/useMutation";
import type { ViewerSession } from "@kallon/sentry-sdk";
import {
  MAX_ZONES,
  type ActivityZone,
  type CameraFeed,
  type CameraSettings,
  type StreamProfile,
  type Tower,
} from "@/lib/types";

/**
 * A tower's settings, over the alerts rail rather than on a screen of
 * their own — the operator has to see the pictures the settings are about.
 *
 * Tower-wide, because the frame puts the gear in the tower's bar rather than
 * on a tile. Zones are the exception and have to be: a zone is a shape drawn
 * on one camera's own view, and the other camera points somewhere else, so the
 * editor asks which camera you are drawing for.
 *
 * The shape follows eufy's per-camera menu, which is the most worked-through
 * version of this in a consumer product: detection first, then picture, then
 * audio, each row carrying its current value. Three things differ on purpose.
 *
 * Sensitivity is named, not a 7-point slider. eufy publishes the numeric ranges
 * behind each of their levels, which is the tell that "level 4 of 7" means
 * nothing on its own; every option here says what it costs instead.
 *
 * Rows expand in place rather than pushing a sub-screen. On a 417px panel with
 * eight settings, a stack of drill-ins is four taps to change one number, and
 * the operator loses the picture every time.
 *
 * Changes are still stamped with who made them — these decide what reaches the
 * alert feed, so an adjustment with no name on it is an unanswerable question
 * three shifts later. The panel no longer prints it: a settings screen is where
 * you change something, and a provenance line at the bottom of one is read by
 * nobody at the moment it matters. It belongs in an audit view, which is where
 * `changedBy` and `changedAt` are waiting.
 */

const DETECT: { value: CameraSettings["detect"]; label: string; note: string }[] =
  [
    {
      value: "people",
      label: "People Only",
      note: "Quietest. Vehicles moving through the frame are ignored.",
    },
    {
      value: "people-vehicles",
      label: "People & Vehicles",
      note: "The default. Catches most of what a yard cares about.",
    },
    {
      value: "all",
      label: "All Motion",
      note: "Everything that moves, including weather and animals.",
    },
  ];

const SENSITIVITY: {
  value: CameraSettings["sensitivity"];
  label: string;
  note: string;
}[] = [
  {
    value: "low",
    label: "Low",
    note: "Misses more. Use where the frame is busy with traffic.",
  },
  { value: "standard", label: "Standard", note: "The default." },
  {
    value: "high",
    label: "High",
    note: "Catches more, and raises more false alerts.",
  },
];

const NIGHT: { value: CameraSettings["nightVision"]; label: string; note?: string }[] =
  [
    { value: "auto", label: "Auto", note: "The default." },
    {
      value: "infrared",
      label: "Infrared",
      note: "Always on. Reaches further after dark, at the cost of colour.",
    },
    { value: "off", label: "Off", note: "Nothing after dusk." },
  ];

/* ⚠ `RECORDING_QUALITY` IS GONE, AND IT WAS THE PLAINEST FALSEHOOD ON THE
   PANEL. It offered "4K HD" as the default, then "Full HD (1080P)" and "HD
   (720P)", on cameras that serve 2560x1440 and 704x576 and nothing else. Three
   options: one impossible, two the hardware does not produce. It wrote to
   `CameraSettings.recordingQuality`, which is local state nothing reads, so
   picking any of them changed nothing anywhere -- an operator chose 720p to
   stretch a filling disk and the tower carried on recording 2K.

   What replaces it is `recordingResolution` below: the resolution the device
   says it is RECORDING at, read-only, and "Not reported" when it has not said.
   See `health.recording.stream` and the camera's own advertised profiles. */

/* ─────────────────────────────────────────────────────────────────────
   STREAM QUALITY IS THE ONE ROW ON THIS PANEL THAT IS REAL.

   It used to be three invented options — "1080P · 30 fps" and friends —
   written against a store nothing read, on a camera that turned out to be
   serving 2560×1440. The label was not merely inert, it was WRONG.

   What replaces it is derived from what the tower actually advertises, so a
   camera with different streams shows its own, and one that advertises none
   shows none. Nothing here is a constant, because nothing here is this app's
   to decide.
   ───────────────────────────────────────────────────────────────────── */

/**
 * A familiar name for a resolution, or nothing.
 *
 * Only ever an ADDITION to the true numbers, never a replacement: "2K" is a
 * convenience for people who think in tiers, and 2560×1440 is the fact. A tier
 * on its own is how "1080p" ended up printed over a 2K stream.
 */
function tierFor(width: number, height: number): string | null {
  const w = Math.max(width, height);
  if (w >= 3840) return "4K";
  if (w >= 2560) return "2K";
  if (w >= 1920) return "Full HD";
  if (w >= 1280) return "HD";
  return "SD";
}

/**
 * What a profile is called on screen.
 *
 * With a resolution: `2K · 2560×1440` — the tier for recognition, the numbers
 * for truth. Without one: the profile's own id, unadorned. The tower declares
 * resolutions from config rather than probing them, so an unconfigured profile
 * genuinely has none, and the honest answer is to name the stream rather than
 * to print a number nobody measured.
 */
function profileLabel(p: StreamProfile): string {
  if (!p.resolution) return p.id;
  const { width, height } = p.resolution;
  const tier = tierFor(width, height);
  return `${tier ? `${tier} · ` : ""}${width}×${height}`;
}

/** The second line, and only when there is something true to put on it. */
function profileNote(p: StreamProfile, isDefault: boolean): string | undefined {
  if (!p.resolution) {
    return `Stream "${p.id}". The tower reports no resolution for it.`;
  }
  return isDefault
    ? "The camera's default. Lightest on the uplink and the battery."
    : "More detail, and more of the uplink and the battery to carry it.";
}

/* ⚠ `RECORDING`, `RETENTION` AND `POWER` ARE GONE, AND THEY WERE THE THREE
   DROP-DOWNS THAT WROTE TO NOTHING.

   "On Detection / Continuous", "7 / 30 / 90 days" and "Performance / Balanced
   / Battery saver" all wrote to `CameraSettings`, which is this browser's own
   local state. No server read any of them, no tower received any of them, and
   there is no command in the protocol for any of the three. An operator
   managing a dark week picked "Battery saver"; an investigator who needed
   three months picked "90 days". Both watched the chevron close on a change
   that did not exist, and the retention one is a silent promise about
   evidence.

   What replaces them, in the same three places: readings. The device reports
   what it actually does -- recording mode and stream from `health.recording`,
   the real retention window and whether the disk is shortening it -- and the
   rows carry "Set by Kallon" so a customer knows the control was taken away
   rather than broken. The power row has nothing behind it at all yet and says
   so.

   `CameraSettings` keeps the fields: a seeded demo fleet still drives them,
   and the footage screen reads `recordingQuality` to describe a clip. Nothing
   on this panel writes them any more. */

export function CameraSettingsPanel({
  tower,
  cloud,
  feeds,
  settings,
  onChange,
  onRename,
  renamePhase = { kind: "idle" },
  onRetryRename,
  onDismissRename,
  cameraProfiles,
  onChooseProfile,
  onSetHome,
  homePhase,
  onRetryHome,
  onDismissHome,
  sessionFor,
  settingsPhase = { kind: "idle" },
  onRetrySettings,
  onDismissSettings,
  onClose,
  canTune = false,
  className = "",
}: {
  tower: Tower;
  /**
   * The site's link to Kallon Cloud.
   *
   * ⚠ ONE FACT ABOUT THE SERVER, not about this tower — which is why it
   * arrives as a prop rather than off `tower`. Every tower on one hub shows
   * the same answer, and `undefined` is "the server did not say", which the
   * row renders in words and never as "disconnected".
   */
  cloud?: CloudReading;
  feeds: CameraFeed[];
  settings: CameraSettings;
  onChange: (next: Partial<CameraSettings>) => void;
  /**
   * Which profile each camera is being watched at, by feed id, and how to
   * change it. Owned by the shell because the choice re-opens a session and
   * this panel is not what holds the peer.
   *
   * ⚠ NOT PART OF `settings`. Every other row here writes to a store nothing
   * reads; this one selects which stream the browser pulls and takes effect
   * immediately. Keeping it out of `CameraSettings` is the difference being
   * made visible in the types.
   */
  cameraProfiles?: Record<string, string>;
  onChooseProfile?: (feedId: string, profile: string) => void;
  /**
   * Save a camera's current pan/tilt as its home.
   *
   * Per camera and per feed id, because each camera has its own home and the
   * two on a site point at different things.
   *
   * Owned by the shell like the other real writes: it goes to the tower over
   * the same authorized PTZ path a move does, and this panel is not what holds
   * the session.
   */
  onSetHome?: (feedId: string) => void;
  /** What each camera's set-home is doing. Keyed by feed id. */
  homePhase?: (feedId: string) => MutationPhase;
  onRetryHome?: (feedId: string) => void;
  onDismissHome?: (feedId: string) => void;
  /**
   * The live session for a camera, if there is one.
   *
   * Read to decide whether set-home can be offered at all: PTZ is
   * session-scoped, so without one there is no address to send the command to
   * and the button would only be able to fail. Saying that up front beats a
   * spinner that resolves into "NO SESSION".
   */
  sessionFor?: (feedId: string) => ViewerSession | null;
  /**
   * May this account change what the cameras LOOK FOR -- zones, sensitivity,
   * motion.
   *
   * ⚠ THE PANEL IS NO LONGER BEHIND THIS, AND THAT IS THE FIX. The whole
   * panel used to be gated on `camera_tuning`, a feature that is off by
   * default because detection tuning is local state with nothing behind it.
   * The result: an operator could not open TOWER SETTINGS AT ALL -- not the
   * tower's name, not stream quality, not the home position, none of which is
   * fabricated and all of which belongs to whoever works at that site.
   *
   * So the panel opens on `settings`, and this one group stays behind
   * `camera_tuning`. Default false: a caller that has not thought about it
   * gets the restrictive answer, which is the same rule `DEFAULT_FEATURES`
   * follows.
   */
  canTune?: boolean;
  /** Commit a new id for this tower. */
  onRename: (next: string) => void;
  /** What the rename is doing. Keyed by tower id, owned by the shell. */
  renamePhase?: MutationPhase;
  onRetryRename?: () => void;
  onDismissRename?: () => void;
  /**
   * Every row on this panel writes through one keyed mutation, so a failed
   * change is reported once, at the top, rather than each of eighteen rows
   * growing its own error slot. Routine: each row already shows its own new
   * value, which is the confirmation.
   */
  settingsPhase?: MutationPhase;
  onRetrySettings?: () => void;
  onDismissSettings?: () => void;
  onClose: () => void;
  /** The panel stands in the alerts column, so it answers to the same
   *  breakpoint rules — see the call site in `TowerView`. */
  className?: string;
}) {
  const [open, setOpen] = useState<string | null>(null);
  /* Sharing exists only where sites do. One cached probe for the page. */
  const caps = useCapabilities();
  const canShare = caps?.features.sites === true;
  const [editingZones, setEditingZones] = useState(false);

  /* What the collapsed row says. One camera speaks for itself; two agreeing
     speak as one; two disagreeing say so rather than picking a winner to
     print. "Not reported" is the honest answer for a tower advertising no
     profiles at all, and it is the same words every other absent reading on
     this panel uses. */
  const streamSummary = (() => {
    const labels = feeds.map((f) => {
      const list = f.profiles ?? [];
      if (list.length === 0) return null;
      const current =
        list.find((p) => p.id === cameraProfiles?.[f.id]) ??
        list.find((p) => p.default) ??
        list[0];
      return profileLabel(current);
    });
    const known = labels.filter((l): l is string => l !== null);
    if (known.length === 0) return "";
    return known.every((l) => l === known[0])
      ? known[0]
      : `${known.length} cameras`;
  })();

  /* ── TOWER OR HUB ────────────────────────────────────────────────────
     From the box's own word, not from a guess. `health.sectors` was the
     obvious inference and it is wrong for every single-radio hub, which
     reports none and would then be drawn with a tower's Network rows: a radio
     link to a hub it IS, and no uplink row at all. Absent means tower, which
     is every release before `kind` crossed. */
  const isHub = tower.kind === "hub";

  /* THE HUB'S WAY OUT, in one sentence of three facts the agent measured.
     Each part is dropped rather than defaulted, so a hub that reports the
     interface and nothing else says the interface and stops. */
  const internetRow = (() => {
    if (!cloud) {
      /* The server did not say. Not "disconnected": a hub whose uplink agent
         has never run has not told us the link is down, it has told us
         nothing. */
      return { value: "", tone: undefined as string | undefined, detail: undefined };
    }
    if (cloud.isCloud) {
      /* Answered BY the cloud. There is no uplink to describe and no round
         trip anybody made. */
      return {
        value: "This is Kallon Cloud",
        tone: undefined,
        detail: "You are reading this through the data centre itself.",
      };
    }
    const where = cloud.iface ?? "Unknown connection";
    if (cloud.connected !== true) {
      return {
        value: `${where} · not connected`,
        tone: "text-critical",
        detail: undefined,
      };
    }
    const latency =
      cloud.latencyMs !== undefined ? ` · ${cloud.latencyMs} ms` : "";
    return {
      value: `${where} · connected${latency}`,
      tone: undefined,
      detail:
        cloud.latencyMs === undefined
          ? "No round trip has been measured yet."
          : "Heartbeat round trip to Kallon Cloud.",
    };
  })();

  /* ── WHERE THIS DEVICE'S FOOTAGE GOES ────────────────────────────────
     `mode: "hub"` means the hub writes and keeps it, which is every mast
     without its own SSD. Absent means the device has not said -- an older
     release -- and then nothing is claimed either way: the disk row falls back
     to whatever `health.disk` reported, which is what it always did. */
  const recordsAtHub = tower.health?.recording?.mode === "hub";

  /* THE RECORDING MODE, as a sentence rather than a chosen option. "Not
     reported" for a device on a release older than `health.recording`, which
     is honest and is what the old drop-down could never say. */
  const recordingModeRow = (() => {
    const rec = tower.health?.recording;
    if (!rec?.mode) return "";
    /* ⚠ NO "Continuous" AND NO "On Detection" HERE, AND THAT IS DELIBERATE.
       Nothing on the wire reports a capture mode: `health.recording` carries
       WHERE the footage is written and WHICH stream, and that is all anybody
       measured. Printing "Continuous" beside two real facts would make a
       fourth fixture out of the row that exists to remove three. */
    const where = rec.mode === "hub" ? "At the hub" : "On this mast";
    /* WHICH STREAM, because it is the difference between 2K evidence and a
       704x576 record of the same event. */
    const stream =
      rec.stream === "main"
        ? " · 2K main stream"
        : rec.stream === "sub"
          ? " · sub stream"
          : "";
    return `${where}${stream}`;
  })();

  /* HOW LONG FOOTAGE REALLY LASTS. Three shapes, and the difference between
     them is the whole reason this is not one number:

       bound_by "age"   the window is deciding, and it is being kept
       bound_by "disk"  the disk filled first, so the real window is shorter
       neither          the device has not reported a window at all

     `effectiveDays` is what the sweep is actually keeping. It is the number a
     customer needs before they plan an investigation around footage that may
     already be gone. */
  const retentionRow = (() => {
    const rec = tower.health?.recording;
    if (!rec) return { value: "", tone: undefined as string | undefined, detail: undefined };
    const asked = rec.retainDays;
    const real = rec.effectiveDays;
    if (rec.boundBy === "disk") {
      /* THE DISK IS DECIDING. Amber, because it is not a fault -- a full disk
         doing exactly what it is meant to -- but it IS less footage than the
         screen would otherwise promise, and somebody should know. */
      return {
        /* ⚠ SHORT ENOUGH TO SURVIVE A PHONE. "About 12 days — the disk is
           full" truncated at 390px to "About 12 days — the disk i…", which
           hides the half that matters: the number is lower than the setting
           BECAUSE the disk filled. The whole sentence stays in the detail. */
        value:
          real !== undefined
            ? `${Math.round(real)} days · disk full`
            : "Until the disk fills",
        tone: "text-warn",
        detail:
          asked !== undefined
            ? `Set to ${asked} days, but the disk fills first, so older footage is already being removed.`
            : "Retention by age is off on this device: footage is kept until the disk fills.",
      };
    }
    if (asked === undefined) return { value: "", tone: undefined, detail: undefined };
    return {
      value: `${asked} days`,
      tone: undefined,
      detail:
        real !== undefined && Math.round(real) < asked
          ? `About ${Math.round(real)} days of footage on the disk right now.`
          : undefined,
    };
  })();

  /* THE TOWER'S OWN UPLINK MEASUREMENT, computed once so the guard and the
     row cannot disagree about whether there is a number. */
  const ownUplink = uplinkReading(tower.health?.uplink);

  /* When the CLOUD link came up, for the hub's Connected since row. Parsed
     here so the row stays the one that ticks. */
  const cloudSince = (() => {
    if (!cloud?.since || cloud.connected !== true) return undefined;
    const at = Date.parse(cloud.since);
    return Number.isNaN(at) ? undefined : at;
  })();

  /* CAN THE PIPELINE HONOUR A CHOICE AT ALL. It can where a camera advertises
     more than one profile: `App.tsx`'s `chooseProfile` sends the picked id as
     the session's `profile` and the feed reopens against that stream, which is
     a real effect with a visible confirmation. Where a camera advertises one
     profile or none there is nothing to honour, and `StreamChoice` already
     says so in prose instead of drawing a radio group of one. This only
     decides which sentence the row prints above them. */
  const canChooseStream = feeds.some((f) => (f.profiles ?? []).length > 1);

  /* A COUNT, NOT A POSITION. This panel cannot say where home currently
     points without asking the tower, and inventing a description would be
     worse than saying nothing - so it reports the one thing it does know: how
     many of this site's cameras can hold a home at all. */
  const movable = feeds.filter((f) => f.ptz).length;
  const homeSummary =
    movable === 0
      ? "No movable camera"
      : movable === 1
        ? "1 movable camera"
        : `${movable} movable cameras`;

  const zoneCount = feeds.reduce(
    (n, f) => n + (settings.zones[f.id]?.length ?? 0),
    0,
  );

  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  const detect = DETECT.find((d) => d.value === settings.detect);
  const sensitivity = SENSITIVITY.find((s) => s.value === settings.sensitivity);
  const night = NIGHT.find((n) => n.value === settings.nightVision);
  /* ── THE REAL RECORDING RESOLUTION ───────────────────────────────────
     Two facts joined: the device says which stream it writes
     (`health.recording.stream`, `main` or `sub`), and each camera advertises
     that stream's resolution. Where both are known this is the true figure;
     where either is missing the row says "Not reported", which is the one
     thing the old "4K HD" could never say.

     Cameras that disagree are reported as disagreeing rather than averaged:
     the two domes on one mast are different hardware, and picking one to print
     is how "1080p" ended up over a 2K stream in the first place. */
  const recordingResolution = (() => {
    const stream = tower.health?.recording?.stream;
    if (!stream) return "";
    const labels = feeds
      .map((f) => (f.profiles ?? []).find((pr) => pr.id === stream))
      .map((pr) => (pr?.resolution ? profileLabel(pr) : null))
      .filter((l): l is string => l !== null);
    if (labels.length === 0) return "";
    return labels.every((l) => l === labels[0])
      ? labels[0]
      : `${labels.length} cameras`;
  })();
  /* `undefined` for a real tower, which reports no array. Computed once so
     the cell and the sun cannot disagree. */
  const reportedSolar =
    tower.solar !== undefined
      ? solarState({ solar: tower.solar, batteryPct: tower.batteryPct })
      : undefined;
  /* The firmware release, colour-coded by channel/type in one place: green
     stable, amber beta, grey dev/unknown. See lib/firmware.ts. */
  const firmware = classifyFirmware(tower.firmware, tower.firmwareChannel);
  /* FREE space, and `undefined` when the tower has not reported any.
     The old form defaulted the missing case to `0 / 1` and rounded it to 0%
     used — an unmeasured disk reading as an empty one, which is the same class
     of lie as a guessed reading. Absence stays absent, and the row below
     renders "Not reported" for it.

     The reported percentage wins over one derived from the gigabytes: it is
     §3.1's own field, and the two are one disk measured once. */
  const storageFreePct =
    tower.health?.disk?.freePct ??
    (tower.storageUsedGb !== undefined && tower.storageTotalGb !== undefined
      ? ((tower.storageTotalGb - tower.storageUsedGb) /
          Math.max(1, tower.storageTotalGb)) *
        100
      : undefined);

  /* THE BATTERY, and the charge this panel is allowed to DRAW.
     A real tower reports `health.battery`; a seeded one carries `batteryPct`.
     They are kept apart on purpose — `batteryPct` is demo state that App.tsx
     drives upward 1% a second, and a live pack's charge must never come from a
     simulation.

     An UNREACHABLE pack draws nothing. Not the last value, not a zero: the pack
     allows one Bluetooth connection, so failing to read it is routine, and the
     honest answer is to say so rather than to keep the last number on screen. */
  const reportedBattery = tower.health?.battery;
  const chargePct = reportedBattery
    ? reportedBattery.reachable
      ? reportedBattery.socPct
      : undefined
    : tower.batteryPct;
  /* Solar says the array is working; a positive pack current says charge is
     actually going in. Either is enough to animate the cell. */
  const chargingNow =
    reportedSolar === "charging" ||
    (reportedBattery ? batteryCharging(reportedBattery) === true : false);

  if (editingZones) {
    return (
      <ZoneEditor
        feeds={feeds}
        zones={settings.zones}
        className={className}
        onChange={(zones) => onChange({ zones })}
        onDone={() => setEditingZones(false)}
      />
    );
  }

  return (
    <motion.aside
      aria-label={`${tower.id} tower settings`}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={ENTER}
      className={`w-full min-w-0 flex-col border-l border-line-panel bg-ink lg:w-[417px] lg:shrink-0 ${className}`}
    >
      {/* The frame's own bar: 46px, both glyphs at 24. Back and close are two
          different exits and it draws both — back collapses an expanded row,
          close leaves the panel. */}
      <header className="flex h-[46px] shrink-0 items-center border-b border-line px-[16px]">
        <button
          type="button"
          onClick={() => (open ? setOpen(null) : onClose())}
          aria-label={open ? "Collapse this setting" : "Close tower settings"}
          className="flex size-[24px] shrink-0 items-center justify-center text-body-ink transition-colors hover:text-muted"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M12 4 6 10l6 6"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="ml-[12px] min-w-0 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
          TOWER SETTINGS
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tower settings"
          className="ml-auto flex size-[24px] shrink-0 items-center justify-center text-body-ink transition-colors hover:text-muted"
        >
          <svg width="16" height="16" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-[24px]">
        {/* The mast at the frame's size. It is the one thing here that says
            *which* tower without being read, and its cell fills to the charge
            like every other drawing of it. */}
        <div className="relative mx-auto mt-[25px] block h-[282px] w-[163px] shrink-0">
          {/* No cell without a charge to draw — the fleet card's rule, and
              the pending card's before it. `?? 0` used to stand in here, which
              drew an EMPTY RED cell on every real tower: a flat battery nobody
              measured, in the fault colour. */}
          {chargePct !== undefined && (
            <TowerBattery
              pct={chargePct}
              charging={chargingNow}
              className="absolute inset-0 size-full"
            />
          )}
          <img
            src="/icons/twr-mast.svg"
            alt=""
            className="absolute inset-0 block size-full"
          />
        </div>

        <div className="flex flex-col gap-[20px] px-[15px] pt-[32px]">
          <div className="flex h-[65px] items-center justify-between gap-[12px] rounded-[8px] bg-panel px-[15px]">
            <div className="flex min-w-0 flex-col gap-[2px]">
              <TowerName
                name={tower.site}
                onRename={onRename}
                phase={renamePhase}
              />
              {/* Under the field it is about, which is where this app already
                  puts a failed edit. Quiet on success: the new name is already
                  on the fleet card, the band header and the breadcrumb, and a
                  tick beside a field that shows the answer is noise. */}
              <MutationError
                phase={renamePhase}
                onRetry={onRetryRename}
                onDismiss={onDismissRename}
                className="pt-[4px]"
              />
              <span className="flex min-w-0 items-center gap-[6px] text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted">
                {/* No id on this line. The name above it is what the fleet
                    card, the band header and the breadcrumb all show, so the
                    id was a third value competing for a 417px row beside a
                    switch — and it was the one nobody came here to read. */}
                <span className="truncate">
                  {tower.location ?? "Location not reported"}
                </span>
                <span
                  aria-hidden
                  className="size-[2px] shrink-0 rounded-full bg-muted"
                />
                <span className="flex shrink-0 items-center gap-[4px]">
                  {/* Filled to the charge, not tinted by it. A flat tint draws
                      a *full* battery in amber, and a full battery is a claim —
                      the glyph at 194:2565 is what 100% looks like, so anything
                      short of it has to read short. The tier colour still comes
                      through: `batteryFill` picks the same three.

                      With no reading there is no fill and no tier: the glyph
                      and its words go muted. `?? 0` used to stand in, which
                      drew an empty battery and printed "No reading" in RED —
                      a fault colour on a reading that does not exist. */}
                  <MaskIcon
                    src="/icons/set-battery.svg"
                    size={24}
                    {...(chargePct !== undefined
                      ? { background: batteryFill(chargePct) }
                      : {})}
                  />
                  <span
                    className={`flex items-center gap-[2px] font-display text-[0.875rem] leading-[20px] font-bold tracking-[0.14px] tabular-nums ${
                      chargePct !== undefined
                        ? batteryTone(chargePct)
                        : "text-muted"
                    }`}
                  >
                    {/* Three states, the same three the fleet board's Power cell
                        draws: a charge, a pack that could not be reached, or no
                        battery at all. "Unreachable" is muted rather than red —
                        it is a normal condition (one Bluetooth connection, and
                        something else has it), not a fault. */}
                    {chargePct !== undefined
                      ? `${Math.round(chargePct)}%`
                      : reportedBattery
                        ? "Unreachable"
                        : "No reading"}
                    {chargingNow && (
                      <MaskIcon
                        src="/icons/set-bolt.svg"
                        size={16}
                        className="solar-charging"
                      />
                    )}
                  </span>
                </span>
              </span>
            </div>
            {/* The only control here that can silence a whole site, so it says
                which site it is silencing. */}
            <Switch
              on={settings.monitoring}
              label={`Monitoring on ${tower.id}`}
              onToggle={() => onChange({ monitoring: !settings.monitoring })}
            />
          </div>

          {!settings.monitoring && (
            <p className="text-[0.875rem] leading-[20px] text-warn">
              Monitoring is off. Both cameras keep streaming and neither will
              raise an alert.
            </p>
          )}

          {/* One place for a failed write, above the groups. The rows below
              each show their own value, so a per-row error slot would be
              eighteen empty boxes to say what one line says here. */}
          <MutationError
            phase={settingsPhase}
            onRetry={onRetrySettings}
            onDismiss={onDismissSettings}
          />

          {/* ⚠ THE ONE GROUP BEHIND `camera_tuning`. Motion, zones and
              sensitivity are local state with no server behind them; showing
              them to a customer is the fabrication `registry/features.py`
              exists to refuse. Everything else on this panel is real. */}
          {canTune ? (
          <Group title="Detection">
            <Row
              label="Motion"
              value={detect?.label ?? ""}
              expanded={open === "detect"}
              onToggle={() => toggle("detect")}
            >
              <Choices
                name="motion"
                options={DETECT}
                value={settings.detect}
                onPick={(v) => onChange({ detect: v })}
              />
            </Row>

            {/* Drawn on the frame, not described. The one eufy pattern worth
                copying whole: "ignore the road, watch the gate" cannot be said
                in a form field. */}
            <RowLink
              label="Activity Zones"
              value={zoneCount === 0 ? "Whole Frame" : `${zoneCount} set`}
              onClick={() => setEditingZones(true)}
            />

            <Row
              label="Sensitivity"
              value={sensitivity?.label ?? ""}
              expanded={open === "sensitivity"}
              onToggle={() => toggle("sensitivity")}
              last
            >
              <Choices
                name="sensitivity"
                options={SENSITIVITY}
                value={settings.sensitivity}
                onPick={(v) => onChange({ sensitivity: v })}
              />
            </Row>
          </Group>
          ) : null}

          <Group title="Camera">
            <Row
              label="Night Vision"
              value={night?.label ?? ""}
              expanded={open === "night"}
              onToggle={() => toggle("night")}
            >
              <Choices
                name="night vision"
                options={NIGHT}
                value={settings.nightVision}
                onPick={(v) => onChange({ nightVision: v })}
              />
            </Row>
            {/* Per camera, not per tower — the two cameras on one site have
                different hardware and different lists. Activity Zones is the
                only other row that has to say which camera it means, and for
                the same reason.

                ⚠ IT NOW SAYS WHAT THE PIPELINE ACTUALLY DOES, which no
                version of this row has said before. A customer reading
                "Stream Quality" reasonably assumes one setting decides what
                leaves their site. Two streams do, and they are chosen by
                different things: the wall gets the sub stream permanently and
                nobody picks that, and opening one camera gets the main stream
                for as long as it is open. Without the sentence the pick below
                reads as a site-wide quality control, which is the one thing it
                is not. */}
            <Row
              label="Stream Quality"
              value={streamSummary}
              expanded={open === "quality"}
              onToggle={() => toggle("quality")}
            >
              <div className="flex flex-col gap-[10px]">
                <p className="px-[10px] text-[0.75rem] leading-[16px] text-muted">
                  Two streams leave this site. The <b>sub stream</b> runs all
                  the time and is what the fleet wall shows. Opening one camera
                  switches that camera to its <b>main stream</b> until it is
                  closed — thirteen times the pixels, so it is on demand rather
                  than always on.
                </p>
                <p className="px-[10px] text-[0.75rem] leading-[16px] text-muted">
                  {canChooseStream
                    ? "Below is which stream each camera is being watched at now. Choosing one reopens that camera at it."
                    : "Each camera is served at the one stream it reports. There is nothing to choose here."}
                </p>
                {feeds.map((f) => (
                  <StreamChoice
                    key={f.id}
                    feed={f}
                    multiple={feeds.length > 1}
                    chosen={cameraProfiles?.[f.id]}
                    onPick={(id) => onChooseProfile?.(f.id, id)}
                  />
                ))}
              </div>
            </Row>
            {/* HOME IS WHERE THE CAMERA POINTS WHEN NOBODY IS DRIVING IT, and
                until now there was no way to say where that is: the daemon
                took it from a file only root could write, and the script it
                pointed at for doing so does not exist. This is that missing
                half, and it is deliberately in settings rather than on the pad
                — the pad's home button RECALLS home many times a shift, and
                setting it is a once-a-deployment act that should not sit one
                mis-tap away from the button that uses it. */}
            <Row
              label="Home Position"
              value={homeSummary}
              expanded={open === "home"}
              onToggle={() => toggle("home")}
            >
              <div className="flex flex-col gap-[10px]">
                {feeds.map((f) => (
                  <SetHomeRow
                    key={f.id}
                    feed={f}
                    multiple={feeds.length > 1}
                    hasSession={Boolean(sessionFor?.(f.id))}
                    phase={homePhase?.(f.id) ?? { kind: "idle" }}
                    onSet={() => onSetHome?.(f.id)}
                    onRetry={() => onRetryHome?.(f.id)}
                    onDismiss={() => onDismissHome?.(f.id)}
                  />
                ))}
              </div>
            </Row>
            {/* ⚠ WAS "Recording Settings · 4K HD", AND IT WAS NOT TRUE.
                These cameras serve 2560x1440 and 704x576. 4K is not a
                resolution any of this hardware produces, the three options
                behind the chevron wrote to local state nothing reads, and an
                operator who picked 720p to stretch a filling disk changed
                nothing at all.

                A READING NOW, with no chevron: the device says which stream it
                records and the camera says that stream's resolution. "Not
                reported" where either is missing, which is every device on a
                release older than `health.recording`. */}
            <RowReading
              label="Recording resolution"
              value={recordingResolution}
              detail={
                recordingResolution
                  ? `The ${tower.health?.recording?.stream} stream, as this camera reports it.`
                  : undefined
              }
              last
            />
          </Group>

          {/* ── SHARING, UNDER CAMERA, ON A SERVER THAT HAS SITES ──────────

              The second way into the same flow: a camera's own settings. The
              other is the Share control on the tile, and both mount
              `QuickShare`, so neither can offer something the other does not.

              Absent entirely on a hub. There is nobody to share with there,
              and a row that opens an empty site picker is a worse answer than
              no row. */}
          {canShare ? (
            <Group title="Sharing">
              {feeds.map((f, i) => (
                <Row
                  key={f.id}
                  /* ⚠ THE CAMERA'S OWN LABEL, ALWAYS. A site with one camera
                     used to get "Share this camera", which is fine until the
                     share arrives at the other end carrying a name the sender
                     never saw. `f.name` is the customer's own name for it,
                     falling back to "CAMERA 1" -- the same string the tile,
                     the wall and `QuickShare`'s own heading use, so all four
                     agree about what is being lent. */
                  label={`Share ${f.name}`}
                  value=""
                  expanded={open === `share:${f.id}`}
                  onToggle={() => toggle(`share:${f.id}`)}
                  last={i === feeds.length - 1}
                >
                  <QuickShare
                    deviceId={f.towerId}
                    camera={f.index}
                    cameraLabel={f.name}
                    onDone={() => toggle(`share:${f.id}`)}
                  />
                </Row>
              ))}
            </Group>
          ) : null}

          <Group title="Audio">
            <RowSwitch
              label="Microphone"
              on={settings.micOn}
              onToggle={() => onChange({ micOn: !settings.micOn })}
            />
            <RowSlider
              label="Speaker Volume"
              value={settings.speakerVolume}
              onChange={(v) => onChange({ speakerVolume: v })}
              last
            />
          </Group>

          {/* ── NETWORK, FROM REAL MEASUREMENTS ──────────────────────────

              Two different boxes, two different sets of rows, because they
              have two different networks. A TOWER has a radio link to its hub
              and reaches the cloud only through that hub. A HUB has an uplink
              to the cloud of its own and sector radios that masts associate
              with. Printing one box's rows for the other is how "Backup
              Connection · Satellite" came to sit on every tower in the fleet.

              ⚠ "Backup Connection" IS GONE. It was `demoCabinet.ts`'s
              fixture, it read "Satellite" on every tower in every fleet, and
              nothing anywhere measured it. What a customer wants in that space
              is whether their site can be seen from outside, which is the
              Kallon Cloud row below and is real. */}
          <Group title="Network">
            {isHub ? (
              <>
                {/* THE HUB'S OWN WAY OUT. Interface, state and the round trip
                    the heartbeat actually costs — all three from the uplink
                    agent that holds the socket, never sniffed. */}
                <RowReading
                  label="Internet"
                  value={internetRow.value}
                  tone={internetRow.tone}
                  detail={internetRow.detail}
                />
                {/* PER SECTOR: who is on it, and how well this radio hears
                    them. `associations` decides whether the list means
                    anything at all — see `SectorRows`. */}
                <SectorRows sectors={tower.health?.sectors} />
                {/* THE CLOUD LINK'S, not a mast's. A hub has no radio link to
                    a hub of its own, so the useful "since" here is the one for
                    the uplink the row above describes. */}
                <ConnectedSince
                  at={cloudSince}
                  what="There is no link to Kallon Cloud at the moment."
                />
              </>
            ) : (
              <>
                {/* ⚠ THIS USED TO BE "Uplink", GRADED FROM `iw`. On a sinew
                    mast the radio is a Ubiquiti box on the far end of an
                    Ethernet cable, so `iw` answered "operation not supported",
                    the tower reported `type: ethernet`, and the row said
                    "Wired" about a radio link. The number now comes from the
                    radio itself over read-only SNMP, and the word beside it is
                    this app's own arithmetic on that number. */}
                <RadioLinkRow radio={tower.health?.radio} />
                {/* ⚠ KEPT, AND ONLY FOR THE ONE CASE WHERE IT IS REAL. The
                    tower's own `iw` reading is a genuine measurement on a mast
                    whose uplink IS a Wi-Fi or LTE interface — and nothing
                    else measures that. On a sinew mast the same probe answers
                    "operation not supported", which the old row rendered as
                    "Wired" beside a radio link it had not measured. So the row
                    appears only for `kind: "signal"`: a number the tower
                    actually read. Every other shape is silence rather than a
                    row saying nothing. */}
                {ownUplink.kind === "signal" ? (
                  <UplinkRow reading={ownUplink} />
                ) : null}
                {/* WAS "IP Address", and that was a demo literal —
                    192.168.1.230 on every tower in the fleet. How long the
                    link has held is the more useful reading anyway: it is the
                    difference between a healthy site and one that is
                    flapping. */}
                <ConnectedSince
                  at={tower.connectedAt}
                  what="This mast's link to its hub. A short one is itself the reading: it says the site is flapping."
                />
              </>
            )}
            {/* THE SAME ROW ON BOTH, AND IT IS ABOUT THE SERVER. Every tower
                on one hub is reaching the cloud, or not, together — which is
                why `cloud` is one fact held by the shell rather than a field
                on each tower.

                ⚠ "KALLON CLOUD", NEVER "DC". The data centre is our word for
                our own machine. */}
            <CloudRow cloud={cloud} last />
          </Group>

          {/* ── STORAGE, WHERE THE FOOTAGE ACTUALLY IS ───────────────────

              ⚠ ALL THREE ROWS WERE WRONG IN DIFFERENT WAYS. "Memory" showed a
              figure for a tower that records nothing locally; "Recording" and
              "Keep Footage for" were drop-downs over `CameraSettings`, which
              is local state nothing reads — a customer picked "90 days", the
              chevron closed, and the hub carried on deleting at whatever it
              was actually set to. The second is the worse failure: a silent
              promise about evidence.

              So: the disk row says which disk it means, and the two settings
              are readings with "Set by Kallon" under them. */}
          <Group title="Storage">
            {recordsAtHub && !isHub ? (
              /* ⚠ A TOWER WITH NO SSD HAS NO STORAGE ROW TO FILL, and the
                 figure it used to print was its own root filesystem — a few
                 gigabytes of operating system, labelled as the site's
                 footage. The honest row names the box the footage is on. */
              <RowReading
                label="Memory"
                value="Recorded at the hub"
                detail="This mast streams to the hub, which writes and keeps the footage. It has no recording disk of its own."
              />
            ) : (
              <RowReading
                label="Memory"
                /* SUPERSEDED 2026-09-12. This said "the projection carries no
                   storage figures at all", and refused to substitute
                   `disk.free_pct` because it was "a percentage of an unknown
                   total". The projection carries them now — on a hub from the
                   archiver's own status file — so the row shows the real
                   reading instead of "Not reported".

                   THE REFUSAL ITSELF STANDS and is why the order below is what
                   it is: gigabytes are preferred because that is what this row
                   promises, and the percentage is shown AS a percentage rather
                   than dressed up as a size. */
                value={
                  tower.storageUsedGb !== undefined &&
                  tower.storageTotalGb !== undefined
                    ? `${tower.storageUsedGb} of ${tower.storageTotalGb} GB used`
                    : storageFreePct !== undefined
                      ? `${Math.round(storageFreePct)}% free`
                      : ""
                }
                /* One tier, shared with the fleet board's Storage cell — see
                   lib/storage.ts. Amber below 20% free, red below 10%, where
                   the device has started overwriting footage. */
                tone={
                  storageFreePct !== undefined
                    ? storageTone(storageFreePct)
                    : undefined
                }
                detail={isHub ? "The hub's archive disk." : undefined}
              />
            )}
            {/* ⚠ READ-ONLY, AND SAYING WHO HOLDS IT. Continuous or on
                detection is a decision with a cost in disk and uplink that
                the customer does not pay for directly and cannot see the
                consequences of from here, so for now it is ours. The row
                reports what the device actually does. */}
            <RowReading
              label="Recording mode"
              value={recordingModeRow}
              note="Set by Kallon"
            />
            {/* ⚠ TWO NUMBERS, BECAUSE ONE OF THEM IS A PROMISE AND THE OTHER
                IS WHAT HAPPENS. The sweep keeps footage for the window we ask
                for UNLESS the disk fills first, and then it quietly keeps
                less. A row printing the asked-for window alone would tell a
                customer they have thirty days of evidence while the sweep
                deletes at twelve. `boundBy` says which limit is deciding. */}
            <RowReading
              label="Keep footage for"
              value={retentionRow.value}
              tone={retentionRow.tone}
              note="Set by Kallon"
              detail={retentionRow.detail}
              last
            />
          </Group>

          <Group title="Power">
            {/* The pack's own readings, above the control that spends them.
                Same order as the Storage group: what is true, then what to do
                about it. Each is empty — "Not reported" — when the tower did not
                send it, and ALL of them are empty when the pack could not be
                reached, because an unreachable battery has no readings rather
                than old ones. */}
            {/* ⚠ "Not connected" AND "Unreachable" ARE DIFFERENT FACTS, and
                the row used to print the second for both. A site with no
                battery configured was reported as a battery we could not
                read, which reads as a fault on hardware that is not there --
                and sends somebody to a cabinet to look at a pack nobody
                fitted.

                  no battery block   nothing is configured: "Not connected"
                  reachable: false   a pack IS fitted and would not answer.
                                     Routine -- it allows one Bluetooth
                                     connection, so somebody standing at the
                                     cabinet with the vendor's app is enough --
                                     and still worth saying. */}
            <RowReading
              label="Battery"
              value={
                chargePct !== undefined
                  ? `${Math.round(chargePct)}%`
                  : reportedBattery
                    ? "Unreachable"
                    : "Not connected"
              }
              tone={chargePct !== undefined ? batteryTone(chargePct) : undefined}
              detail={
                chargePct === undefined
                  ? reportedBattery
                    ? "A pack is fitted and did not answer. It allows one Bluetooth connection at a time."
                    : "No battery is configured on this device."
                  : undefined
              }
            />
            <RowReading
              label="Pack Voltage"
              value={
                reportedBattery?.reachable &&
                reportedBattery.voltageV !== undefined
                  ? `${reportedBattery.voltageV} V`
                  : ""
              }
            />
            <RowReading
              label="Pack Temperature"
              /* The PACK's temperature. `health.thermal.socC` is the processor's
                 and is a different reading — the Device group's business, not
                 this one's. */
              value={
                reportedBattery?.reachable && reportedBattery.tempC !== undefined
                  ? `${reportedBattery.tempC}°C`
                  : ""
              }
            />
            {/* ⚠ READ-ONLY, BECAUSE NOTHING IS BEHIND IT. Performance /
                Balanced / Battery saver wrote to `CameraSettings.powerMode`,
                which is local state no server reads and no tower receives:
                an operator managing a dark week chose "Battery saver",
                watched the chevron close, and changed nothing at all. There
                is no power-mode command in the protocol and no daemon to take
                one.

                It stays as a row rather than disappearing because the mode IS
                a real thing about the mast -- it is just not ours to set from
                here yet. "Not reported" is the truthful value until a device
                reports one. */}
            <RowReading
              label="Working mode"
              value=""
              note="Set by Kallon"
              detail="The mast's power profile is set when it is installed. No device reports it yet."
              last
            />
          </Group>

          {/* ── WHAT THIS BOX IS ──────────────────────────────────────────
              Four of these five lines were WRONG until the hello carried them.
              Model and Serial Number came from the fixture in `lib/data.ts`,
              so every tower on every fleet was a "Terra Sentry XL"; Firmware
              read `v1.5.0-23-g8e6f18b (dev)` on a tower running something
              else. Each row now shows what the tower reported, and "Not
              reported" when it reported nothing -- which is true, and is the
              one thing a fixture can never be. */}
          <Group title="About Device">
            <RowReading label="Model Name" value={tower.model ?? ""} />
            {/* THE UNIT's serial, from its label. It survives a re-flash and a
                move: neither changes which unit this is. */}
            <RowReading label="Serial Number" value={tower.serial ?? ""} />
            {/* THE BOARD's own, read off the Jetson at every start. Beside the
                unit serial rather than merged with it, because a swapped board
                changes this line and leaves the one above alone -- which is
                how a repair becomes visible instead of remembered. */}
            <RowReading label="Board Serial" value={tower.boardSerial ?? ""} />
            <RowReading label="Cameras" value={`${feeds.length}`} />
            {/* A HUB'S RADIO SECTORS, where it has any. A count here and the
                per-sector detail in the Network group above: this row answers
                "what is this box", that one answers "is it working". Absent on
                a tower, which has no sectors -- it is ON one. */}
            {isHub ? (
              <RowReading
                label="Radio sectors"
                value={
                  (tower.health?.sectors?.length ?? 0) > 0
                    ? `${tower.health?.sectors?.length}`
                    : "One radio, no sectors"
                }
                detail={
                  (tower.health?.sectors?.length ?? 0) > 0
                    ? tower.health?.sectors
                        ?.map((sector) =>
                          sector.azimuth !== undefined
                            ? `${sector.id} at ${sector.azimuth}°`
                            : sector.id,
                        )
                        .join(" · ")
                    : undefined
                }
              />
            ) : null}
            {/* The release this tower is RUNNING, as `v1.5.0-23`: the version
                and the build number, no commit hash and no "(dev)" on a
                customer's screen. The whole string is the row's detail, for
                the support call. Colour-coded by channel: green (stable),
                amber (beta), grey (ahead of a release, or unknown). No "Update
                Firmware" action -- firmware moves via OTA/releases, not from
                this panel, and a control that cannot act does not belong
                here. */}
            <RowReading
              label="Firmware"
              value={firmware.label}
              tone={firmware.tone}
              detail={firmware.detail}
              last
            />
          </Group>
        </div>
      </div>
    </motion.aside>
  );
}

/**
 * The tower's name, editable where it is displayed.
 *
 * A button until it is clicked, then the same text in an input at the same
 * size and position — nothing moves, which is the point of editing in place.
 * Enter and blur commit, Escape abandons.
 *
 * It is the tower's *name*, not its id. The id is a key — feeds, alerts and the
 * settings map all hang off it — and renaming a key to fix a typo is how a site
 * loses its cameras. The name is what the fleet card, the band header and the
 * breadcrumb already show, so editing it here changes all four.
 *
 * ⚠ WHAT WAS TYPED IS WHAT IS SENT. This used to `.trim().toUpperCase()` before
 * committing and drop an empty result on the floor. Both had to go once the
 * write became real: `set_label` on the server is the only validator, it
 * refuses an empty, over-long or control-character label and its `422` says
 * which — so trimming here would silently repair some labels and the emptiness
 * check would swallow the one error the operator most needs to see. The field
 * still *displays* uppercase; that is CSS, and it does not touch the value.
 *
 * The name shown is always the prop, never the draft, so a failed rename leaves
 * the old name standing — a field that keeps showing what you typed after the
 * server refused it is the revert bug in a smaller box.
 */
function TowerName({
  name,
  phase = { kind: "idle" },
  onRename,
}: {
  name: string;
  /** From the shell, keyed by tower id. Never state in here. */
  phase?: MutationPhase;
  onRename: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);

  const saving = phase.kind === "pending";

  const commit = () => {
    setEditing(false);
    /* Identical is the only thing worth not sending: it is not a change, and a
       round trip to be told so would be a spinner for nothing. Everything else
       — including the empty string — is the server's to judge. */
    if (draft !== name) onRename(draft);
  };

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        disabled={saving}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
        aria-label="Tower name"
        /* The failed field wears the ring, as the serial and pairing-code step
           already does — the error text below says why, and this says which. */
        className={`w-full min-w-0 rounded-[4px] bg-card px-[6px] py-0 text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-body-ink uppercase outline-none focus-visible:outline-1 focus-visible:outline-terra ${errorRing(phase)}`}
      />
    );
  }

  return (
    <span className="flex min-w-0 items-center gap-[6px]">
      <button
        type="button"
        onClick={() => {
          setDraft(name);
          setEditing(true);
        }}
        disabled={saving}
        title={saving ? "Saving this name…" : "Rename this tower"}
        /* A text cursor, because what happens on click is that you start typing.
           The default arrow says "this does something"; the caret says what. */
        className="-mx-[6px] cursor-text truncate rounded-[4px] px-[6px] text-left text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-body-ink transition-colors hover:bg-card disabled:cursor-wait disabled:text-muted"
      >
        {name}
      </button>
      {/* The one place this panel shows a spinner. Everywhere else a change
          confirms itself by displaying its own new value — but a rename now
          waits for the registry, so for that moment the field shows the OLD
          name and nothing at all would be happening as far as the operator can
          tell. This says the difference between "not saved yet" and "not
          saved". */}
      {saving && <MutationSpinner size={14} />}
    </span>
  );
}

/* ---------------------------------------------------------------- pieces */

/**
 * A group: a 16px sentence-case title, then one 8px card holding its rows.
 *
 * The frame separates rows with a `#252528` hairline drawn on every row but
 * the last, which is why `last` is passed down rather than derived — a group
 * whose final row carries a border reads as an unfinished list.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-[8px]">
      {/* 14px, not the frame's 16. At 16 the group titles sat level with the
          tower name above them and read as headings of equal weight; the name
          is the only thing on this panel that should carry that size. */}
      <h3 className="text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted">
        {title}
      </h3>
      <div className="flex flex-col overflow-hidden rounded-[8px] bg-panel">
        {children}
      </div>
    </section>
  );
}

/** 53px, label muted at 16, value white and medium at the right with a 20px
 *  chevron. The frame's row, and every row below is a variation of it. */
const ROW = "flex h-[53px] w-full items-center justify-between gap-[12px] px-[16px] text-left";
/* The same row with room for a second line under the label. `min-h` rather
   than a taller fixed height, so a long note wraps instead of overflowing the
   card it sits in. */
const ROW_TALL = "flex min-h-[53px] w-full items-center justify-between gap-[12px] px-[16px] py-[8px] text-left";
const ROW_LINE = "border-b border-row-line";
const LABEL = "text-[0.875rem] leading-[18px] tracking-[0.14px] text-muted";
/* The value's type, WITHOUT a colour. A reading that carries a tone must carry
   only that one: two colour utilities on one element is one `color`
   declaration, and the stylesheet — not the class list — decides which wins.
   `text-body-ink` is emitted after every status colour, so for as long as the two
   were written side by side every tone on this panel rendered white: the
   uplink's Great/Fair/Poor, "Not connected", the storage warning. */
const VALUE_TYPE = "text-[0.875rem] leading-[18px] font-medium tracking-[0.14px]";
const VALUE = `${VALUE_TYPE} text-body-ink`;

/* The export points left. Figma composes it with a vertical flip and a half
   turn, which together are a horizontal flip — so the raw asset is the mirror
   of what the frame shows. Flipped here rather than re-exported, because the
   file is correct and only its placement was doing the work. */
function Chevron() {
  return (
    <MaskIcon
      src="/icons/row-chevron.svg"
      size={20}
      className="shrink-0 -scale-x-100 text-muted"
    />
  );
}

/** A row that opens its options underneath rather than pushing a screen. */
function Row({
  label,
  value,
  expanded,
  last = false,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  expanded: boolean;
  last?: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className={last && !expanded ? "" : ROW_LINE}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className={`${ROW} transition-colors hover:bg-card-hover`}
      >
        <span className={LABEL}>{label}</span>
        <span className="flex min-w-0 items-center gap-[4px]">
          <span className={`truncate ${VALUE}`}>{value}</span>
          {/* Down when the row is open, which is where its options are. */}
          <span
            className={`flex transition-transform ${expanded ? "rotate-90" : ""}`}
          >
            <Chevron />
          </span>
        </span>
      </button>
      {expanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="flex flex-col gap-[2px] border-t border-row-line px-[8px] py-[8px]"
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}

/** A row that goes somewhere instead of opening. */
/**
 * One camera's "set current position as home".
 *
 * ⚠ IT SAYS WHAT IT WILL SAVE, BEFORE IT SAVES IT. The camera is somewhere the
 * operator has just pointed it, and the whole action is "remember THIS" — so
 * the button names the act rather than the setting, and the note underneath
 * says the part that is not obvious and would otherwise be a surprise: the
 * zoom is not kept.
 *
 * ⚠ IT REFUSES OUT LOUD RATHER THAN GOING GREY. A fixed camera has no position
 * to save and a camera with no live session has nowhere to send the command,
 * and both are disabled — but each says which, because "why can I not press
 * this" is a question an operator should never have to carry to a supervisor.
 * The zoom buttons already work this way.
 *
 * The confirmation is a check that RETRACTS, and it is not decoration here: a
 * saved home changes nothing on screen, so without it the only evidence the
 * write landed would be pressing the pad's home button and watching.
 */
function SetHomeRow({
  feed,
  multiple,
  hasSession,
  phase,
  onSet,
  onRetry,
  onDismiss,
}: {
  feed: CameraFeed;
  multiple: boolean;
  hasSession: boolean;
  phase: MutationPhase;
  onSet: () => void;
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const fixed = !feed.ptz;
  const blocked = fixed || !hasSession;
  const pending = phase.kind === "pending";

  const why = fixed
    ? "This camera is fixed — it has no position to save."
    : !hasSession
      ? "Open the live view on this camera first — home is saved through the same authorized session a move uses."
      : null;

  return (
    <div className="flex flex-col gap-[6px]">
      {multiple && (
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">
          {feed.name ?? feed.id}
        </span>
      )}
      <button
        type="button"
        disabled={blocked || pending}
        aria-busy={pending || undefined}
        onClick={onSet}
        className={`flex items-center justify-between gap-[8px] rounded-[8px] px-[10px] py-[8px] text-left transition-colors ${
          blocked
            ? "cursor-not-allowed bg-card/40 text-muted"
            : "bg-card hover:bg-card-hover"
        } ${errorRing(phase)}`}
      >
        <span className="text-[13px]">Set current position as home</span>
        <MutationIcon phase={phase} idle={<Chevron />} />
      </button>
      {/* The zoom rule, said once, where the decision is made. An operator who
          framed a shot at 12x and pressed this would otherwise reasonably
          expect to come back at 12x. */}
      <span className="text-[11px] leading-[15px] text-muted">
        {why ?? "Saves where this camera is pointing now. Home always returns at the widest zoom, not the current one."}
      </span>
      <MutationStatus phase={phase} label="Saving home position" />
      <MutationError phase={phase} onRetry={onRetry} onDismiss={onDismiss} />
    </div>
  );
}

function RowLink({
  label,
  value,
  last = false,
  onClick,
}: {
  label: string;
  value: string;
  last?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ROW} ${last ? "" : ROW_LINE} transition-colors hover:bg-card-hover`}
    >
      <span className={LABEL}>{label}</span>
      <span className="flex min-w-0 items-center gap-[4px]">
        <span className={`truncate ${VALUE}`}>{value}</span>
        <Chevron />
      </span>
    </button>
  );
}

/**
 * A value the tower reports. No chevron and no hover, which is the whole
 * signal — the frame draws the uplink, the model name and the camera count
 * without one, and that is how it says they do not open.
 *
 * Never renders blank: an absent reading says why, the way the alert fields do.
 */
function RowReading({
  label,
  value,
  tone,
  icon,
  action,
  detail,
  note,
  last = false,
}: {
  label: string;
  value: string;
  tone?: string;
  /** A glyph after the value, as the uplink row carries. */
  icon?: string;
  /** An action beside the value, as the firmware row carries. */
  action?: string;
  /**
   * The whole fact, when the row shows a shortened one.
   *
   * The firmware row prints `v1.5.0-23` and keeps the commit here: the hash is
   * what an engineer needs and what a customer should never be handed. It is a
   * `title`, so it is on hover and read out by a screen reader, and the row
   * stays one line either way.
   */
  detail?: string;
  /**
   * A small line under the LABEL, shown on screen rather than on hover.
   *
   * ⚠ IT EXISTS FOR "Set by Kallon", AND THAT IS NOT DECORATION. Recording
   * mode and the retention window used to be drop-downs; they are readings
   * now, and a reading where a control used to be reads as a thing that has
   * stopped working unless the row says who holds it. A `title` would not do:
   * nobody hovers a row to find out why they cannot change it.
   */
  note?: string;
  last?: boolean;
}) {
  return (
    <div
      className={`${note ? ROW_TALL : ROW} ${last ? "" : ROW_LINE}`}
    >
      <span className="flex min-w-0 flex-col">
        <span className={LABEL}>{label}</span>
        {note && (
          <span className="text-[0.75rem] leading-[14px] tracking-[0.12px] text-dim">
            {note}
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-[6px]">
        {/* One colour class, never two — see VALUE_TYPE. */}
        <span
          title={detail || undefined}
          className={`truncate ${VALUE_TYPE} ${tone ?? "text-body-ink"} tabular-nums`}
        >
          {value || "Not reported"}
        </span>
        {icon && <img src={icon} alt="" width={16} height={16} className="block shrink-0" />}
        {action && (
          /* Disabled, and the green goes with it. A firmware push is the one
             control on this panel that reaches the hardware, and there is no
             route to reach it with — the agent reports `agent_version` and
             accepts nothing back. Live green on a control that cannot act is
             the colour rule inverted: it would read as a healthy signal. */
          <button
            type="button"
            disabled
            title={`${action} — not available yet`}
            className="shrink-0 text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-terra transition-colors hover:text-body-ink disabled:text-body-ink/30 disabled:hover:text-body-ink/30"
          >
            {action}
          </button>
        )}
      </span>
    </div>
  );
}

/**
 * The uplink, graded only when there is a number behind the grade.
 *
 * Colour is the app's reserved set and it is spent here deliberately: this is a
 * READING of a site, which is what green/amber/red are for. The three
 * non-signal states get no colour at all — they are not degradations, and
 * painting "Wired" amber would report a fault on hardware that is working.
 *
 * The dBm rides beside the grade for the same reason a stream profile shows its
 * resolution: a label with the measurement behind it can be checked, and one
 * without it has to be believed.
 */
function UplinkRow({ reading }: { reading: UplinkReading }) {
  if (reading.kind === "signal") {
    const word =
      reading.grade === "great" ? "Great" : reading.grade === "fair" ? "Fair" : "Poor";
    return (
      <RowReading
        label="Uplink"
        value={`${word} · ${reading.dbm} dBm`}
        tone={
          reading.grade === "poor"
            ? "text-critical"
            : reading.grade === "fair"
              ? "text-warn"
              : "text-terra"
        }
        /* The exported set is two-tier — there is no `wifi-bad.svg` — so a poor
           uplink took the amber glyph and the row said red in words beside
           amber in the picture. Better no glyph than one reporting a tier above
           the truth. Give it the third export and it belongs back here. */
        icon={
          reading.grade === "great"
            ? "/icons/wifi-good.svg"
            : reading.grade === "fair"
              ? "/icons/wifi-warn.svg"
              : undefined
        }
      />
    );
  }

  /* Everything below is an honest absence of a signal, not a bad one. */
  if (reading.kind === "wired") {
    return <RowReading label="Uplink" value="Wired" />;
  }
  if (reading.kind === "unassociated") {
    return <RowReading label="Uplink" value="Radio not connected" tone="text-warn" />;
  }
  return <RowReading label="Uplink" value="No signal reading" />;
}

/** The two health blocks the Network group draws, named once. */
type RadioBlock = NonNullable<NonNullable<Tower["health"]>["radio"]>;
type SectorBlock = NonNullable<NonNullable<Tower["health"]>["sectors"]>;

/**
 * The radio link to this mast's hub: the number, and the word for it.
 *
 * ⚠ WHAT THIS REPLACED, AND WHY THE OLD ROW COULD NOT BE FIXED. The Network
 * group used to show "Uplink", graded from `health.uplink.signalDbm` — which
 * the tower measures by running `iw dev <iface> link`. On a sinew mast the
 * radio is a Ubiquiti box on the far end of an Ethernet cable: `iw` answers
 * "operation not supported", the tower honestly reports `type: ethernet`, and
 * the row said **"Wired"** about a radio link. No threshold could fix that;
 * the measurement was of the wrong thing.
 *
 * The number here comes from the radio itself, over read-only SNMP, and
 * `signalFrom` says which end read it — the mast's own radio hearing the hub,
 * or the hub's sector radio hearing the mast. They differ by a few dB, and a
 * reader comparing two sites deserves to know which one they have.
 *
 * ⚠ EVERY ABSENCE IS A DIFFERENT SENTENCE, and none of them is a grade:
 *
 *   no radio block        this mast has no radio link — wired, or WireGuard
 *   associated: false     a radio joined to nothing, which is a fault
 *   no signalDbm          nothing measured it: no SNMP community on the site,
 *                         or a radio that would not answer. "not measured",
 *                         never 0 dBm, which would grade as the best link in
 *                         the fleet.
 */
function RadioLinkRow({ radio }: { radio?: RadioBlock }) {
  if (!radio) {
    /* No radio link to describe. A mast on WireGuard over somebody's fibre is
       a real deployment, and this row is not about it. */
    return <RowReading label="Radio link" value="No radio link" />;
  }
  if (!radio.associated) {
    return (
      <RowReading label="Radio link" value="Not connected" tone="text-critical" />
    );
  }
  const note = radioStateNote(radio.state);
  if (radio.signalDbm === undefined) {
    /* ASSOCIATED, AND UNMEASURED. Both halves are true and the row says both,
       because "Connected" alone invites a reader to assume it is also good. */
    return (
      <RowReading
        label="Radio link"
        value={note ? `Connected · ${note}` : "Connected · not measured"}
        tone={note ? "text-warn" : undefined}
        detail="The signal is read from the radio over SNMP. Nothing has reported one for this mast — see docs/release-tower.md."
      />
    );
  }
  const grade = radioGrade(radio.signalDbm);
  const parts = [grade.word, `${radio.signalDbm} dBm`];
  if (note) parts.push(note);
  return (
    <RowReading
      label="Radio link"
      value={parts.join(" · ")}
      tone={note === "link down" ? "text-critical" : grade.tone}
      detail={
        radio.signalFrom === "tower"
          ? "Measured by this mast's own radio, hearing the hub."
          : radio.signalFrom === "hub"
            ? "Measured by the hub's sector radio, hearing this mast."
            : undefined
      }
    />
  );
}

/**
 * A hub's sector radios: who is on each one, and how well it hears them.
 *
 * ⚠ READ `associations` FIRST, NEVER `towers ?? []`. A sector whose radio
 * would not answer, or one on a hub with no station reader configured, carries
 * NO tower list — and `[]` printed for that case says "this sector has lost
 * every mast it had", which is the one wrong answer available here and the one
 * that sends somebody up a tower in the dark.
 *
 * One row per sector rather than one saying "3 sectors": the question this
 * answers is "which sector is the problem", and a count cannot answer it.
 */
function SectorRows({ sectors }: { sectors?: SectorBlock }) {
  if (!sectors || sectors.length === 0) {
    /* A single-radio hub, which is every hub built before sectors existed. It
       has a radio; it does not have sectors. */
    return <RowReading label="Radio" value="One radio, no sectors" />;
  }
  return (
    <>
      {sectors.map((sector) => {
        if (sector.state === "down") {
          return (
            <RowReading
              key={sector.id}
              label={`Radio ${sector.id}`}
              value="Radio not answering"
              tone="text-critical"
            />
          );
        }
        if (sector.associations !== "observed") {
          /* The radio may be perfectly fine. What is missing is anybody having
             asked it who is associated, so the row says that and does not
             imply an empty sector. */
          return (
            <RowReading
              key={sector.id}
              label={`Radio ${sector.id}`}
              value={sector.state === "up" ? "Up · masts not read" : "Not known"}
              detail="Nothing on this hub reads the radios' station lists. See docs/hub-deploy.md."
            />
          );
        }
        const towers = sector.towers ?? [];
        if (towers.length === 0) {
          return (
            <RowReading
              key={sector.id}
              label={`Radio ${sector.id}`}
              value="No masts on it"
            />
          );
        }
        /* THE SIGNALS, WHERE THEY WERE MEASURED. A mast in `towers` with no
           entry in `towerSignals` is associated and unmeasured — the older
           password station reader scrapes MACs off an HTTP page and has no
           signal to give — so it is listed without a number rather than left
           out or handed one. */
        const byId = new Map(
          (sector.towerSignals ?? []).map((t) => [t.deviceId, t.signalDbm]),
        );
        const measured = towers
          .map((id) => byId.get(id))
          .filter((d): d is number => d !== undefined);
        /* The WEAKEST of them decides the row's colour: a sector is as good as
           its worst mast, and an average would paint one failing dish green. */
        const worst = measured.length > 0 ? Math.min(...measured) : undefined;
        return (
          <RowReading
            key={sector.id}
            label={`Radio ${sector.id}`}
            value={`${towers.length} mast${towers.length === 1 ? "" : "s"}${
              worst !== undefined
                ? ` · ${radioGrade(worst).word} · ${worst} dBm`
                : ""
            }`}
            tone={worst !== undefined ? radioGrade(worst).tone : undefined}
            detail={
              measured.length === 0
                ? "No signal was measured for these masts — this hub's station reader is on the older password path. See docs/hub-deploy.md."
                : towers
                    .map((id) => {
                      const dbm = byId.get(id);
                      return `${id}: ${dbm === undefined ? "not measured" : `${dbm} dBm`}`;
                    })
                    .join(" · ")
            }
          />
        );
      })}
    </>
  );
}

/**
 * Whether this site can be seen from outside, and from how far away.
 *
 * ⚠ "KALLON CLOUD", NEVER "DC". The data centre is our word for our own
 * machine. A customer reading this row is being told whether their site is
 * reachable by the service they bought, and that service has a name.
 *
 * ⚠ ABSENT IS NOT "DISCONNECTED". A hub whose uplink agent has never run has
 * told us nothing; a hub whose agent says `connected: false` has told us the
 * link is down. The first is a gap in our own reporting, and printing it as a
 * fault at the customer's site is the mirror image of fake green.
 */
function CloudRow({ cloud, last = false }: { cloud?: CloudReading; last?: boolean }) {
  if (!cloud) {
    return (
      <RowReading
        label="Kallon Cloud"
        value="Not reported"
        detail="This site has not reported its link to Kallon Cloud."
        last={last}
      />
    );
  }
  if (cloud.isCloud) {
    return (
      <RowReading
        label="Kallon Cloud"
        value="Connected"
        detail="You are reading this through Kallon Cloud, so the connection is in use right now."
        last={last}
      />
    );
  }
  if (cloud.connected !== true) {
    return (
      <RowReading
        label="Kallon Cloud"
        value="Not connected"
        tone="text-critical"
        detail="The site keeps recording and stays viewable on its own network. It cannot be reached from outside until the link returns."
        last={last}
      />
    );
  }
  return (
    <RowReading
      label="Kallon Cloud"
      value={
        cloud.latencyMs !== undefined
          ? `Connected · ${cloud.latencyMs} ms`
          : "Connected"
      }
      detail={cloud.iface ? `Over ${cloud.iface}.` : undefined}
      last={last}
    />
  );
}

/**
 * When the current link came up, and how long it has held.
 *
 * ⚠ WALL CLOCK FIRST, DURATION SECOND — and that ordering is the app's time
 * rule rather than a layout preference. `formatRelative` ("3 days ago") is
 * reserved for two transient banners whose whole job is *this just happened*,
 * and neither of those re-ticks. Operators hand incidents over by radio across
 * shifts; a row that only said "3 days ago" would give the next shift nothing
 * to quote. So the value is the instant, in site time, and the uptime rides
 * beside it.
 *
 * Its own component so the tick stays here. `useNow` is deliberately not called
 * in `TowerView` — a re-render pushed through the tile tree twice a minute is
 * how this app makes a takeover snap instead of animate, which is written up at
 * the hook. Only this row re-renders.
 */
function ConnectedSince({ at, what }: { at?: number; what?: string }) {
  /* 30s, the hook's default. The finest thing this can show is a minute, so a
     faster tick would be renders nobody can read. */
  const now = useNow();

  if (at === undefined) {
    /* Absence is the reading, and it says WHICH absence. `RowReading`'s generic
       fallback is "Not reported", which here would be the wrong claim: the
       tower did not fail to report a connection time, it has no connection.
       Showing the last known uptime would be worse still — a link that is down,
       reported as having held for days.

       `what` names WHICH link, because this row serves two now: a tower's link
       to its hub and a hub's link to Kallon Cloud. The same three words over
       two different facts is how a reader ends up thinking the hub lost its
       masts when it lost its internet. */
    return (
      <RowReading
        label="Connected since"
        value="Not connected"
        tone="text-critical"
        detail={what}
      />
    );
  }

  return (
    <RowReading
      label="Connected since"
      value={`${formatEventTime(at, now)} · up ${formatUptime(now - at)}`}
      detail={what}
    />
  );
}

function RowSwitch({
  label,
  on,
  last = false,
  onToggle,
}: {
  label: string;
  on: boolean;
  last?: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`${ROW} ${last ? "" : ROW_LINE}`}>
      <span className={LABEL}>{label}</span>
      <Switch on={on} label={label} onToggle={onToggle} />
    </div>
  );
}

/** The one row that cannot be 53px: a slider needs its own line under the
 *  label, so it keeps the row's padding and gives up its height. */
function RowSlider({
  label,
  value,
  last = false,
  onChange,
}: {
  label: string;
  value: number;
  last?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div
      className={`flex flex-col gap-[10px] px-[16px] py-[14px] ${last ? "" : ROW_LINE}`}
    >
      <div className="flex items-center justify-between">
        <span className={LABEL}>{label}</span>
        <span className={`${VALUE} tabular-nums`}>{value}%</span>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={label}
        className="w-full accent-white"
      />
    </div>
  );
}

/**
 * One camera's profiles.
 *
 * Three states, and only one of them is a choice:
 *
 *  - **no list** — the tower advertised none. Says so, and offers nothing. An
 *    older agent still serves its default stream perfectly well, so this is
 *    not an error and must not read as one.
 *  - **one profile** — shown, and shown as unavailable to change. Drawing a
 *    single radio button would be a choice-shaped thing that cannot be chosen.
 *  - **several** — the real selector.
 *
 * The camera's name appears only when there is more than one camera; on a
 * single-camera tower it would be a heading over the only thing on screen.
 */
function StreamChoice({
  feed,
  multiple,
  chosen,
  onPick,
}: {
  feed: CameraFeed;
  multiple: boolean;
  chosen?: string;
  onPick: (profileId: string) => void;
}) {
  const list = feed.profiles ?? [];
  /* What is PLAYING, which is not always what was picked: a remembered id the
     tower no longer advertises falls through to the default, and this has to
     mark the stream the operator is actually watching. */
  const current =
    list.find((p) => p.id === chosen) ??
    list.find((p) => p.default) ??
    list[0];

  return (
    <div className="flex flex-col gap-[4px]">
      {multiple && (
        <span className="px-[10px] font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.1px] text-dim">
          {feed.name}
        </span>
      )}
      {list.length === 0 ? (
        <p className="px-[10px] py-[6px] text-[0.75rem] leading-[16px] text-muted">
          This camera reports no stream profiles. It is served at its default.
        </p>
      ) : list.length === 1 ? (
        <p className="px-[10px] py-[6px] text-[0.75rem] leading-[16px] text-muted">
          One stream only — {profileLabel(list[0])}.
        </p>
      ) : (
        <div role="radiogroup" aria-label={`${feed.name} stream quality`} className="flex flex-col">
          {list.map((p) => {
            const picked = p.id === current?.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={picked}
                onClick={() => onPick(p.id)}
                className={`flex flex-col gap-[2px] rounded-[6px] px-[10px] py-[8px] text-left transition-colors ${
                  picked ? "bg-panel" : "hover:bg-panel/60"
                }`}
              >
                <span className="flex items-center gap-[8px] text-[0.875rem] text-body-ink">
                  <span
                    aria-hidden
                    className={`size-[8px] shrink-0 rounded-full ${picked ? "bg-action" : "bg-overlay/20"}`}
                  />
                  {profileLabel(p)}
                </span>
                <span className="pl-[16px] text-[0.75rem] leading-[16px] text-muted">
                  {profileNote(p, p.default)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Choices<T extends string | number>({
  name,
  options,
  value,
  onPick,
}: {
  name: string;
  options: { value: T; label: string; note?: string }[];
  value: T;
  onPick: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={name} className="flex flex-col">
      {options.map((o) => {
        const picked = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={picked}
            onClick={() => onPick(o.value)}
            className={`flex flex-col gap-[2px] rounded-[6px] px-[10px] py-[8px] text-left transition-colors ${
              picked ? "bg-panel" : "hover:bg-panel/60"
            }`}
          >
            <span className="flex items-center gap-[8px] text-[0.875rem] text-body-ink">
              <span
                aria-hidden
                className={`size-[8px] shrink-0 rounded-full ${picked ? "bg-action" : "bg-overlay/20"}`}
              />
              {o.label}
            </span>
            {/* Every option says what it costs. A setting whose trade-off is
                invisible gets turned up once and never looked at again. */}
            {o.note && (
              <span className="pl-[16px] text-[0.75rem] leading-[16px] text-muted">
                {o.note}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function Switch({
  on,
  label,
  onToggle,
}: {
  on: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
      className={`flex h-[22px] w-[38px] shrink-0 items-center rounded-full px-[3px] transition-colors ${
        on ? "bg-action" : "bg-stroke"
      }`}
    >
      <span
        className={`size-[16px] rounded-full transition-transform ${
          on ? "translate-x-[16px] bg-black" : "bg-overlay/70"
        }`}
      />
    </button>
  );
}

/* ----------------------------------------------------------- zone editor */

function ZoneEditor({
  feeds,
  zones,
  className = "",
  onChange,
  onDone,
}: {
  feeds: CameraFeed[];
  zones: Record<string, ActivityZone[]>;
  className?: string;
  onChange: (zones: Record<string, ActivityZone[]>) => void;
  onDone: () => void;
}) {
  /* Which camera is being drawn on. Everything else in this panel is
     tower-wide; a rectangle is not, so this is the one place the two cameras
     are told apart. */
  const [feedId, setFeedId] = useState(feeds[0]?.id ?? "");
  const feed = feeds.find((f) => f.id === feedId) ?? feeds[0];
  const mine = zones[feedId] ?? [];
  const setMine = (next: ActivityZone[]) =>
    onChange({ ...zones, [feedId]: next });
  const frameRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<ActivityZone | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  /* The draft is mirrored in a ref because `pointerup` reads it. React batches
     state across a fast gesture, so the `draft` closed over by the up handler
     can still be the value from before the drag began — the rectangle is on
     screen and the handler sees `null`. The ref is what actually happened. */
  const draftRef = useRef<ActivityZone | null>(null);

  /* Normalised against the frame's own box, so a zone drawn here still covers
     the same ground in a fullscreen takeover. */
  const point = (e: ReactPointerEvent) => {
    const box = frameRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)),
      y: Math.min(1, Math.max(0, (e.clientY - box.top) / box.height)),
    };
  };

  const full = mine.length >= MAX_ZONES;

  return (
    <motion.aside
      aria-label={`${feed?.name ?? ""} activity zones`}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={ENTER}
      className={`w-full min-w-0 flex-col border-l border-line-panel bg-ink lg:w-[417px] lg:shrink-0 ${className}`}
    >
      <header className="flex h-[46px] shrink-0 items-center gap-[8px] border-b border-line pl-[12px] pr-[14px]">
        <button
          type="button"
          onClick={onDone}
          aria-label="Back to camera settings"
          className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors hover:text-body-ink"
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M12 4 6 10l6 6"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <h2 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-body-ink">
          ACTIVITY ZONES
        </h2>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[16px] overflow-y-auto px-[15px] pb-[24px] pt-[16px]">
        {/* The one per-camera control in a tower-wide panel, so it says which
            camera before it says anything else. */}
        <div className="flex gap-[6px]">
          {feeds.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFeedId(f.id)}
              aria-pressed={f.id === feedId}
              className={`h-[34px] flex-1 truncate rounded-[8px] px-[10px] text-[0.8125rem] font-medium transition-colors ${
                f.id === feedId
                  ? "bg-action text-action-ink"
                  : "bg-card text-body-ink hover:bg-card-hover"
              }`}
            >
              {f.name}
            </button>
          ))}
        </div>

        <p className="text-[0.875rem] leading-[20px] text-sub">
          Drag on the picture to draw a zone. Movement outside your zones is
          ignored. With none drawn, the whole frame is watched.
        </p>

        {/* On the camera's own frame. The whole point is that you can see the
            gate you are drawing around. */}
        <div
          ref={frameRef}
          onPointerDown={(e) => {
            if (full) return;
            /* Capture on the frame, not on `e.target` — the target is usually
               the <img> inside, and capturing there sends the rest of the
               gesture somewhere the handlers are not. Guarded because capture
               is a nicety: it keeps a drag alive past the frame's edge, and if
               it is unavailable the drawing still has to work. */
            try {
              e.currentTarget.setPointerCapture(e.pointerId);
            } catch {
              /* no capture; the pointerup below still lands */
            }
            start.current = point(e);
            draftRef.current = { id: "draft", ...start.current, w: 0, h: 0 };
            setDraft(draftRef.current);
          }}
          onPointerMove={(e) => {
            if (!start.current) return;
            const p = point(e);
            draftRef.current = {
              id: "draft",
              x: Math.min(start.current.x, p.x),
              y: Math.min(start.current.y, p.y),
              w: Math.abs(p.x - start.current.x),
              h: Math.abs(p.y - start.current.y),
            };
            setDraft(draftRef.current);
          }}
          /* Nothing to commit and nothing left armed. `pointerup` is not the
             only way a gesture ends: a touch device fires `pointercancel` when
             the system takes the pointer back mid-drag, and without this the
             anchor stayed set — the next drag across the frame was read as a
             continuation and rubber-banded a rectangle from the *old* corner,
             committing a zone nobody drew. `lostpointercapture` covers the
             same hole when capture is unavailable and the release lands
             outside the frame; after a normal release it is a no-op, because
             the anchor is already cleared. */
          onPointerCancel={() => {
            start.current = null;
            draftRef.current = null;
            setDraft(null);
          }}
          onLostPointerCapture={() => {
            if (!start.current) return;
            start.current = null;
            draftRef.current = null;
            setDraft(null);
          }}
          onPointerUp={() => {
            /* A stray click is not a zone. Anything under 5% of the frame in
               either direction is discarded rather than left as a speck the
               operator has to find and delete. */
            const d = draftRef.current;
            if (d && d.w > 0.05 && d.h > 0.05) {
              setMine([...mine, { ...d, id: `z${Date.now().toString(36)}` }]);
            }
            start.current = null;
            draftRef.current = null;
            setDraft(null);
          }}
          className={`relative aspect-video w-full touch-none overflow-hidden rounded-[8px] bg-tile-dead ${
            full ? "cursor-not-allowed" : "cursor-crosshair"
          }`}
        >
          {feed?.poster && (
            <img
              src={feed.poster}
              alt=""
              draggable={false}
              className="absolute inset-0 size-full object-cover opacity-70"
            />
          )}
          {[...mine, ...(draft ? [draft] : [])].map((z, i) => (
            <span
              key={z.id}
              className="absolute border border-detect bg-detect/20"
              style={{
                left: `${z.x * 100}%`,
                top: `${z.y * 100}%`,
                width: `${z.w * 100}%`,
                height: `${z.h * 100}%`,
              }}
            >
              {z.id !== "draft" && (
                <span className="absolute left-[4px] top-[3px] font-display text-[0.6875rem] text-detect">
                  {i + 1}
                </span>
              )}
            </span>
          ))}
        </div>

        {mine.length === 0 ? (
          <p className="text-[0.8125rem] leading-[20px] text-muted">
            No zones. The whole frame is watched.
          </p>
        ) : (
          <ul className="flex flex-col gap-[8px]">
            {mine.map((z, i) => (
              <li
                key={z.id}
                className="flex h-[44px] items-center justify-between gap-[12px] rounded-[8px] bg-card px-[14px]"
              >
                <span className="flex items-center gap-[10px] text-[0.875rem] text-body-ink">
                  <span
                    aria-hidden
                    className="size-[10px] rounded-[2px] border border-detect bg-detect/20"
                  />
                  Zone {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setMine(mine.filter((o) => o.id !== z.id))}
                  className="text-[0.8125rem] font-medium text-critical transition-colors hover:text-body-ink"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}

        {full && (
          <p className="text-[0.8125rem] leading-[20px] text-warn">
            Three zones is the limit. Remove one to draw another.
          </p>
        )}
      </div>
    </motion.aside>
  );
}
