import { motion } from "motion/react";
import { alertsForTower, feedsForTower, solarState } from "@/lib/data";
import { uplinkReading } from "@/lib/api/map";
import { ENTER } from "@/lib/motion";
import type { Alert, CameraFeed, Tower, TowerStatus } from "@/lib/types";
import { ConnectedSince, RowReading, UplinkRow } from "./CameraSettingsPanel";
import { IconRail } from "./IconRail";
import { CABINET_CRITICAL_C, CABINET_WARN_C, STATUS } from "./TowerCard";
import { batteryTone } from "./TowerBattery";

/**
 * The towers board: every tower on the fleet, each as one status panel.
 *
 * The camera wall answers "what is happening"; this answers "is every site
 * all right", which is a different question and wants a different screen —
 * the fleet card beside the wall is a 129px index entry and was never going
 * to carry nine readings. One panel per tower, the same rows in the same order
 * on every one, so a fleet of twenty is scanned by colour down a column rather
 * than read card by card.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  EVERY ROW IS EITHER A READING OR A REASON — NEVER A GUESS
 * ══════════════════════════════════════════════════════════════════════
 *
 * A security fleet view is only worth looking at if every value on it can be
 * trusted, so each row is one of exactly two things:
 *
 *   a reading   something the tower reported, graded on this app's existing
 *               thresholds and nothing new — the status grammar, the uplink
 *               grades, the battery tiers, the cabinet temperatures. A reading
 *               carries a status colour because it has a status.
 *   pending     something this dashboard is not told yet. Drawn muted behind a
 *               hollow ring, NEVER given a colour, and it says WHY in the row —
 *               "Not reported yet" (the tower measures it, coordination does
 *               not pass it on), "No sensor fitted" (no hardware measures it),
 *               "No alert feed yet" (no backend serves it). The hover says the
 *               longer version.
 *
 * The rows already read the fields the pending ones are waiting for —
 * `health.door`, `cover`, `thermal`, `disk` — so each one lights up on its own
 * the day coordination passes the field through. Nothing here needs editing
 * then, which is the point of placing them now.
 *
 * ── AN OFFLINE TOWER HAS NO CURRENT READINGS ─────────────────────────
 *
 * Coordination keeps the last health block a tower sent, and serves it after
 * the link drops. Drawn as-is, a dark site would show "Great · −56 dBm" and a
 * closed door from whenever it was last heard — a stale reading in a current
 * row, in a healthy colour. So every row the tower itself reports says "Tower
 * offline" instead, muted. Cameras and connection keep their own rows, which
 * already say the link is down in the fault colour.
 *
 * Attaches no live video. The board is not the wall, so under the session
 * manager the wall's streams idle behind it and close if nobody comes back.
 */

/** A row's content, before it is drawn. */
interface Reading {
  value: string;
  tone?: string;
  pending?: boolean;
  hint?: string;
}

/* The three reasons a reading is not here, in the row's own words. Each is a
   different fact and sends an operator somewhere different, so they are
   never collapsed into one "N/A". */
const NOT_PASSED_ON = "Not reported yet";
const NO_SENSOR = "No sensor fitted";
const NO_FEED = "No alert feed yet";

/* The longer why, for the pointer that asks. */
const WHY = {
  door: "The tower reads its door switch, but coordination does not pass that reading to the dashboard yet.",
  cover: "The tower reads its cover sensor, but coordination does not pass that reading to the dashboard yet.",
  temperature:
    "The tower measures its own temperature, but coordination does not pass that reading to the dashboard yet.",
  storage:
    "The tower can measure its recordings disk, but that reading is not reported to the dashboard yet.",
  power:
    "No tower on this fleet carries a battery or charge sensor, so there is no reading to show.",
  alerts:
    "Coordination has no alert feed yet. A tower's own tamper and camera alerts stay on the tower for now.",
} as const;

/* Not pending — the reading exists — but not current either. Muted, because
   the fault it implies is already said in red two rows up. */
const OFFLINE: Reading = {
  value: "Tower offline",
  tone: "text-muted",
  hint: "The tower is not connected, so there is no current reading. The last one it sent is not shown as if it were.",
};

/* A camera the tower confirms is up. `delayed` and `frozen` are degraded
   pictures but still pictures; `connecting` and a never-reported camera are
   neither up nor down, and are counted as unconfirmed rather than guessed. */
const UP: ReadonlySet<CameraFeed["state"]> = new Set<CameraFeed["state"]>([
  "live",
  "recording",
  "delayed",
  "frozen",
]);

function camerasReading(feeds: CameraFeed[]): Reading {
  const total = feeds.length;
  /* A tower reporting no cameras is not a healthy one with nothing to show —
     `towerStatusFor` calls it degraded for the same reason. */
  if (total === 0) return { value: "None reported", tone: "text-warn" };
  const up = feeds.filter((f) => UP.has(f.state)).length;
  const down = feeds.filter((f) => f.state === "offline").length;
  const unconfirmed = total - up - down;
  return {
    value:
      `${up} / ${total} online` + (unconfirmed > 0 ? ` · ${unconfirmed} unconfirmed` : ""),
    /* Green only when every camera is confirmed up, red only when every one is
       confirmed down. Anything between — a dead camera, or one nobody has
       heard from — is amber, the tile grammar's word for a half-blind site. */
    tone: up === total ? "text-terra" : down === total ? "text-critical" : "text-warn",
  };
}

