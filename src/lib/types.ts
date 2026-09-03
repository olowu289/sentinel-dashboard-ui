/**
 * Feed state grammar — `state • duration`, one chip per tile.
 *
 * A feed with no fresh frames decays to `frozen` rather than silently
 * continuing to render its last image. Absence of a live/recording chip
 * must always read as "not live".
 */
export type FeedState =
  | "recording"
  | "live"
  | "delayed"
  | "frozen"
  | "connecting"
  | "offline"
  /**
   * Nothing has reported this camera's liveness, or what was reported is too
   * old to stand behind. **NOT the same as live, and never drawn as good.**
   *
   * Coordination serves `"unknown"` directly rather than inferring — a tower
   * that has never connected reports every camera as unknown with a null
   * `as_of` — and the contract is explicit that a guessed `"live"` is the one
   * reading it forbids. It is also what a *stale* reading decays to: camera
   * status is last-known as of `as_of`, so a `"live"` under a down link with an
   * ageing stamp is true only in the past tense.
   *
   * `stateLabel` and `DOT` in `FeedChip` are exhaustive switches with no
   * `default`, and `tsconfig` sets `noFallthroughCasesInSwitch` — so adding a
   * state here fails the build until every site has handled it. That compile
   * error is the guard against a new state silently rendering as healthy. Do
   * not add a `default` case to make it go away.
   */
  | "unknown";

export type LinkQuality = "good" | "warn" | "bad";

/**
 * Tower health, one level up from `FeedState` and deliberately in the same
 * grammar: green is nominal, amber is degraded, red is a fault. A tower with a
 * dead camera or a poor uplink is still reachable, so it is not `offline` — and
 * calling it `online` would let a half-blind site read as healthy on the fleet
 * wall, which is the one thing the dashboard exists to prevent.
 */
export type TowerStatus = "online" | "degraded" | "offline";

/**
 * Solar array state, where one is reported at all.
 *
 * Its own name because `Tower.solar` is now optional — a real tower reports no
 * array — while the things that DO carry one (a seeded tower, a unit being
 * claimed) still require it. Writing `Tower["solar"]` at those sites would make
 * them optional too and lose the guarantee.
 */
export type SolarState = "charging" | "idle" | "fault";

/**
 * A tower carries exactly two cameras. This is the hardware, not a layout
 * choice, and the fleet wall is built on it: a band is one site's header over
 * one row of two tiles, which is what the design draws and why the wall caps
 * its columns at two. Change this and the wall stops being a row per site.
 */
export const CAMERAS_PER_TOWER = 2;

/**
 * Cabinet sensors, as coordination's merged `health` block reports them.
 *
 * Every member is optional because `tower.state` pushes **partial** health —
 * only what changed — so a consumer merges rather than replaces. Nothing in the
 * UI reads this yet; it is here so the mapper has somewhere honest to put what
 * the projection actually carries, instead of the battery and solar readings it
 * does not.
 */
export interface TowerHealthReading {
  door?: { open: boolean; since?: string };
  cover?: { exposed: boolean; since?: string };
  impact?: { lastDeltaMg: number | null; at?: string };
  /** SoC temperature — the processor's, **not** the cabinet's. */
  thermal?: { socC: number | null; state?: string };
  disk?: { freePct: number };
}

/**
 * A tower.
 *
 * ── WHY SO MANY FIELDS ARE OPTIONAL ────────────────────────────────────
 *
 * They were all required while every tower came from the seed, which could
 * invent whatever it liked. A real tower comes from coordination's §A.3
 * projection, and that carries `device_id`, `label`, `link`, `as_of`,
 * `cameras`, `sensors`, and a `health` block of door · cover · impact ·
 * thermal · disk. It carries **no battery, no solar array state, no cabinet
 * temperature, no storage figures, and no uplink *quality*** — those are not
 * withheld, they do not exist anywhere in the contract.
 *
 * So the choice was: invent them, or admit they are absent. Absence is
 * diagnostic in this app — the fleet card already draws a mast with no battery
 * cell for an unfinished tower, on the stated grounds that "drawing one would
 * be inventing a reading" — and that is exactly the right instinct here. A real
 * site showing 87% because the seed said so is the fake-green failure this
 * whole integration exists to refuse.
 *
 * `undefined` therefore means **not reported**, and every read site renders it
 * as such. A seeded tower still fills them all in, so the demo screens are
 * unchanged.
 */
