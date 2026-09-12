import { motion } from "motion/react";
import { alertsForTower, feedsForTower, solarState } from "@/lib/data";
import { uplinkReading, type UplinkReading } from "@/lib/api/map";
import { ENTER } from "@/lib/motion";
import { formatEventTime, formatUptime } from "@/lib/time";
import { batteryFlow, batteryHint, batteryTone } from "@/lib/battery";
import { storageHint, storageTone } from "@/lib/storage";
import { useNow } from "@/lib/useNow";
import type { Alert, CameraFeed, Tower, TowerStatus } from "@/lib/types";
import { IconRail } from "./IconRail";
import { MaskIcon } from "./Icon";
import { CABINET_CRITICAL_C, CABINET_WARN_C, STATUS } from "./TowerCard";
import { batteryFill, TowerBattery } from "./TowerBattery";

/**
 * The towers board: the fleet as a status board, one row per tower.
 *
 * The camera wall answers "what is happening"; this answers "is every site
 * all right". It is laid out for that question at fleet scale: every tower is
 * one row, every reading is one column, and the columns line up down the page
 * — so twenty towers are read the way a control room reads a board, down for
 * the site and across for the detail, and a red cell in a column of green is
 * seen before it is read.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  EVERY CELL IS AN INSTRUMENT, AND THE INSTRUMENT IS THE READING
 * ══════════════════════════════════════════════════════════════════════
 *
 * Each cell is a glyph and a figure, and the GLYPH CARRIES THE VALUE rather
 * than labelling it: the signal bars light to the grade, the tank fills to the
 * free space, the battery fills to the charge and takes the mast's bolt while
 * it is taking charge. That is the mast's own grammar — `batteryFill` paints a
 * gradient into a mask, the glyph takes its reading's tone — applied a column
 * at a time. Nothing here is a new hue, a new glyph or a new keyframe: every
 * icon is an existing export and the only animations are the two this app
 * already runs, `pulse-dot` and `solar-charging`.
 *
 * ── MOTION IS FOR TROUBLE, NOT FOR DECORATION ──────────────────────────
 *
 * A board that moves everywhere is a board nobody can scan, so a healthy
 * reading is STILL: green cells do not pulse, and neither does amber. Only a
 * RED cell breathes, on the 2s heartbeat the live dot uses, and an offline
 * tower's leading edge breathes with it. On a wall of twenty towers that is
 * the whole point — a field of calm green, and the one site in trouble calling
 * across the room. Charging is the single exception, and it is a reading too:
 * the bolt means charge is going in right now.
 *
 * ── WHAT IS REAL, AND WHAT IS ONLY PENDING ─────────────────────────────
 *
 *   a reading   something the tower reported, graded on this app's existing
 *               thresholds and nothing new — the status grammar, the uplink
 *               grades, the battery tiers, the storage tiers, the cabinet
 *               temperatures. Its glyph is lit in that tone.
 *   pending     something this dashboard is not told yet: a dark glyph, a quiet
 *               dash, NEVER a colour, and the reason on hover — "Not reported
 *               yet" (the tower measures it, coordination does not pass it on),
 *               "No sensor fitted" (no hardware measures it), "No alert feed
 *               yet" (no backend serves it).
 *
 * The cells already read the fields the pending ones wait for —
 * `health.door`, `cover`, `thermal`, `disk` — so each lights up on its own the
 * day coordination passes the field through. A SEEDED fleet fills every one of
 * them from fixtures, which is how the whole instrument panel can be seen lit
 * without a single invented number reaching a live board; the badge above the
 * table says whose towers those are.
 *
 * An OFFLINE tower has no current readings. Coordination keeps the last health
 * block a tower sent and serves it after the link drops; drawn as-is, a dark
 * site would show a healthy uplink and a closed door from whenever it was last
 * heard. So every cell the tower itself reports goes to a dash, and the
 * connection cell says it is down, in red.
 *
 * Attaches no live video. The board is not the wall, so under the session
 * manager the wall's streams idle behind it and close if nobody comes back.
 */

/** One cell's content, before it is drawn. */
interface Cell {
  /** Compact — what fits the column. */
  value: string;
  /** A status colour, only when the value has a status. */
  tone?: string;
  /** Nothing to show: drawn as a dash, and `hint` says why. */
  empty?: boolean;
  /** Not reported to this dashboard yet — the one kind of empty that will
   *  change without anyone touching the tower. */
  pending?: boolean;
  /** The full sentence behind the compact value, for the pointer that asks. */
  hint: string;
  /**
   * 0–1, for the cells whose glyph is a gauge rather than a symbol: how full
   * the tank is, how charged the cell is. Absent when there is nothing to fill.
   */
  level?: number;
  /** Charge is going IN right now — the bolt, and only ever from a real sign. */
  charging?: boolean;
}

