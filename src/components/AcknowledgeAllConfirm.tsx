import { motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ENTER } from "@/lib/motion";

/**
 * "Acknowledge all 4 alerts?" — the one bulk write this product has.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY A CONFIRMATION FOR SOMETHING THAT ONLY MARKS THINGS READ
 * ══════════════════════════════════════════════════════════════════════
 *
 * Because there is no way back. Acknowledging is one-way and the first one
 * wins; there is no un-acknowledge route and there is deliberately not going
 * to be one, because an acknowledgement is an auditable record of a person
 * noticing and a button that erased it would let a screen imply somebody
 * un-noticed something. One alert at a time that is a small claim. All of
 * them at once, from a list somebody may have scrolled past, is a claim worth
 * reading the number of first.
 *
 * ⚠ PORTALLED, LIKE `SignOutConfirm`, AND FOR THE REASON WRITTEN THERE:
 * `position: fixed` resolves against the nearest transformed ancestor rather
 * than the viewport, and this app animates with `motion`, which sets
 * `transform`. An `inset-0` overlay rendered inside the 417px alerts column
 * fills the column.
 *
 * Centred rather than anchored, which is the one difference from the sign-out
 * popover: that one is about a 34px control in a corner, and this is about
 * every row on the screen behind it.
 */
export function AcknowledgeAllConfirm({
  count,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** How many are outstanding in the view this was pressed from. */
  count: number;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  /* Cancel takes focus, as it does on the other confirmation in this app: the
     safe one is the default, and the acting one is a deliberate second move. */
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  /**
   * Escape cancels and Tab cannot leave, in the CAPTURE phase.
   *
   * ⚠ THE ALERTS SCREEN BINDS Escape AND THE ARROWS ON THE WINDOW to step
   * and clear its selection. A bubbling Escape here would close this dialog
   * AND drop the alert behind it, which is the same trap `ClipPlayer` and
   * `SignOutConfirm` both document.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      e.preventDefault();
      e.stopPropagation();
      const onCancelBtn = document.activeElement === cancelRef.current;
      (onCancelBtn ? confirmRef : cancelRef).current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  const onOutside = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (!busy) onCancel();
    },
    [busy, onCancel],
  );

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      /* Dimmed, unlike the sign-out popover. That one is about a control in
         the corner; this one is about the list behind it, and the list is
         what the number in the title refers to. */
      className="fixed inset-0 z-200 flex items-center justify-center bg-ink/70 px-[16px]"
      onMouseDown={onOutside}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="ackall-title"
        aria-describedby="ackall-body"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={ENTER}
        className="flex w-full max-w-[360px] flex-col gap-[16px] rounded-[12px] border border-line bg-panel p-[18px] shadow-2xl"
      >
        <div className="flex flex-col gap-[6px]">
          <h2
            id="ackall-title"
            className="font-display text-[0.9375rem] leading-[20px] tracking-[0.15px] text-body-ink"
          >
            {/* The number, not "these": somebody who has scrolled a long feed
                is agreeing to a quantity they cannot see all of. */}
            Acknowledge all {count} {count === 1 ? "alert" : "alerts"}?
          </h2>
          {/* ONE LINE, and it is the one somebody would otherwise get wrong:
              the bound is the newest row on screen, so a camera that stops
              while this dialog is open is still waiting for a person
              afterwards. */}
          <p
            id="ackall-body"
            className="text-[0.8125rem] leading-[18px] text-sub/80"
          >
            Alerts that arrive after this stay unacknowledged.
          </p>
        </div>

        <div className="flex items-center justify-end gap-[8px]">
          <button
            ref={cancelRef}
            type="button"
            data-ack-all-cancel
            onClick={onCancel}
            disabled={busy}
            className="h-[38px] shrink-0 rounded-[8px] border border-stroke px-[14px] text-[0.8125rem] text-sub transition-colors hover:bg-card-hover hover:text-body-ink disabled:cursor-not-allowed disabled:text-sub/40"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-ack-all-confirm
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            /* White on black, which is what a primary action is in this
               product. NOT `critical`: red is a fault or a transmission
               here, and clearing a list is neither. */
            className="h-[38px] shrink-0 whitespace-nowrap rounded-[8px] bg-overlay px-[14px] text-[0.8125rem] font-medium text-action-ink transition-colors hover:bg-overlay/90 disabled:cursor-not-allowed disabled:bg-overlay/40"
          >
            {busy ? "Acknowledging…" : "Acknowledge all"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
