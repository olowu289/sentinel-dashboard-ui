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
