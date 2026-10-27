/**
 * "Share this camera", from wherever the camera is.
 *
 * ── THE SAME FLOW IN TWO PLACES, AND ONE OF THEM IS A CARD ────────────
 *
 * The brief asks for sharing a feed from the camera's own settings OR from
 * the feed itself, inline, without leaving it. Those are two very different
 * surfaces -- a settings row and a floating card over live video -- and they
 * must offer the same thing, so they mount this.
 *
 * It is deliberately SMALLER than the Sharing page's offer form: one camera is
 * already chosen, so there is no tower picker, and what is left is the three
 * questions that remain. Everything it does ask uses the same controls the
 * page uses, so an operator who learns one has learned both.
 *
 * ⚠ IT OFFERS, IT DOES NOT GRANT. The other site still has to accept, and
 * until they do nothing has changed. That is the whole shape of sharing here
 * and the reason this can be two taps: a mistake costs a message, not access.
 */

import { useMemo, useState } from "react";
import type { Site } from "@kallon/sentry-sdk";
import { said } from "@/lib/said";
import { deviceName } from "@/lib/deviceName";
import { useShareFeed } from "@/lib/useShareFeed";
import { useSites } from "@/lib/useSites";
import {
  Allow,
  DurationPicker,
  MessageBox,
  SitePicker,
} from "./ShareControls";

export function QuickShare({
  deviceId,
  camera,
  cameraLabel,
  onDone,
  compact,
}: {
  deviceId: string;
  /** 1-based, or undefined to offer the whole mast. */
  camera?: number;
  cameraLabel: string;
  onDone?: () => void;
  compact?: boolean;
}) {
  const feed = useShareFeed();
  const sites = useSites();
  const [otherSiteId, setOther] = useState("");
  const [ptz, setPtz] = useState(false);
  const [playback, setPlayback] = useState(false);
  /* ZERO MEANS NOTHING CHOSEN, and the Offer button stays off until it is.
     It used to open on fifteen minutes, so "share this camera" with two
     clicks lent it for a quarter of an hour that nobody had decided on. */
  const [durationSec, setDuration] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  /* ── WHOSE CAMERA IS THIS? THE SERVER ANSWERS ───────────────────────────

     An offer has to be made on behalf of the site that OWNS the mast, and a
     browser cannot know which site that is: the fleet projection carries no
     site, deliberately, and joining it here would mean a request per site to
     find out. It used to send `mine[0]` and hope -- which is right for a
     person in one site and wrong for everybody else.

     So the offer names no site of its own and the server derives it from the
     cameras, which it has to check anyway. What comes back carries the name,
     and that is what gets shown. */
  const mine = useMemo<readonly Site[]>(() => sites.value?.sites ?? [], [sites.value]);
  const [sharedAs, setSharedAs] = useState<string>("");

  const others = useMemo<readonly Site[]>(() => {
    const directory = (sites.value?.others ?? []).map((o) => ({
      site_id: o.site_id,
      name: o.name,
      status: "active" as const,
      created_at: "",
      hubs: [] as readonly string[],
    }));
    /* An admin is in every site, so their directory is empty and the list is
       their own sites instead. Either way a site that owns this camera is
       filtered out by the server, which refuses a share with itself. */
    return directory.length > 0 ? directory : mine;
  }, [sites.value, mine]);

  const send = async () => {
    setBusy(true);
    setError(null);
    const window_ = lastHour();
    try {
      const made = await feed.create({
        direction: "offer",
        otherSiteId,
        scope: [
          camera === undefined
            ? { device_id: deviceId }
            : { device_id: deviceId, cameras: [camera] },
        ],
        ...(message.trim() ? { message: message.trim() } : {}),
        live: true,
        ptz,
        playback,
        /* THE SERVER REFUSES PLAYBACK WITHOUT A WINDOW, and it is right to:
           a relative one drifts as the share ages. An offer made from a
           camera is about something happening now, so the footage anybody
           wants with it is the hour just gone. */
        ...(playback ? { playbackFrom: window_.from, playbackTo: window_.to } : {}),
        durationSec,
      });
      /* WHICH SITE IT WENT AS, from the share the server just made. Rule:
         always show who you are acting as -- and after the fact is the only
         honest moment for it here, because before the fact nobody knew. */
      setSharedAs(made.owner_site_name);
      setSent(true);
      /* A moment on screen saying it went, then out of the way. The card that
         matters next is the other site's answer. */
      setTimeout(() => onDone?.(), 2400);
    } catch (err) {
      setError(said(err, "That share did not go out."));
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <p className="text-[0.8125rem] leading-[18px] text-body-ink" role="status">
        Offered{sharedAs ? ` as ${sharedAs}` : ""}. They have to accept before
        anything changes.
      </p>
    );
  }

  if (others.length === 0) {
    return (
      <p className="text-[0.8125rem] leading-[18px] text-muted">
        There is no other site to share with yet. An administrator adds sites in
        Administration.
      </p>
    );
  }

  const gap = compact ? "gap-[10px]" : "gap-[14px]";
  return (
    <div className={`flex flex-col ${gap}`}>
      <p className="text-[0.8125rem] leading-[18px] text-body-ink">
        Share <span className="font-display">{deviceName(cameraLabel)}</span>
      </p>

      <SitePicker sites={others} value={otherSiteId} onChange={setOther} label="With" />

      <Allow
        label="Controls"
        detail="They can point it. Your site always wins a contest for the camera."
        on={ptz}
        onChange={setPtz}
      />
      <Allow
        label="Playback"
        detail="They can watch the last hour of footage from this camera."
        on={playback}
        onChange={setPlayback}
      />

      <div className="flex flex-col gap-[6px]">
        <span className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted">
          For how long
        </span>
        <DurationPicker value={durationSec} onChange={setDuration} />
      </div>

      <MessageBox
        value={message}
        onChange={setMessage}
        placeholder="Gate camera, yours for the hour."
      />

      {error ? (
        <p className="text-[0.75rem] text-critical" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={() => void send()}
          disabled={busy || !otherSiteId || durationSec <= 0}
          /* The app's primary: white fill, dark ink. See `Accept` in
             ShareNotifications -- one button style for the whole family. */
          className="rounded-[6px] bg-action px-[12px] py-[6px] font-display text-[0.75rem] tracking-[0.12px] text-action-ink transition-opacity hover:opacity-90 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
        >
          {busy ? "Sending..." : "Offer"}
        </button>
        {onDone ? (
          <button
            type="button"
            onClick={onDone}
            className="rounded-[6px] border border-stroke px-[10px] py-[5px] text-[0.75rem] text-muted transition-colors hover:text-body-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action"
          >
            Cancel
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The playback window an offer made from here carries: the last hour.
 *
 * Stated once, here, rather than guessed at both call sites. An offer made
 * from a camera is about something happening NOW, so the footage anybody wants
 * with it is the footage just before now.
 */
export function lastHour(): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - 60 * 60 * 1000).toISOString(),
    to: new Date(now).toISOString(),
  };
}
