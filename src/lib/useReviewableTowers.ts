import { useEffect, useState } from "react";
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
 * ── FALLING BACK ───────────────────────────────────────────────────────
 *
 * A hub too old to serve the endpoint, or a failed request, leaves `towers` null and
 * the caller uses the live fleet exactly as before. Degrading to the previous
 * behaviour is better than an empty screen.
 */

export type ReviewPhase =
  | { kind: "loading" }
  | { kind: "ready"; towers: ReviewableTower[] }
  | { kind: "unavailable" };

export function useReviewableTowers(): ReviewPhase {
  const [phase, setPhase] = useState<ReviewPhase>({ kind: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const towers = await listReviewableTowers(controller.signal);
        if (controller.signal.aborted) return;
        setPhase({ kind: "ready", towers });
      } catch {
        if (controller.signal.aborted) return;
        // Quiet on purpose: the caller falls back to the live fleet, which is what
        // this screen used before. An error banner for something the operator
        // cannot act on, over a screen that is about to work, is noise.
        setPhase({ kind: "unavailable" });
      }
    })();
    return () => controller.abort();
  }, []);

  return phase;
}
