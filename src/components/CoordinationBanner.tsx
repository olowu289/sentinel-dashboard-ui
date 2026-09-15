import { motion } from "motion/react";
import { ENTER } from "@/lib/motion";
import { MaskIcon } from "./Icon";
import type { ReachProblem } from "@/lib/api/reach";
import type { MutationPhase } from "@/lib/useMutation";
import { MutationSpinner } from "./MutationFeedback";

/**
 * A global condition, said once, at the top of the app.
 *
 * ── WHY THIS IS NOT A FEED STATE ───────────────────────────────────────
 *
 * "Cannot reach coordination" is not a fact about a camera, and putting it in
 * `FeedChip` would be a category error with a real consequence: four tiles each
 * reporting the same outage reads as four separate faults, and an operator
 * would go looking for four causes. `FeedChip` speaks about one camera at a
 * time. This speaks about the whole app's ability to ask anything at all.
 *
 * So it sits above every screen, once, and it does not touch the tiles. A
 * camera whose tower genuinely went down still says so on its own tile; this
 * says why we might not know either way.
 *
 * ── COLOUR ─────────────────────────────────────────────────────────────
 *
 * Amber for an outage: it is not a fault at a site and not the operator's
 * mistake, and amber's standing claim in this app is *this needs you*. Red for
 * a client bug, because that genuinely is a fault — ours — and the one thing
 * that must not happen is a defect wearing the same colour as a network blip.
 *
 * ── NOT DISMISSIBLE ────────────────────────────────────────────────────
 *
 * Deliberately, and unlike the alert and battery banners. Those report an event
 * that has already been read; this reports a standing inability to know
 * anything, and an operator who waved it away would be left reading a fleet
 * screen with no way to tell that it had stopped being current. It leaves when
 * the condition does.
 */
export function CoordinationBanner({
  problem,
  onRetry,
  phase = { kind: "idle" },
}: {
  problem: ReachProblem;
  onRetry?: () => void;
  /** What the Try again button is doing, from `useMutation`. */
  phase?: MutationPhase;
}) {
  const bug = problem.failure === "client_bug";

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={ENTER}
      role="alert"
      className={`relative z-200 flex shrink-0 items-start gap-[10px] overflow-hidden px-[16px] py-[10px] ${
        bug ? "bg-critical text-white" : "bg-advice-banner text-advice-ink"
      }`}
    >
      <MaskIcon
        src="/icons/banner-alert.svg"
        size={20}
        className={`mt-[1px] shrink-0 ${bug ? "text-white" : "text-advice-ink"}`}
      />
      <div className="flex min-w-0 flex-col gap-[2px]">
        <p className="text-[0.875rem] leading-[20px] font-medium tracking-[0.14px]">
          {problem.headline}
        </p>
        <p
          className={`text-[0.8125rem] leading-[18px] ${
            bug ? "text-white/85" : "text-advice-ink/80"
          }`}
        >
          {problem.detail}
        </p>
        {/* ⚠ THE TRANSPORT'S OWN WORDS USED TO BE PRINTED HERE, in mono, under
            the detail line: "Failed to fetch", "Illegal invocation", a bare
            status. It is genuinely the line that says WHICH of the three
            identical-looking failures this was — but on a wall-mounted screen
            in front of somebody watching a yard it reads as the app having come
            apart, and there is nothing they can do with it. It goes to the
            console instead, from `classifyReach`, with the name, status and
            code beside it, which is more than was ever on screen. */}
      </div>

      {/* Deliberate, operator-driven, and only where retrying could help. A
          client bug will fail again identically, so offering the button there
          would be inviting somebody to press it until they believed the
          service was at fault. */}
      {onRetry && !bug && (
        <button
          type="button"
          onClick={onRetry}
          disabled={phase.kind === "pending"}
          aria-busy={phase.kind === "pending" || undefined}
          className="ml-auto flex shrink-0 items-center gap-[6px] rounded-[6px] border border-advice-ink/30 px-[12px] py-[5px] text-[0.75rem] font-medium text-advice-ink transition-colors hover:border-advice-ink/60 disabled:opacity-50"
        >
          {phase.kind === "pending" && <MutationSpinner size={12} />}
          {phase.kind === "pending" ? "Trying…" : "Try again"}
        </button>
      )}
    </motion.div>
  );
}
