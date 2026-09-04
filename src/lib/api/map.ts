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
  return out;
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

  return {
    id: feedId(deviceId, cam.index),
    towerId: deviceId,
    index: cam.index,
    /* The projection carries no per-camera label — a zone name like "GAS YARD"
       is an account-layer nicety the contract does not have — so the honest
       label is the address the operator can actually quote on the radio. */
    name: `CAMERA ${cam.index}`,
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
    /* `agent_version` is the nearest real thing to a firmware string, and the
       projection marks it optional. Everything else the settings panel wants —
       battery, solar, cabinet temperature, uplink quality, storage, location,
       model, IP, backup connection, serial — is ABSENT FROM THE CONTRACT and
       therefore absent here. See the note on `Tower`. */
    ...(raw.agent_version ? { firmware: raw.agent_version } : {}),
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
