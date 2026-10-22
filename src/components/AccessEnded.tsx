/**
 * A share ended while somebody was watching, said properly.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT WAS ON SCREEN
 * ══════════════════════════════════════════════════════════════════════
 *
 * A borrowed camera's share ran out mid-watch and the screen said:
 *
 *     kln_lab_000002 IS UNAVAILABLE
 *     This tower is not on your fleet any more. It may have been removed, or
 *     access to it may have ended.
 *
 * Three things wrong with four lines. A device serial as the headline. A
 * sentence that reads as a fault ("not on your fleet any more") about the
 * system working exactly as designed. And a list of two possible causes, so
 * the person watching has to guess which happened to them, with nothing to do
 * about either.
 *
 * What actually happened is ordinary and has an obvious next step: the loan
 * finished, and they can ask for more time. So that is what this says, and the
 * button does it.
 *
 * ── THE THREE STATES THIS SCREEN IS NOT ───────────────────────────────
 *
 * A tower that is OFFLINE and a tower that has been REMOVED are different
 * facts with different answers, and neither is "your access ended". They get
 * their own sentences (`CameraGone`), and the caller decides which it is from
 * the share feed rather than from a guess: if a live share for this camera
 * ended, access ended; if there never was one, the camera is simply gone.
 */

import { useCallback, useMemo, useState } from "react";
import { motion } from "motion/react";
import { ENTER } from "@/lib/motion";
import { said } from "@/lib/said";
import { DurationPicker } from "@/components/sharing/ShareControls";
import { useShareFeed } from "@/lib/useShareFeed";
import { useActingSite } from "@/lib/useActingSite";
import type { Share } from "@kallon/sentry-sdk";

/**
 * The share that lent this camera to me and has now finished, if there was one.
 *
 * Newest first, so re-asking after a second expiry asks the site that lent it
 * most recently rather than whoever lent it in March.
 */
export function useEndedShareFor(deviceId: string | null | undefined): Share | null {
  const feed = useShareFeed();
  return useMemo(() => {
    if (!deviceId) return null;
    const mine = feed.finished.filter(
      (s) =>
        /* LENT TO ME, not by me: `outgoing` means one of my sites owns the
           cameras, and an owner whose own camera went offline is not somebody
           whose access ended. */
        s.incoming !== true &&
        (s.scope ?? []).some((e) => e.device_id === deviceId),
    );
    const byNewest = [...mine].sort(
      (a, b) =>
        Date.parse(b.decided_at ?? b.created_at) -
        Date.parse(a.decided_at ?? a.created_at),
    );
    return byNewest[0] ?? null;
  }, [feed.finished, deviceId]);
}

/**
 * "Your access to these cameras has ended", with a way forward.
 *
 * `onClose` is the Close button: it dismisses and nothing else. The request
 * goes to the site that OWNED the share, which is the only site that can grant
 * it — asking anybody else would be a request nobody can answer.
 */