/* The three reasons a reading is not here. Each is a different fact and sends
   an operator somewhere different, so they are never collapsed into one. */
const NOT_PASSED_ON = "Not reported yet";
const NO_SENSOR = "No sensor fitted";
const NO_FEED = "No alert feed yet";

const WHY = {
  door: "the tower reads its door switch, but coordination does not pass that reading to the dashboard yet.",
  cover: "the tower reads its cover sensor, but coordination does not pass that reading to the dashboard yet.",
  temperature:
    "the tower measures its own temperature, but coordination does not pass that reading to the dashboard yet.",
  storage:
    "the tower can measure its recordings disk, but that reading is not reported to the dashboard yet.",
  /* SUPERSEDED 2026-09-12. This read "no tower on this fleet carries a battery
     or charge sensor, so there is no reading to show", and it is now false: a
     tower with ENABLE_BATTERY_BLE=1 reads its LiFePO4 pack over Bluetooth and
     reports charge, voltage and pack temperature. A REACHABLE BATTERY IS A
     FITTED SENSOR.

     This copy now covers only what is left — a tower that reports no battery
     block at all, which is a tower with no pack wired or the reader switched
     off. A tower that HAS one and cannot reach it is a different state and says
     so in its own words rather than borrowing this one. */
  power:
    "this tower reports no battery. A tower with a pack fitted and the battery reader enabled reports charge, voltage and pack temperature.",
  alerts:
    "coordination has no alert feed yet. A tower's own tamper and camera alerts stay on the tower for now.",
} as const;

const pending = (reason: string, why: string): Cell => ({
  value: "—",
  empty: true,
  pending: true,
  hint: `${reason} — ${why}`,
});

/* Not pending — a reading exists — but not current either. */
const OFFLINE: Cell = {
  value: "—",
  empty: true,
  hint: "Tower offline — the last reading it sent is not shown as if it were current.",
};

/* A real minus, not a hyphen. It is a signed quantity in a column of them. */
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);

/* A camera the tower confirms is up. `delayed` and `frozen` are degraded
   pictures but still pictures; `connecting` and a never-reported camera are
   neither up nor down, and are counted as unconfirmed rather than guessed. */
const UP: ReadonlySet<CameraFeed["state"]> = new Set<CameraFeed["state"]>([
  "live",
  "recording",
  "delayed",
  "frozen",
]);

function camerasCell(feeds: CameraFeed[]): Cell {
  const total = feeds.length;
  /* A tower reporting no cameras is not a healthy one with nothing to show —
     `towerStatusFor` calls it degraded for the same reason. */
  if (total === 0) return { value: "0", tone: "text-warn", hint: "This tower reports no cameras." };
  const up = feeds.filter((f) => UP.has(f.state)).length;
  const down = feeds.filter((f) => f.state === "offline").length;
  const unconfirmed = total - up - down;
  return {
    value: `${up}/${total}`,
    /* Green only when every camera is confirmed up, red only when every one is
       confirmed down. Anything between — a dead camera, or one nobody has
       heard from — is amber, the tile grammar's word for a half-blind site. */
    tone: up === total ? "text-terra" : down === total ? "text-critical" : "text-warn",
    hint:
      `${up} of ${total} cameras online` +
      (down > 0 ? ` · ${down} down` : "") +
      (unconfirmed > 0 ? ` · ${unconfirmed} not confirmed` : ""),
  };
}

const GRADE_WORD = { great: "Great", fair: "Fair", poor: "Poor" } as const;

function uplinkCell(online: boolean, reading: UplinkReading): Cell {
  if (!online) return OFFLINE;
  switch (reading.kind) {
    case "signal":
      return {
        /* The BARS carry the grade now, so the figure carries what they
           cannot: the measurement itself. "Great · −56" said the same thing
           twice in a column 96px wide. */
        value: `${signed(reading.dbm)} dBm`,
        tone:
          reading.grade === "poor"
            ? "text-critical"
            : reading.grade === "fair"
              ? "text-warn"
              : "text-terra",
        hint: `${GRADE_WORD[reading.grade]} — ${reading.dbm} dBm, as the tower measured it.`,
      };
    case "wired":
      return { value: "Wired", hint: "Wired uplink — there is no radio signal to grade." };
    case "unassociated":
      return {
        value: "No link",
        tone: "text-warn",
        hint: "The radio is up but not joined to any network.",
      };
    default:
      return {
        value: "—",
        empty: true,
        hint: "No signal reading — the tower did not measure its uplink.",
      };
  }
}

