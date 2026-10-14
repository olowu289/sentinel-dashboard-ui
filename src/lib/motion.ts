import type { Transition } from "motion/react";

/**
 * Motion vocabulary — the single source of truth for animated transitions.
 * Deliberately not duplicated as CSS custom properties: everything animated is
 * JS-driven, so a mirrored token set would have no consumers and would drift.
 * (The standing CSS keyframes — pulse-dot, siren — keep their own timings in
 * index.css, since motion never touches them.)
 *
 * Everything is a tween. A spring on a video frame overshoots its own bounds
 * and settles back, which on a wall of cameras reads as the stream glitching —
 * the exact wrong reflex to train in an operator. Deterministic durations are
 * also load-bearing: the fullscreen exit holds its z-index for the length of
 * the animation, and a spring has no length to hold for.
 */

/** Near-instant acceleration, long deceleration, hard terminal stop. */
export const ENTER: Transition = { duration: 0.2, ease: [0.2, 0, 0, 1] };

/** Exits beat entries — the destination is already known, so don't make them wait. */
export const EXIT: Transition = { duration: 0.16, ease: [0.3, 0, 0, 1] };

/** Opacity and in-place swaps. Linear, because eased opacity reads as lag. */
export const FADE: Transition = { duration: 0.12, ease: "linear" };

/**
 * Following a value the DEVICE reports on a poll, between readings.
 *
 * The only one here that takes a duration, because the duration is not a taste
 * decision: it is the interval the reading arrives on, so the travel ends about
 * as the next one lands and the thing on screen is never far from the thing
 * being reported.
 *
 * ⚠ LINEAR, AND THAT IS NOT THE HOUSE EASE. Everything above eases, because
 * everything above is chrome arriving or leaving. This is a MEASUREMENT moving
 * at a constant rate -- a radar needle, driven by a head turning at a fixed
 * speed -- and an eased one reads as a mechanism that speeds up and slows down
 * twice a second. Ease what the interface does; never ease what the equipment
 * is doing.
 *
 * (The header says there are no CSS motion tokens because nothing consumed
 * them. This is a JS tween like the rest, and it has a consumer: SweepRadar.)
 */
export const TRACK = (seconds: number): Transition => ({ duration: seconds, ease: "linear" });
