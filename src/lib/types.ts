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
  | "offline";

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
 * A tower carries exactly two cameras. This is the hardware, not a layout
 * choice, and the fleet wall is built on it: a band is one site's header over
 * one row of two tiles, which is what the design draws and why the wall caps
 * its columns at two. Change this and the wall stops being a row per site.
 */
export const CAMERAS_PER_TOWER = 2;

export interface Tower {
  id: string;
  /** Site the tower watches, e.g. "WAREHOUSE: PARKING LOT". */
  site: string;
  status: TowerStatus;
  /** Solar array state. These towers are off-grid; the panel is the only thing
   *  that refills the battery, so its health is a first-class signal. */
  solar: "charging" | "idle" | "fault";
  /** Battery charge, 0–100. */
  batteryPct: number;
  /** Cabinet temperature in °C. These are sealed enclosures in the sun with a
   *  battery inside; heat is what kills them, so it is a reading in its own
   *  right rather than weather. */
  tempC: number;
  /** Uplink quality — the same three tiers the tile chips use. */
  link: LinkQuality;
  /** Where it stands, as the settings panel prints it. One region, one zone —
   *  see the note at the top of `time.ts`; the offset is part of the string
   *  because it never varies. */
  location: string;
  /** Hardware model, for the About group. */
  model: string;
  ipAddress: string;
  /** What it falls back to when the primary uplink drops. */
  backupConnection: string;
  /** Chassis serial, printed on the cabinet label beside the QR. The id is
   *  assigned by the platform and is what gets spoken on the radio; this is
   *  what is physically stamped on the box, and it is the only handle an
   *  installer standing at the tower has. */
  serial: string;
  /** Running firmware. Read-only here; updating one is a field operation. */
  firmware: string;
  /** On-tower recording, in GB. Off-grid sites buffer locally and ship on the
   *  uplink, so this fills and empties on its own — it is a reading, not a
   *  quota the operator manages. */
  storageUsedGb: number;
  storageTotalGb: number;
}

/**
 * A unit that exists in the field and has not been claimed by anyone yet.
 *
 * Everything a tower knows about itself — charge, temperature, uplink, how many
 * cameras it has — comes off the hardware at claim time. The setup flow asks a
 * human for exactly two things it cannot read: what to call the site, and what
 * to call each camera. Anything else on this screen would be a field the
 * operator can get wrong about their own equipment.
 */
export interface UnclaimedUnit {
  towerId: string;
  serial: string;
  /** Printed under the QR inside the cabinet door. */
  pairingCode: string;
  solar: Tower["solar"];
  batteryPct: number;
  tempC: number;
  link: LinkQuality;
  firmware: string;
  storageTotalGb: number;
  model: string;
  ipAddress: string;
  backupConnection: string;
  /** Always `CAMERAS_PER_TOWER` of them. `poster` absent means the camera is
   *  wired but not returning frames — it is still named during setup, because a
   *  dead camera you cannot label is a dead camera you cannot report. */
  cameras: { id: string; poster?: string }[];
}

/**
 * A claim that has landed but has not been finished.
 *
 * The unit is already this operator's from the moment the phone scans — that is
 * what claiming means — so dropping it because they navigated away would strand
 * a tower nobody can see and nobody else can claim. It waits in the panel with
 * whatever naming was done, and setup resumes where it stopped.
 */
export interface PendingTower {
  unit: UnclaimedUnit;
  /** Whatever the operator had typed. Empty until they reach the site step. */
  site: string;
  names: Record<string, string>;
}

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
  id: string;
  /** Owning tower. The fleet wall mixes cameras from several towers, so a tile
   *  has to be able to say which site it is looking at. */
  towerId: string;
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
  /** Tiles with PTZ hardware get the joystick; fixed cameras do not. */
  ptz?: boolean;
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