function connectedCell(tower: Tower, now: number): Cell {
  if (tower.connectedAt !== undefined) {
    return {
      value: `up ${formatUptime(now - tower.connectedAt)}`,
      hint: `Connected since ${formatEventTime(tower.connectedAt, now)}.`,
    };
  }
  /* Up, but the time it came up was not reported — a seeded tower, which has
     no such field. "Down" beside ONLINE would be two cells contradicting each
     other. */
  if (tower.online) {
    return { value: "—", empty: true, hint: "This tower did not report when its link came up." };
  }
  return { value: "Down", tone: "text-critical", hint: "The tower is not connected." };
}

function doorCell(tower: Tower): Cell {
  const door = tower.health?.door;
  if (!door) return pending(NOT_PASSED_ON, WHY.door);
  return door.open
    ? { value: "Open", tone: "text-critical", hint: "The cabinet door is open." }
    : { value: "Closed", tone: "text-terra", hint: "The cabinet door is closed." };
}

function coverCell(tower: Tower): Cell {
  const cover = tower.health?.cover;
  if (!cover) return pending(NOT_PASSED_ON, WHY.cover);
  return cover.exposed
    ? { value: "Exposed", tone: "text-critical", hint: "The cover sensor sees light — the cover is off." }
    : { value: "Intact", tone: "text-terra", hint: "The cover is in place." };
}

function temperatureCell(tower: Tower): Cell {
  const thermal = tower.health?.thermal;
  if (thermal) {
    /* Reported, but with no number in it — the sensor itself is silent, which
       is a different absence from the reading never being passed on. */
    if (thermal.socC === null) {
      return {
        value: "—",
        empty: true,
        hint: "The tower reported its temperature block with no reading in it.",
      };
    }
    /* The tower's own processor, graded by the tower's own verdict. The
       cabinet thresholds below are for the enclosure, not a chip that idles
       in the forties, so they are not applied to it. */
    const c = Math.round(thermal.socC * 10) / 10;
    return {
      value: `${c}°C`,
      ...(thermal.state === "critical" ? { tone: "text-critical" } : {}),
      hint: `Processor at ${c}°C, as the tower measured it.`,
    };
  }
  if (tower.tempC !== undefined) {
    const c = tower.tempC;
    return {
      value: `${c}°C`,
      ...(c >= CABINET_CRITICAL_C
        ? { tone: "text-critical" }
        : c >= CABINET_WARN_C
          ? { tone: "text-warn" }
          : {}),
      hint: `Cabinet at ${c}°C.`,
    };
  }
  return pending(NOT_PASSED_ON, WHY.temperature);
}

function storageCell(tower: Tower): Cell {
  /* SUPERSEDED 2026-09-12. This read "the settings panel's own tier: amber from
     90% used, and no invented red above it", and both halves have changed.

     THE TIER MOVED OUT OF HERE. It lives in lib/storage.ts now, shared with the
     settings row, because the same fact drawn in two places with two copies of
     a threshold disagrees with itself the first time one is tuned.

     AND THERE IS A RED NOW. "No invented red" was the right instinct without
     data; there is data now and it argues the other way. Below 10% free the
     tower is deleting footage to keep recording — it is losing evidence while
     every other reading says the site is fine. That is a fault, and red is what
     this app uses for a fault.

     FREE, NOT USED. This showed used%; it shows free% now, matching §3.1's
     `disk.free_pct` and answering the question an operator actually has — how
     much longer can this tower keep recording. */
  const gb =
    tower.storageUsedGb !== undefined && tower.storageTotalGb !== undefined
      ? { used: tower.storageUsedGb, total: tower.storageTotalGb }
      : undefined;
  /* The reported percentage wins over one derived from the gigabytes: it is the
     protocol's own field, and the two are the same disk measured once. */
  const freePct =
    tower.health?.disk?.freePct ??
    (gb ? ((gb.total - gb.used) / Math.max(1, gb.total)) * 100 : undefined);

  if (freePct === undefined) return pending(NOT_PASSED_ON, WHY.storage);
  /* Both the colour and the sentence take the MEASURED value; only the cell's
     own label is rounded. Rounding first would hand 9.6 in as 10 and paint a
     disk that is already overwriting footage in amber, with the wording to
     match — see the warning on `storageHint`. */
  return {
    value: `${Math.round(freePct)}% free`,
    tone: storageTone(freePct),
    hint: storageHint(freePct, gb?.used, gb?.total),
    /* The tank fills with what is LEFT, like a fuel gauge: full is good, and
       an empty one reads as the trouble it is. */
    level: Math.min(1, Math.max(0, freePct / 100)),
  };
}

