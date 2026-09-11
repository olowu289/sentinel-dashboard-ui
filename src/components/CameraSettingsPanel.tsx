import { motion } from "motion/react";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { solarState } from "@/lib/data";
import { MaskIcon } from "./Icon";
import { batteryFill, batteryTone, TowerBattery } from "./TowerBattery";
import { ENTER, FADE } from "@/lib/motion";
import { formatEventTime, formatUptime } from "@/lib/time";
import { uplinkReading, type UplinkReading } from "@/lib/api/map";
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

/* What is written to the tower's own buffer, as opposed to what goes out over
   the uplink. The link constrains one and the storage constrains the other, so
   the frame is right to make them two rows. */
const RECORDING_QUALITY: {
  value: CameraSettings["recordingQuality"];
  label: string;
  note: string;
}[] = [
  {
    value: "4k",
    label: "4K HD",
    note: "The default. Best for evidence, and fills the buffer fastest.",
  },
  { value: "1080p", label: "Full HD (1080P)", note: "Half the storage." },
  { value: "720p", label: "HD (720P)", note: "For a tower that fills up." },
];

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

const RECORDING: {
  value: CameraSettings["recording"];
  label: string;
  note: string;
}[] = [
  {
    value: "detection",
    label: "On Detection",
    note: "The default. Keeps the buffer long and the uplink quiet.",
  },
  {
    value: "continuous",
    label: "Continuous",
    note: "Nothing is missed, and the tower fills its storage far faster.",
  },
];

const RETENTION: { value: CameraSettings["retentionDays"]; label: string }[] = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
];

/* These towers are off-grid and the solar panel is the only thing refilling the
   battery, so this is the setting a dark week is actually managed with. Every
   option names what it gives up, because the whole point of the choice is the
   trade. */
const POWER: {
  value: CameraSettings["powerMode"];
  label: string;
  note: string;
}[] = [
  {
    value: "performance",
    label: "Performance",
    note: "Full frame rate and the fastest wake. Heaviest on the battery.",
  },
  { value: "balanced", label: "Balanced", note: "The default." },
  {
    value: "saver",
    label: "Battery saver",
    note: "Wakes slower, so the first second of an event can be missed.",
  },
];

