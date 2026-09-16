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
 *  HOLD-TO-MOVE IS CONTINUOUS, MADE PROMPT BY A TIGHT DEADMAN + FAST STOP.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tower runs ONE ContinuousMove while it is fed keepalives and stops when
 * they cease or an explicit Stop arrives. This is LATENCY-INDEPENDENT: "moves
 * while held, stops when released" holds whether commands take 10ms, 1s or 3s —
 * latency only shifts when start/stop happen. The old coast was not continuous
 * being wrong; it was the deadman being ~4s. Two changes fix it: the tower
 * deadman is now TIGHT (~1s, {@link PTZ_DEADMAN_MS}), so a lost keepalive stops
 * the head within ~1 interval; and release sends an explicit Stop that the tower
 * EXPEDITES (it preempts the queue). The keepalive ({@link PTZ_KEEPALIVE_MS},
 * ~0.4s, inside the deadman) only refreshes the deadman — it is NOT per-tick
 * movement, so nothing piles up at any latency. `client.ptzHold` owns that one
 * timer; this file holds none.
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
 * Purely press FEEL: a very short tap still starts the move before the release's
 * stop lands, so a quick nudge is never swallowed by a stop that beat it.
 */
export const MIN_PRESS_MS = 260;

/**
 * The manual pad's directional velocities, spread into `{ mode: "continuous",
 * ...axis }`. CONTINUOUS is right and latency-independent: the tower runs ONE
 * ContinuousMove while keepalives arrive and stops when they cease or an explicit
 * Stop lands — "moves while held, stops when released" holds at 10ms, 1s or 3s
 * alike; latency only shifts WHEN start/stop happen. The coast on release is
 * bounded by the tower's TIGHT deadman (~1s) plus the prompt Stop, not the old
 * ~4s. (A fixed-cadence relative-step scheme was tried and rejected: it piles up
 * at high latency and feels sluggish at low latency — this does neither.)
 *
 * ⚠ ALL THREE AXES ARE ALWAYS PRESENT. The tower's continuous branch requires
 * `pan`, `tilt` AND `zoom` together (a missing one is `invalid_request`), so an
 * idle axis is an explicit `0`. `+tilt` is up, `+pan` is right, `+zoom` is tele
 * (in), signed rates in -1…1.
 */
export const CONTINUOUS_AXES = {
  up: { pan: 0, tilt: 0.5, zoom: 0 },
  down: { pan: 0, tilt: -0.5, zoom: 0 },
  left: { pan: -0.5, tilt: 0, zoom: 0 },
  right: { pan: 0.5, tilt: 0, zoom: 0 },
  in: { pan: 0, tilt: 0, zoom: 0.5 },
  out: { pan: 0, tilt: 0, zoom: -0.5 },
} as const;

export type JogDirection = keyof typeof CONTINUOUS_AXES;

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
 * Start a held CONTINUOUS move, kept alive until `stop()`.
 *
 * Delegates to `client.ptzHold`: ONE ContinuousMove, then a keepalive every
 * {@link PTZ_KEEPALIVE_MS} that only REFRESHES the tower's deadman (no per-tick
 * movement, so nothing piles up at any latency). `stop()` sends an explicit Stop,
 * which the tower expedites (it preempts the queue), and the tight deadman backs
 * it up if the link drops. `action:"move"` → the unchanged grant-on-command
 * auth path (coordination attaches the grant and checks `ptz`; the tower
 * authorizes from it), so a view-only session is refused exactly as before.
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
 * Save the camera's CURRENT pan/tilt as its home.
 *
 * The tower reads the position itself, so nothing about where the camera is
 * pointing travels from here — there is no value a caller could get wrong, and
 * no way to aim a camera indirectly through a settings write.
 *
 * ⚠ THE ZOOM IS NOT SENT AND IS NOT THE CURRENT ONE. Home is always stored at
 * the widest view the lens has. An operator framing a shot at 12× and pressing
 * this means "point here", not "and come back at 12×", and the tower is the
 * only place that decides it.
 *
 * ⚠ IT CAN REFUSE, AND THE REFUSAL IS INFORMATION. A camera whose home comes
 * from a calibration bundle reads it from there whatever this writes, so the
 * tower answers `HOME_NOT_SETTABLE` rather than reporting a success that
 * changed nothing. That message is shown as-is — it tells the operator why,
 * and it is not a fault.
 *
 * Session-scoped like every other PTZ command: the session IS the
 * authorization, so this needs the live view open on that camera.
 */
export async function setHome(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
): Promise<PtzResult> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");

  try {
    return await getClient().ptzSetHome(ref, feed.index);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
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
    /* A refusal with a reason, not a fault. The tower is telling the operator
       that this camera's home is surveyed rather than set by hand — repeating
       its own words beats translating them into a failure. */
    if (code === "HOME_NOT_SETTABLE" || code === "home_not_settable") {
      return "HOME IS SET BY CALIBRATION ON THIS CAMERA";
    }
    if (code === "ptz_unavailable") return "PTZ UNAVAILABLE ON TOWER";
    if (code === "tower_offline") return "TOWER OFFLINE";
    if (code === "tower_timeout") return "TOWER DID NOT ANSWER";
    if (code === "rate_limited") return "PTZ RATE LIMITED";
    if (code === "camera_unknown") return "CAMERA NOT ON THIS TOWER";
    return `PTZ FAILED — ${code.toUpperCase()}`;
  }
  return "PTZ FAILED";
}
