/**
 * Patrol: a movable camera sweeping its preset round on a timer.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE CONTRACT, IN ONE PLACE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Read, on every MOVABLE camera in a device record:
 *
 *   "patrol": {
 *     "enabled":   bool,
 *     "every":     "1h"|"2h"|"4h"|"6h"|"12h"|"24h"|"random",
 *     "direction": "clockwise"|"anticlockwise"|"random",
 *     "next_at":   "<ISO 8601 UTC>" | null,
 *     "running":   bool
 *   }
 *
 * A FIXED camera carries no `patrol` field at all, and that absence is the
 * signal: there is no round to sweep, so there is no row, no switch and no
 * explanation of why there isn't one. Absent is not "off".
 *
 * Write: `PUT /v1/viewer/towers/{device_id}/cameras/{camera}/patrol` with
 * `{enabled, every, direction}`, answering 200 with the whole patrol object.
 *
 * ── WHY THE WORDS LIVE HERE AND NOT IN THE PANEL ──────────────────────
 *
 * Because the same setting is drawn in two places -- the tower settings panel
 * and Settings → Cameras -- and two copies of "4h means Every 4 hours" is one
 * copy that will eventually say something else. The screens render; this file
 * decides what the wire's words mean.
 */

/** Exactly the intervals the contract allows, in the order the panel lists them. */
export const PATROL_INTERVALS = ["1h", "2h", "4h", "6h", "12h", "24h", "random"] as const;
export type PatrolEvery = (typeof PATROL_INTERVALS)[number];

/** Exactly the directions the contract allows, in the order the panel lists them. */
export const PATROL_DIRECTIONS = ["clockwise", "anticlockwise", "random"] as const;
export type PatrolDirection = (typeof PATROL_DIRECTIONS)[number];

/** One camera's patrol, as the device reports it. */
export interface Patrol {
  enabled: boolean;
  every: PatrolEvery;
  direction: PatrolDirection;
  /** When the next round starts. `null` while off, and while the device has not said. */
  nextAt: string | null;
  /** It is sweeping right now. */
  running: boolean;
}

/** What a write sends. The three fields the operator chooses, and nothing else. */
export interface PatrolEdit {
  enabled: boolean;
  every: PatrolEvery;
  direction: PatrolDirection;
}

/** The default a camera with no patrol block would take, if one is ever needed. */
export const PATROL_DEFAULT: PatrolEdit = {
  enabled: false,
  every: "4h",
  direction: "clockwise",
};

/* ======================================================================
 *  THE WIRE'S WORDS, AND OURS
 * ====================================================================== */

/**
 * How often, in words.
 *
 * ⚠ "Every 1 hour" IS NOT ENGLISH, which is the one case a table beats a
 * format string. The rest are regular; writing them out costs nothing and
 * means nobody has to read a pluralisation rule to know what the screen says.
 */
const EVERY_WORD: Readonly<Record<PatrolEvery, string>> = {
  "1h": "Every hour",
  "2h": "Every 2 hours",
  "4h": "Every 4 hours",
  "6h": "Every 6 hours",
  "12h": "Every 12 hours",
  "24h": "Every 24 hours",
  random: "Random",
};

/** The same intervals as the choices under the row, where "Every" is the label. */
const EVERY_CHOICE: Readonly<Record<PatrolEvery, string>> = {
  "1h": "1 hour",
  "2h": "2 hours",
  "4h": "4 hours",
  "6h": "6 hours",
  "12h": "12 hours",
  "24h": "24 hours",
  random: "Random",
};

const DIRECTION_WORD: Readonly<Record<PatrolDirection, string>> = {
  clockwise: "Clockwise",
  anticlockwise: "Anticlockwise",
  random: "Random",
};

export function everyWord(every: PatrolEvery): string {
  return EVERY_WORD[every] ?? EVERY_WORD["4h"];
}