function powerCell(tower: Tower): Cell {
  /* THREE HONEST STATES, AND THEY ARE NOT INTERCHANGEABLE.

     SUPERSEDED 2026-09-12: this cell only ever had two — a seeded percentage or
     "No sensor fitted" — because no real tower reported a battery. One does
     now, over Bluetooth, and the middle case it introduced is the important
     one: the pack accepts a SINGLE BLE connection, so a tower that has a
     battery regularly cannot read it (someone standing at it with the vendor's
     app is enough).

       reachable          the charge, colour-coded.
       not reachable      said plainly, with NO number. Not the last one, not a
                          zero. "It was 37% when anyone could last ask" is not a
                          charge level, and the whole point of `reachable`
                          crossing the wire is so this cell can say so.
       no battery block   "No sensor fitted" — no pack wired, or the reader off.

     The real reading is read from `health.battery` and NOT from `batteryPct`,
     deliberately. `batteryPct` is the seed's field and App.tsx drives it upward
     1% a second to animate the demo; a live tower's charge must never be
     downstream of that. Seeded towers still fall through to it below, so the
     demo screens are unchanged. */
  const battery = tower.health?.battery;
  if (battery) {
    if (!battery.reachable) {
      return {
        value: "unreachable",
        empty: true,
        hint: batteryHint(battery),
      };
    }
    if (battery.socPct !== undefined) {
      return {
        value: `${Math.round(battery.socPct)}%`,
        tone: batteryTone(battery.socPct),
        hint: batteryHint(battery),
        level: Math.min(1, Math.max(0, battery.socPct / 100)),
        /* The pack's own current sign, past the deadband — the same source the
           mast's sweep reads, so the glyph here and the cell on the mast can
           never disagree about whether charge is going in. */
        charging: batteryFlow(battery) === "charging",
      };
    }
    /* Reached the pack and got no charge level out of it. Rare, and still not a
       reason to show a number. */
    return { value: "—", empty: true, hint: batteryHint(battery) };
  }

  if (tower.batteryPct === undefined) return pending(NO_SENSOR, WHY.power);
  const charging =
    tower.solar !== undefined &&
    solarState({ solar: tower.solar, batteryPct: tower.batteryPct }) === "charging";
  return {
    value: `${tower.batteryPct}%`,
    tone: batteryTone(tower.batteryPct),
    hint: `Battery at ${tower.batteryPct}%${charging ? ", charging" : ""}.`,
    level: Math.min(1, Math.max(0, tower.batteryPct / 100)),
    charging,
  };
}

function alertsCell(alerts: Alert[], feed: boolean): Cell {
  if (!feed) return pending(NO_FEED, WHY.alerts);
  if (alerts.length === 0) return { value: "0", hint: "No alerts." };
  const waiting = alerts.filter((a) => a.status === "triggered").length;
  /* Amber, the app's word for "this needs you" — the same claim the card's
     strip makes about an alert nobody has picked up. */
  return waiting > 0
    ? {
        value: `${waiting} open`,
        tone: "text-warn",
        hint: `${waiting} of ${alerts.length} alerts unclaimed.`,
      }
    : { value: `${alerts.length}`, hint: `${alerts.length} alerts, all claimed.` };
}

/* The columns, in reading order: connectivity first, because everything else
   rides on it; then the cabinet; then what the site has raised. */
const COLUMNS = [
  ["cameras", "Cameras"],
  ["uplink", "Uplink"],
  ["connected", "Connected"],
  ["door", "Door"],
  ["cover", "Cover"],
  ["temperature", "Temp"],
  ["storage", "Storage"],
  ["power", "Power"],
  ["alerts", "Alerts"],
] as const;
type ColumnId = (typeof COLUMNS)[number][0];

/**
 * The glyph each column draws, all of them existing exports.
 *
 * Two are reused for a job they were not drawn for, and both earn it: the
 * cover sensor is an LDR — it reports that it can SEE light — and the door is
 * a panel that opens. A dedicated lock or shield export can replace either
 * without touching anything else here. Nothing is hand-drawn: this repo's rule
 * is to reuse the exported set rather than invent glyphs beside it.
 */
const GLYPH: Partial<Record<ColumnId, string>> = {
  cameras: "/icons/cctv.svg",
  door: "/icons/panel-collapse.svg",
  cover: "/icons/poi-eye.svg",
  temperature: "/icons/twr-temp.svg",
  power: "/icons/twr-battery.svg",
  alerts: "/icons/bell.svg",
};

