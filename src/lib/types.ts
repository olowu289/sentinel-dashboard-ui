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

export interface CameraFeed {
  id: string;
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
}

export interface Alert {
  id: string;
  kind: AlertKind;
  title: string;
  /** Epoch ms. Every displayed time is derived from this, never stored as a
   *  pre-formatted string — the filter has to be able to compare them. */
  at: number;
  status: AlertStatus;
  source: string;
  zone: string;
  attachment?: AlertAttachment;
  /** Present once a responder claims the alert. */
  acknowledgedBy?: string;
}
