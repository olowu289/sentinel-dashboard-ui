import { useCallback, useRef, useState } from "react";
import type { AlertClip } from "@kallon/sentry-sdk";

/**
 * WHY A CLIP WOULD NOT LOAD, AND WHICH OF THE TWO ANSWERS IT IS.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  A `<video>` ELEMENT CANNOT TELL YOU, AND THE TWO NEED OPPOSITE REPLIES
 * ══════════════════════════════════════════════════════════════════════
 *
 * `MediaError` has four codes and no status in any of them, so an expired
 * ticket and a swept file arrive as the same event. They are not the same
 * thing:
 *
 *   403  THE TICKET EXPIRED. `url` is minted per request and a presigned
 *        bucket URL lives fifteen minutes, so an operator who leaves the feed
 *        open through a shift and opens an alert from this morning hits this.
 *        The evidence is one request away, and a screen that said "broken"
 *        would be telling them it is gone.
 *   404  THE BUDGET SWEPT THE FILE. Clips go before footage, never the other
 *        way round, and the alert survives its clip deliberately: an alert is
 *        the record that the camera stopped at 03:14, and deleting it to save
 *        an attachment would be deleting the incident.
 *
 * One ranged byte through the same signed URL the element used is the
 * cheapest honest way to ask, and it learns exactly what the element learned.
 *
 * ── RETRIED ONCE, AND ONCE IS THE NUMBER ──────────────────────────────
 *
 * ⚠ A second 403 after a fresh mint is not an expiry; it is a server
 * refusing, and retrying it in a loop would be this app causing the outage it
 * is reporting.
 *
 * ── AND THE STATE IS KEYED BY ALERT ID ────────────────────────────────
 *
 * ⚠ BECAUSE `AlertDetail` IS NEVER REMOUNTED. The feed swaps its content in
 * place so arrowing through alerts stays instant, so a bare `useState` here
 * would carry one incident's "Clip no longer kept" onto the next one's
 * title — which is the trap CLAUDE.md documents, and on this surface it reads
 * as evidence having been destroyed. A map keyed by id makes the swap safe by
 * construction rather than by remembering.
 */

/** What this browser has learned about one alert's clips. */
export interface ClipHealth {
  /** The file is gone. The alert stays, and says so. */
  evicted: boolean;
  /** Called by whatever element failed to load one of this alert's clips. */
  report: (clip: AlertClip) => void;
}

/**
 * Ask the server what actually went wrong.
 *
 * `null` for a network failure, which is neither an expiry nor an eviction
 * and must not be rendered as either.
 */
async function statusOf(url: string): Promise<number | null> {
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0" } });
    return res.status;
  } catch {
    return null;
  }
}

export function useClipHealth(
  alertId: string,
  /** Re-read the alert, for fresh URLs. Returns once the feed has them. */
  refresh: (id: string) => Promise<void>,
): ClipHealth {
  const [evicted, setEvicted] = useState<Record<string, true>>({});
  /* Per clip key, not per alert: two cameras expire together and each will
     report, and the second must not spend the first's one retry. */
  const retried = useRef<Set<string>>(new Set());

  const report = useCallback(
    (clip: AlertClip) => {
      const url = clip.url;
      if (!url) return;
      void (async () => {
        const status = await statusOf(url);
        if (status === 404) {
          setEvicted((prev) => (prev[alertId] ? prev : { ...prev, [alertId]: true }));
          return;
        }
        if (status !== 403) return;
        if (retried.current.has(clip.key)) return;
        retried.current.add(clip.key);
        await refresh(alertId).catch(() => {});
      })();
    },
    [alertId, refresh],
  );

  return { evicted: evicted[alertId] === true, report };
}
