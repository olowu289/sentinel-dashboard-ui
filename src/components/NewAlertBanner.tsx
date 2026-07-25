import { motion } from "motion/react";
import type { Alert } from "@/lib/types";
import { ENTER } from "@/lib/motion";
import { formatRelative } from "@/lib/time";
import { MaskIcon } from "./Icon";

/**
 * How a new alert reaches an operator who cannot see the alerts feed — either
 * the panel is collapsed, or on a phone they are on the camera view.
 *
 * It takes space at the top of the wall rather than floating over it. A toast
 * covering video is exactly the wrong trade here: the frame it is telling you
 * about is the frame it would be hiding.
 */
export function NewAlertBanner({
  alert,
  className = "",
  onView,
  onDismiss,
}: {
  alert: Alert;
  className?: string;
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      /* Height rather than opacity: the wall below has to make room for it,
         and animating that is what keeps the tiles from jumping. */
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 43, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={ENTER}
      role="status"
      className={`shrink-0 items-center gap-[8px] overflow-hidden bg-alert-banner px-[8px] ${className}`}
    >
      <MaskIcon
        src="/icons/banner-alert.svg"
        size={24}
        className="shrink-0 text-white"
      />

      {/* One sentence, then the action inline — an operator reads the what
          before deciding whether to leave the wall for it. */}
      <p className="min-w-0 truncate text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
        {alert.title}, {formatRelative(alert.at)}.{" "}
        <button
          type="button"
          onClick={onView}
          className="font-semibold underline underline-offset-2 hover:no-underline"
        >
          View Details
        </button>
      </p>

      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss alert notification"
        title="Dismiss"
        className="ml-auto mr-[10px] flex size-[24px] shrink-0 items-center justify-center rounded-[4px] text-white/90 transition-colors hover:text-white"
      >
        <MaskIcon src="/icons/banner-close.svg" size={20} />
      </button>
    </motion.div>
  );
}
