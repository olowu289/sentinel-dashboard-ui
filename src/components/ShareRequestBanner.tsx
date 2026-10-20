/**
 * "North Gate wants to see one of your cameras."
 *
 * ══════════════════════════════════════════════════════════════════════
 *  NON-BLOCKING, AND THAT IS THE WHOLE SPECIFICATION
 * ══════════════════════════════════════════════════════════════════════
 *
 * It sits above the screen and pushes nothing. It is not a modal, it does not
 * steal focus, and it never covers a camera: an operator watching a feed
 * because something is happening must not have a permissions question put in
 * front of it. The same slot and the same posture as `NewAlertBanner`, for the
 * same reason.
 *
 * It is DISMISSIBLE and the share does not go away when it is dismissed: the
 * Shares view still has it, still pending. A banner that was the only way to
 * answer would make dismissing it a decision nobody meant to make.
 *
 * ── TIME ───────────────────────────────────────────────────────────────
 *
 * `formatRelative`, which `lib/time.ts` reserves for exactly two places: the
 * new-alert banner and the tower card's alert strip. This is the third, and it
 * qualifies on the same terms -- one transient line whose whole job is *this
 * just happened*, and it does not re-tick.
 *
 * ── ACCEPT HERE IS THE PLAIN ACCEPT ────────────────────────────────────
 *
 * Accepting from the banner grants exactly what was asked for. Narrowing the
 * scope, the permissions or the duration is a decision with fields, and fields
 * belong on the Shares view; "Review" goes there. A banner that let somebody
 * change the scope in two taps would be a banner that got it wrong in two taps.
 */

import { motion } from "motion/react";
import { useCallback, useState } from "react";
import type { Share } from "@kallon/sentry-sdk";
import { acceptShare, declineShare } from "@/lib/api/sites";
import { ENTER } from "@/lib/motion";
import { formatRelative } from "@/lib/time";

export function ShareRequestBanner({
  shares,
  onReview,
  onAnswered,
  className = "",
}: {
  /** Pending shares on MY cameras. The caller filters; this renders the first. */
  shares: readonly Share[];
  onReview: () => void;
  onAnswered: () => void;
  className?: string;
}) {
  const [dismissed, setDismissed] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);

  const pending = shares.filter((s) => !dismissed.includes(s.share_id));
  const share = pending[0];

  const answer = useCallback(
    async (what: "accept" | "decline") => {
      if (!share) return;
      setBusy(true);
      try {
        if (what === "accept") await acceptShare(share.share_id);
        else await declineShare(share.share_id);
        onAnswered();
      } finally {
        setBusy(false);
      }
    },
    [share, onAnswered],
  );

  if (!share) return null;

  const towers = share.scope.length;
  const asking = share.viewer_site_name || "Another site";
  const wants: string[] = [];
  if (share.live) wants.push("live view");
  if (share.ptz) wants.push("camera control");
  if (share.playback) wants.push("footage");

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      role="status"
      aria-live="polite"
      className={
        "flex flex-wrap items-center gap-x-[16px] gap-y-[8px] border-b border-detect/40 bg-detect-bg px-[16px] py-[10px] " +
        className
      }
    >
      <p className="min-w-[220px] flex-1 text-[0.8125rem] leading-[20px] text-sub">
        <span className="font-display text-detect">{asking}</span>{" "}
        {share.direction === "request" ? "wants to see" : "is offering"}{" "}
        {towers === 1 ? "a camera" : `${towers} towers`}
        {wants.length ? ` (${wants.join(", ")})` : ""}
        <span className="text-muted">
          {" · "}
          {formatRelative(Date.parse(share.created_at))}
        </span>
        {pending.length > 1 ? (
          <span className="text-muted">
            {" · "}
            {pending.length - 1} more waiting
          </span>
        ) : null}
      </p>
      <div className="flex shrink-0 items-center gap-[8px]">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("accept")}
          className="rounded-[8px] bg-action px-[12px] py-[6px] font-display text-[0.8125rem] text-action-ink transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Accept
        </button>
        <button
          type="button"
          onClick={onReview}
          className="rounded-[8px] border border-stroke px-[12px] py-[6px] text-[0.8125rem] text-body-ink transition-colors hover:bg-card-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Review
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer("decline")}
          className="rounded-[8px] border border-stroke px-[12px] py-[6px] text-[0.8125rem] text-muted transition-colors hover:text-sub disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          Decline
        </button>
        <button
          type="button"
          aria-label="Dismiss for now"
          title="Dismiss for now. It stays in Shares."
          onClick={() => setDismissed((d) => [...d, share.share_id])}
          className="rounded-[8px] px-[8px] py-[6px] text-[0.8125rem] text-muted transition-colors hover:text-sub focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          {"×"}
        </button>
      </div>
    </motion.div>
  );
}