/* One grid for the header and every row, so the columns line up down the
   whole board. The identity column takes the slack; the readings share the
   rest evenly and never drop below what a glyph and its figure need. */
const GRID = "grid grid-cols-[minmax(232px,1.7fr)_repeat(9,minmax(96px,1fr))_124px]";

interface Assessed {
  tower: Tower;
  cells: Record<ColumnId, Cell>;
  uplink: UplinkReading;
  rank: number;
  order: number;
}

function assess(
  tower: Tower,
  order: number,
  feeds: CameraFeed[],
  alerts: Alert[],
  alertFeed: boolean,
  now: number,
): Assessed {
  /* Cells the tower itself reports go dark with it — see the header. A
     pending cell keeps its own reason: it was never a reading to go stale. */
  const current = (c: Cell): Cell => (tower.online || c.pending ? c : OFFLINE);
  const uplink = uplinkReading(tower.health?.uplink);
  const cells: Record<ColumnId, Cell> = {
    cameras: camerasCell(feeds),
    uplink: uplinkCell(tower.online, uplink),
    connected: connectedCell(tower, now),
    door: current(doorCell(tower)),
    cover: current(coverCell(tower)),
    temperature: current(temperatureCell(tower)),
    storage: current(storageCell(tower)),
    power: current(powerCell(tower)),
    alerts: alertsCell(alerts, alertFeed),
  };
  const tones = Object.values(cells).map((c) => c.tone);
  const rank =
    tower.status === "offline"
      ? 0
      : tower.status === "degraded"
        ? 1
        : tones.includes("text-critical")
          ? 2
          : tones.includes("text-warn")
            ? 3
            : 4;
  return { tower, cells, uplink, rank, order };
}

/**
 * Three bars from the REAL dBm, in the grade's colour.
 *
 * Lit by the same grades the Uplink cell prints, so the drawing and the figure
 * cannot disagree. No reading lights nothing: three empty bars say "not
 * measured" as plainly as a dash. A wired tower draws a full, quiet set — there
 * is no radio to grade, and an empty meter would read as a bad one.
 */
function SignalBars({ online, reading }: { online: boolean; reading: UplinkReading }) {
  const lit =
    online && reading.kind === "signal"
      ? reading.grade === "great"
        ? 3
        : reading.grade === "fair"
          ? 2
          : 1
      : online && reading.kind === "wired"
        ? 3
        : 0;
  const tone =
    reading.kind === "signal"
      ? reading.grade === "great"
        ? "bg-terra"
        : reading.grade === "fair"
          ? "bg-warn"
          : "bg-critical"
      : "bg-white/45";
  return (
    <span data-bars={lit} aria-hidden className="flex h-[12px] shrink-0 items-end gap-[1.5px]">
      {[5, 8.5, 12].map((h, i) => (
        <span
          key={h}
          style={{ height: h }}
          className={`w-[3px] rounded-[1px] ${i < lit ? tone : "bg-white/15"}`}
        />
      ))}
    </span>
  );
}

/**
 * A tank that fills with what is LEFT — the storage cell's gauge.
 *
 * Built from two spans rather than an export for the same reason the signal
 * bars are: it is a meter, not a symbol, and its whole job is to be at a
 * height. Its tone is `storageTone`'s, so the gauge and the figure beside it
 * cross the same thresholds at the same moment.
 */
function Tank({ level, tone }: { level: number; tone: string }) {
  const fill =
    tone === "text-critical" ? "bg-critical" : tone === "text-warn" ? "bg-warn" : "bg-terra";
  return (
    <span
      data-level={Math.round(level * 100)}
      aria-hidden
      className="relative block h-[14px] w-[5px] shrink-0 overflow-hidden rounded-[1.5px] bg-white/15"
    >
      <span
        style={{ height: `${Math.round(level * 100)}%` }}
        className={`absolute inset-x-0 bottom-0 rounded-[1.5px] ${fill}`}
      />
    </span>
  );
}

/**
 * One reading, drawn.
 *
 * The glyph is the instrument and the figure is the fine print. A LIT glyph
 * takes its reading's tone; a pending one is dark and says nothing at all,
 * because a coloured glyph over a reading nobody has is exactly the fake-green
 * this app exists to refuse.
 */
