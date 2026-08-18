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
  /** Uplink quality — the same three tiers the tile chips use. */
  link: LinkQuality;
}

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
  /** Chronological, oldest first. The detections that caused the alert come
   *  before it; what the platform did about it comes after. */
  timeline?: TimelineEvent[];
}
