/**
 * THE LIVE FEED HAS STOPPED, AND A STOPPED FEED LOOKS LIKE A QUIET NIGHT.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE ONE THING THAT TELLS THOSE TWO APART
 * ══════════════════════════════════════════════════════════════════════
 *
 * Both are a list of alerts that is not changing. On a monitoring product
 * one of them is the best news on the screen and the other is the worst, and
 * nothing else on this surface distinguishes them: the rows are still there,
 * still true, still the last thing the server said. An operator reading a
 * dead feed as a calm site is the failure this whole product is built to
 * refuse, and it is the easiest one to ship because it has no symptom.
 *
 * ── QUIET, AND NOT A BANNER ───────────────────────────────────────────
 *
 * The rows on screen have not become wrong, and the SDK is already
 * reconnecting. So: one line, in the quietest ink the palette has, below the
 * count and above the list. Not red — nothing is wrong with the SITE, which
 * is what red means here, and spending the fault colour on a browser's
 * connection is how an operator learns to discount it.
 *
 * It is gated on a grace period (`PAUSED_AFTER_MS`) rather than on every
 * drop. Drops are ordinary on this channel — a slow reader is closed rather
 * than waited for — and a notice that blinks all day is a notice nobody
 * reads, which is the same failure arrived at from the other side.
 *
 * Both alert surfaces draw this one, for the reason `FeedChip` exists: a
 * second copy of the sentence is a second copy that can be reworded alone.
 */
export function PausedNotice() {
  return (
    <p
      data-alert-paused
      role="status"
      className="shrink-0 border-b border-line px-[15px] py-[8px] text-[0.75rem] leading-[16px] text-muted"
    >
      Live updates paused. This list may be behind.
    </p>
  );
}