function CellView({ id, cell, row }: { id: ColumnId; cell: Cell; row: Assessed }) {
  /* ⚠ RED BREATHES, AND NOTHING ELSE DOES. `pulse-dot` is the live dot's own
     2s heartbeat, already in this app and already switched off under
     prefers-reduced-motion. Amber deliberately stays still: on a fleet of
     twenty, several degraded towers pulsing at once is a screen that fidgets,
     and the thing this is for — one site in real trouble, seen from across a
     room — stops working the moment everything moves. */
  const alarm = cell.tone === "text-critical";
  const tone = cell.empty ? "text-white/25" : (cell.tone ?? "text-white");
  const glyphTone = cell.empty ? "text-white/20" : (cell.tone ?? "text-white/70");

  return (
    <div
      role="cell"
      data-cell={id}
      data-pending={cell.pending || undefined}
      data-alarm={alarm || undefined}
      title={cell.hint}
      className="flex min-w-0 items-center gap-[7px] px-[10px]"
    >
      <span className={`flex shrink-0 items-center ${glyphTone} ${alarm ? "pulse-dot" : ""}`}>
        {id === "uplink" ? (
          <SignalBars online={row.tower.online} reading={row.uplink} />
        ) : id === "storage" ? (
          /* An EMPTY tank when there is nothing to fill it with, exactly as the
             signal bars sit unlit on a tower that measured no radio: the
             instrument is still there, dark, and the dash beside it says why.
             A cell with no gauge at all would be the one hole in the panel. */
          <Tank level={cell.level ?? 0} tone={cell.tone ?? ""} />
        ) : id === "connected" ? (
          /* The smallest instrument on the board, and the same one the status
             word uses: lit while the link is up, dark when it is not. */
          <span
            aria-hidden
            className={`block size-[6px] rounded-full ${
              row.tower.online ? "bg-terra" : "bg-white/20"
            }`}
          />
        ) : id === "power" && cell.level !== undefined ? (
          /* The mast's own trick: the charge painted INTO the glyph as a
             gradient, so the battery is full to exactly the figure beside it.
             `batteryFill` owns the tiers, here as on the mast and in the
             tooltip. */
          <MaskIcon
            src="/icons/twr-battery.svg"
            size={17}
            background={batteryFill(cell.level * 100)}
          />
        ) : GLYPH[id] ? (
          <MaskIcon src={GLYPH[id]!} size={15} />
        ) : null}
      </span>

      <span
        className={`truncate font-display text-[0.8125rem] leading-[18px] tracking-[0.13px] tabular-nums ${
          /* One colour class, never two — see VALUE_TYPE in the settings panel. */
          tone
        }`}
      >
        {cell.value}
      </span>

      {/* Charge going in, right now. The settings panel's bolt on the sun's own
          2s breath — the app's existing marker for exactly this, rather than a
          second way of saying it. */}
      {cell.charging && (
        <span className="shrink-0 text-terra">
          <MaskIcon src="/icons/set-bolt.svg" size={13} className="solar-charging" />
        </span>
      )}

      {/* A dash says nothing to a screen reader; the reason does. */}
      {cell.empty && <span className="sr-only">{cell.hint}</span>}
    </div>
  );
}

/**
 * The row's anchor: the fleet card's mast, small, carrying the charge it can
 * honestly draw.
 *
 * SUPERSEDED 2026-09-12: this said no live tower reports one, so the mast was
 * line art alone. A pack is read over Bluetooth now, so the cell fills from
 * `health.battery` and runs the card's own charging sweep while the current is
 * positive. An UNREACHABLE pack still draws nothing: its last charge is not
 * its charge.
 *
 * The signal bars moved from here into the Uplink column, where they sit under
 * their own header beside their own figure. The mast keeps the one reading it
 * draws better than any cell could.
 */
function MiniMast({ tower }: { tower: Tower }) {
  const battery = tower.health?.battery;
  /* A measured charge, or the seed's demo one — never either standing in for
     the other. `batteryPct` is driven upward 1% a second by `App.tsx`. */
  const pct = battery ? (battery.reachable ? battery.socPct : undefined) : tower.batteryPct;
  const charging = battery
    ? batteryFlow(battery) === "charging"
    : tower.solar !== undefined &&
      tower.batteryPct !== undefined &&
      solarState({ solar: tower.solar, batteryPct: tower.batteryPct }) === "charging";
  return (
    <span aria-hidden className="flex items-start">
      {/* The export's own 58×101 grid at 35×61, both layers pinned to it so the
          cell registers under the struts exactly as it does on the card. */}
      <span className="relative block h-[61px] w-[35px] shrink-0">
        {pct !== undefined && (
          <span data-battery className="absolute inset-0">
            <TowerBattery
              pct={pct}
              charging={charging}
              className="absolute inset-0 size-full"
            />
          </span>
        )}
        <img
          src="/icons/twr-mast.svg"
          alt=""
          width={35}
          height={61}
          className={`absolute inset-0 block h-[61px] w-[35px] ${tower.online ? "" : "opacity-40"}`}
        />
      </span>
    </span>
  );
}