function doorReading(tower: Tower): Reading {
  const door = tower.health?.door;
  if (!door) return { value: NOT_PASSED_ON, pending: true, hint: WHY.door };
  return door.open
    ? { value: "Open", tone: "text-critical" }
    : { value: "Closed", tone: "text-terra" };
}

function coverReading(tower: Tower): Reading {
  const cover = tower.health?.cover;
  if (!cover) return { value: NOT_PASSED_ON, pending: true, hint: WHY.cover };
  return cover.exposed
    ? { value: "Exposed", tone: "text-critical" }
    : { value: "Intact", tone: "text-terra" };
}

function temperatureReading(tower: Tower): Reading {
  const thermal = tower.health?.thermal;
  if (thermal) {
    /* Reported, but with no number in it — the sensor itself is silent, which
       is a different absence from the reading never being passed on. */
    if (thermal.socC === null) {
      return {
        value: "Sensor not reporting",
        pending: true,
        hint: "The tower reported its temperature block with no reading in it.",
      };
    }
    /* The tower's own processor, graded by the tower's own verdict. The
       cabinet thresholds below are for the enclosure, not a chip that idles
       in the forties, so they are not applied to it. */
    return {
      value: `${Math.round(thermal.socC * 10) / 10}°C`,
      ...(thermal.state === "critical" ? { tone: "text-critical" } : {}),
      hint: "The tower's processor temperature, as the tower measured it.",
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
    };
  }
  return { value: NOT_PASSED_ON, pending: true, hint: WHY.temperature };
}

function storageReading(tower: Tower): Reading {
  /* The settings panel's own tier: amber from 90% used, and no invented red
     above it. */
  if (tower.storageUsedGb !== undefined && tower.storageTotalGb !== undefined) {
    const pct = (tower.storageUsedGb / Math.max(1, tower.storageTotalGb)) * 100;
    return {
      value: `${tower.storageUsedGb} / ${tower.storageTotalGb} GB used`,
      ...(pct >= 90 ? { tone: "text-warn" } : {}),
    };
  }
  const disk = tower.health?.disk;
  if (disk) {
    const used = Math.round(100 - disk.freePct);
    return { value: `${used}% used`, ...(used >= 90 ? { tone: "text-warn" } : {}) };
  }
  return { value: NOT_PASSED_ON, pending: true, hint: WHY.storage };
}

function powerReading(tower: Tower): Reading {
  if (tower.batteryPct === undefined) {
    return { value: NO_SENSOR, pending: true, hint: WHY.power };
  }
  const charging =
    tower.solar !== undefined &&
    solarState({ solar: tower.solar, batteryPct: tower.batteryPct }) === "charging";
  return {
    value: `${tower.batteryPct}%${charging ? " · charging" : ""}`,
    tone: batteryTone(tower.batteryPct),
  };
}

function alertsReading(alerts: Alert[], feed: boolean): Reading {
  if (!feed) return { value: NO_FEED, pending: true, hint: WHY.alerts };
  if (alerts.length === 0) return { value: "None" };
  const waiting = alerts.filter((a) => a.status === "triggered").length;
  /* Amber, the app's word for "this needs you" — the same claim the card's
     strip makes about an alert nobody has picked up. */
  return waiting > 0
    ? { value: `${waiting} unclaimed · ${alerts.length} total`, tone: "text-warn" }
    : { value: `${alerts.length} · all claimed` };
}

function Row({ label, reading, last = false }: { label: string; reading: Reading; last?: boolean }) {
  return (
    <RowReading
      dense
      label={label}
      value={reading.value}
      tone={reading.tone}
      pending={reading.pending ?? false}
      hint={reading.hint}
      last={last}
    />
  );
}

