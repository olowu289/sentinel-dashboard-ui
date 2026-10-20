import {
  isNormalPtzOutcome,
  isPtzYielded,
  type PtzControl,
  type PtzMoveParams,
  type PtzResult,
  type PtzStopParams,
  type SessionRef,
  type SweepStatus,
} from "@kallon/sentry-sdk";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";

/**
 * Pointing a camera.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  HOLD-TO-MOVE IS CONTINUOUS. RELEASE STOPS VIA AN EXPLICIT STOP, NOT THE DEADMAN.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tower runs ONE ContinuousMove while it is fed keepalives. This is LATENCY-
 * INDEPENDENT: "moves while held, stops when released" holds whether commands
 * take 10ms, 1s or 3s — latency only shifts when start/stop happen.
 *
 * TWO SEPARATE ROLES, decoupled after a false-stop bug:
 *   - RELEASE is bounded by the EXPLICIT Stop, which the tower expedites (it
 *     preempts the queue): release → Stop → head stops in ~1 link-latency,
 *     independent of the deadman.
 *   - The DEADMAN ({@link PTZ_DEADMAN_MS}) is ONLY a link-death safety net — tab
 *     closed, link dropped. It is GENEROUS (~3s) on purpose: a tight 1s deadman
 *     false-fired mid-hold at ~1s latency because keepalives sent every 0.5s
 *     ARRIVE ~1s apart under jitter, so it must exceed the worst-case keepalive-
 *     arrival gap over the link.
 * The keepalive ({@link PTZ_KEEPALIVE_MS}, ~0.6s) sits WELL inside the deadman
 * and only refreshes it — NOT per-tick movement, so nothing piles up at any
 * latency. `client.ptzHold` owns that one timer; this file holds none.
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
 * How long a direction must be held before it is a HOLD rather than a CLICK.
 *
 * Re-exported from the SDK so a component reaches for one PTZ module and not
 * two. The threshold itself is a gesture reading and not on the wire -- the
 * device knows nothing about it.
 *
 * ⚠ THIS SUPERSEDES {@link MIN_PRESS_MS} FOR CLICKS. That constant delayed
 * the STOP so a brief tap still moved; the distance was then whatever velocity
 * ran for whatever the round trip allowed, which is the unrepeatable nudge a
 * step replaces. MIN_PRESS_MS is kept for the one thing it is still honest
 * about -- press feel on a hold that is ending -- and is no longer what decides
 * how far a tap moves a camera.
 */
export { PTZ_CLICK_MS } from "@kallon/sentry-sdk";

/**
 * How long a PTZ error stays on a tile before it clears itself.
 *
 * A PTZ fault is usually transient -- a REQUEST_TIMEOUT on one command, a
 * SUPERSEDED from a fast direction change -- and a line that persists on a
 * camera which is moving perfectly well is worse than no line at all: an
 * operator cannot tell a stale message from a live one. Long enough to read,
 * short enough that it cannot outlive the condition.
 */
export const PTZ_ERROR_LINGER_MS = 4000;

/**
 * How often a tile asks the device for sweep progress.
 *
 * Only ever while a sweep is actually in play -- an idle camera asks nothing.
 * Every poll is a real round trip to a real tower over a possibly-metered
 * uplink, so this is as slow as a progress bar can be without looking stuck:
 * a 90-second circle advances about 2% a tick.
 */
export const SWEEP_POLL_MS = 2000;

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

/** The directions a CLICK can step. Pan and tilt only -- zoom stays a hold. */
export type StepDirection = "up" | "down" | "left" | "right";

/**
 * A step's signed multipliers, DERIVED from the hold's velocities.
 *
 * Only the sign is taken, because a step's `pan`/`tilt` are multipliers of the
 * camera's configured `step_deg` rather than velocities -- the magnitude comes
 * from the device. Derived rather than written out so the two cannot disagree
 * about which way "left" is: a click and a hold on the same button must move
 * the camera the same way, and a second hand-written table is how that drifts.
 */
export const STEP_AXES: Record<StepDirection, { pan: number; tilt: number }> = {
  up: { pan: 0, tilt: Math.sign(CONTINUOUS_AXES.up.tilt) },
  down: { pan: 0, tilt: Math.sign(CONTINUOUS_AXES.down.tilt) },
  left: { pan: Math.sign(CONTINUOUS_AXES.left.pan), tilt: 0 },
  right: { pan: Math.sign(CONTINUOUS_AXES.right.pan), tilt: 0 },
};

/** True for a direction a click can step; zoom is held, never stepped. */
export function isStepDirection(dir: JogDirection): dir is StepDirection {
  return dir === "up" || dir === "down" || dir === "left" || dir === "right";
}

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
 * ONE FIXED NUDGE -- what a CLICK on a direction sends.
 *
 * A step is a distance the camera executes and stops itself, so the same click
 * moves the same amount every time and a slow link moves it no further. That is
 * the whole reason a click is no longer "hold briefly, then stop": that moved
 * whatever velocity ran for whatever the round trip allowed, which on a bad
 * link was a long way.
 *
 * ⚠ THE REPLY CAN BE A REFUSAL THAT IS NOT AN ERROR. A step into the tilt
 * limit answers `done: false` with a `reason`; nothing throws. Callers show
 * {@link describeStepRefusal} rather than treating a 200 as movement.
 *
 * ⚠ A STEP PAUSES A RUNNING SWEEP, at the device. The reply carries the new
 * sweep block, so a caller can reflect the pause without polling.
 */
