/**
 * The fleet, from coordination.
 *
 * Three calls, all §4.2.3, all through the SDK. No retry loop anywhere: an
 * absent tower is an ANSWER, NOT A WAIT — v1 lost eight days to spinning on
 * that, and a fleet screen that shows a spinner where a tower should be teaches
 * an operator nothing.
 */

import type { TowerDetail } from "@kallon/sentry-sdk";
import type { CameraFeed, Tower } from "@/lib/types";
import { endSessionIfUnauthorized, getSession } from "./auth";
import { getClient, getCoordinationBaseUrl, webFetch } from "./client";
import { parsePatrol, patrolRefusal, type Patrol, type PatrolEdit } from "@/lib/patrol";
import { toTower } from "./map";
import { withDemoCabinetReadings } from "./demoCabinet";

export interface FleetSnapshot {
  towers: Tower[];
  feeds: CameraFeed[];
  /**
   * Whether the box that answered is reaching Kallon Cloud.
   *
   * ⚠ ONE FACT ABOUT THE SERVER, not about a tower — which is why it is here
   * and not on `Tower`. Every tower on one hub shows the same answer, so
   * copying it into each of them would be one fact stored n times and n
   * chances for two settings screens on one site to disagree.
   *
   * Carried only by `listFleet`: the single-tower routes answer about a tower.
   * Absent is "the server could not say", which the row renders in words and
   * never as "disconnected".
   */
  cloud?: CloudReading;
}

/**
 * The site's link to Kallon Cloud, as the Network group prints it.
 *
 * ⚠ THIS REPLACED "Backup Connection", WHICH WAS A FIXTURE. That row read
 * "Satellite" on every tower in every fleet, from `demoCabinet.ts`, and
 * nothing anywhere measured it. What a customer actually wants in that space
 * is simpler and real: is my site reachable from outside, over what, and how
 * far away is it.
 *
 * ⚠ "KALLON CLOUD", NEVER "DC". The data centre is our word for our own
 * machine. The row names the service.
 */
export interface CloudReading {
  connected?: boolean;
  /** Declared at install, not sniffed: Ethernet · Fibre · Mobile · Satellite · Wi-Fi. */
  iface?: string;
  /** When the current cloud link came up. Absent while disconnected. */
  since?: string;
  /** Heartbeat round trip, ms. Absent while disconnected. */
  latencyMs?: number;
  /** The answer came FROM the cloud, so there is no round trip to report. */
  isCloud?: boolean;
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
  let reply;
  try {
    /* `listFleet`, NOT `listTowers`: the array form drops the envelope, and
       the envelope is where the `cloud` block lives. See the SDK's note on the
       two -- one fact about the server cannot ride inside a tower. */
    reply = await getClient().listFleet(signal ? { signal } : {});
  } catch (err) {
    endSessionIfUnauthorized(err);
    throw err;
  }
  const raw = reply.towers;

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
  /* Spread conditionally, so "the server said nothing" stays distinguishable
     from "the server said not connected". The row says different words for
     each. */
  const cloud = reply.cloud;
  return {
    towers,
    feeds,
    ...(cloud
      ? {
          cloud: {
            ...(typeof cloud.connected === "boolean"
              ? { connected: cloud.connected }
              : {}),
            ...(cloud.iface ? { iface: cloud.iface } : {}),
            ...(cloud.since ? { since: cloud.since } : {}),
            ...(typeof cloud.latency_ms === "number"
              ? { latencyMs: cloud.latency_ms }
              : {}),
            ...(cloud.is_cloud === true ? { isCloud: true } : {}),
          },
        }
      : {}),
  };
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

/**
 * Rename ONE CAMERA on a tower — `PATCH /v1/viewer/towers/{id}/cameras/{n}`.
 *
 * ⚠ HAND-ROLLED `fetch`, THE SAME DOCUMENTED EXCEPTION `auth.ts` AND
 * `account.ts` CARRY. `renameTower` above goes through the SDK because the SDK
 * has a method for it; this route is newer than the vendored SDK, so there is
 * nothing to call. Kept in this file rather than in a new one so the two renames
 * sit together and the exception stays countable.
 * TODO(sdk): add `renameCamera` and delete the fetch below.
 *
 * ── THE SAME ERRORS AS THE TOWER RENAME, ON PURPOSE ────────────────────
 *
 * `TowerUnavailableError` and `LabelRejectedError`, reused rather than
 * reinvented, so the settings screen handles a refused camera name with exactly
 * the code that handles a refused tower name.
 *
 * A 404 HERE MEANS THREE THINGS AND MUST NOT BE SPLIT. Unknown tower, somebody
 * else's tower, and an account whose `settings` feature is off all answer 404 —
 * deliberately, so the route cannot be used to enumerate a fleet or to probe
 * which features an account has. The client therefore says "that tower is not
 * available", which is true of all three.
 *
 * An EMPTY or whitespace label CLEARS the name rather than storing a blank one,
 * which is the server's behaviour; the caller does not need a second function.
 *
 * Returns the whole re-projected tower, so the caller replaces its copy rather
 * than patching one field and hoping the rest still matches.
 */
export async function renameCamera(
  deviceId: string,
  cameraIndex: number,
  label: string,
  signal?: AbortSignal,
): Promise<FleetSnapshot> {
  const base = getCoordinationBaseUrl();
  if (!base) throw new TowerUnavailableError(deviceId);
  const session = getSession();
  if (!session?.ref) {
    /* Tagged 401 so `isUnauthorized` ends the session, exactly as a real 401
       from any other call would. */
    throw Object.assign(new Error("not signed in"), { status: 401 });
  }

  let response: Response;
  try {
    response = await webFetch(
      `${base}/v1/viewer/towers/${encodeURIComponent(deviceId)}/cameras/${cameraIndex}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.ref}`,
        },
        body: JSON.stringify({ label }),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new TowerUnavailableError(deviceId);
  }

  if (response.status === 401) {
    const dead = Object.assign(new Error("session is no longer valid"), {
      status: 401,
    });
    endSessionIfUnauthorized(dead);
    throw dead;
  }
  if (response.status === 404) throw new TowerUnavailableError(deviceId);
  if (response.status === 422) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: unknown };
    };
    throw new LabelRejectedError(
      typeof body?.error?.message === "string" ? body.error.message : undefined,
    );
  }
  if (!response.ok) throw new TowerUnavailableError(deviceId);

  const body = (await response.json().catch(() => ({}))) as { tower?: unknown };
  if (!body.tower || typeof body.tower !== "object") {
    /* A 200 with no tower is not a success we can act on: the point of the
       response is the fresh copy that replaces the stale one. */
    throw new TowerUnavailableError(deviceId);
  }
  const mapped = toTower(body.tower as TowerDetail);
  return {
    towers: [withDemoCabinetReadings(mapped.tower)],
    feeds: mapped.feeds,
  };
}