function TowerPanel({
  tower,
  feeds,
  alerts,
  alertFeed,
  index,
  onOpen,
}: {
  tower: Tower;
  feeds: CameraFeed[];
  alerts: Alert[];
  alertFeed: boolean;
  index: number;
  onOpen: () => void;
}) {
  const status = STATUS[tower.status];
  /* Tower-reported rows, held to the rule in the header: nothing the tower
     said is shown as current once it has stopped saying anything. A pending
     row keeps its own reason — it was never a reading to go stale. */
  const current = (r: Reading): Reading => (tower.online || r.pending ? r : OFFLINE);

  return (
    /* The whole panel opens the tower, but only the header is the button: the
       rows carry hover reasons, and a button wrapped round them would swallow
       the pointer they need. The header's click bubbles here, so keyboard and
       pointer land on the same action. */
    <motion.article
      data-tower={tower.id}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      /* A short cascade, capped, so a large fleet arrives as a sweep rather
         than a wait: the twentieth panel is not held back for half a second. */
      transition={{ ...ENTER, delay: Math.min(index, 10) * 0.025 }}
      onClick={onOpen}
      className="group flex cursor-pointer flex-col overflow-hidden rounded-[12px] bg-panel transition-colors hover:bg-card-lift"
    >
      <button
        type="button"
        aria-label={`Open ${tower.id}, ${tower.site} — ${status.label}`}
        className="flex h-[62px] w-full shrink-0 items-center justify-between gap-[12px] border-b border-row-line px-[16px] text-left"
      >
        {/* The fleet card's header, as it draws it: the name in Sora over the
            status word and its dot. The same three states, the same colours. */}
        <span className="flex min-w-0 flex-col gap-[4px]">
          <span className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white">
            {tower.site}
          </span>
          <span className="flex min-w-0 items-center gap-[4px]">
            <span className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-sub">
              {status.label}
            </span>
            <span className={`size-[4.711px] shrink-0 rounded-full ${status.dot}`} />
            {/* The id, quietly. Two sites can share a name; the id is what an
                engineer on the phone reads back. */}
            <span className="ml-[6px] truncate text-[0.75rem] leading-[15px] tracking-[0.12px] text-muted">
              {tower.id}
            </span>
          </span>
        </span>
        <img
          src="/icons/chevron-right.svg"
          alt=""
          width={16}
          height={16}
          className="shrink-0 opacity-50 transition-opacity group-hover:opacity-100"
        />
      </button>

      {/* Connectivity first, because it is what everything else rides on; then
          the cabinet; then what the site has raised. */}
      <div className="flex flex-col">
        <Row label="Cameras" reading={camerasReading(feeds)} />
        {tower.online ? (
          <UplinkRow dense reading={uplinkReading(tower.health?.uplink)} />
        ) : (
          <Row label="Uplink" reading={OFFLINE} />
        )}
        {tower.connectedAt === undefined && tower.online ? (
          /* Up, but the time it came up was not reported — a seeded tower,
             which has no such field. "Not connected" beside ONLINE would be
             two rows contradicting each other. */
          <Row
            label="Connected since"
            reading={{
              value: "Not reported",
              pending: true,
              hint: "This tower did not report when its link came up.",
            }}
          />
        ) : (
          <ConnectedSince dense at={tower.connectedAt} />
        )}
        <Row label="Door" reading={current(doorReading(tower))} />
        <Row label="Cover" reading={current(coverReading(tower))} />
        <Row label="Temperature" reading={current(temperatureReading(tower))} />
        <Row label="Storage" reading={current(storageReading(tower))} />
        <Row label="Power" reading={current(powerReading(tower))} />
        <Row label="Alerts" reading={alertsReading(alerts, alertFeed)} last />
      </div>
    </motion.article>
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

        <div className="min-h-0 flex-1 overflow-y-auto px-[16px] pb-[calc(24px+env(safe-area-inset-bottom))] pt-[16px] lg:px-[24px]">
          <div className="mb-[14px] flex flex-wrap items-center gap-x-[16px] gap-y-[8px]">
            {seeded && (
              <p className="rounded-[6px] bg-detect/20 px-[10px] py-[6px] font-display text-[0.6875rem] tracking-[0.11px] text-detect">
                SEEDED FLEET — NOT YOUR TOWERS
              </p>
            )}
            {/* The key to the one mark on this screen that is not a status. Said
                once here rather than on every panel. */}
            <p className="flex items-center gap-[6px] text-[0.75rem] leading-[16px] tracking-[0.12px] text-muted">
              <span aria-hidden className="size-[6px] shrink-0 rounded-full border border-muted" />
              Pending — not reported to this dashboard yet. Hover a row for why.
            </p>
          </div>

          {/* The same three empty walls the fleet panel tells apart: a wait, a
              failure to read, and a genuinely empty account. */}
          {!loading && problem && towers.length === 0 && (
            <div className="flex max-w-[480px] flex-col gap-[6px] rounded-[8px] bg-critical/12 px-[14px] py-[12px]">
              <p className="text-[0.8125rem] leading-[20px] text-critical">Could not read your fleet.</p>
              <p className="text-[0.75rem] leading-[16px] text-muted">{problem}</p>
            </div>
          )}
          {loading && towers.length === 0 && (
            <p className="py-[8px] font-display text-[0.75rem] tracking-[0.12px] text-muted">
              LOADING FLEET…
            </p>
          )}
          {!loading && !problem && towers.length === 0 && (
            <p className="py-[8px] text-[0.8125rem] leading-[20px] text-muted">
              No towers on this account yet. Add one and it appears here.
            </p>
          )}

          {/* Fills the width in 300px-minimum columns: one on a phone, two on a
              laptop, four or five on a wall monitor — a fleet of twenty is a
              few screens of scroll, never a squeeze. */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-[12px]">
            {towers.map((tower, i) => (
              <TowerPanel
                key={tower.id}
                tower={tower}
                feeds={feedsForTower(feeds, tower.id)}
                alerts={alertsForTower(alerts, tower.id)}
                alertFeed={alertFeed}
                index={i}
                onOpen={() => onOpenTower(tower.id)}
              />
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
