/**
 * The fleet, from coordination.
 *
 * Two calls, both §4.2.3, both through the SDK. No retry loop anywhere: an
 * absent tower is an ANSWER, NOT A WAIT — v1 lost eight days to spinning on
 * that, and a fleet screen that shows a spinner where a tower should be teaches
 * an operator nothing.
 */

import type { CameraFeed, Tower } from "@/lib/types";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";
import { toTower } from "./map";

export interface FleetSnapshot {
  towers: Tower[];
  feeds: CameraFeed[];
}

/**
 * A tower that is not this account's, or does not exist.
 *
 * ⚠ THE TWO ARE DELIBERATELY INDISTINGUISHABLE. §4.2.3 returns one `404
 * tower_unknown` for "no such tower" and "not yours" alike, so the endpoint
 * cannot be used to enumerate the fleet. A UI must therefore say
 * **"unavailable"** and must never say "does not exist" — the second is a
 * claim the server did not make, and making it turns a lookup into an oracle.
 *
 * This replaces `findTower`'s `?? TOWERS[0]`, which returned a *different
 * tower's* data for an id it could not find. Under real per-account scoping
 * that would have rendered another account's telemetry under the requested
 * tower's name.
 */
export class TowerUnavailableError extends Error {
  readonly deviceId: string;
  constructor(deviceId: string) {
    super(`${deviceId} is unavailable`);
    this.name = "TowerUnavailableError";
    this.deviceId = deviceId;
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  return status === 404 || code === "tower_unknown";
}

/**
 * Every tower this viewer may see — `GET /v1/viewer/towers`.
 *
 * ⚠ AN EMPTY LIST IS A VALID 200 AND MUST NOT BE TREATED AS AN ERROR. §4.2.3 is
 * explicit that a viewer with no authorized towers gets `{towers: []}`, never a
 * 403. A new account has an empty fleet, and that is a state to render, not a
 * failure to report.
 *
 * A 401/403 anywhere here means the session is gone, which is handled in one
 * place (`endSessionIfUnauthorized`) so the whole app drops to login in one
 * move. The error is still rethrown: the caller failed and has to stop loading.
 */
export async function listFleet(signal?: AbortSignal): Promise<FleetSnapshot> {
  let raw;
  try {
    raw = await getClient().listTowers(signal ? { signal } : {});
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }

  const now = Date.now();
  const towers: Tower[] = [];
  const feeds: CameraFeed[] = [];
  for (const info of raw) {
    const mapped = toTower(info, now);
    towers.push(mapped.tower);
    feeds.push(...mapped.feeds);
  }
  return { towers, feeds };
}

/**
 * One tower with its merged health — `GET /v1/viewer/towers/{device_id}`.
 *
 * `health` is coordination's merged view: the hello carries a full block and
 * `tower.state` pushes only what changed, and the merge is on the server so a
 * viewer never reassembles fleet state from fragments it did not receive.
 */
export async function getTower(
  deviceId: string,
  signal?: AbortSignal,
): Promise<FleetSnapshot> {
  let raw;
  try {
    raw = await getClient().getTower(deviceId, signal ? { signal } : {});
  } catch (err) {
    endSessionIfUnauthorized(err);
    if (isNotFound(err)) throw new TowerUnavailableError(deviceId);
    throw err;
  }
  const mapped = toTower(raw);
  return { towers: [mapped.tower], feeds: mapped.feeds };
}
