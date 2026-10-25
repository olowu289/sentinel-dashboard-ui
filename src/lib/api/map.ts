/**
 * Coordination's projected inventory → this app's own types.
 *
 * One direction, one place. Every derivation, default and grouping happens here
 * and never in a component, so there is exactly one answer to "is this camera
 * live" and no screen can quietly disagree with another.
 *
 * ── THE TWO SHAPES, ONE HOP APART ──────────────────────────────────────
 *
 * A tower's `tower.hello` is its full business card, media-plane internals
 * included. What coordination serves a viewer is that card *narrowed* — §A.6
 * strips `path`, `whep_path` and `boot_id`, and the SDK's validator rejects a
 * document carrying any of them. This module consumes the projection and only
 * the projection; if a field is not in `TowerInfo`, it does not exist here.
 */

import { parsePatrol } from "@/lib/patrol";
import type { CameraInfo, TowerDetail, TowerInfo } from "@kallon/sentry-sdk";
import type {
  CameraFeed,
  FeedState,
  Tower,
  TowerHealthReading,
  TowerStatus,
} from "@/lib/types";

/**
 * How old a camera-status reading may be before it stops standing for the
 * present.
 *
 * The SDK surfaces `as_of` faithfully and **deliberately refuses to interpret
 * it** — applying a freshness threshold is this app's call, not the transport's.
 * So this number is a judgement, and it is ours to defend.
 *
 * 90 seconds: a tower reports on state change plus a periodic hello, so a
 * healthy site refreshes well inside a minute. Much tighter and an ordinary gap
 * between reports would flicker every tile to NO REPORT; much looser and a
 * tower that died two minutes ago still reads live, which is the whole failure
 * this exists to catch.
 */
export const STALE_AFTER_MS = 90_000;

/**
 * Where the grade boundaries sit, in dBm.
 *
 * ⚠ THE INTERPRETATION LIVES HERE, and that is the whole architecture of this
 * reading. The tower measures an RSSI and says nothing about whether it is
 * good; coordination passes the number through untouched. Both refuse to grade
 * for the same reason: a verdict decided upstream would freeze one opinion of
 * "acceptable" into every tower in the fleet and need a firmware change to
 * revise. It is the same split as `as_of` — the server reports WHEN, this file
 * decides what counts as stale.
 *
 * RSSI is negative and closer to zero is stronger, so these read backwards
 * until you hold that in mind: -55 is better than -80.
 */
export const UPLINK_GREAT_DBM = -60;
export const UPLINK_FAIR_DBM = -75;

/** What the Uplink row should say, and never a grade without a dBm behind it. */
export type UplinkReading =
  /** A real measurement. `dbm` is what was measured; `grade` is our reading. */
  | { kind: "signal"; grade: "great" | "fair" | "poor"; dbm: number }
  /** Wired. No RSSI exists, and inventing a poor grade would libel good kit. */
  | { kind: "wired" }
  /** A radio that is up and joined to nothing. Not wired, and not a signal. */
  | { kind: "unassociated" }
  /** Nothing was measured. Distinct from the tower being unreachable. */
  | { kind: "unmeasured" };

/**
 * Grade the uplink, or honestly decline to.
 *
 * Every path that is not a real dBm returns a NON-GRADE. That is the rule this
 * function exists to enforce in one place: the row it feeds can draw Great,
 * Fair or Poor only when it was handed a number, so there is no arrangement of
 * missing data that produces a grade.
 */
export function uplinkReading(
  uplink: TowerHealthReading["uplink"] | undefined,
): UplinkReading {
  if (!uplink) return { kind: "unmeasured" };
  const dbm = uplink.signalDbm;
  if (typeof dbm === "number" && Number.isFinite(dbm)) {
    /* Closer to zero is stronger. */
    const grade =
      dbm > UPLINK_GREAT_DBM ? "great" : dbm >= UPLINK_FAIR_DBM ? "fair" : "poor";
    return { kind: "signal", grade, dbm };
  }
  if (uplink.type === "ethernet") return { kind: "wired" };
  if (uplink.associated === false) return { kind: "unassociated" };
  return { kind: "unmeasured" };
}

/** Why a feed is not live, in words a fallback can print. */
export type FeedStateReason =
  /** The tower reported this camera down. */
  | "feed_lost"
  /** The link is down, so nothing behind it can be confirmed. */
  | "tower_offline"
  /** The tower has never reported this camera. */
  | "never_reported"
  /** It was reported live, but too long ago to stand behind. */
  | "stale";