export function everyChoice(every: PatrolEvery): string {
  return EVERY_CHOICE[every] ?? EVERY_CHOICE["4h"];
}

export function directionWord(direction: PatrolDirection): string {
  return DIRECTION_WORD[direction] ?? DIRECTION_WORD.clockwise;
}

/**
 * What the collapsed Patrol row says for ONE camera.
 *
 * Off, or how often. The direction is not here: a row is a label and a value,
 * and "Every 4 hours, clockwise" is two values in the space for one -- the
 * direction is a choice you make once and read inside.
 */
export function patrolWord(patrol: Patrol | undefined): string {
  if (!patrol || !patrol.enabled) return "Off";
  return everyWord(patrol.every);
}

/**
 * What the collapsed row says for a whole device.
 *
 * One camera speaks for itself; two that agree speak as one; two that disagree
 * say how many are on rather than picking a winner to print. The same grammar
 * the Picture quality row uses, for the same reason.
 */
export function patrolSummary(patrols: readonly (Patrol | undefined)[]): string {
  if (patrols.length === 0) return "";
  const words = patrols.map((p) => patrolWord(p));
  if (words.every((w) => w === words[0])) return words[0];
  const on = patrols.filter((p) => p?.enabled).length;
  return on === 1 ? "1 camera on" : `${on} cameras on`;
}

/* ======================================================================
 *  READING THE WIRE
 * ====================================================================== */

const isEvery = (v: unknown): v is PatrolEvery =>
  typeof v === "string" && (PATROL_INTERVALS as readonly string[]).includes(v);

const isDirection = (v: unknown): v is PatrolDirection =>
  typeof v === "string" && (PATROL_DIRECTIONS as readonly string[]).includes(v);

/**
 * Parse one camera's patrol block, or answer `undefined`.
 *
 * ⚠ `undefined` FOR A CAMERA THAT CARRIES NO BLOCK, and that is the whole
 * distinction a fixed camera rests on. It must never become a default: a
 * fixed dome given `{enabled: false}` would grow a Patrol row offering to
 * sweep a round it cannot turn to.
 *
 * An unrecognised `every` or `direction` falls back rather than dropping the
 * block, because a camera that IS patrolling should keep its row even if a
 * later server adds a seventh interval this build has never heard of.
 */
export function parsePatrol(raw: unknown): Patrol | undefined {
  if (raw === null || typeof raw !== "object") return undefined;
  const o = raw as Record<string, unknown>;
  const nextAt = typeof o["next_at"] === "string" && o["next_at"].trim() !== ""
    ? o["next_at"]
    : null;
  return {
    enabled: o["enabled"] === true,
    every: isEvery(o["every"]) ? o["every"] : PATROL_DEFAULT.every,
    direction: isDirection(o["direction"]) ? o["direction"] : PATROL_DEFAULT.direction,
    nextAt,
    running: o["running"] === true,
  };
}

/* ======================================================================
 *  WHEN IT IS REFUSED
 * ====================================================================== */

/**
 * One plain sentence for a refusal the server sent no message with.
 *
 * ⚠ THE SERVER'S OWN SENTENCE WINS whenever it sends one -- it knows which
 * tower and which share, and this app knows neither. These are the fallbacks,
 * one line each, what happened and what to do.
 */
const REFUSAL: Readonly<Record<string, string>> = {
  patrol_forbidden: "You cannot change patrol on this camera.",
  camera_not_movable: "This camera cannot move, so it cannot patrol.",
  patrol_invalid: "That patrol setting was not accepted. Choose another.",
  tower_offline: "This tower is offline. Try again when it is back.",
};

export function patrolRefusal(code: string | null | undefined, message?: string | null): string {
  const sent = typeof message === "string" ? message.trim() : "";
  if (sent !== "") return sent;
  const key = typeof code === "string" ? code.trim().toLowerCase() : "";
  return REFUSAL[key] ?? "That change was not saved. Try again.";
}
