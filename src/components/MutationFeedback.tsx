import { AnimatePresence, motion } from "motion/react";
import { FADE } from "@/lib/motion";
import type { MutationPhase } from "@/lib/useMutation";

/**
 * What a mutation looks like while it works, when it lands, and when it fails.
 *
 * Nothing here is a new visual language. The spinner and the
 * check-that-retracts are lifted from `ClipCard`'s export button, which has
 * shipped since before there was a backend; the inline failure is
 * `AddTowerView`'s manual-entry error, which is this app's established idiom
 * for "the thing you just did did not work, and here is why, next to where you
 * did it".
 *
 * The only decision taken here is the colour, and it follows the reserved-colour
 * rule rather than inventing an exception: a failed command is `--color-critical`,
 * because a command that did not run is a fault. Amber would be wrong — amber is
 * a reading about a site, and this is a statement about an action.
 */

/** The same 16px spinner `ClipCard` shows while an export is working. */
export function MutationSpinner({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className="animate-spin [animation-duration:800ms]"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="2.5"
      />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** `ClipCard`'s check. */
export function MutationCheck({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="m3 8.5 3.5 3.5L13 5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The icon slot for a control that runs a mutation.
 *
 * `mode="wait"` and a scale swap, exactly as `ClipCard` does it: at this size a
 * crossfade is invisible and two glyphs dissolving through each other is mush.
 * The done → idle step animates too, so the check *retracts* rather than
 * blinking out — a success state that vanishes reads as a failure.
 */
export function MutationIcon({
  phase,
  idle,
  size = 16,
}: {
  phase: MutationPhase;
  /** What the control shows when nothing is happening. */
  idle: React.ReactNode;
  size?: number;
}) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.span
        key={phase.kind}
        initial={{ opacity: 0, scale: 0.6 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.6 }}
        transition={FADE}
        className="flex items-center justify-center"
      >
        {phase.kind === "pending" ? (
          <MutationSpinner size={size} />
        ) : phase.kind === "done" ? (
          <MutationCheck size={size} />
        ) : (
          idle
        )}
      </motion.span>
    </AnimatePresence>
  );
}

/**
 * A failure, said where the action was taken.
 *
 * Inline rather than as a page banner, which is where this app already puts a
 * failed action — see the serial and pairing-code step, whose error sits under
 * the two fields it is about. A toast would put the explanation somewhere other
 * than the thing that needs explaining, and on a screen with several controls
 * that is a guessing game.
 *
 * The message is the real one, verbatim. The typed errors in this app already
 * say something useful and specific; paraphrasing them into "something went
 * wrong" would throw away the only part an operator can act on.
 */
export function MutationError({
  phase,
  onRetry,
  onDismiss,
  className = "",
}: {
  phase: MutationPhase;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
}) {
  if (phase.kind !== "error") return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={FADE}
      role="alert"
      className={`flex flex-wrap items-center gap-x-[10px] gap-y-[4px] ${className}`}
    >
      <p className="min-w-0 flex-1 text-[0.8125rem] leading-[20px] text-critical">
        {phase.message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="shrink-0 rounded-[6px] border border-critical/40 px-[10px] py-[3px] text-[0.75rem] font-medium text-critical transition-colors hover:border-critical hover:bg-critical/10"
        >
          Try again
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-[6px] px-[8px] py-[3px] text-[0.75rem] text-muted transition-colors hover:text-white"
        >
          Dismiss
        </button>
      )}
    </motion.div>
  );
}

/**
 * Screen-reader confirmation.
 *
 * The icon swap is invisible to assistive technology, which is why `ClipCard`
 * already carries one of these. Pending is announced too, not just success: a
 * control that has gone quiet for two seconds is exactly when somebody needs to
 * be told it is working.
 */
export function MutationStatus({
  phase,
  label,
}: {
  phase: MutationPhase;
  /** What is being done, e.g. "Acknowledging alert ALT-8841". */
  label: string;
}) {
  return (
    <span role="status" className="sr-only">
      {phase.kind === "pending"
        ? `${label}…`
        : phase.kind === "done"
          ? `${label} — done`
          : phase.kind === "error"
            ? `${label} — failed. ${phase.message}`
            : ""}
    </span>
  );
}

/** `ring-1 ring-critical` on the control that failed, per `AddTowerView`. */
export function errorRing(phase: MutationPhase): string {
  return phase.kind === "error" ? "ring-1 ring-critical" : "";
}
