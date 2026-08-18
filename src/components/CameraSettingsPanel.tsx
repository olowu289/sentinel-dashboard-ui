import { motion } from "motion/react";
import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ENTER, FADE } from "@/lib/motion";
import {
  MAX_ZONES,
  type ActivityZone,
  type CameraFeed,
  type CameraSettings,
  type Tower,
} from "@/lib/types";

/**
 * A tower's camera settings, over the alerts rail rather than on a screen of
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
      label: "People only",
      note: "Quietest. Vehicles moving through the frame are ignored.",
    },
    {
      value: "people-vehicles",
      label: "People and vehicles",
      note: "The default. Catches most of what a yard cares about.",
    },
    {
      value: "all",
      label: "All motion",
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

const NIGHT: { value: CameraSettings["nightVision"]; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "on", label: "Always on" },
  { value: "off", label: "Off" },
];

const QUALITY: { value: CameraSettings["quality"]; label: string; note: string }[] =
  [
    {
      value: "1080p30",
      label: "1080p · 30 fps",
      note: "Sharpest, and the heaviest on the uplink.",
    },
    { value: "1080p15", label: "1080p · 15 fps", note: "The default." },
    {
      value: "720p30",
      label: "720p · 30 fps",
      note: "Smoother motion on a poor link, less detail.",
    },
  ];

const RECORDING: {
  value: CameraSettings["recording"];
  label: string;
  note: string;
}[] = [
  {
    value: "detection",
    label: "On detection",
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
  onClose,
}: {
  tower: Tower;
  feeds: CameraFeed[];
  settings: CameraSettings;
  onChange: (next: Partial<CameraSettings>) => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [editingZones, setEditingZones] = useState(false);

  const zoneCount = feeds.reduce(
    (n, f) => n + (settings.zones[f.id]?.length ?? 0),
    0,
  );

  const toggle = (id: string) => setOpen((o) => (o === id ? null : id));

  const detect = DETECT.find((d) => d.value === settings.detect);
  const sensitivity = SENSITIVITY.find((s) => s.value === settings.sensitivity);
  const night = NIGHT.find((n) => n.value === settings.nightVision);
  const quality = QUALITY.find((q) => q.value === settings.quality);
  const recording = RECORDING.find((r) => r.value === settings.recording);
  const power = POWER.find((p) => p.value === settings.powerMode);
  const usedPct = Math.round(
    (tower.storageUsedGb / Math.max(1, tower.storageTotalGb)) * 100,
  );

  if (editingZones) {
    return (
      <ZoneEditor
        feeds={feeds}
        zones={settings.zones}
        onChange={(zones) => onChange({ zones })}
        onDone={() => setEditingZones(false)}
      />
    );
  }

  return (
    <motion.aside
      aria-label={`${tower.id} camera settings`}
      initial={{ opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={ENTER}
      className="flex w-full min-w-0 flex-col border-l border-line-panel bg-ink lg:w-[417px] lg:shrink-0"
    >
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-[12px] border-b border-line pl-[16px] pr-[14px]">
        {/* The scope rides the title. As a paragraph in the content flow it
            sat immediately above the first group header and read as that
            group's introduction rather than the panel's. */}
        <div className="flex min-w-0 flex-col">
          <h2 className="truncate font-display text-[0.875rem] leading-[18px] tracking-[0.14px] text-white">
            CAMERA SETTINGS
          </h2>
          <p className="truncate text-[0.6875rem] leading-[14px] text-muted">
            Both cameras on {tower.id} · {feeds.map((f) => f.name).join(", ")}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close camera settings"
          className="flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-muted transition-colors hover:text-white"
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-[26px] overflow-y-auto px-[15px] pb-[24px] pt-[18px]">
        <Group title="DETECTION">
          <Row
            label="Detect"
            value={detect?.label ?? ""}
            expanded={open === "detect"}
            onToggle={() => toggle("detect")}
          >
            <Choices
              name="detect"
              options={DETECT}
              value={settings.detect}
              onPick={(v) => onChange({ detect: v })}
            />
          </Row>

          <Row
            label="Sensitivity"
            value={sensitivity?.label ?? ""}
            expanded={open === "sensitivity"}
            onToggle={() => toggle("sensitivity")}
          >
            <Choices
              name="sensitivity"
              options={SENSITIVITY}
              value={settings.sensitivity}
              onPick={(v) => onChange({ sensitivity: v })}
            />
          </Row>

          {/* Drawn on the frame, not described. It is the one eufy pattern
              worth copying whole: "ignore the road, watch the gate" cannot be
              said in a form field. */}
          <button
            type="button"
            onClick={() => setEditingZones(true)}
            className="flex h-[48px] w-full items-center justify-between gap-[12px] px-[14px] text-left transition-colors hover:bg-card-hover"
          >
            <span className="text-[0.875rem] text-white">Activity zones</span>
            <span className="flex items-center gap-[8px] text-[0.875rem] text-muted">
              {zoneCount === 0 ? "Whole frame" : `${zoneCount} set`}
              <img
                src="/icons/chevron-right.svg"
                alt=""
                width={16}
                height={16}
              />
            </span>
          </button>
        </Group>

        <Group title="PICTURE">
          <Row
            label="Night vision"
            value={night?.label ?? ""}
            expanded={open === "night"}
            onToggle={() => toggle("night")}
          >
            <Choices
              name="night"
              options={NIGHT}
              value={settings.nightVision}
              onPick={(v) => onChange({ nightVision: v })}
            />
          </Row>
          <Row
            label="Stream quality"
            value={quality?.label ?? ""}
            expanded={open === "quality"}
            onToggle={() => toggle("quality")}
          >
            <Choices
              name="quality"
              options={QUALITY}
              value={settings.quality}
              onPick={(v) => onChange({ quality: v })}
            />
          </Row>
        </Group>

        <Group title="AUDIO">
          <div className="flex h-[48px] items-center justify-between gap-[12px] px-[14px]">
            <span className="text-[0.875rem] text-white">Microphone</span>
            <Switch
              on={settings.micOn}
              label="Microphone"
              onToggle={() => onChange({ micOn: !settings.micOn })}
            />
          </div>
          <div className="flex flex-col gap-[10px] px-[14px] py-[12px]">
            <div className="flex items-center justify-between">
              <span className="text-[0.875rem] text-white">Speaker volume</span>
              <span className="font-display text-[0.875rem] text-muted tabular-nums">
                {settings.speakerVolume}%
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={settings.speakerVolume}
              onChange={(e) =>
                onChange({ speakerVolume: Number(e.target.value) })
              }
              aria-label="Speaker volume"
              className="w-full accent-white"
            />
          </div>
        </Group>

        {/* The storage figure is a reading, not a quota. The tower buffers
            locally and ships on the uplink, so it fills and empties on its own
            — the operator's only levers on it are the two rows above. */}
        <Group
          title="STORAGE"
          value={`${tower.storageUsedGb} GB of ${tower.storageTotalGb} GB`}
          tone={usedPct >= 90 ? "text-warn" : undefined}
        >
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
            label="Keep footage for"
            value={`${settings.retentionDays} days`}
            expanded={open === "retention"}
            onToggle={() => toggle("retention")}
          >
            <Choices
              name="retention"
              options={RETENTION}
              value={settings.retentionDays}
              onPick={(v) => onChange({ retentionDays: v })}
            />
          </Row>
        </Group>

        <Group
          title="POWER"
          value={`${tower.batteryPct}%${tower.solar === "charging" && tower.batteryPct < 100 ? " and rising" : ""}`}
          tone={
            tower.batteryPct < 20
              ? "text-critical"
              : tower.batteryPct < 40
                ? "text-warn"
                : undefined
          }
        >
          <Row
            label="Working mode"
            value={power?.label ?? ""}
            expanded={open === "power"}
            onToggle={() => toggle("power")}
          >
            <Choices
              name="power"
              options={POWER}
              value={settings.powerMode}
              onPick={(v) => onChange({ powerMode: v })}
            />
          </Row>
        </Group>

        {/* Read-only, and the reason this group exists at all: when a camera
            misbehaves the first two questions are which box it is and what it
            is running. */}
        {/* Passed as children, not as `readings`: every row here is a reading,
            so the group can wear the same card as the others and the absent
            chevron is what marks them read-only. */}
        <Group title="DEVICE INFO">
          <Reading label="Serial" value={tower.serial} />
          <Reading label="Firmware" value={tower.firmware} />
          <Reading label="Cameras" value={`${feeds.length}`} />
          <Reading
            label="Uplink"
            value={
              tower.link === "good"
                ? "Good"
                : tower.link === "warn"
                  ? "Fair"
                  : "Poor"
            }
            tone={
              tower.link === "bad"
                ? "text-critical"
                : tower.link === "warn"
                  ? "text-warn"
                  : undefined
            }
          />
        </Group>

      </div>
    </motion.aside>
  );
}