export interface Tower {
  id: string;
  /** Site the tower watches, e.g. "WAREHOUSE: PARKING LOT". */
  site: string;
  status: TowerStatus;
  /**
   * Presence — coordination watches the WSS link itself, so unlike everything
   * below this is **always current**. It is the one signal that says whether
   * anything else can be trusted.
   */
  online: boolean;
  /**
   * When the camera statuses were last confirmed; `null` before the tower has
   * ever reported. **Not** when the request was served.
   *
   * This is what stops a stale reading being drawn as a current one, and the
   * SDK deliberately refuses to interpret it — the freshness threshold is
   * ours. See `STALE_AFTER_MS` in `lib/api/map.ts`.
   */
  asOf?: number | null;
  /** When the sensor block was last updated. Kept distinct from `asOf`. */
  healthAsOf?: number | null;
  /** What the cabinet sensors report. Nothing renders it yet. */
  health?: TowerHealthReading;

  /** Solar array state. Not in the projection — absent for a real tower. */
  solar?: SolarState;
  /** Battery charge, 0–100. Not in the projection — absent for a real tower. */
  batteryPct?: number;
  /** Cabinet temperature in °C. Not in the projection. Note `health.thermal` is
   *  the *SoC* temperature, which is a different reading and not a substitute. */
  tempC?: number;
  /**
   * Uplink *quality*, in three tiers.
   *
   * Absent for a real tower, and this one is worth being clear about:
   * coordination's `link` is **presence**, not quality, and it lands on
   * `online` above. Mapping `up` to `"good"` would be inventing a grade the
   * tower never gave.
   */
  link?: LinkQuality;
  /** Where it stands, as the settings panel prints it. Not in the projection. */
  location?: string;
  /** Hardware model, for the About group. Not in the projection. */
  model?: string;
  ipAddress?: string;
  /** What it falls back to when the primary uplink drops. Not in the projection. */
  backupConnection?: string;
  /** Chassis serial, printed on the cabinet label beside the QR. Not in the
   *  projection — the platform id is, and that is what the radio uses. */
  serial?: string;
  /** Running firmware. `agent_version` is the nearest real field. */
  firmware?: string;
  /** On-tower recording, in GB. Not in the projection; `health.disk.freePct` is
   *  a percentage of an unknown total and is not the same reading. */
  storageUsedGb?: number;
  storageTotalGb?: number;
}

/* `UnclaimedUnit` and `PendingTower` are gone.
 *
 * They modelled a fabricated unit and a half-finished local claim — the shapes
 * the old setup flow invented because there was no server to ask. Registration
 * is real now: the only two inputs are a pairing code and a label, the pending
 * state is a `Claim` that lives on the server (`lib/api/claim.ts`), and a tower
 * appears when it has enrolled rather than when this app decides to draw one. */

/**
 * Somebody the fleet is watching for.
 *
 * `reason` and `expiresAt` are required, and that is the whole design position.
 * A watchlist entry with no stated reason is an accusation with no author, and
 * it is the only thing that lets a second operator judge a match they did not
 * create. A watchlist that never expires becomes permanent surveillance of
 * people whose reason lapsed months ago. Both are cheap now and effectively
 * impossible to add later, because by then there are entries without them.
 */
export interface Person {
  id: string;
  name: string;
  /** The reference face. One frame, front-on — what the matcher compares to. */
  photo: string;
  /** Why this person is being watched for. Shown wherever a match is. */
  reason: string;
  /** Who put them on the list. Enrolling somebody is an act with a name on it. */
  addedBy: string;
  addedAt: number;
  /** Epoch ms. Past it, the entry stops matching and moves to `EXPIRED` — it is
   *  never deleted, because a list that quietly forgets is unauditable. */
  expiresAt: number;
  /** Why watching was stopped early, and by whom.
   *
   *  Absent means the entry simply ran out its term — which is the ordinary
   *  ending and needs no explanation. Present means somebody decided, and the
   *  decision is as auditable a fact as the reason they were added for. The
   *  access tools that get this right capture a reason at *removal*, not only
   *  at creation: "why is this person on the list" and "why did we take them
   *  off" are different questions and an entry that can only answer the first
   *  is half a record. */
  stoppedReason?: string;
  stoppedBy?: string;
  stoppedAt?: number;
}