/**
 * A patrol refused, with the server's own code and sentence.
 *
 * ⚠ IT CARRIES BOTH, because only one of them is for a person. The code is
 * how this app picks a fallback sentence when the server sent none; the
 * message is what it shows when it did, and the server's is better -- it
 * knows which tower and which share, and this app knows neither.
 *
 * ⚠ AND "NOTHING WAS CHANGED" IS PART OF THE CONTRACT. Every refusal leaves
 * the camera exactly as it was, so the screen puts its controls back where
 * they were rather than leaving them on what the operator asked for. A
 * half-applied patrol would be the worst of the three states available here.
 */
export class PatrolRefusedError extends Error {
  readonly code: string | null;
  constructor(code: string | null, message?: string | null) {
    super(patrolRefusal(code, message));
    this.name = "PatrolRefusedError";
    this.code = code;
  }
}

/**
 * Set one camera's patrol -- `PUT /v1/viewer/towers/{id}/cameras/{n}/patrol`.
 *
 * ⚠ HAND-ROLLED `fetch`, THE SAME DOCUMENTED EXCEPTION `renameCamera` ABOVE
 * CARRIES, and for the same reason: this route is newer than the vendored
 * SDK, so there is no method to call. Kept beside it so the exception stays
 * countable rather than becoming a habit.
 * TODO(sdk): add `setPatrol` and delete the fetch below.
 *
 * Answers with the WHOLE patrol object, which is what the caller shows. The
 * screen never renders what it asked for: a save that came back with a
 * different `next_at` -- or with `enabled` still false because the tower
 * refused quietly -- must read as what the device actually holds.
 */
export async function setPatrol(
  deviceId: string,
  cameraIndex: number,
  edit: PatrolEdit,
  signal?: AbortSignal,
): Promise<Patrol> {
  const base = getCoordinationBaseUrl();
  if (!base) throw new TowerUnavailableError(deviceId);
  const session = getSession();
  if (!session?.ref) {
    /* Tagged 401 so `isUnauthorized` ends the session, exactly as a real 401
       from any other call would. */
    throw Object.assign(new Error("not signed in"), { status: 401 });
  }

  let response: Response;
  try {
    response = await webFetch(
      `${base}/v1/viewer/towers/${encodeURIComponent(deviceId)}/cameras/${cameraIndex}/patrol`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.ref}`,
        },
        /* EXACTLY THE THREE FIELDS THE CONTRACT NAMES. Not `next_at`, not
           `running`: those are the device's to report and not ours to ask
           for, and sending them would invite a server to believe one. */
        body: JSON.stringify({
          enabled: edit.enabled,
          every: edit.every,
          direction: edit.direction,
        }),
        ...(signal ? { signal } : {}),
      },
    );
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw err;
    throw new TowerUnavailableError(deviceId);
  }

  if (response.status === 401) {
    const dead = Object.assign(new Error("session is no longer valid"), { status: 401 });
    endSessionIfUnauthorized(dead);
    throw dead;
  }

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: { code?: unknown; message?: unknown };
      code?: unknown;
      message?: unknown;
    };
    const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
    const code = str(body?.error?.code) ?? str(body?.code);
    const message = str(body?.error?.message) ?? str(body?.message);
    /* ⚠ A 404 IS NOT A PATROL REFUSAL. Unknown tower, somebody else's tower
       and an account without the feature all answer 404 -- deliberately, so
       the route cannot be used to enumerate a fleet -- and "that tower is not
       available" is true of all three. */
    if (response.status === 404 && code === null) throw new TowerUnavailableError(deviceId);
    throw new PatrolRefusedError(code, message);
  }

  const body = (await response.json().catch(() => null)) as unknown;
  /* The server answers with the patrol object. The contract puts it at the
     top level; a body carrying it under `patrol` is the same answer wrapped,
     and reading both costs one line.

     ⚠ THE NESTED ONE IS TRIED FIRST, and the order is not cosmetic:
     `parsePatrol` accepts ANY object and fills the gaps with defaults, so a
     wrapper `{patrol: {...}}` parses perfectly well as a patrol of its own --
     enabled false, every 4h -- and would quietly replace the real answer with
     a default one. */
  const wrapped = (body as { patrol?: unknown } | null)?.patrol;
  const patrol = (wrapped !== undefined ? parsePatrol(wrapped) : undefined)
    ?? parsePatrol(body);
  if (!patrol) {
    /* A 200 with nothing readable in it is not a success we can act on: the
       point of the answer is the state that replaces what was on screen. */
    throw new PatrolRefusedError(null, null);
  }
  return patrol;
}