export function CameraSettingsPanel({
  tower,
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
  className = "",
}: {
  tower: Tower;
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
  const recording = RECORDING.find((r) => r.value === settings.recording);
  const power = POWER.find((p) => p.value === settings.powerMode);
  const recordingQuality = RECORDING_QUALITY.find(
    (r) => r.value === settings.recordingQuality,
  );
  /* `undefined` for a real tower, which reports no array. Computed once so
     the cell and the sun cannot disagree. */
  const reportedSolar =
    tower.solar !== undefined
      ? solarState({ solar: tower.solar, batteryPct: tower.batteryPct })
      : undefined;
  const usedPct = Math.round(
    ((tower.storageUsedGb ?? 0) / Math.max(1, tower.storageTotalGb ?? 1)) * 100,
  );

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
          className="flex size-[24px] shrink-0 items-center justify-center text-white transition-colors hover:text-muted"
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
        <h2 className="ml-[12px] min-w-0 truncate font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          TOWER SETTINGS
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close tower settings"
          className="ml-auto flex size-[24px] shrink-0 items-center justify-center text-white transition-colors hover:text-muted"
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
          {tower.batteryPct !== undefined && (
            <TowerBattery
              pct={tower.batteryPct}
              charging={reportedSolar === "charging"}
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
                    {...(tower.batteryPct !== undefined
                      ? { background: batteryFill(tower.batteryPct) }
                      : {})}
                  />
                  <span
                    className={`flex items-center gap-[2px] font-display text-[0.875rem] leading-[20px] font-bold tracking-[0.14px] tabular-nums ${
                      tower.batteryPct !== undefined
                        ? batteryTone(tower.batteryPct)
                        : "text-muted"
                    }`}
                  >
                    {tower.batteryPct !== undefined
                      ? `${tower.batteryPct}%`
                      : "No reading"}
                    {reportedSolar === "charging" && (
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
                different hardware and different lists, and this tower's are
                2560×1440 and 1920×1080. Activity Zones is the only other row
                that has to say which camera it means, and for the same
                reason. */}
            <Row
              label="Stream Quality"
              value={streamSummary}
              expanded={open === "quality"}
              onToggle={() => toggle("quality")}
            >
              <div className="flex flex-col gap-[10px]">
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
            <Row
              label="Recording Settings"
              value={recordingQuality?.label ?? ""}
              expanded={open === "recq"}
              onToggle={() => toggle("recq")}
              last
            >
              <Choices
                name="recording settings"
                options={RECORDING_QUALITY}
                value={settings.recordingQuality}
                onPick={(v) => onChange({ recordingQuality: v })}
              />
            </Row>
          </Group>

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

          <Group title="Network">
            {/* No chevron on the frame, and rightly — an uplink is a reading,
                not a setting. It keeps its colour, which makes it the only
                value on this panel that is not white.

                ⚠ THIS USED TO BE A DEMO GRADE. `tower.link` is coordination's
                view of the WSS socket — up or down — and the seed layer turned
                that into "Great"/"Fair"/"Poor", which is a grade the tower
                never gave, on the one row in this panel whose colour carries
                meaning. It now grades a REAL dBm or says honestly that it
                cannot. There is no arrangement of missing data that produces a
                grade: `uplinkReading` returns a non-grade for every path that
                is not a number. */}
            <UplinkRow reading={uplinkReading(tower.health?.uplink)} />
            {/* WAS "IP Address", and that was a demo literal — 192.168.1.230
                on every tower in the fleet. This reports something the tower
                actually tells us. It is also the more useful reading: an
                address is a constant an operator rarely needs, while how long
                the link has held is the difference between a healthy site and
                one that is flapping. */}
            <ConnectedSince at={tower.connectedAt} />
            <RowReading
              label="Backup Connection"
              value={tower.backupConnection ?? ""}
              last
            />
          </Group>

          <Group title="Storage">
            <RowReading
              label="Memory"
              /* Empty renders as "Not reported" — the row already does that,
                 which is exactly the absence grammar this app asks for. The
                 projection carries no storage figures at all; `disk.free_pct`
                 is a percentage of an unknown total and is not the same
                 reading, so it is not substituted in here. */
              value={
                tower.storageUsedGb !== undefined &&
                tower.storageTotalGb !== undefined
                  ? `${tower.storageUsedGb}GB / ${tower.storageTotalGb}GB Used`
                  : ""
              }
              tone={usedPct >= 90 ? "text-warn" : undefined}
            />
            <Row
              label="Recording"
              value={recording?.label ?? ""}
              expanded={open === "recording"}
              onToggle={() => toggle("recording")}
            >
              <Choices
                name="recording"
                options={RECORDING}
                value={settings.recording}
                onPick={(v) => onChange({ recording: v })}
              />
            </Row>
            <Row
              label="Keep Footage for"
              value={`${settings.retentionDays} days`}
              expanded={open === "retention"}
              onToggle={() => toggle("retention")}
              last
            >
              <Choices
                name="retention"
                options={RETENTION}
                value={settings.retentionDays}
                onPick={(v) => onChange({ retentionDays: v })}
              />
            </Row>
          </Group>

          <Group title="Power">
            <Row
              label="Working Mode"
              value={power?.label ?? ""}
              expanded={open === "power"}
              onToggle={() => toggle("power")}
              last
            >
              <Choices
                name="working mode"
                options={POWER}
                value={settings.powerMode}
                onPick={(v) => onChange({ powerMode: v })}
              />
            </Row>
          </Group>

          <Group title="About Device">
            <RowReading label="Model Name" value={tower.model ?? ""} />
            <RowReading label="Serial Number" value={tower.serial ?? ""} />
            <RowReading label="Cameras" value={`${feeds.length}`} />
            {/* The frame puts an action beside the version. It is the only
                thing on this panel that reaches the hardware, so it is its own
                target rather than a row you can land on by accident. */}
            <RowReading
              label="Firmware"
              value={tower.firmware ?? ""}
              action="Update Firmware"
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
        className={`w-full min-w-0 rounded-[4px] bg-card px-[6px] py-0 text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-white uppercase outline-none focus-visible:outline-1 focus-visible:outline-terra ${errorRing(phase)}`}
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
        className="-mx-[6px] cursor-text truncate rounded-[4px] px-[6px] text-left text-[0.875rem] leading-[20px] font-medium tracking-[0.14px] text-white transition-colors hover:bg-card disabled:cursor-wait disabled:text-muted"
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
const ROW_LINE = "border-b border-row-line";
const LABEL = "text-[0.875rem] leading-[18px] tracking-[0.14px] text-muted";
/* The value's type, WITHOUT a colour. A reading that carries a tone must carry
   only that one: two colour utilities on one element is one `color`
   declaration, and the stylesheet — not the class list — decides which wins.
   `text-white` is emitted after every status colour, so for as long as the two
   were written side by side every tone on this panel rendered white: the
   uplink's Great/Fair/Poor, "Not connected", the storage warning. */
const VALUE_TYPE = "text-[0.875rem] leading-[18px] font-medium tracking-[0.14px]";
const VALUE = `${VALUE_TYPE} text-white`;

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
  last = false,
}: {
  label: string;
  value: string;
  tone?: string;
  /** A glyph after the value, as the uplink row carries. */
  icon?: string;
  /** An action beside the value, as the firmware row carries. */
  action?: string;
  last?: boolean;
}) {
  return (
    <div className={`${ROW} ${last ? "" : ROW_LINE}`}>
      <span className={LABEL}>{label}</span>
      <span className="flex min-w-0 items-center gap-[6px]">
        {/* One colour class, never two — see VALUE_TYPE. */}
        <span className={`truncate ${VALUE_TYPE} ${tone ?? "text-white"} tabular-nums`}>
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
            className="shrink-0 text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-terra transition-colors hover:text-white disabled:text-white/30 disabled:hover:text-white/30"
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
function ConnectedSince({ at }: { at?: number }) {
  /* 30s, the hook's default. The finest thing this can show is a minute, so a
     faster tick would be renders nobody can read. */
  const now = useNow();

  if (at === undefined) {
    /* Absence is the reading, and it says WHICH absence. `RowReading`'s generic
       fallback is "Not reported", which here would be the wrong claim: the
       tower did not fail to report a connection time, it has no connection.
       Showing the last known uptime would be worse still — a link that is down,
       reported as having held for days. */
    return <RowReading label="Connected since" value="Not connected" tone="text-critical" />;
  }

  return (
    <RowReading
      label="Connected since"
      value={`${formatEventTime(at, now)} · up ${formatUptime(now - at)}`}
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
                <span className="flex items-center gap-[8px] text-[0.875rem] text-white">
                  <span
                    aria-hidden
                    className={`size-[8px] shrink-0 rounded-full ${picked ? "bg-white" : "bg-white/20"}`}
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
            <span className="flex items-center gap-[8px] text-[0.875rem] text-white">
              <span
                aria-hidden
                className={`size-[8px] shrink-0 rounded-full ${picked ? "bg-white" : "bg-white/20"}`}
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
        on ? "bg-white" : "bg-stroke"
      }`}
    >
      <span
        className={`size-[16px] rounded-full transition-transform ${
          on ? "translate-x-[16px] bg-black" : "bg-white/70"
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
          className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors hover:text-white"
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
        <h2 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
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
                  ? "bg-white text-black"
                  : "bg-card text-white hover:bg-card-hover"
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
                <span className="flex items-center gap-[10px] text-[0.875rem] text-white">
                  <span
                    aria-hidden
                    className="size-[10px] rounded-[2px] border border-detect bg-detect/20"
                  />
                  Zone {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setMine(mine.filter((o) => o.id !== z.id))}
                  className="text-[0.8125rem] font-medium text-critical transition-colors hover:text-white"
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