/** `${deviceId}:${index}` — a React key and a lookup handle. NEVER an address. */
export function feedId(deviceId: string, index: number): string {
  return `${deviceId}:${index}`;
}

function parseStamp(at: string | null | undefined): number | null {
  if (!at) return null;
  const ms = Date.parse(at);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A camera's state, resolved in priority order. **The order is the logic.**
 *
 * 1. A down link outranks everything. For an offline tower the projection holds
 *    LAST REPORTED values, and drawing those as current is precisely what
 *    `as_of` exists to prevent — §3.3 makes the link the presence signal, so if
 *    it is down we cannot speak for the cameras behind it.
 * 2. `unknown` is served directly and is valid. It is never promoted.
 * 3. A reported `down` is a real answer about a real camera.
 * 4. Only then is `live` believed — and only if the reading is fresh. A `live`
 *    with an ageing `as_of` is true in the past tense, which on a monitoring
 *    wall is worse than saying nothing.
 *
 * Reordering any of these turns a stale or unconfirmed camera green.
 */
export function feedStateFor(
  link: string,
  reported: CameraInfo["status"],
  asOf: number | null,
  now: number = Date.now(),
): { state: FeedState; reason?: FeedStateReason } {
  if (link !== "up") return { state: "offline", reason: "tower_offline" };
  if (reported === "unknown") return { state: "unknown", reason: "never_reported" };
  if (reported === "down") return { state: "offline", reason: "feed_lost" };
  if (asOf === null) return { state: "unknown", reason: "never_reported" };
  if (now - asOf > STALE_AFTER_MS) return { state: "unknown", reason: "stale" };
  return { state: "live" };
}

/**
 * The tower's own verdict, rolled up from its cameras.
 *
 * `degraded` means the link is up but something behind it is not. With
 * per-camera status served directly, a dead camera *is* the signal — there is
 * no health block to interpret and no threshold to invent.
 *
 * Note the honest limit: the projection carries a sensor block, but nothing in
 * it contributes here, so a thermally distressed tower with healthy cameras
 * reads `online`. That is what the projection tells us, not an oversight.
 */
export function towerStatusFor(link: string, feeds: CameraFeed[]): TowerStatus {
  if (link !== "up") return "offline";
  /* No cameras at all is not health. A tower that has never sent an inventory
     reports an empty list, and calling that online would be the guess the
     contract forbids. `degraded` is the closest honest word this app has —
     its own type comment says a half-blind site must not read healthy. */
  if (feeds.length === 0) return "degraded";
  if (feeds.some((f) => f.state === "offline")) return "degraded";
  if (feeds.every((f) => f.state === "unknown")) return "degraded";
  return "online";
}

function toHealth(raw: TowerDetail["health"] | undefined): TowerHealthReading | undefined {
  if (!raw) return undefined;
  const out: TowerHealthReading = {};
  if (raw.door) out.door = { open: raw.door.open, ...(raw.door.since ? { since: raw.door.since } : {}) };
  if (raw.cover) {
    out.cover = { exposed: raw.cover.exposed, ...(raw.cover.since ? { since: raw.cover.since } : {}) };
  }
  if (raw.impact) {
    out.impact = {
      lastDeltaMg: raw.impact.last_delta_mg,
      ...(raw.impact.at ? { at: raw.impact.at } : {}),
    };
  }
  if (raw.thermal) {
    out.thermal = {
      socC: raw.thermal.soc_c,
      ...(raw.thermal.state ? { state: raw.thermal.state } : {}),
    };
  }
  if (raw.disk) out.disk = { freePct: raw.disk.free_pct };
  /* The battery. `reachable` always crosses; the readings only when the tower
     actually reached the pack, which is what the SDK's shape already
     guarantees. Spread conditionally rather than defaulted, for the usual
     reason: an unreachable pack must render as unreachable, never as 0%. */
  if (raw.battery) {
    out.battery = {
      reachable: raw.battery.reachable,
      ...(raw.battery.as_of ? { asOf: raw.battery.as_of } : {}),
      ...(typeof raw.battery.soc_pct === "number"
        ? { socPct: raw.battery.soc_pct }
        : {}),
      ...(typeof raw.battery.voltage_v === "number"
        ? { voltageV: raw.battery.voltage_v }
        : {}),
      ...(typeof raw.battery.current_a === "number"
        ? { currentA: raw.battery.current_a }
        : {}),
      ...(typeof raw.battery.temp_c === "number"
        ? { tempC: raw.battery.temp_c }
        : {}),
    };
  }
  /* Each member carried only when present. A wired uplink has no `signalDbm`
     and must not gain one here — the whole point of the three shapes is that
     they stay distinguishable all the way to the row that draws them. */
  if (raw.uplink) {
    out.uplink = {
      ...(typeof raw.uplink.signal_dbm === "number"
        ? { signalDbm: raw.uplink.signal_dbm }
        : {}),
      ...(raw.uplink.type ? { type: raw.uplink.type } : {}),
      ...(typeof raw.uplink.associated === "boolean"
        ? { associated: raw.uplink.associated }
        : {}),
    };
  }
  /* THE HUB'S VIEW OF THE RADIO, including which sector this mast is on.
     `sector` is spread conditionally like everything else here, for the
     sharpest version of the usual reason: every absence is real. A mast with no
     letter is a mast nobody could place — no sector radios, no station reader,
     a silent radio, or a mast mid-roam claimed by two — and a default would put
     it confidently on sector A. */
  if (raw.radio) {
    out.radio = {
      associated: raw.radio.associated === true,
      ...(typeof raw.radio.node_id === "number" ? { nodeId: raw.radio.node_id } : {}),
      ...(raw.radio.state ? { state: raw.radio.state } : {}),
      ...(typeof raw.radio.last_seen_sec === "number"
        ? { lastSeenSec: raw.radio.last_seen_sec }
        : {}),
      ...(typeof raw.radio.quality === "number" ? { quality: raw.radio.quality } : {}),
      ...(raw.radio.sector ? { sector: raw.radio.sector } : {}),
      /* HOW STRONG THE LINK ACTUALLY IS, read off the Ubiquiti radio over
         read-only SNMP, and WHICH END READ IT. Conditional like the rest, and
         this one is the sharpest case on the whole block: the Radio link row
         grades this number into Good/Fair/Weak, so a substituted 0 would grade
         as a perfect link on a site that measured nothing at all. */
      ...(typeof raw.radio.signal_dbm === "number"
        ? { signalDbm: raw.radio.signal_dbm }
        : {}),
      ...(raw.radio.signal_from ? { signalFrom: raw.radio.signal_from } : {}),
    };
  }
  /* THE HUB'S OWN SECTORS. `associations` says whether the tower list means
     anything, so it crosses unconditionally and falls back to "unknown": a
     sector block that arrived without it must not read as observed. The lists
     cross only when they WERE observed, so "absent" survives the mapping
     instead of becoming an empty array that reads as "no masts here". */
  if (Array.isArray(raw.sectors) && raw.sectors.length > 0) {
    out.sectors = raw.sectors.map((s) => {
      const observed = s.associations === "observed";
      return {
        id: s.id,
        state: s.state,
        associations: observed ? "observed" : "unknown",
        ...(typeof s.azimuth === "number" ? { azimuth: s.azimuth } : {}),
        ...(s.ssid ? { ssid: s.ssid } : {}),
        ...(s.mgmt ? { mgmt: s.mgmt } : {}),
        ...(typeof s.signal_dbm === "number" ? { signalDbm: s.signal_dbm } : {}),
        ...(observed && Array.isArray(s.towers) ? { towers: s.towers } : {}),
        ...(observed && Array.isArray(s.stations) ? { stations: s.stations } : {}),
        /* PER-MAST SIGNALS, where the station reader used SNMP. Absent on the
           older password path, which scrapes MACs off an HTTP page and has no
           signal to give -- so an absent list is "not measured" and a mast in
           `towers` with no entry here is associated and unmeasured. */
        ...(Array.isArray(s.tower_signals) && s.tower_signals.length > 0
          ? {
              towerSignals: s.tower_signals.map((t) => ({
                deviceId: t.device_id,
                signalDbm: t.signal_dbm,
              })),
            }
          : {}),
      };
    });
  }
  /* WHERE THE FOOTAGE GOES, AND WHAT SURVIVES THERE. Read-only on every
     screen: the window is set by Kallon, and the drop-down that used to offer
     7/30/90 days wrote to local state and nothing else.

     `effectiveDays` and `boundBy` cross beside `retainDays` because the three
     are one fact. A screen printing the asked-for window alone would tell a
     customer they have thirty days while the sweep deletes at twelve. */
  if (raw.recording) {
    out.recording = {
      ...(raw.recording.mode ? { mode: raw.recording.mode } : {}),
      ...(raw.recording.stream ? { stream: raw.recording.stream } : {}),
      ...(typeof raw.recording.retain_days === "number"
        ? { retainDays: raw.recording.retain_days }
        : {}),
      ...(typeof raw.recording.effective_days === "number"
        ? { effectiveDays: raw.recording.effective_days }
        : {}),
      ...(raw.recording.bound_by ? { boundBy: raw.recording.bound_by } : {}),
    };
  }
  return out;
}

/** What the Sector column should say, and never a letter without an observation. */
export type SectorReading =
  /** The hub's radios were asked, and this mast was on one of them. */
  | { kind: "on"; sector: string }
  /**
   * The hub holds a radio link to this mast but cannot say which sector.
   *
   * ONE WORD FOR FOUR CAUSES, deliberately: no station reader configured, a
   * radio that would not answer one, a radio of this mast's own that has not
   * answered ARP, or a mast mid-roam claimed by two sectors at once. They
   * differ in the journal and in `/run/kallon/sectors.json`; to somebody
   * reading a fleet board they are one fact, which is that the board does not
   * know.
   */
  | { kind: "unobserved" }
  /** No radio link at all: a wired mast, or a tower on WireGuard. */
  | { kind: "none" };

/**
 * Which sector radio a mast is on, or honestly decline to say.
 *
 * The rule this exists to enforce in one place: the column it feeds may print a
 * LETTER only when the hub observed the association. There is no arrangement of
 * missing data that produces a sector, because a mast shown confidently on the
 * wrong antenna sends a technician up the wrong mast.
 */
export function sectorReading(
  radio: TowerHealthReading["radio"] | undefined,
): SectorReading {
  if (!radio) return { kind: "none" };
  const sector = radio.sector;
  if (typeof sector === "string" && /^[A-Za-z]$/.test(sector.trim())) {
    return { kind: "on", sector: sector.trim().toUpperCase() };
  }
  return { kind: "unobserved" };
}

/**
 * One camera.
 *
 * `poster` is deliberately empty. The seed's posters are photographs shipped in
 * `public/media/`; a real camera's picture is the WebRTC stream and nothing
 * else. Handing a real tile a stock still would put a picture on screen that
 * came from a different site — the most convincing possible lie, and precisely
 * the one the media seam refuses.
 */
export function toFeed(
  deviceId: string,
  cam: CameraInfo,
  link: string,
  asOf: number | null,
  now?: number,
): CameraFeed {
  const { state } = feedStateFor(link, cam.status, asOf, now);

  /* ⚠ READ THROUGH A NARROWING, BECAUSE THE VENDORED SDK DOES NOT DECLARE IT.
     Coordination adds `label` to each camera in the projection (the account's
     own name for it, merged per request), and `@kallon/sentry-sdk`'s
     `CameraInfo` is a version behind. Narrowing here rather than editing
     `vendor/sentry-sdk`: the SDK is a separate repo, and a hand-edited vendored
     type is a change that vanishes on the next SDK update with nothing to say
     it was ever needed.
     TODO(sdk): add `label?: string` to CameraInfo and delete this cast. */
  const rawLabel = (cam as { label?: unknown }).label;
  const named = typeof rawLabel === "string" && rawLabel.trim() ? rawLabel : "";

  return {
    id: feedId(deviceId, cam.index),
    towerId: deviceId,
    index: cam.index,
    /* ⚠ THE NOTE HERE USED TO SAY THE PROJECTION CARRIES NO LABEL. It does
       now: a zone name like "GAS YARD" is an account-layer nicety, and that is
       exactly where it has been put — `camera_labels` on the DC, keyed on
       (account, device, index), merged into the projection per request.

       So the customer's own name wins, and `CAMERA 2` is the FALLBACK rather
       than the only answer. Falling back rather than showing an empty string
       matters on a monitoring surface: a tile with no name is a tile nobody can
       quote on the radio, which is the whole reason that note argued for the
       index in the first place.

       Named here, in the mapper, and therefore named EVERYWHERE — the wall, the
       tower view, the playback picker, the download filename. Doing it in the
       settings screen alone would have produced a camera called "North gate" in
       one place and "CAMERA 2" in the five others. */
    name: named || `CAMERA ${cam.index}`,
    /* The RAW label, kept apart from `name`. The settings screen has to tell
       "named North gate" from "not named, so showing CAMERA 2" — it puts the
       first in the input and the second in the placeholder — and `name` alone
       cannot answer that. */
    ...(named ? { label: named } : {}),
    state,
    lens: cam.lens,
    // Capability, not permission. See the note on `CameraFeed.ptz`.
    ptz: cam.ptz_capable === true,
    /* Straight through, default first as the tower ordered them. Omitted
       entirely when the tower advertised none, so "no list" stays
       distinguishable from "a list with one entry" — the first offers no
       choice, the second says this camera really does have exactly one. */
    ...(cam.profiles && cam.profiles.length > 0
      ? { profiles: cam.profiles.map((p) => ({
          id: p.id,
          default: p.default,
          ...(p.resolution
            ? { resolution: { width: p.resolution.width, height: p.resolution.height } }
            : {}),
        })) }
      : {}),
    /* Straight through, and ABSENT when the camera carried none -- a fixed
       dome has no round to sweep and must not gain a switch here. */
    ...(() => {
      const patrol = parsePatrol((cam as { patrol?: unknown }).patrol);
      return patrol ? { patrol } : {};
    })(),
    poster: "",
    lastSeenAt: asOf,
    /* No `latencyMs`. Coordination reports none, and `FeedChip` omits the
       segment when it is absent — which is right. The seed's latency walk was
       a simulation; inventing a number here would make it a lie. */
  };
}

/** One tower, with its cameras. */
export function toTower(raw: TowerInfo | TowerDetail, now?: number): {
  tower: Tower;
  feeds: CameraFeed[];
} {
  const asOf = parseStamp(raw.as_of);
  const feeds = raw.cameras.map((c) => toFeed(raw.device_id, c, raw.link, asOf, now));
  const detail = raw as Partial<TowerDetail>;

  const tower: Tower = {
    id: raw.device_id,
    /* Served, never derived from the id. Parsing a slug for a name couples
       display to an identifier format and breaks the day one does not match the
       pattern. The fallback is a last resort, not a scheme. */
    site: raw.label || raw.device_id,
    status: towerStatusFor(raw.link, feeds),
    online: raw.link === "up",
    asOf,
    healthAsOf: parseStamp(detail.health_as_of),
    ...(toHealth(detail.health) ? { health: toHealth(detail.health) } : {}),
    /* STORAGE, in the units a person reads. `health.disk.freePct` already
       crosses in `toHealth`; these are the same disk stated the other way, and
       both are carried because neither answers the other's question — see
       `DiskHealth` in the SDK. Absent from an agent that reports only the
       percentage, which is why they are spread conditionally rather than
       defaulted to zero: a tower with no figures must read "Not reported",
       never "0 of 0 GB". */
    ...(detail.health?.disk?.used_gb !== undefined
      ? { storageUsedGb: detail.health.disk.used_gb }
      : {}),
    ...(detail.health?.disk?.total_gb !== undefined
      ? { storageTotalGb: detail.health.disk.total_gb }
      : {}),
    /* `agent_version` is the nearest real thing to a firmware string, and the
       projection marks it optional.

       SUPERSEDED 2026-09-12 in part: this listed STORAGE among the things
       "ABSENT FROM THE CONTRACT and therefore absent here". It is in the
       contract now — §3.1's `disk` block carries free_pct and, additively, the
       gigabytes — and it is mapped just above.

       SUPERSEDED AGAIN, for MODEL and SERIAL. Both are on the wire now, from
       the tower's own device.env, and the board's own serial comes with them.
       Until then the About screen showed a FIXTURE — every tower on every
       fleet was a "Terra Sentry XL" — which is the thing this comment was
       written to prevent and the thing that happened anyway, because the
       fixture was already there when the field was not.

       The rest of the list stands: battery, solar, cabinet temperature,
       location, IP and backup connection are still absent, and still must not
       be invented here. See the note on `Tower`. */
    ...(raw.agent_version ? { firmware: raw.agent_version } : {}),
    ...(raw.ota_channel ? { firmwareChannel: raw.ota_channel } : {}),
    ...(raw.model ? { model: raw.model } : {}),
    /* TOWER OR HUB, from the box's own word. The one field the settings
       screen's Network group branches on -- see `Tower.kind`. */
    ...(raw.kind === "hub" ? ({ kind: "hub" } as const) : {}),
    ...(raw.serial ? { serial: raw.serial } : {}),
    /* The JETSON's own, read off the board at every start rather than written
       in config. Kept beside the unit serial and never merged with it: a
       swapped board changes this one and not the other, and that difference is
       the answer to "is this still the same board inside the same unit". */
    ...(raw.board_serial ? { boardSerial: raw.board_serial } : {}),
    /* Real, and one of the very few things on the settings panel's Network
       section that is. Omitted rather than nulled when the tower is offline —
       `Tower.connectedAt` documents why absence is the honest answer. */
    ...(() => {
      const at = raw.connected_at ? Date.parse(raw.connected_at) : NaN;
      return Number.isFinite(at) ? { connectedAt: at } : {};
    })(),
  };

  return { tower, feeds };
}
