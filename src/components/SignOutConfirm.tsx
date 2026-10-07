import { motion } from "motion/react";
import { useCallback, useEffect, useRef } from "react";
import { ENTER } from "@/lib/motion";

/**
 * "Sign out of Sentry?" — the one destructive control in the rail that had no
 * confirmation.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS EXISTS
 * ══════════════════════════════════════════════════════════════════════
 *
 * The sign-out glyph is 34px, at the bottom of the rail, one pixel-accurate
 * click from the simulator button above it — and it ended the session on the
 * first click with nothing in between. On a control-room wall that is a
 * mis-click that blanks the screen somebody is watching, and on the hub's
 * kiosk monitor it is a mis-touch.
 *
 * ⚠ ONLY THE PERSON'S OWN CLICK ASKS. An automatic sign-out — a session that
 * lapsed, or the forced one after a password change — must NOT show this. Those
 * paths go through `markSessionEnded` and `clearSession` in `api/auth.ts` and
 * never touch `signOut`, which is the only thing this dialog guards. That is
 * structural rather than a rule somebody has to remember: this component is
 * mounted by the BUTTON, so a programmatic session end cannot reach it. There
 * is a test asserting `signOut` has exactly one caller.
 *
 * ── THE DEFAULT IS CANCEL, AND IT IS FOCUSED ───────────────────────────
 *
 * Cancel takes focus on open, so Enter and Space — the two keys somebody
 * already mashing a 34px button is most likely to hit next — cancel rather
 * than confirm. The destructive action is reachable only by moving to it
 * deliberately.
 *
 * ── THE FOCUS TRAP IS NOT DECORATION ───────────────────────────────────
 *
 * `aria-modal` promises a screen reader that the rest of the page is inert. If
 * Tab walks out into the wall behind it, that promise is false and somebody
 * using a keyboard is operating controls they cannot see the state of. Two
 * buttons make the trap four lines, so there is no excuse for omitting it.
 *
 * `ClipPlayer` and the fullscreen tile carry `aria-modal` without a trap. They
 * are full-screen takeovers where tabbing out is less consequential, and they
 * are not fixed here because widening this change into two other components is
 * not what it is for. Recorded rather than quietly diverged from.
 *
 * ── z-200, ABOVE THE PLAYER ────────────────────────────────────────────
 *
 * `IconRail` renders INSIDE `ClipPlayer`, which is `fixed inset-0 z-100`. So
 * this dialog can be opened from on top of the player, and at z-100 it would
 * have been painted underneath the thing it was launched from.
 */
export function SignOutConfirm({
  account,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** The organization being left. Named so a shared kiosk says whose session. */
  account?: string;
  /** True while the sign-out request is in flight. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  /* Cancel takes focus on open — see the header. A ref rather than `autoFocus`
     because `autoFocus` inside an animated subtree is applied before the
     element is laid out and is silently dropped often enough not to rely on. */
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  /**
   * Escape cancels, and Tab cannot leave.
   *
   * CAPTURE PHASE, and it stops propagation for the keys it owns — the same
   * reasoning `ClipPlayer` documents: the alerts panel binds Escape on the
   * window to drop its selection, so a bubbling Escape here would close this
   * dialog AND change the screen behind it. Capture runs first regardless of
   * registration order.
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
      /* Two focusable things, so the cycle is explicit rather than computed
         from a query of focusable descendants. */
      e.preventDefault();
      e.stopPropagation();
      const onCancelBtn = document.activeElement === cancelRef.current;
      (onCancelBtn ? confirmRef : cancelRef).current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  /* Clicking the scrim cancels. Guarded on the target being the scrim ITSELF so
     a drag that starts on the panel and ends outside does not close it, and so
     a click inside never bubbles out as a dismissal. */
  const onScrim = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (!busy) onCancel();
    },
    [busy, onCancel],
  );

  return (
    <div
      /* THE SCRIM STAYS DARK IN BOTH THEMES. It is a scrim over the product,
         not a surface in it — the same rule the `bg-black/NN` overlays follow
         after the theme sweep. A light scrim over a light page would not read
         as "the thing behind is inert". */
      className="fixed inset-0 z-200 flex items-center justify-center bg-black/60 p-[16px]"
      onMouseDown={onScrim}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        aria-describedby="signout-body"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={ENTER}
        className="flex w-[380px] max-w-full flex-col gap-[18px] rounded-[12px] border border-line bg-panel p-[22px] shadow-2xl"
      >
        <div className="flex flex-col gap-[6px]">
          <h2
            id="signout-title"
            className="font-display text-[1rem] leading-[22px] tracking-[0.16px] text-body-ink"
          >
            Sign out of Sentry?
          </h2>
          <p
            id="signout-body"
            className="text-[0.8125rem] leading-[20px] text-sub/80"
          >
            {account
              ? `You will be signed out of ${account} on this device and returned to the sign-in screen.`
              : "You will be returned to the sign-in screen."}
          </p>
        </div>

        {/* Cancel FIRST in the DOM, so it is also first in the tab order and
            the focused default. The destructive action sits to its right, which
            is where this product's other confirmations put it. */}
        <div className="flex justify-end gap-[10px]">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-[44px] rounded-[8px] border border-stroke px-[18px] text-[0.875rem] text-sub transition-colors hover:bg-card-hover hover:text-body-ink disabled:cursor-not-allowed disabled:text-sub/40"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            /* `critical`, because it ends the session. The only saturated
               colour in this dialog, so it is unmistakably the one that acts. */
            className="h-[44px] rounded-[8px] bg-critical px-[18px] text-[0.875rem] font-medium text-critical-ink transition-colors hover:bg-critical/90 disabled:cursor-not-allowed disabled:bg-critical/40"
          >
            {busy ? "SIGNING OUT…" : "Sign out"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
