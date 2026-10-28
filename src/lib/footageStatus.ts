import type { DeviceFootage } from "@kallon/sentry-sdk";
/* ⚠ `formatBytes` IS NOT WRITTEN AGAIN HERE. One was, and that is exactly the
   drift this module's own header argues against: the clip list and this row
   would have rounded the same backlog two ways. `lib/time.ts` owns the
   rendering of a size, as it owns the rendering of a stamp. */
import { formatBytes } from "./time";

/**
 * WHAT A TOWER'S FOOTAGE IS DOING, in the few words a screen has room for.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS ITS OWN MODULE AND NOT TWO HELPERS IN A COMPONENT
 * ══════════════════════════════════════════════════════════════════════
 *
 * The same two readings appear on the Towers board (one cell each, in a row of
 * twelve) and in a tower's settings panel (one row each, under Storage). They
 * are the same fact and they must not be able to disagree — the board saying a
 * site is up to date while its own settings say it cannot reach the hub is the
 * failure the colour and the number both exist to prevent, and it is the one a
 * reader has no way to catch. One function per reading, called twice.
 *
 * Everything here is pure and takes the SDK's `DeviceFootage` straight. That
 * block is a sibling of `health` on a projected device and arrives already
 * shaped; re-declaring it in `types.ts` would be a second copy to keep in step
 * with the first, which is what the SDK's own export list warns against.
 *
 * ── THE VERDICT IS THE SERVER'S, NOT OURS ─────────────────────────────
 *
 * ⚠ `sync.reason` CHANGED MEANING IN SDK 0.13.0 and this module is the only
 * place that reads it. It used to be the TOWER's refusal code — why its own
 * sync could not run — and it is now the HUB's verdict over a fixed five
 * (sentry-core docs/alerts.md §8). The tower's codes moved aside to
 * `sync.blocked_by`, unchanged in value, and are deliberately NOT read here:
 * `wireguard_link` and `cannot_determine` both fold into `unreachable`, and
 * doing that fold a second time on this side is how two builds end up
 * disagreeing about the same tower in front of a customer.
 *
 * Two of the five cannot come from a tower at all. `unreachable` needs the link
 * state, which only the hub observes, and `behind` needs a clock. So a tower
 * that reported footage but no `sync` block has said nothing about its sync,
 * and the honest answer is NOTHING — not `ok`. A screen that renders silence as
 * "Up to date" is a screen that says a site is fine because it did not answer.
 */

/** The two numbers behind "Waiting", summed over every camera and stream. */
export interface FootageWaiting {
  /** Segments the hub has not confirmed receiving. */
  files: number;
  /** The same segments, in bytes. */
  bytes: number;
}

/** A reading, as the board's cells and the panel's rows both want it. */
export interface FootageReading {
  value: string;
  /** A Tailwind colour class, or absent for the neutral ink. */
  tone?: string;
}

/** Four hours: the limit the hub itself measures `behind` against. */
export const BEHIND_LIMIT_HOURS = 4;

/**
 * The oldest footage the hub has not confirmed, across every camera and stream,
 * and whether that start is exact.
 *
 * ⚠ THE OLDEST, WHICH IS THE MINIMUM, not the first one found. A tower with two
 * cameras can be an hour behind on one and a day behind on the other, and the
 * reading an operator needs is the worse of the two: "Behind 1 h" on a site
 * missing yesterday's second camera is a reassurance nobody earned.
 *
 * `exact` goes false when ANY contributing stream said so. Same direction, same
 * reason — the weaker claim wins, because a number presented as exact when part
 * of it was estimated is the one that gets quoted.
 */
export function oldestUnconfirmed(
  footage: DeviceFootage | undefined,
): { atMs: number; exact: boolean } | null {
  if (!footage?.cameras) return null;
  let atMs: number | null = null;
  /* ⚠ ABSENT MEANS EXACT, and that is the server's own statement: the field is
     sent ONLY when the start could not be established, so `undefined` is the
     stronger claim rather than the missing one. Reading it as falsy would
     invert it and print "about" over every exact reading in the fleet. */
  let exact = true;
  for (const camera of footage.cameras) {
    for (const stream of camera.streams ?? []) {
      const raw = stream.oldest_unconfirmed_start;
      if (!raw) continue;
      const t = Date.parse(raw);
      if (!Number.isFinite(t)) continue;
      if (atMs === null || t < atMs) atMs = t;
      if (stream.oldest_unconfirmed_exact === false) exact = false;
    }
  }
  return atMs === null ? null : { atMs, exact };
}

/** Whole hours between then and now, never negative. */
export function hoursBehind(atMs: number, now: number = Date.now()): number {
  return Math.max(0, Math.round((now - atMs) / 3_600_000));
}

