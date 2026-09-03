import {
  isNormalPtzOutcome,
  type PtzMoveParams,
  type PtzResult,
  type PtzStopParams,
  type SessionRef,
} from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * Pointing a camera.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE KEEPALIVE IS THE SDK'S. DO NOT ADD A TIMER TO THIS FILE.
 * ══════════════════════════════════════════════════════════════════════
 *
 * A held jog must be refreshed more often than the daemon's 4-second deadman or
 * the mount stops itself, and over a WAN that budget includes round-trip time.
 * `client.ptzHold` owns that cadence at ~1.5s and nothing here does any timing
 * of its own.
 *
 * This is a SAFETY rule, not a tidiness one. A hand-rolled keepalive that drifts
 * or outlives its move is a camera that keeps turning after the operator let
 * go — and the deadman exists precisely because that is the failure worth
 * engineering against. Two timers racing to refresh one move is worse than one
 * timer owned by the layer that knows the protocol.
 *
 * ── STOP IS UNCONDITIONAL ──────────────────────────────────────────────
 *
 * `stop` is dispatched on the tower BEFORE any grant-scope check that could
 * refuse it, and is honoured even under an expired grant, because "refusing a
 * stop can only leave a camera moving; accepting one can only leave it still."
 *
 * Client-side that means: always send it, never gate it behind our own
 * permission check, and never skip it because the session looks expired. The
 * same rule talk-down's release already follows.
 */

/**
 * Minimum press before a hold is released.
 *
 * The SDK owns the keepalive cadence; this is purely the press FEEL, so a 60ms
 * tap does not fire move-then-stop back to back and queue a stop behind an
 * un-dispatched move.
 */
export const MIN_PRESS_MS = 260;

/**
 * The axes, exactly as the reference dashboard sends them.
 *
 * Always spread into `{ mode: "jog", ...axis }`. `jog` rather than `continuous`
 * for a recorded reason: the tower routes `continuous` to ONVIF and `jog` to
 * the camera's own CGI path, and the ONVIF route failed on this hardware with
 * `invalid_request` from camera clock skew. Pan and tilt worked throughout
 * because they were already jogging; zoom simply had never been asked.
 */
export const JOG_AXES = {
  up: { tilt: 0.5 },
  down: { tilt: -0.5 },
  left: { pan: -0.5 },
  right: { pan: 0.5 },
  in: { zoom: 0.5 },
  out: { zoom: -0.5 },
} as const;

export type JogDirection = keyof typeof JOG_AXES;

/** Raised when a command cannot even be attempted. Never a fake success. */
export class PtzUnavailableError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = "PtzUnavailableError";
    this.reason = reason;
  }
}

/** A held move. `stop()` must always fire on release. */
export interface PtzHold {
  stop: (params?: PtzStopParams) => Promise<PtzResult>;
}

/**
 * `feed.ptz` is CAPABILITY, not permission.
 *
 * Whether the hardware can move is in the projection; whether THIS viewer may
 * move it lives in the grant, which the viewer never receives. So a
 * `403 grant_permission` on the first command is the only way to find out, and
 * a tile drawing the pad is not a promise the pad will work. We check what we
 * can and let the server answer the rest.
 */
function requireCapability(feed: { ptz?: boolean; state: string }) {
  if (!feed.ptz) throw new PtzUnavailableError("CAMERA IS FIXED");
  if (feed.state !== "live" && feed.state !== "recording") {
    throw new PtzUnavailableError("CAMERA NOT LIVE");
  }
}

/**
 * PTZ is SESSION-SCOPED: the session IS the authorization, and the protocol
 * defines no PTZ endpoint outside one. No session, no command — there is no
 * other address to send it to.
 */
function requireSession(session: SessionRef | null | undefined): SessionRef {
  if (!session) throw new PtzUnavailableError("NO SESSION");
  return session;
}

/**
 * Start a held move, keeping it alive until `stop()`.
 *
 * Delegates entirely to `client.ptzHold` — see the header. Do not add a timer.
 */
export async function beginHold(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
  params: PtzMoveParams,
): Promise<PtzHold> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");

  try {
    const held = await getClient().ptzHold(ref, feed.index, params);
    return { stop: (p) => held.stop(p) };
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * Stop, and optionally recall HOME.
 *
 * ⚠ ALWAYS SENDS. No capability check, no session-freshness check, no early
 * return. See the header — the asymmetry between the two failure modes is the
 * whole argument.
 */
export async function stopOrHome(
  feed: { index?: number },
  session: SessionRef | null | undefined,
  home = false,
): Promise<PtzResult | null> {
  if (!session || feed.index === undefined) return null;
  return getClient().ptzStop(session, feed.index, { home });
}

/**
 * Turn a PTZ failure into a short line the tile can print, or `null` for
 * "say nothing".
 *
 * ⚠ `SUPERSEDED` IS A NORMAL OUTCOME. It is what a rapid tap or a direction
 * change produces — the daemon dropping an older move for a newer one — and the
 * protocol is explicit that it MUST NOT be surfaced as a fault. An operator
 * nudging a camera left then right would otherwise be told something broke
 * every time they changed their mind.
 *
 * With jog start/stop rather than a repeating tick it should be rare anyway,
 * but the guard stays: the reason it was rare is not a reason to report it.
 */
export function describePtzFailure(err: unknown): string | null {
  if (err instanceof PtzUnavailableError) return `PTZ UNAVAILABLE — ${err.reason}`;
  if (isNormalPtzOutcome(err)) return null;

  if (err && typeof err === "object" && "code" in err) {
    const code = String((err as { code: unknown }).code);
    /* Capability is not permission — this is the only way to learn the grant
       does not cover steering, so it gets its own words rather than a generic
       refusal. */
    if (code === "grant_permission" || code === "not_authorized") return "PTZ NOT PERMITTED";
    if (code === "ptz_unavailable") return "PTZ UNAVAILABLE ON TOWER";
    if (code === "tower_offline") return "TOWER OFFLINE";
    if (code === "tower_timeout") return "TOWER DID NOT ANSWER";
    if (code === "rate_limited") return "PTZ RATE LIMITED";
    if (code === "camera_unknown") return "CAMERA NOT ON THIS TOWER";
    return `PTZ FAILED — ${code.toUpperCase()}`;
  }
  return "PTZ FAILED";
}
