import { useEffect, useRef, useState } from "react";
import type { PtzStatusResult, SessionRef } from "@kallon/sentry-sdk";
import { getClient } from "@/lib/api/client";

/**
 * The camera's REAL optical magnification, while an operator is zooming.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE NUMBER IS MEASURED OR IT IS NOT SHOWN. THERE IS NO THIRD OPTION.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `zoom_ratio` is the camera's own magnification, read off its CGI
 * (`status.AbsPosition[2]`, ×100) and passed through the tower untouched. This
 * hook renders that or nothing at all. It never counts button presses, and it
 * never derives an × from the normalized zoom axis — the tower refuses to do
 * that for a measured reason: the mapping is steeply non-linear on this lens
 * (0.056 normalized is already ~1.3×), and guessing it once produced "1.34×"
 * on a lens sitting at 1.20×. A readout that drifts from the glass is worse
 * than no readout, because an operator cannot tell which one they are looking
 * at.
 *
 * So every path that is not a live numeric reading resolves to `null`: the
 * camera did not answer, the request failed, the session went away. `null`
 * means the caller draws nothing.
 *
 * ── WHY IT STOPS SHOWING WHEN THE POLL STOPS ───────────────────────────
 *
 * The value clears once polling ends, rather than lingering as the last thing
 * we saw. While we are polling, the figure on screen is at most a second old.
 * Once we stop, nothing is watching the lens — a second operator, a tracker,
 * or a `home` recall can move it and the number on screen would quietly become
 * a lie with no way for anyone to notice. A readout that is only present while
 * it is *maintained* can always be trusted; one that persists can not.
 *
 * ── WHY IT IS NOT A CONTINUOUS POLL ────────────────────────────────────
 *
 * Every poll is a real round trip to a real camera over a possibly-metered
 * off-grid uplink. This runs only while a zoom is actually being held, plus a
 * short tail so the resting value lands after the hand comes off, and only on
 * the tower view. The fleet wall never calls it: eight tiles polling four
 * cameras to animate a number nobody is reading is exactly the arithmetic the
 * live-tile ceiling exists to prevent.
 *
 * Status is safe to send mid-move — the daemon's `CameraQueue` never enqueues
 * a status, so it can neither supersede the zoom nor be superseded by it.
 */

/**
 * ~2Hz. The tower's CGI reading is cached 0.4s and costs the camera 235-378ms,
 * so this is the fastest cadence that returns a genuinely new number rather
 * than re-serving one we already have.
 */
export const ZOOM_POLL_MS = 500;

/**
 * How long polling continues after the button comes up.
 *
 * A lens does not stop dead — the stop has to reach the tower, and the last
 * CGI reading trails the glass slightly. Without a tail the readout freezes on
 * the second-to-last value and the operator reads a magnification the camera
 * has already left. Long enough to settle, short enough that an idle tile is
 * not quietly talking to a camera.
 */
export const ZOOM_TAIL_MS = 2000;

function readRatio(result: PtzStatusResult | Record<string, unknown> | undefined): number | null {
  const raw = result?.["zoom_ratio"];
  /* Finite and positive, or nothing. A `0` or a NaN arriving from a camera
     mid-reboot must not render as "0.0×" — that is a reading nobody made. */
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export function useZoomReadout({
  enabled,
  session,
  camera,
  active,
}: {
  /** Tower view with a real head. The fleet wall passes `false` and never polls. */
  enabled: boolean;
  session: SessionRef | null | undefined;
  camera: number | undefined;
  /** A zoom is being held right now. */
  active: boolean;
}): number | null {
  const [ratio, setRatio] = useState<number | null>(null);

  /* Whether a poll is still in flight. At 2Hz over a WAN a request can easily
     outlive its slot, and stacking them would turn a slow link into a queue of
     requests all asking the same question. */
  const inFlight = useRef(false);

  /* Bumped whenever the thing being watched changes. A reply that arrives
     after a camera switch belongs to the old camera and must not be drawn on
     the new one. */
  const generation = useRef(0);

  const canPoll = enabled && Boolean(session) && camera !== undefined;

  /* The session's IDENTITY, not the object. A parent that rebuilds the session
     object on every render would otherwise tear the interval down and rebuild
     it each time — and since each rebuild polls immediately, a stable-looking
     tile would quietly turn into a request storm at render rate. The object
     itself is read through a ref so the poll still uses the current one. */
  const sessionId = typeof session === "string" ? session : session?.session_id;
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /* `active` is read through a ref inside the timer so that releasing the
     button does not tear down and rebuild the interval — the effect below
     depends on the tail, not on every press. */
  const activeRef = useRef(active);
  activeRef.current = active;

  /* When the tail started. `0` means "not running". */
  const [running, setRunning] = useState(false);
  const stopAt = useRef(0);

  useEffect(() => {
    if (active && canPoll) {
      stopAt.current = 0;          // held: no deadline at all
      setRunning(true);
    } else if (!active) {
      stopAt.current = Date.now() + ZOOM_TAIL_MS;
    }
  }, [active, canPoll]);

  useEffect(() => {
    if (!running || !canPoll || camera === undefined || !sessionId) return;

    const gen = ++generation.current;
    let cancelled = false;

    const poll = async () => {
      if (cancelled || inFlight.current) return;
      inFlight.current = true;
      try {
        const ref = sessionRef.current;
        if (!ref) return;
        const res = await getClient().ptzStatus(ref, camera);
        if (cancelled || gen !== generation.current) return;
        setRatio(readRatio(res.result));
      } catch {
        /* A failed status is not a zoom level. Clear it — the same rule the
           tower follows when its CGI goes quiet, and the reason there is no
           `catch` branch here that keeps the old number. */
        if (!cancelled && gen === generation.current) setRatio(null);
      } finally {
        inFlight.current = false;
      }
    };

    void poll();
    const timer = setInterval(() => {
      /* The tail: keep going while held, then until the deadline passes. */
      if (!activeRef.current && stopAt.current !== 0 && Date.now() > stopAt.current) {
        setRunning(false);
        return;
      }
      void poll();
    }, ZOOM_POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, canPoll, camera, sessionId]);

  /* Nothing is watching the lens any more, so nothing may be claimed about it. */
  useEffect(() => {
    if (!running) setRatio(null);
  }, [running]);

  return canPoll ? ratio : null;
}

/**
 * The readout as it is drawn: `2.4×`.
 *
 * One decimal, because the camera reports two (`1.20`) and a trailing hundredth
 * on a figure that moves continuously reads as noise rather than precision.
 * `null` in, `null` out — the caller renders nothing.
 */
export function formatZoom(ratio: number | null): string | null {
  return ratio === null ? null : `${ratio.toFixed(1)}×`;
}
