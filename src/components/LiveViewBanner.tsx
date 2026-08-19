import { motion } from "motion/react";
import { ENTER } from "@/lib/motion";
import { MaskIcon } from "./Icon";

/**
 * What a long live session costs the tower.
 *
 * These sites are off-grid: the panel is the only thing refilling the battery,
 * and holding a stream open keeps the camera awake to serve it. Ten minutes in,
 * the operator is told — not stopped. Watching a yard for half an hour is a
 * legitimate thing to be doing, and a banner that blocked it would be answered
 * by learning to dismiss banners.
 *
 * Amber, and the same 43px bar the new-alert banner takes, because it makes the
 * same shape of claim: something about this site needs you to know it. It takes
 * space at the top of the wall rather than floating over the video, for the
 * reason written on `NewAlertBanner` — the frames are the job.
 */
export function LiveViewBanner({
  onDismiss,
}: {
  onDismiss: () => void;
}) {
  return (
    <motion.div
      /* Height, not opacity — the wall below has to make room for it, and
         animating that is what keeps the tiles from jumping. */
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 43, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={ENTER}
      role="status"
      className="flex shrink-0 items-center gap-[8px] overflow-hidden bg-advice-banner px-[16px]"
    >
      <MaskIcon
        src="/icons/cctv.svg"
        size={24}
        className="shrink-0 text-advice-ink"
      />
      {/* The frame reads "Extended Live viewing can drain your camera's
          battery faster". Two changes. "Your camera" is a consumer product's
          possessive and this operator is watching somebody else's site —
          everywhere else in the app it is *the tower*, which is also the thing
          whose battery is drawn two rows up. And "can drain" hedges a
          certainty: it is draining, which is why the bar is up.

          "Faster" stays. It is a comparative against the tower's own resting
          draw rather than against another product, which is the reading an
          operator of an off-grid site already has — the battery is always
          going down, and this is about the rate. */}
      <p className="min-w-0 truncate text-[0.875rem] leading-[20px] tracking-[0.14px] text-advice-ink">
        Live view keeps the camera awake and drains the tower's battery faster.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss battery notification"
        title="Dismiss"
        className="ml-auto flex size-[20px] shrink-0 items-center justify-center rounded-[4px] text-advice-ink/80 transition-colors hover:text-advice-ink"
      >
        <MaskIcon src="/icons/banner-close.svg" size={20} />
      </button>
    </motion.div>
  );
}
