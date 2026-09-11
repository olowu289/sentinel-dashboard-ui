import { motion } from "motion/react";
import { alertsForTower, feedsForTower, solarState } from "@/lib/data";
import { uplinkReading, type UplinkReading } from "@/lib/api/map";
import { ENTER } from "@/lib/motion";
import { formatEventTime, formatUptime } from "@/lib/time";
import { storageHint, storageTone } from "@/lib/storage";
import { useNow } from "@/lib/useNow";
import type { Alert, CameraFeed, Tower, TowerStatus } from "@/lib/types";
import { IconRail } from "./IconRail";
import { CABINET_CRITICAL_C, CABINET_WARN_C, STATUS } from "./TowerCard";
import { batteryTone, TowerBattery } from "./TowerBattery";

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
 * ── PROBLEMS FIRST ──────────────────────────────────────────────────────
 *
 * Rows are ordered by how much they need somebody: offline, then degraded,
 * then any tower with a red cell, then amber, then the healthy ones. A single
 * dark site rises to the top of a fleet of fifty on its own. Ties keep fleet
 * order, so a quiet board does not reshuffle, and a tower that changes state
 * glides to its new place rather than jumping — the one motion on this screen,
 * and it is information: something here just got better or worse.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  EVERY CELL IS EITHER A READING OR A REASON — NEVER A GUESS
 * ══════════════════════════════════════════════════════════════════════
 *
 *   a reading   something the tower reported, graded on this app's existing
 *               thresholds and nothing new — the status grammar, the uplink
 *               grades, the battery tiers, the cabinet temperatures. It carries
 *               a status colour because it has a status, and its hover gives
 *               the full figure behind the compact one.
 *   pending     something this dashboard is not told yet: a quiet dash, never
 *               a colour, with the reason on hover — "Not reported yet" (the
 *               tower measures it, coordination does not pass it on), "No
 *               sensor fitted" (no hardware measures it), "No alert feed yet"
 *               (no backend serves it).
 *
 * The cells already read the fields the pending ones wait for —
 * `health.door`, `cover`, `thermal`, `disk` — so each lights up on its own the
 * day coordination passes the field through.
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
  /** A glyph after the value, as the uplink row carries. */
  glyph?: string;
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
  power: "no tower on this fleet carries a battery or charge sensor, so there is no reading to show.",
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
        value: `${GRADE_WORD[reading.grade]} · ${signed(reading.dbm)}`,
        tone:
          reading.grade === "poor"
            ? "text-critical"
            : reading.grade === "fair"
              ? "text-warn"
              : "text-terra",
        hint: `${GRADE_WORD[reading.grade]} — ${reading.dbm} dBm, as the tower measured it.`,
        /* The settings row's own rule: a glyph only where an export exists for
           that tier. There is no poor glyph, and one a tier above the truth
           would be worse than none. */
        ...(reading.grade === "great"
          ? { glyph: "/icons/wifi-good.svg" }
          : reading.grade === "fair"
            ? { glyph: "/icons/wifi-warn.svg" }
            : {}),
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
  };
}