export function AccessEnded({
  share,
  onClose,
}: {
  /** The share that ended. Its owning site is who gets asked. */
  share: Share | null;
  onClose: () => void;
}) {
  const feed = useShareFeed();
  const acting = useActingSite();
  const [asking, setAsking] = useState(false);
  const [durationSec, setDurationSec] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* WHICH OF MY SITES ASKS. The share names it: the site the cameras were lent
     to is the site that wants them back. Falling back to whichever site I am
     acting as covers a share this client never saw land. */
  const mySiteId = share?.viewer_site_id ?? acting.site?.site_id ?? "";
  const ownerSiteId = share?.owner_site_id ?? "";
  const ownerName = share?.owner_site_name?.trim() || "the other site";

  const ask = useCallback(() => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await feed.create({
          direction: "request",
          mySiteId,
          otherSiteId: ownerSiteId,
          /* A REQUEST HAS TO SAY WHY: the server refuses one without a
             message, and the site answering it has nothing else to go on. This
             one writes itself, because the person asking has just been cut off
             mid-watch. */
          message: "Our access to these cameras has ended. May we have more time?",
          durationSec,
        });
        setSent(true);
      } catch (err) {
        setError(said(err, "That request did not go out. Try again."));
      } finally {
        setBusy(false);
      }
    })();
  }, [feed, mySiteId, ownerSiteId, durationSec]);

  if (sent) {
    return (
      <Frame>
        <p className="text-[0.875rem] leading-[20px] text-body-ink" data-testid="access-sent">
          Request sent. You&rsquo;ll see the cameras again if it&rsquo;s accepted.
        </p>
        <Buttons>
          <Primary onClick={onClose}>Close</Primary>
        </Buttons>
      </Frame>
    );
  }

  return (
    <Frame>
      <p
        className="font-display text-[0.9375rem] leading-[22px] text-body-ink"
        data-testid="access-ended"
      >
        Your access to these cameras has ended.
      </p>
      {asking ? (
        <div className="flex w-full max-w-[320px] flex-col gap-[10px]">
          <p className="text-[0.8125rem] leading-[18px] text-muted">
            How much longer do you need? {ownerName} decides.
          </p>
          <DurationPicker value={durationSec} onChange={setDurationSec} />
          {error ? (
            <p role="alert" className="text-[0.8125rem] leading-[18px] text-critical">
              {error}
            </p>
          ) : null}
          <Buttons>
            <Primary onClick={ask} disabled={busy || durationSec <= 0}>
              {busy ? "Sending…" : "Send request"}
            </Primary>
            <Quiet onClick={() => setAsking(false)}>Back</Quiet>
          </Buttons>
        </div>
      ) : (
        <Buttons>
          <Primary onClick={() => setAsking(true)} disabled={!ownerSiteId || !mySiteId}>
            Request more time
          </Primary>
          <Quiet onClick={onClose}>Close</Quiet>
        </Buttons>
      )}
    </Frame>
  );
}

/**
 * A camera that is offline, or one that is genuinely gone.
 *
 * ⚠ NEVER THE SHARE SENTENCE. "Your access has ended" about a tower whose
 * radio is down would send somebody to ask for permission they already have.
 */
export function CameraGone({
  reason,
  onClose,
}: {
  reason: "offline" | "removed";
  onClose: () => void;
}) {
  return (
    <Frame>
      <p
        className="font-display text-[0.9375rem] leading-[22px] text-body-ink"
        data-testid={reason === "offline" ? "camera-offline" : "camera-removed"}
      >
        {reason === "offline"
          ? "This camera is offline right now."
          : "This camera is no longer available."}
      </p>
      <p className="max-w-[320px] text-center text-[0.8125rem] leading-[18px] text-muted">
        {reason === "offline"
          ? "Its site will show it again as soon as it is back."
          : "It may have been removed from the site."}
      </p>
      <Buttons>
        <Primary onClick={onClose}>Close</Primary>
      </Buttons>
    </Frame>
  );
}

/* ---------------------------------------------------------------- *
 * The small pieces, shared by the three states so they cannot drift
 * ---------------------------------------------------------------- */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={ENTER}
      className="flex h-full w-full flex-col items-center justify-center gap-[14px] bg-ink px-[24px] text-center"
    >
      {children}
    </motion.div>
  );
}

function Buttons({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-center gap-[8px]">{children}</div>;
}

function Primary({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="h-[36px] rounded-[8px] bg-action px-[16px] text-[0.8125rem] font-medium text-action-ink transition-colors hover:bg-overlay/90 disabled:cursor-not-allowed disabled:bg-overlay/25 disabled:text-action-ink/40"
    >
      {children}
    </button>
  );
}

function Quiet({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-[36px] rounded-[8px] border border-stroke px-[16px] text-[0.8125rem] text-body-ink transition-colors hover:bg-card-hover"
    >
      {children}
    </button>
  );
}