/* ---------------------------------------------------------------- pieces */

/** A value the tower reports. No control, and it never renders blank — an
 *  absent reading says why, the way the alert fields do. */
/**
 * A value the tower reports, in the same card and the same shape as a control
 * row — the missing chevron is what says it does not open.
 *
 * It was styled the other way round for a while: no card, muted label, white
 * value, sitting on the panel's own ground so it could not be mistaken for
 * something pressable. That was right while readings sat *among* controls. Once
 * the two single readings moved up onto their group headers, the only group
 * left holding any was DEVICE INFO — where every row is a reading, so there is
 * nothing to be mistaken for, and a group with no card was the one group that
 * looked broken.
 *
 * Never renders blank — an absent reading says why, the way the alert fields do.
 */
function Reading({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="flex h-[48px] items-center justify-between gap-[12px] px-[14px]">
      <span className="text-[0.875rem] text-white">{label}</span>
      <span className={`text-[0.875rem] tabular-nums ${tone ?? "text-muted"}`}>
        {value || "Not reported"}
      </span>
    </div>
  );
}

/**
 * A group is one card with hairlines inside it, not a stack of tiles.
 *
 * Six separate cards with 8px between them made every row float at the same
 * weight and left the group headings doing all the work of grouping, which at
 * 12px muted they cannot. One surface per group is what alias, Apple Fitness
 * and Character AI all do, and it is what makes DETECTION mean something.
 *
 * `readings` sit *below* the card rather than inside it — see `Reading`.
 */