function TowerRow({
  row,
  index,
  onOpen,
}: {
  row: Assessed;
  index: number;
  onOpen: () => void;
}) {
  const { tower, cells } = row;
  const status = STATUS[tower.status];
  return (
    /* The whole row opens the tower, but only the name is the button: the
       cells carry hover reasons, and a button wrapped round them would swallow
       the pointer they need. The button's click bubbles here, so keyboard and
       pointer land on the same action. */
    <motion.div
      role="row"
      data-tower={tower.id}
      layout="position"
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      /* Arrival is a short capped cascade; a re-sort is the plain tween, with
         no stagger, so a tower that changes state moves at once. */
      transition={{ default: { ...ENTER, delay: Math.min(index, 10) * 0.02 }, layout: ENTER }}
      onClick={onOpen}
      className={`group relative ${GRID} h-[72px] cursor-pointer items-center rounded-[10px] bg-panel pr-[18px] transition-colors hover:bg-card-lift`}
    >
      {/* A site that needs somebody carries its status down its leading edge,
          so a problem row reads as one before any cell is. Healthy rows carry
          none — a green edge on every row would be decoration. A DARK site's
          edge breathes, on the same heartbeat its red cells do: that row is the
          one to walk towards. */}
      {tower.status !== "online" && (
        <span
          aria-hidden
          data-edge={tower.status}
          className={`absolute inset-y-[12px] left-0 w-[2px] rounded-r-full ${status.dot} ${
            tower.status === "offline" ? "pulse-dot" : ""
          }`}
        />
      )}

      {/* Sticky, so on a phone the board scrolls sideways under the name
          rather than losing which tower a row is. `bg-inherit` follows the
          row's own fill through its hover. */}
      <div role="rowheader" className="sticky left-0 z-[1] flex h-full min-w-0 items-center rounded-l-[10px] bg-inherit pl-[16px] pr-[10px]">
        <button
          type="button"
          aria-label={`Open ${tower.id}, ${tower.site} — ${status.label}`}
          className="flex min-w-0 flex-col items-start gap-[4px] text-left"
        >
          <span className="flex min-w-0 max-w-full items-center gap-[8px]">
            <span className={`size-[7px] shrink-0 rounded-full ${status.dot}`} />
            {/* Titled, because the column truncates a long site name and the
                rest of it is the part that says which yard. */}
            <span
              title={tower.site}
              className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white"
            >
              {tower.site}
            </span>
          </span>
          {/* The status word and the id, quietly. Two sites can share a name;
              the id is what an engineer on the phone reads back. */}
          <span className="flex min-w-0 max-w-full items-center gap-[6px] pl-[15px] text-[0.75rem] leading-[15px] tracking-[0.12px]">
            <span className="shrink-0 text-sub">{status.label}</span>
            <span className="truncate text-muted">{tower.id}</span>
          </span>
        </button>
      </div>

      {COLUMNS.map(([id]) => (
        <CellView key={id} id={id} cell={cells[id]} row={row} />
      ))}

      <div
        role="cell"
        data-cell="mast"
        title={`${cells.uplink.hint} ${cells.power.hint}`}
        /* The mast and the way in, given room to be two things: the drawing
           is the row's identity and the arrow is its affordance, and at ten
           pixels apart they read as one crowded glyph. */
        className="flex h-full items-center justify-end gap-[18px] pl-[10px]"
      >
        <MiniMast tower={tower} />
        <img
          src="/icons/chevron-right.svg"
          alt=""
          width={16}
          height={16}
          className="shrink-0 opacity-40 transition-opacity group-hover:opacity-100"
        />
      </div>
    </motion.div>
  );
}

/** The fleet in three numbers, in the status grammar's own dots. */
function Tally({ towers }: { towers: Tower[] }) {
  const order: TowerStatus[] = ["online", "degraded", "offline"];
  return (
    <span className="flex items-center gap-[14px]">
      {order.map((s) => {
        const n = towers.filter((t) => t.status === s).length;
        return (
          <span
            key={s}
            className={`flex items-center gap-[6px] font-display text-[0.75rem] leading-[20px] tracking-[0.12px] tabular-nums ${
              n === 0 ? "text-white/35" : "text-sub"
            }`}
          >
            <span
              className={`size-[6px] rounded-full ${n === 0 ? "bg-white/20" : STATUS[s].dot}`}
            />
            {n} {STATUS[s].label}
          </span>
        );
      })}
    </span>
  );
}