export async function step(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
  dir: StepDirection,
): Promise<PtzResult> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");

  try {
    return await getClient().ptzStep(ref, feed.index, STEP_AXES[dir]);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * The line for a step the camera declined, or `null` when it moved.
 *
 * Separate from {@link describePtzFailure} because this is not a failure: the
 * command arrived, the camera answered, and the answer was "not that way". The
 * device writes `reason` for a person, so it is shown as-is.
 */
/**
 * WHO IS DRIVING THIS CAMERA, when it is not you.
 *
 * `null` for every case where the controls are live -- nobody holding it, you
 * holding it, a deployment that does not arbitrate control at all -- so the
 * caller can render this and gate on nothing else.
 *
 * ⚠ THE SITE'S NAME IS THE SERVER'S, rendered verbatim. Sites know each
 * other by the names an admin gave them and by nothing else, so there is
 * nothing to translate and nothing to abbreviate.
 */
export function describeControl(control: PtzControl | null | undefined): string | null {
  if (!control || control.yours) return null;
  const who = control.holder_site?.trim();
  /* A hold with no name is still a hold: refusing to say anything would leave
     a dead pad with no explanation, which is the one outcome worse than a
     vague one. */
  return who ? `CONTROLLED BY ${who.toUpperCase()}` : "CONTROLLED BY ANOTHER SITE";
}

export function describeStepRefusal(res: PtzResult): string | null {
  const result = res.result as { done?: unknown; reason?: unknown } | undefined;
  if (!result || result.done !== false) return null;
  const reason = typeof result.reason === "string" ? result.reason : null;
  return reason ?? "THE CAMERA DID NOT MOVE";
}

/**
 * Release a tilt/zoom hold taken DURING a sweep, leaving the sweep turning.
 *
 * ⚠ THIS IS THE ONE EASY WAY TO BREAK A SWEEP FROM THE UI. Letting go of a
 * tilt button and pressing the sweep's Stop are the same `stop` on the wire,
 * and during a sweep they must do opposite things. Only this app knows which
 * button it was, so the flag is sent explicitly: forget it and every tilt
 * release ends the operator's circle.
 *
 * Unconditional like every stop -- see the header.
 */
export async function stopKeepingSweep(
  feed: { index?: number },
  session: SessionRef | null | undefined,
): Promise<PtzResult | null> {
  if (!session || feed.index === undefined) return null;
  const params: PtzStopParams = { keep_sweep: true };
  return getClient().ptzStop(session, feed.index, params);
}

/* ---------------------------------------------------------------- *
 * 360 SWEEP
 *
 * The sweep runs ON THE DEVICE. These are one-shot commands, not a loop: a
 * closed tab, a navigation or a dropped link must not stall a circle that is
 * already turning, which is exactly why none of this is a timer in the browser.
 * ---------------------------------------------------------------- */

/** Begin a circle from where the camera is now. A second start is not an error. */
export async function sweepStart(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
): Promise<SweepStatus> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");
  try {
    return await getClient().sweepStart(ref, feed.index);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/** Suspend, keeping the place. The device resumes it itself after its quiet period. */
export async function sweepPause(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
): Promise<SweepStatus> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");
  try {
    return await getClient().sweepPause(ref, feed.index);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/** Carry on from a pause. */
export async function sweepResume(
  feed: { index?: number; ptz?: boolean; state: string },
  session: SessionRef | null | undefined,
): Promise<SweepStatus> {
  requireCapability(feed);
  const ref = requireSession(session);
  if (feed.index === undefined) throw new PtzUnavailableError("NO CAMERA ADDRESS");
  try {
    return await getClient().sweepResume(ref, feed.index);
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
}

/**
 * End the sweep where the camera is.
 *
 * ⚠ NEVER GATED, for the same reason a stop is not: refusing to stop a
 * turning camera can only leave it turning. No capability check, no session
 * freshness check, no early return beyond having somewhere to send it.
 */
export async function sweepStop(
  feed: { index?: number },
  session: SessionRef | null | undefined,
): Promise<SweepStatus | null> {
  if (!session || feed.index === undefined) return null;
  return getClient().sweepStop(session, feed.index);
}

/**
 * Read the sweep without changing it.
 *
 * ⚠ DOES NOT END THE SESSION ON A 403, unlike the movement calls. `status`
 * needs the `ptz` permission, so a view-only session is refused here as a
 * matter of what it may READ -- that is a permission fact about this one
 * reading, not a dead session, and signing an operator out of a working video
 * wall because a sweep poll was refused would be the wrong trade entirely. The
 * caller renders nothing instead.
 */
export async function readSweep(
  feed: { index?: number },
  session: SessionRef | null | undefined,
): Promise<SweepStatus | null> {
  if (!session || feed.index === undefined) return null;
  return getClient().sweepStatus(session, feed.index);
}

/**
 * The camera's current pan/tilt/zoom, and whatever else `status` carries.
 *
 * ⚠ THE ONE PTZ READ, and it is here so there is not a second one. The
 * tilt-limit watcher and the zoom readout both used to call
 * `getClient().ptzStatus` directly, which put two call sites outside every
 * policy this file exists to hold -- and they are the two that run on a timer,
 * so they are the ones that most need to agree about what a refusal means.
 *
 * Like {@link readSweep} this does NOT end the session on a 403: both callers
 * poll while a button is held, and a refused read must not sign anybody out.
 * They already treat a throw as "no reading", which is the honest rendering.
 */
export async function readStatus(
  session: SessionRef | null | undefined,
  camera: number | undefined,
): Promise<PtzResult | null> {
  if (!session || camera === undefined) return null;
  return getClient().ptzStatus(session, camera);
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
  /* A YIELD IS NOT A FAILURE, and it must not be drawn as one. The camera's
     own site is driving it, which is the system working: the tile already says
     who has it, in a line that lasts as long as the hold rather than the four
     seconds a fault chip lasts. Two messages for one event would read as two
     problems. See {@link describeControl}. */
  if (isPtzYielded(err)) return null;

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
