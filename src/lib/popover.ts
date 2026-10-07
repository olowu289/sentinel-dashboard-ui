/**
 * Where an anchored popover goes. Pure arithmetic, so it can be tested.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS NOT INSIDE THE COMPONENT
 * ══════════════════════════════════════════════════════════════════════
 *
 * The sign-out confirmation shipped rendering INSIDE the 71px icon rail —
 * title wrapped one word per line, Cancel off-screen, Sign out clipped. The
 * cause was `position: fixed` resolving against a transformed ancestor rather
 * than the viewport, and the fix is a portal; but the lesson is that placement
 * is the part that goes wrong, and placement buried in a component is placement
 * nobody can test without a browser.
 *
 * So the geometry lives here, takes plain numbers, returns plain numbers, and
 * has a test with the exact rail-and-button rect from the bug report. The
 * component measures and renders; this decides.
 */

/** Gap between the anchor and the card. */
export const POPOVER_GAP = 10;
/** Closest the card may come to any screen edge. */
export const POPOVER_MARGIN = 12;

export interface Rect {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Place a card of `width` × `height` beside `anchor`, kept on screen.
 *
 * ── THE ORDER IS THE LOGIC ─────────────────────────────────────────────
 *
 * HORIZONTALLY: to the RIGHT of the anchor, because the rail is on the left
 * and a popover about a rail button belongs beside the rail rather than over
 * it. Flipped to the left only when the card would run off the right edge, and
 * clamped after either way — a window narrower than the card still shows it
 * rather than pushing it out of view.
 *
 * VERTICALLY: prefers opening DOWNWARD from the anchor's top edge, flips UPWARD
 * when that would overflow the bottom, and clamps. In practice the sign-out
 * button sits at the bottom of the rail so it nearly always flips up — the rule
 * is written in the order the layout is TRIED rather than the order it usually
 * resolves, because the rail's contents are conditional (the simulator button
 * comes and goes with a feature) and the anchor is not always at one height.
 *
 * CLAMPING IS LAST AND UNCONDITIONAL. A flip can still overflow — a card taller
 * than the viewport has nowhere good to go — and in that case being pinned to
 * the top-left margin and clipped at the bottom is strictly better than being
 * positioned off-screen, where there is nothing to scroll to.
 */
export function placePopover({
  anchor,
  width,
  height,
  viewport,
  gap = POPOVER_GAP,
  margin = POPOVER_MARGIN,
}: {
  anchor: Rect;
  width: number;
  height: number;
  viewport: Viewport;
  gap?: number;
  margin?: number;
}): { top: number; left: number } {
  let left = anchor.right + gap;
  if (left + width > viewport.width - margin) left = anchor.left - gap - width;
  left = Math.max(margin, Math.min(left, viewport.width - margin - width));

  let top = anchor.top;
  if (top + height > viewport.height - margin) top = anchor.bottom - height;
  top = Math.max(margin, Math.min(top, viewport.height - margin - height));

  return { top, left };
}