export function TowersView({
  towers,
  feeds,
  alerts,
  alertFeed,
  seeded = false,
  loading = false,
  problem = null,
  onNavigate,
  onOpenTower,
}: {
  towers: Tower[];
  feeds: CameraFeed[];
  alerts: Alert[];
  /** Whether alerts come from a real source. Seed data does; a live fleet has
   *  no alert feed yet, and a count of zero there would claim a quiet site. */
  alertFeed: boolean;
  seeded?: boolean;
  loading?: boolean;
  problem?: string | null;
  onNavigate: (id: string) => void;
  onOpenTower: (towerId: string) => void;
}) {
  /* The uptime column's clock. The finest thing it shows is a minute. */
  const now = useNow();

  const rows = towers
    .map((t, i) =>
      assess(t, i, feedsForTower(feeds, t.id), alertsForTower(alerts, t.id), alertFeed, now),
    )
    .sort((a, b) => a.rank - b.rank || a.order - b.order);

  return (
    <div className="flex h-full w-full overflow-hidden bg-ink">
      <IconRail active="towers" onSelect={onNavigate} className="hidden lg:block" />

      <main aria-label="Towers" className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-[46px] shrink-0 items-center justify-between gap-[12px] border-b border-line pl-[16px] pr-[16px] lg:pr-[24px]">
          <h1 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
            TOWERS
          </h1>
          {towers.length > 0 && <Tally towers={towers} />}
        </header>

        {/* Scrolls both ways: down through the fleet, and sideways on a screen
            too narrow for eleven columns, with the header and the names held
            in place. */}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="min-w-[1260px] px-[16px] pb-[calc(24px+env(safe-area-inset-bottom))] lg:px-[24px]">
            {/* The badge, and nothing else. The board explains itself: every
                cell says what it is on hover, and the order is the point of the
                order — a line telling an operator how to read a status board is
                a note to the person who built it. Pinned left so it holds its
                place while the board scrolls sideways on a phone.

                It matters more now than it did: a seeded fleet fills every
                instrument on this board from fixtures, which is how the design
                is previewed lit. This badge is what keeps that from being
                mistaken for somebody's actual site. */}
            {seeded && (
              <div className="sticky left-0 w-fit pb-[6px] pt-[16px]">
                <p className="rounded-[6px] bg-detect/20 px-[10px] py-[6px] font-display text-[0.6875rem] tracking-[0.11px] text-detect">
                  SEEDED FLEET — NOT YOUR TOWERS
                </p>
              </div>
            )}

            {/* The same three empty walls the fleet panel tells apart: a wait,
                a failure to read, and a genuinely empty account. */}
            {!loading && problem && towers.length === 0 && (
              <div className="mt-[10px] flex max-w-[480px] flex-col gap-[6px] rounded-[8px] bg-critical/12 px-[14px] py-[12px]">
                <p className="text-[0.8125rem] leading-[20px] text-critical">Could not read your fleet.</p>
                <p className="text-[0.75rem] leading-[16px] text-muted">{problem}</p>
              </div>
            )}
            {loading && towers.length === 0 && (
              <p className="py-[10px] font-display text-[0.75rem] tracking-[0.12px] text-muted">
                LOADING FLEET…
              </p>
            )}
            {!loading && !problem && towers.length === 0 && (
              <p className="py-[10px] text-[0.8125rem] leading-[20px] text-muted">
                No towers on this account yet. Add one and it appears here.
              </p>
            )}

            {towers.length > 0 && (
              <div role="table" aria-label="Fleet status">
                <div
                  role="row"
                  className={`sticky top-0 z-[2] ${GRID} items-center bg-ink pr-[18px] pb-[8px] pt-[14px]`}
                >
                  <div role="columnheader" className="sticky left-0 bg-ink pl-[31px] font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase">
                    Tower
                  </div>
                  {COLUMNS.map(([id, label]) => (
                    <div
                      key={id}
                      role="columnheader"
                      className="px-[10px] font-display text-[0.6875rem] tracking-[0.11px] text-muted uppercase"
                    >
                      {label}
                    </div>
                  ))}
                  <div role="columnheader" className="sr-only">
                    Mast
                  </div>
                </div>

                <div className="flex flex-col gap-[6px]">
                  {rows.map((row, i) => (
                    <TowerRow
                      key={row.tower.id}
                      row={row}
                      index={i}
                      onOpen={() => onOpenTower(row.tower.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
