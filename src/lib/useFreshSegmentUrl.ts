import { useCallback, useEffect, useRef, useState } from "react";
import type { ArchivedSegment } from "@kallon/sentry-sdk";
import { freshSegmentUrl } from "./api/recordings";

/**
 * A playable URL for the selected segment, minted when it is actually opened.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE LIST'S URLS START AGEING WHEN THE LIST IS BUILT, NOT WHEN YOU CLICK.
 * ══════════════════════════════════════════════════════════════════════
 *
 * `listArchivedRecordings` returns a URL for every segment in the day. On the data
 * centre those are PRESIGNED bucket URLs with a fixed lifetime, and the clock starts
 * the moment the list is assembled. An operator who loads a day, scans it for ten
 * minutes and then opens a clip is handed a URL with a fraction of its life left.
 *
 * When it runs out mid-clip the browser does not report anything useful: the video
 * simply stops buffering. That is indistinguishable from the slow start the archive
 * remux exists to fix, which is exactly why it is worth removing as a possibility
 * rather than reasoning about whether the window is "probably long enough".
 *
 * So: ask for a URL when a segment is opened, and ask once more if the media element
 * errors. The list's URL remains the fallback, so a hub that does not serve this
 * endpoint, or a failed request, still plays exactly as before.
 *
 * ── WHY A HOOK AND NOT A FETCH IN THE COMPONENT ───────────────────────
 *
 * Because of the races. A user clicking down a list faster than the network answers
 * must not end up with clip A's URL in the player showing clip B, and a response
 * arriving after the component has moved on must not overwrite anything. Both are
 * handled here, once, with a request sequence number.
 */

export interface FreshUrls {
  /** Play this. Falls back to the list's URL until a fresh one arrives. */
  url: string;
  /** Download this. Same fallback. */
  downloadUrl: string;
  /** The readable name, preferring the freshly minted one. */
  filename: string;
  /** True while a fresh URL is being fetched for the current segment. */
  resolving: boolean;
  /** Ask again. Called when the media element reports an error. */
  refresh: () => void;
}

export function useFreshSegmentUrl(
  deviceId: string | null,
  camera: number | null,
  segment: ArchivedSegment | null,
): FreshUrls {
  const [fresh, setFresh] = useState<{
    key: string;
    url: string;
    downloadUrl: string;
    filename: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  // Monotonic, so a late response for a segment the user has already left is
  // dropped rather than racing the current one into the player.
  const seq = useRef(0);
  // One retry per segment. Without this a segment whose URL cannot be minted (a
  // revoked key, a misconfigured bucket) would refetch on every error event the
  // media element fires, which is several per failure.
  const retried = useRef<string | null>(null);

  const resolve = useCallback(
    (force: boolean) => {
      if (!segment || !deviceId || camera === null) return;
      if (force) {
        if (retried.current === segment.key) return;
        retried.current = segment.key;
      }
      const mine = ++seq.current;
      setResolving(true);
      freshSegmentUrl(deviceId, camera, segment.key)
        .then((got) => {
          if (seq.current !== mine) return; // the user moved on
          setFresh({
            key: segment.key,
            url: got.url,
            downloadUrl: got.downloadUrl,
            filename: got.filename || segment.filename,
          });
        })
        .catch(() => {
          // Deliberately quiet. The list's URL is still there and may well work;
          // surfacing an error for something the operator cannot act on, when
          // playback is about to succeed anyway, is noise.
          if (seq.current !== mine) return;
          setFresh(null);
        })
        .finally(() => {
          if (seq.current === mine) setResolving(false);
        });
    },
    [deviceId, camera, segment],
  );

  useEffect(() => {
    setFresh(null);
    retried.current = null;
    resolve(false);
  }, [resolve]);

  const matches = fresh && segment && fresh.key === segment.key;
  return {
    url: (matches ? fresh.url : segment?.url) ?? "",
    downloadUrl: (matches ? fresh.downloadUrl : segment?.downloadUrl) ?? "",
    filename: (matches ? fresh.filename : segment?.filename) ?? "segment",
    resolving,
    refresh: () => resolve(true),
  };
}
