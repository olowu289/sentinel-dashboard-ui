/**
 * How long, as a number somebody typed and a sentence somebody can read.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS ITS OWN MODULE WITH NO COMPONENT IN IT
 * ══════════════════════════════════════════════════════════════════════
 *
 * Four buttons were not enough. A share is lent for "about ten minutes" or
 * "until the end of the shift", and the quick choices (15 minutes, 1 hour, 4
 * hours, 24 hours) cover neither, so the picker gained a field to type into.
 * A typed field means parsing, bounds and an error sentence, and all three
 * belong somewhere testable rather than inside the component that draws them.
 *
 * ── THE BOUNDS ARE THE SERVER'S, AND THIS IS A COPY THAT SAYS SO ──────
 *
 * `SHARE_MIN_SEC` and `SHARE_MAX_SEC` come from the SDK, which gets them from
 * the contract, which is what the server enforces. Nothing here decides a
 * policy: this only means somebody who types 2 minutes is told so where they
 * typed it, instead of after a round trip. The server refuses it either way,
 * and if the two ever disagree the server wins and the box was wrong.
 */

import { SHARE_MAX_SEC, SHARE_MIN_SEC } from "@kallon/sentry-sdk";

export type DurationUnit = "minutes" | "hours";

/**
 * The quick choices, which are the four lengths people actually pick.
 *
 * Not a scale and not evenly spaced: "a quarter of an hour" for somebody at
 * the gate, "an hour" for a visit, "four hours" for a shift, "a day" for work
 * that runs over. Anything else is typed.
 */
export const QUICK_DURATIONS: readonly { label: string; sec: number }[] = [
  { label: "15 min", sec: 15 * 60 },
  { label: "1 hour", sec: 60 * 60 },
  { label: "4 hours", sec: 4 * 60 * 60 },
  { label: "24 hours", sec: 24 * 60 * 60 },
];

export const MIN_SEC = SHARE_MIN_SEC;
export const MAX_SEC = SHARE_MAX_SEC;

/** `5 minutes` / `30 days`, for naming a bound inside a sentence. */
export function spellDuration(sec: number): string {
  if (sec % 86400 === 0 && sec >= 86400) {
    const d = sec / 86400;
    return `${d} ${d === 1 ? "day" : "days"}`;
  }
  if (sec % 3600 === 0 && sec >= 3600) {
    const h = sec / 3600;
    return `${h} ${h === 1 ? "hour" : "hours"}`;
  }
  const m = Math.round(sec / 60);
  return `${m} ${m === 1 ? "minute" : "minutes"}`;
}

/** What one of the quick buttons would be called, or null for a typed value. */
export function quickLabel(sec: number): string | null {
  return QUICK_DURATIONS.find((d) => d.sec === sec)?.label ?? null;
}

/**
 * A length, in the words it was CHOSEN in.
 *
 * ⚠ THE BUTTON'S WORDS WIN. Somebody pressed "24 hours" and the panel
 * answering them read "They asked for 1 day" -- the same length, said two
 * ways, on two screens about one share. `spellDuration` prefers the largest
 * unit that divides evenly, which is right for a typed value and wrong for one
 * that has a button with a name on it.
 *
 * Everywhere a chosen length is shown back to somebody, this is the one to
 * use; `spellDuration` is for naming a BOUND, which has no button.
 */
export function sayDuration(sec: number): string {
  return quickLabel(sec) ?? spellDuration(sec);
}

export interface ParsedDuration {
  /** Seconds, only when the value is both a number and in range. */
  readonly sec: number | null;
  /**
   * Why it was refused, as a sentence, or null.
   *
   * ⚠ IT NAMES THE RANGE. "Out of range" sends somebody back to guess; "a
   * share has to last at least 5 minutes" tells them what to type instead. The
   * server's refusal says the same thing in the same shape, so being refused
   * locally and being refused remotely read alike.
   */
  readonly problem: string | null;
}

/**
 * A typed amount and its unit, checked.
 *
 * An EMPTY field is not an error. Somebody clearing it to type again has not
 * made a mistake, and shouting at them mid-keystroke is how a form becomes
 * unusable; it returns `{sec: null, problem: null}` and the caller treats that
 * as "nothing chosen yet".
 */
export function parseDuration(raw: string, unit: DurationUnit): ParsedDuration {
  const text = raw.trim();
  if (text === "") return { sec: null, problem: null };
  if (!/^\d+$/.test(text)) {
    return {
      sec: null,
      problem: "Type a whole number of " + unit + ".",
    };
  }
  const amount = Number(text);
  if (amount === 0) {
    return { sec: null, problem: "Zero is not a length. " + atLeast() };
  }
  const sec = amount * (unit === "hours" ? 3600 : 60);
  if (sec < MIN_SEC) return { sec: null, problem: atLeast() };
  if (sec > MAX_SEC) return { sec: null, problem: atMost() };
  return { sec, problem: null };
}

function atLeast(): string {
  return `A share has to last at least ${spellDuration(MIN_SEC)}: a shorter one can expire while the video is still connecting.`;
}

function atMost(): string {
  return `A share can last at most ${spellDuration(MAX_SEC)}. For longer, give the site the camera in Administration rather than lending it.`;
}

/**
 * Seconds back into a field and a unit, for opening a picker on a value.
 *
 * ⚠ HOURS WHEN IT DIVIDES EVENLY, MINUTES OTHERWISE. A four-hour share
 * reopened as "240 minutes" is the same length and a worse sentence, and
 * somebody editing it would have to do the arithmetic to change it to five.
 */
export function splitDuration(sec: number): { amount: string; unit: DurationUnit } {
  if (sec >= 3600 && sec % 3600 === 0) {
    return { amount: String(sec / 3600), unit: "hours" };
  }
  return { amount: String(Math.round(sec / 60)), unit: "minutes" };
}