/**
 * The Footage row: is what this tower records reaching the hub?
 *
 * `null` when the tower has said nothing about its sync, which is a row that
 * does not appear rather than a row reading "Unknown" — absence of a field and
 * a field whose value is unknown are different, and only the second gets words.
 */
export function footageReading(
  footage: DeviceFootage | undefined,
  now: number = Date.now(),
): FootageReading | null {
  const reason = footage?.sync?.reason;
  if (!reason) return null;
  switch (reason) {
    case "ok":
      return { value: "Up to date", tone: "text-terra" };
    case "behind": {
      const oldest = oldestUnconfirmed(footage);
      /* The hub said `behind` and sent no start to measure it from. The verdict
         still stands — it was reached from a number this projection did not
         carry — so the row says the verdict and declines to invent the hours.
         Amber either way: the site needs somebody. */
      if (!oldest) return { value: "Behind", tone: "text-detect" };
      const h = hoursBehind(oldest.atMs, now);
      /* "about" on an inexact start, and that word is the whole of the honesty
         here: a segment whose beginning could not be established is stamped
         when it ARRIVED, so hours derived from it are a floor, not a
         measurement. */
      return {
        value: oldest.exact ? `Behind ${h} h` : `Behind about ${h} h`,
        tone: "text-detect",
      };
    }
    case "unreachable":
      /* RED. Nothing this tower records is getting off it, so the site is
         filling a disk with evidence nobody can reach — the same shape of fault
         as a site recording nothing at all. */
      return { value: "Can't reach hub", tone: "text-critical" };
    case "no_recording_disk":
      return { value: "Not recording: no disk", tone: "text-critical" };
    case "recording_off":
      /* ⚠ NOT RED. Somebody turned recording off; that is a decision, and the
         hub's own table says so in those words. Painting a decision as a fault
         teaches an operator to stop reading the colour. */
      return { value: "Recording off" };
    default:
      /* A sixth verdict from a newer hub. Rendered as nothing rather than as
         its own code: `sync.reason` is a machine value and rule 3 says an
         internal word never reaches a screen. The row disappears, which is the
         honest outcome — this build cannot say what that tower is doing. */
      return null;
  }
}

/** Files and bytes the hub has not confirmed, summed across the tower. */
export function footageWaiting(
  footage: DeviceFootage | undefined,
): FootageWaiting | null {
  if (!footage?.cameras) return null;
  let files = 0;
  let bytes = 0;
  let said = false;
  for (const camera of footage.cameras) {
    for (const stream of camera.streams ?? []) {
      if (typeof stream.unconfirmed_segments === "number") {
        files += stream.unconfirmed_segments;
        said = true;
      }
      if (typeof stream.unconfirmed_bytes === "number") {
        bytes += stream.unconfirmed_bytes;
        said = true;
      }
    }
  }
  /* A tower that listed its cameras and never mentioned a backlog has not said
     there is none. Zero is a reading and silence is not, and the row that draws
     this hides rather than printing a nought somebody would trust. */
  return said ? { files, bytes } : null;
}

/**
 * The Waiting row: how much this tower is holding that the hub has not got.
 *
 * ⚠ "Nothing waiting" IS A READING AND IT IS THE GOOD ONE. The temptation is to
 * hide a zero, and it is wrong here: the row above can read "Up to date" for a
 * site that is up to date, and the only thing on screen separating a measured
 * backlog of nothing from a backlog nobody counted is whether this row has a
 * number in it.
 */
export function waitingReading(
  footage: DeviceFootage | undefined,
): FootageReading | null {
  const waiting = footageWaiting(footage);
  if (!waiting) return null;
  if (waiting.files === 0) return { value: "Nothing waiting" };
  const files = `${waiting.files} ${waiting.files === 1 ? "file" : "files"}`;
  /* A middle dot between the two halves of one value, never an em-dash. */
  return { value: `${files} · ${formatBytes(waiting.bytes)}` };
}

/**
 * Does the Footage row already say why nothing is being recorded?
 *
 * The Recording row reads `health.recording.mode`, which is `RECORD_ENABLE` and
 * nothing else — it cannot tell a missing disk from a switch somebody turned
 * off, and last round it shipped the shorter "Not recording" for exactly that
 * reason. `sync.reason` CAN tell them apart, so the exact sentence now lives on
 * the Footage row and this hides the vaguer one above it, rather than two rows
 * making the same claim with two different levels of confidence.
 */
export function recordingRowIsRedundant(
  footage: DeviceFootage | undefined,
): boolean {
  const reason = footage?.sync?.reason;
  return reason === "no_recording_disk" || reason === "recording_off";
}