/**
 * A region of a camera's own view that detection is confined to.
 *
 * Normalised 0–1 against the frame, never pixels: the same zone has to hold
 * when the tile is 380px on a fleet wall and 1280px in a takeover, and a zone
 * that drifts with the layout is a zone that stops covering the gate.
 */
export interface ActivityZone {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eufy caps it at three, and three is right — a fourth region is usually the
 *  whole frame drawn the long way round. */
export const MAX_ZONES = 3;

/**
 * A tower's camera settings — every camera on it, not one.
 *
 * The frame puts the gear in the tower's own bar rather than on a tile, which
 * is the argument for the scope: these are the tower's cameras, and a control
 * that lived on a picture would imply the other picture had its own.
 *
 * These are not preferences. Sensitivity, detection type and zones decide what
 * reaches the alert feed, which makes them operational — so every change is
 * stamped with who made it. "Why did we stop getting alerts from the gas yard"
 * has to have an answer, and it is usually somebody's afternoon adjustment.
 */
export interface CameraSettings {
  /** What is worth waking somebody for. */
  detect: "people" | "people-vehicles" | "all";
  sensitivity: "low" | "standard" | "high";
  /** Keyed by feed id, and the one thing here that cannot be tower-wide. A
   *  zone is a shape drawn on one camera's own view; the second camera points
   *  somewhere else entirely, so the same rectangle over its frame would fence
   *  off a piece of ground nobody chose. Empty means the whole frame. */
  zones: Record<string, ActivityZone[]>;
  nightVision: "auto" | "infrared" | "off";
  /** What goes out over the uplink. Separate from what is written to the
   *  tower's own buffer — the link is the constraint on one and the storage is
   *  the constraint on the other, so they are not one setting. */
  quality: "1080p30" | "1080p15" | "720p30";
  recordingQuality: "4k" | "1080p" | "720p";
  /** The master switch in the panel's header card. Off means the tower keeps
   *  streaming but raises nothing. */
  monitoring: boolean;
  micOn: boolean;
  /** 0–100. */
  speakerVolume: number;
  /** Continuous costs storage and uplink; on-detection costs the seconds
   *  before the trigger. Neither is free, which is why both say so. */
  recording: "detection" | "continuous";
  /** Days of footage kept on the tower before it rolls over. */
  retentionDays: 7 | 30 | 90;
  /** What the camera is allowed to spend. These towers are off-grid and the
   *  panel is the only thing refilling the battery, so this is the setting a
   *  dark winter week is actually managed with. */
  powerMode: "performance" | "balanced" | "saver";
  changedBy?: string;
  changedAt?: number;
}

export const DEFAULT_CAMERA_SETTINGS: CameraSettings = {
  /* People and vehicles rather than all motion. A yard at night is full of
     moving things that are not incidents, and a feed that cries wolf is one an
     operator learns to ignore — which is the only failure mode that matters. */
  detect: "people-vehicles",
  sensitivity: "standard",
  zones: {},
  nightVision: "auto",
  recordingQuality: "4k",
  monitoring: true,
  quality: "1080p15",
  micOn: true,
  speakerVolume: 70,
  recording: "detection",
  retentionDays: 30,
  powerMode: "balanced",
};

export interface CameraFeed {
  /** Stable key. For a real camera this is `${towerId}:${index}`. */
  id: string;
  /** Owning tower. The fleet wall mixes cameras from several towers, so a tile
   *  has to be able to say which site it is looking at. */
  towerId: string;
  /**
   * THE PROTOCOL ADDRESS. 1-based, unique within a tower, and **the only camera
   * name a session, a PTZ command or a grant may carry**.
   *
   * A session request body is `{device_id, camera}` and nothing else — that is
   * a security boundary rather than a convention, because a vocabulary that
   * could name something *inside* a camera is one that can ask for more. So
   * `id` is for React and lookups; this is for the wire. Never send `id`, and
   * never send a presentation grouping.
   */
  index?: number;
  /** Zone label shown in the tile chip, e.g. "GAS YARD". */
  name: string;
  state: FeedState;
  /** Round-trip latency in ms. Undefined when there is no link. */
  latencyMs?: number;
  /** Elapsed seconds in the current state — the `• duration` half of the chip. */
  elapsedSec?: number;
  poster: string;
  /** Looping clip standing in for the live stream. Falls back to `poster`. */
  video?: string;
  /** Raw transport error, surfaced verbatim when known. */
  error?: string;
  /**
   * Tiles with PTZ hardware get the joystick; fixed cameras do not.
   *
   * ⚠ CAPABILITY, NOT PERMISSION — populated from the projection's
   * `ptz_capable`. Whether *this viewer* may steer lives in the grant, which
   * the viewer never receives, so the only way to learn that is to issue a
   * command and catch `403 grant_permission`. A tile drawing the pad is not a
   * promise that the pad will work.
   */
  ptz?: boolean;
  /** Optical class, straight from the projection. */
  lens?: "ptz" | "fixed";
  /**
   * When this camera's `state` was last confirmed, from the tower's `as_of`.
   * `null` means it has never reported.
   *
   * Replaces the hardcoded "Last seen 14:02" the offline fallback used to
   * print — which was a literal, on the one line whose whole job is to say how
   * old the bad news is.
   */
  lastSeenAt?: number | null;
}

export type AlertKind = "alert" | "vehicle" | "person" | "speaker" | "fault";

export type AlertStatus = "triggered" | "acknowledged" | "resolved";

export interface AlertAttachment {
  kind: "clip" | "audio";
  title: string;
  thumbnail: string;
  /** Runtime in seconds. Shown on the thumbnail so the cost of watching is
   *  known before the click — a 30s clip and a 4-minute one are different
   *  decisions mid-triage. */
  durationSec?: number;
  /** What the tower wrote it at, as printed in the player. A property of the
   *  file rather than of the tower's current setting — `recordingQuality` can
   *  be changed after the fact and this cannot. Absent means the buffer did
   *  not report it, and the player shows nothing rather than a guess. */
  quality?: string;
}

/**
 * One step in an alert's own sequence.
 *
 * `at` is epoch ms like everywhere else — never a pre-formatted string, so the
 * detail view can compute elapsed time between steps. That delta is the number
 * an investigator actually reads: "vehicle, then a person 15 seconds later" is
 * the finding; two identical wall-clock stamps are not.
 */
export interface TimelineEvent {
  at: number;
  /** Picks the 28px badge, from the same exported asset set the alert rows
   *  use — a step and the alert it belongs to are the same kind of thing and
   *  must not be drawn from two different icon vocabularies. */
  icon: AlertKind;
  title: string;
  /** Evidence captured at this step, rendered as a clip card indented beneath
   *  it. The clip belongs to the moment, not to the alert as a whole. */
  attachment?: AlertAttachment;
}

export interface Alert {
  id: string;
  /** Owning tower — the fleet card counts what each site has raised. */
  towerId: string;
  kind: AlertKind;
  title: string;
  /** Epoch ms. Every displayed time is derived from this, never stored as a
   *  pre-formatted string — the filter has to be able to compare them. */
  at: number;
  status: AlertStatus;
  source: string;
  zone: string;
  /** Cameras covering the event. Plural because a zone can be overlooked by
   *  more than one, and an operator pulling footage needs all of them. */
  cameras?: string[];
  attachment?: AlertAttachment;
  /** Present once a responder claims the alert. */
  acknowledgedBy?: string;
  /** Model certainty, 0–100. Only detections carry one; a hardware fault or an
   *  operator action is not a prediction and must not be shown as if it were. */
  confidence?: number;
  /** Set when this detection matched somebody on the watchlist. A match is a
   *  *possibility*, never an identification — `confidence` travels with it and
   *  the copy says "possible match" everywhere it is shown. */
  matchedPersonId?: string;
  /** The operator said this is not the person. Keeps the detection, drops the
   *  identity — the camera did see somebody. */
  matchRejected?: boolean;
  /** Chronological, oldest first. The detections that caused the alert come
   *  before it; what the platform did about it comes after. */
  timeline?: TimelineEvent[];
}