function powerCell(tower: Tower): Cell {
  if (tower.batteryPct === undefined) return pending(NO_SENSOR, WHY.power);
  const charging =
    tower.solar !== undefined &&
    solarState({ solar: tower.solar, batteryPct: tower.batteryPct }) === "charging";
  return {
    value: `${tower.batteryPct}%`,
    tone: batteryTone(tower.batteryPct),
    hint: `Battery at ${tower.batteryPct}%${charging ? ", charging" : ""}.`,
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

/* One grid for the header and every row, so the columns line up down the
   whole board. The identity column takes the slack; the readings share the
   rest evenly and never drop below what "Great · −58" needs. */
const GRID = "grid grid-cols-[minmax(232px,1.8fr)_repeat(9,minmax(88px,1fr))_124px]";

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

function CellView({ id, cell }: { id: ColumnId; cell: Cell }) {
  return (
    <div
      role="cell"
      data-cell={id}
      data-pending={cell.pending || undefined}
      title={cell.hint}
      className="flex min-w-0 items-center gap-[6px] px-[10px]"
    >
      <span
        className={`truncate font-display text-[0.8125rem] leading-[18px] tracking-[0.13px] tabular-nums ${
          /* One colour class, never two — see VALUE_TYPE in the settings panel. */
          cell.empty ? "text-white/25" : (cell.tone ?? "text-white")
        }`}
      >
        {cell.value}
      </span>
      {cell.glyph && (
        <img src={cell.glyph} alt="" width={14} height={14} className="block shrink-0" />
      )}
      {/* A dash says nothing to a screen reader; the reason does. */}
      {cell.empty && <span className="sr-only">{cell.hint}</span>}
    </div>
  );
}

/**
 * Three bars from the REAL dBm, in the grade's colour, beside the mast.
 *
 * Lit by the same grades the Uplink cell prints, so the drawing and the words
 * cannot disagree. No reading lights nothing: three empty bars say "not
 * measured" as plainly as a dash. A wired tower draws none — there is no radio
 * to have a signal.
 */
function SignalBars({ online, reading }: { online: boolean; reading: UplinkReading }) {
  if (online && reading.kind === "wired") return null;
  const lit =
    online && reading.kind === "signal"
      ? reading.grade === "great"
        ? 3
        : reading.grade === "fair"
          ? 2
          : 1
      : 0;
  const tone =
    reading.kind === "signal"
      ? reading.grade === "great"
        ? "bg-terra"
        : reading.grade === "fair"
          ? "bg-warn"
          : "bg-critical"
      : "";
  return (
    <span data-bars={lit} aria-hidden className="flex h-[10px] items-end gap-[1.5px]">
      {[4, 7, 10].map((h, i) => (
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
 * The row's anchor: the fleet card's mast, small, carrying the two readings it
 * can honestly draw.
 *
 * The CELL renders only for a real charge — the fleet card's rule, and the
 * pending card's before it. No tower on a live fleet reports one, so today the
 * mast is line art alone, which is the truth: an empty or demo-filled cell
 * would be inventing a battery nobody has fitted.
 */
function MiniMast({ tower, uplink }: { tower: Tower; uplink: UplinkReading }) {
  const charging =
    tower.solar !== undefined &&
    tower.batteryPct !== undefined &&
    solarState({ solar: tower.solar, batteryPct: tower.batteryPct }) === "charging";
  return (
    <span aria-hidden className="flex items-start gap-[5px]">
      <SignalBars online={tower.online} reading={uplink} />
      {/* The export's own 58×101 grid at 35×61, both layers pinned to it so the
          cell registers under the struts exactly as it does on the card. */}
      <span className="relative block h-[61px] w-[35px] shrink-0">
        {tower.batteryPct !== undefined && (
          <span data-battery className="absolute inset-0">
            <TowerBattery
              pct={tower.batteryPct}
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
  const { tower, cells, uplink } = row;
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
          none — a green edge on every row would be decoration. */}
      {tower.status !== "online" && (
        <span
          aria-hidden
          className={`absolute inset-y-[12px] left-0 w-[2px] rounded-r-full ${status.dot}`}
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
        <CellView key={id} id={id} cell={cells[id]} />
      ))}

      <div
        role="cell"
        data-cell="mast"
        title={`${cells.uplink.hint} ${tower.batteryPct === undefined ? "No battery sensor fitted." : cells.power.hint}`}
        /* The mast and the way in, given room to be two things: the drawing
           is the row's identity and the arrow is its affordance, and at ten
           pixels apart they read as one crowded glyph. */
        className="flex h-full items-center justify-end gap-[18px] pl-[10px]"
      >
        <MiniMast tower={tower} uplink={uplink} />
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
          <div className="min-w-[1180px] px-[16px] pb-[calc(24px+env(safe-area-inset-bottom))] lg:px-[24px]">
            {/* The badge, and nothing else. The board explains itself: every
                cell says what it is on hover, and the order is the point of the
                order — a line telling an operator how to read a status board is
                a note to the person who built it. Pinned left so it holds its
                place while the board scrolls sideways on a phone. */}
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