function Group({
  title,
  value,
  tone,
  children,
}: {
  title: string;
  /** The group's own reading, on the header line. A group with one number to
   *  report does not need a row for it — "STORAGE … 96 GB of 128 GB" says the
   *  same thing in half the height, and drops a label the heading already
   *  carried. Only where the group has exactly one; DEVICE INFO has four and
   *  keeps them as rows. */
  value?: string;
  tone?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col">
      <div className="flex items-baseline justify-between gap-[12px]">
        <h3 className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
          {title}
        </h3>
        {value && (
          <span
            className={`font-display text-[0.75rem] tracking-[0.12px] tabular-nums ${tone ?? "text-white"}`}
          >
            {value}
          </span>
        )}
      </div>
      <span aria-hidden className="mb-[12px] mt-[8px] h-px bg-line" />
      {children && (
        <div className="flex flex-col overflow-hidden rounded-[10px] bg-card [&>*+*]:border-t [&>*+*]:border-line">
          {children}
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  value,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  value: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex h-[48px] w-full items-center justify-between gap-[12px] px-[14px] text-left transition-colors hover:bg-card-hover"
      >
        <span className="text-[0.875rem] text-white">{label}</span>
        <span className="flex min-w-0 items-center gap-[8px]">
          <span className="truncate text-[0.875rem] text-muted">{value}</span>
          <img
            src="/icons/chevron-right.svg"
            alt=""
            width={16}
            height={16}
            className={`shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`}
          />
        </span>
      </button>
      {expanded && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="flex flex-col gap-[2px] border-t border-line px-[8px] py-[8px]"
        >
          {children}
        </motion.div>
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
  onChange,
  onDone,
}: {
  feeds: CameraFeed[];
  zones: Record<string, ActivityZone[]>;
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
      className="flex w-full min-w-0 flex-col border-l border-line-panel bg-ink lg:w-[417px] lg:shrink-0"
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
