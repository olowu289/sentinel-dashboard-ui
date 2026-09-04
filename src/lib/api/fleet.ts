/**
 * The fleet, from coordination.
 *
 * Three calls, all §4.2.3, all through the SDK. No retry loop anywhere: an
 * absent tower is an ANSWER, NOT A WAIT — v1 lost eight days to spinning on
 * that, and a fleet screen that shows a spinner where a tower should be teaches
 * an operator nothing.
 */

import type { CameraFeed, Tower } from "@/lib/types";
import { endSessionIfUnauthorized } from "./auth";
import { getClient } from "./client";
import { toTower } from "./map";
import { withDemoCabinetReadings } from "./demoCabinet";

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

/**
 * The server refused the label.
 *
 * `422 invalid_label` — empty, over-long, or carrying control characters. Its
 * message says WHICH, and that message is shown verbatim: the rule lives in
 * `set_label` and only the server knows it, so paraphrasing here would be a
 * second copy of a policy free to drift from the one actually enforced.
 *
 * Distinct from `TowerUnavailableError` because the remedy is opposite. A
 * refused label is the operator's to fix, in the field they are already in. An
 * unavailable tower is not their doing and nothing they retype will help.
 */
export class LabelRejectedError extends Error {
  constructor(detail?: string) {
    super(detail?.trim() || "That name was refused.");
    this.name = "LabelRejectedError";
  }
}

function isNotFound(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  return status === 404 || code === "tower_unknown";
}

/** `422 invalid_label` — the label itself, not the request or the response. */
function isInvalidLabel(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const status = (err as { status?: unknown }).status;
  const code = (err as { code?: unknown }).code;
  return code === "invalid_label" || status === 422;
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
    /* ⚠ DEMO READINGS. `toTower` leaves battery, solar, temperature, uplink
       quality and storage ABSENT, because the projection carries none of them.
       This puts fabricated ones back so the populated UI can be seen in
       development. See `demoCabinet.ts` — it must be switched off, made real,
       or marked on screen before this ships. */
    towers.push(withDemoCabinetReadings(mapped.tower));
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
  // Same demo readings as the list, so the two views cannot disagree.
  return { towers: [withDemoCabinetReadings(mapped.tower)], feeds: mapped.feeds };
}

/**
 * Rename one tower — `PATCH /v1/viewer/towers/{device_id}`.
 *
 * ⚠ THIS REPLACES A LOCAL-ONLY RENAME. Until the route landed, the edit wrote
 * to `towers` in the shell and was gone on the next load — an operator renamed
 * a site, came back, and found the old name. That was the whole bug, and the
 * reason nothing here is optimistic: the value that lands is the one the SERVER
 * returns, so the name can never show a change the registry did not make.
 *
 * The label is **account-layer metadata** and touches nothing else: the tower
 * does not know its own label, `device_id` stays the identity everywhere, and
 * there is no envelope and no WSS relay. An OFFLINE TOWER CAN STILL BE RENAMED,
 * which is worth knowing — it is the one write on the whole fleet screen that
 * does not depend on the site being reachable.
 *
 * ⚠ THE LABEL GOES UP VERBATIM. No trim, no case-folding, no emptiness check.
 * `set_label` is the only validator, its `422` says why it refused, and a
 * client-side rule would be a second copy of that policy — free to drift, and
 * silently mangling what somebody typed instead of telling them it was wrong.
 *
 * Returns the updated **projection**, not an acknowledgement, so the caller
 * re-renders from the server's answer rather than the string it just sent.
 */
export async function renameTower(
  deviceId: string,
  label: string,
  signal?: AbortSignal,
): Promise<FleetSnapshot> {
  let raw;
  try {
    raw = await getClient().renameTower(deviceId, label, signal ? { signal } : {});
  } catch (err) {
    endSessionIfUnauthorized(err);
    /* Order matters: 404 before 422. Both are "the server said no", but only
       one of them is about the text that was typed. */
    if (isNotFound(err)) throw new TowerUnavailableError(deviceId);
    if (isInvalidLabel(err)) {
      throw new LabelRejectedError(
        err instanceof Error ? err.message : undefined,
      );
    }
    throw err;
  }
  const mapped = toTower(raw);
  // The same demo readings as the list and the detail, so no view disagrees.
  return { towers: [withDemoCabinetReadings(mapped.tower)], feeds: mapped.feeds };
}
