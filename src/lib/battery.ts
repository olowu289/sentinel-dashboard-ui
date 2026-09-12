/**
 * How much charge a tower has left, as a status.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE SET OF THRESHOLDS, FOR EVERY DRAWING OF A BATTERY.
 * ══════════════════════════════════════════════════════════════════════
 *
 * The numbers below were already in this app, in `TowerBattery.tsx`, split
 * across `TIERS` (the mast cell's fill colours), `batteryTone` (the text beside
 * it) and `batteryFill` (the glyph's gradient). That file makes the argument
 * itself — "three copies of the same two thresholds is how a product ends up
 * disagreeing with itself about when a battery is low" — and it was right.
 *
 * So they moved here rather than being copied a fourth time for the fleet
 * board's Power cell. `TowerBattery.tsx` imports them for its geometry and
 * re-exports `batteryTone`, so every existing call site keeps working against
 * one definition. Changing a threshold is now one edit.
 *
 * ── WHY 40 AND 20 ──────────────────────────────────────────────────────
 *
 * These are the tiers the design shipped and they suit the product: a security
 * tower is a thing whose job ends when its battery does. 40% is early enough
 * that somebody can act — check the panel, look at the week's weather — before
 * it matters. Below 20% the site is hours from going dark, which is a fault,
 * and red is what this app uses for a fault.
 *
 * Compare `storage.ts`: the same three-tier grammar, the same reasoning, a
 * different quantity. A tower can lose recordings; it cannot lose power.
 */

/** Below this much charge, the site is hours from going dark. */
export const BATTERY_CRITICAL_PCT = 20;

/** Below this much charge, somebody should look at it. */
export const BATTERY_LOW_PCT = 40;

export type BatteryTier = "ok" | "low" | "critical";

export function batteryTier(pct: number): BatteryTier {
  if (pct < BATTERY_CRITICAL_PCT) return "critical";
  if (pct < BATTERY_LOW_PCT) return "low";
  return "ok";
}

/**
 * The colour class for a charge.
 *
 * The house grammar — `text-terra` / `text-warn` / `text-critical` — so a
 * healthy battery reads the same green as a healthy signal or a healthy disk.
 */
export function batteryTone(pct: number): string {
  switch (batteryTier(pct)) {
    case "critical":
      return "text-critical";
    case "low":
      return "text-warn";
    default:
      return "text-terra";
  }
}

/**
 * What the tower last said about its pack.
 *
 * ⚠ `reachable` CARRIES THE WHOLE MEANING. The battery allows ONE Bluetooth
 * connection, so a tower regularly cannot read its own pack — someone standing
 * at it with the vendor's app is enough. When `reachable` is false there are NO
 * readings, and that is the honest state rather than a degraded one. Never
 * substitute a remembered value behind it.
 */
export interface BatteryReading {
  reachable: boolean;
  /** When the tower took the reading. */
  asOf?: string;
  socPct?: number;
  voltageV?: number;
  currentA?: number;
  /** The PACK's temperature — not the processor's (`health.thermal.socC`). */
  tempC?: number;
}

/**
 * Amps below which the pack is doing neither.
 *
 * A pack at rest still reads tens of milliamps, and the SIGN of that is noise
 * rather than a direction — wired straight to an indicator it would flicker
 * between charging and discharging while nothing at all was happening. Half an
 * amp sits far below anything an array puts in or a tower draws out, so it
 * separates "resting" from either without ever masking a real one: the
 * reference tower reads +20.69 A while charging.
 */
export const BATTERY_IDLE_A = 0.5;

/** Which way the charge is going, or neither. */
export type BatteryFlow = "charging" | "discharging" | "idle";

/**
 * Which way the charge is moving, per the current's SIGN.
 *
 * Positive amps are charge going INTO the pack. `undefined` when there is no
 * current reading, which is not the same as "not charging" — the distinction
 * matters because the charging sweep is a claim about the array working.
 */
export function batteryFlow(reading: BatteryReading): BatteryFlow | undefined {
  if (!reading.reachable || reading.currentA === undefined) return undefined;
  if (Math.abs(reading.currentA) < BATTERY_IDLE_A) return "idle";
  return reading.currentA > 0 ? "charging" : "discharging";
}

/** The three states above, narrowed for callers that only drive an animation. */
export function batteryCharging(reading: BatteryReading): boolean | undefined {
  const flow = batteryFlow(reading);
  return flow === undefined ? undefined : flow === "charging";
}

/**
 * The current as an operator reads it: signed, to one decimal, and what the
 * sign MEANS. "+20.7 A charging" says in one line what a bare 20.69 does not.
 */
export function batteryCurrentLabel(reading: BatteryReading): string | undefined {
  if (!reading.reachable || reading.currentA === undefined) return undefined;
  const amps = reading.currentA;
  /* A typographic minus, matching the dBm the board prints beside it. */
  const sign = amps > 0 ? "+" : amps < 0 ? "−" : "";
  return `${sign}${Math.abs(amps).toFixed(1)} A ${batteryFlow(reading) ?? ""}`.trim();
}

/**
 * The sentence behind the colour, for a hover.
 *
 * Says what is happening rather than restating the percentage, which is already
 * on screen. Voltage and current are included when known because they are what
 * distinguishes a pack that is merely low from one that is being drained.
 */
export function batteryHint(reading: BatteryReading): string {
  if (!reading.reachable) {
    return (
      "The tower could not read its battery. The pack accepts one Bluetooth " +
      "connection at a time, so this is usually something else holding it — " +
      "no charge level is shown rather than an old one."
    );
  }
  if (reading.socPct === undefined) {
    return "The tower reached its battery but reported no charge level.";
  }

  const parts: string[] = [`Battery at ${Math.round(reading.socPct)}%`];
  const flow = batteryFlow(reading);
  if (flow === "charging") parts.push("charging");
  else if (flow === "discharging") parts.push("discharging");
  else if (flow === "idle") parts.push("neither charging nor discharging");

  let sentence = `${parts.join(", ")}.`;
  const detail: string[] = [];
  if (reading.voltageV !== undefined) detail.push(`${reading.voltageV} V`);
  if (reading.currentA !== undefined) detail.push(`${reading.currentA} A`);
  if (reading.tempC !== undefined) detail.push(`${reading.tempC} °C`);
  if (detail.length) sentence += ` ${detail.join(" · ")}.`;

  switch (batteryTier(reading.socPct)) {
    case "critical":
      return `${sentence} The site is hours from going dark.`;
    case "low":
      return `${sentence} Worth checking the panel before it matters.`;
    default:
      return sentence;
  }
}
