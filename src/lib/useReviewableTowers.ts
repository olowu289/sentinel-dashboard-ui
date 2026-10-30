import { useCallback, useEffect, useState } from "react";
import type { ReviewableTower } from "@kallon/sentry-sdk";
import { listReviewableTowers } from "./api/recordings";

/**
 * What Playback can offer, which is not the same list as what is online.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A REVIEW SCREEN MUST NOT BE BUILT FROM THE LIVE FLEET.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `listFleet` projects every tower from its live hello. An OFFLINE tower has no
 * hello, so it arrives with an empty `cameras` array, and Playback drew its camera
 * buttons from exactly that: the tower appeared in the selector and then said "This
 * site has no cameras to review", with 270 segments and 25.8 GB sitting on the hub's
 * disk. Nothing was refusing the footage; the screen could not ask for it.
 *
 * A tower being offline is frequently the whole reason somebody opened this screen.
 *
 * So the list comes from the ARCHIVE, and `online` is carried only so the UI can
 * badge it. Live viewing is unaffected and keeps its own source: an offline tower
 * genuinely has no feed, and saying so there is correct.
 *
 * ── WHEN IT FAILS, IT SAYS SO ─────────────────────────────────────────
 *
 * ⚠ THIS USED TO SWALLOW EVERY FAILURE INTO ONE `unavailable`, AND THE
 * DOCSTRING PROMISED A FALLBACK THAT DOES NOT EXIST. The words were "a hub too
 * old to serve the endpoint, or a failed request, leaves `towers` null and the
 * caller uses the live fleet exactly as before" -- and no caller ever did.
 * `FootageView` mapped the failure to an empty array, so a 403 from
 * coordination drew an EMPTY DROPDOWN with no explanation and no day of
 * footage behind it. On the live site that is how it was reported: "the
 * device dropdown is empty and no recordings are shown", for a bucket that
 * was filling correctly the whole time.
 *
 * An empty list and a refused request are two different facts and one of them
 * is the operator's to act on, so there are two phases and each carries its
 * own sentence. The 403 is separated from the rest because it is the only one
 * retrying cannot fix: an account that may not see footage will still not see
 * it in ten seconds, and offering a button that cannot work is worse than
 * offering none.
 */

export type ReviewPhase =
  | { kind: "loading" }
  | { kind: "ready"; towers: ReviewableTower[] }
  /** The server said no. Not retryable, so nothing offers to. */
  | { kind: "refused"; message: string }
  /** Anything else: unreachable, a 500, a body that was not a list. */
  | { kind: "failed"; message: string };

/** The account may not see recorded footage. One sentence, nothing to do. */
export const REVIEW_REFUSED = "Footage isn't available for this account.";
/** Everything else, and there IS something to do. */
export const REVIEW_FAILED = "Couldn't load towers. Try again.";

/** A refusal, which no amount of retrying changes. */
function refused(err: unknown): boolean {
  const status = (err as { status?: unknown } | null)?.status;
  const code = (err as { code?: unknown } | null)?.code;
  return status === 403 || code === "forbidden";
}

export interface ReviewableTowers {
  readonly phase: ReviewPhase;
  /** Ask again. Only offered for {@link ReviewPhase} `failed`. */
  readonly retry: () => void;
}

export function useReviewableTowers(): ReviewableTowers {
  const [phase, setPhase] = useState<ReviewPhase>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      /* Back to the spinner on a retry, so pressing the button visibly does
         something even when the second answer is the same as the first. */
      setPhase({ kind: "loading" });
      try {
        const towers = await listReviewableTowers(controller.signal);
        if (controller.signal.aborted) return;
        setPhase({ kind: "ready", towers });
      } catch (err) {
        if (controller.signal.aborted) return;
        setPhase(
          refused(err)
            ? { kind: "refused", message: REVIEW_REFUSED }
            : { kind: "failed", message: REVIEW_FAILED },
        );
      }
    })();
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  return { phase, retry };
}
