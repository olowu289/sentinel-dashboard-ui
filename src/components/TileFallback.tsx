/**
 * Everything that renders in place of video. Offline, connecting and error all
 * sit on the same `tile-dead` surface so a feed recovering through those states
 * never flashes brightness — only the glyph, copy and badge change.
 *
 * Only the terminal error tier gets a button: offline and reconnecting resolve
 * themselves, and a Retry there just invites pointless clicking.
 */

import { formatClockShort } from "@/lib/time";

/**
 * How old the bad news is.
 *
 * Replaces a hardcoded `"14:02"` — a literal, on the one line whose entire job
 * was to say when a camera was last confirmed. `null` means the tower has never
 * reported it, which is a different fact from "a while ago" and says so.
 * `undefined` is a seeded feed, which has no such stamp; the caller renders
 * nothing rather than an empty line.
 */
export function lastSeenLabel(at: number | null | undefined): string {
  if (at === null) return "Never reported.";
  if (at === undefined) return "";
  return `Last confirmed ${formatClockShort(at)}`;
}

function CameraOffGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 17.5v-11ZM14 10l6-3.5v11L14 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function SignalOffGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M5 12.5a9.9 9.9 0 0 1 4-2.4M19 12.5a9.9 9.9 0 0 0-4.4-2.5M1.8 9a15 15 0 0 1 6-3.4M22.2 9a15 15 0 0 0-8.6-3.9M8.6 16a5 5 0 0 1 6.8 0"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="19.5" r="1" fill="currentColor" />
      <path
        d="M3 3l18 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function AlertTriangleGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M10.3 3.9 1.9 18.1A2 2 0 0 0 3.6 21h16.8a2 2 0 0 0 1.7-2.9L13.7 3.9a2 2 0 0 0-3.4 0Z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M12 9v4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
    </svg>
  );
}

function QuestionGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 17.5v-11ZM14 10l6-3.5v11L14 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M6.6 10.1a1.5 1.5 0 0 1 2.9.5c0 1-1.5 1.2-1.5 2.2"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="8" cy="15.2" r="0.9" fill="currentColor" />
    </svg>
  );
}

function Spinner({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden
      className="animate-spin [animation-duration:900ms]"
    >
      <circle
        cx="10"
        cy="10"
        r="8"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <path
        d="M18 10a8 8 0 0 0-8-8"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function OfflineFallback({ lastSeen }: { lastSeen: string }) {
  return (
    <div className="flex flex-col items-center gap-[10px] text-white/35">
      <CameraOffGlyph />
      <p className="text-[0.8125rem] font-medium text-white/70">
        Camera offline
      </p>
      {/* Only when there is a stamp to show. A seeded feed has none, and an
          empty line is worse than a missing one. */}
      {lastSeen && (
        <p className="-mt-[4px] text-[0.75rem] text-white/35">{lastSeen}</p>
      )}
    </div>
  );
}

/**
 * Nothing has told us about this camera.
 *
 * Distinct from offline, and the distinction is the point: offline is a
 * *report* — the tower said this camera is down, which is information an
 * operator can act on. This is the absence of a report, which is a statement
 * about the link rather than the lens, and it must never be drawn as either
 * healthy or faulty.
 *
 * Grey, with the other dead states, and on the same `tile-dead` surface so a
 * feed recovering through them never flashes brightness.
 */
export function UnknownFallback({ since }: { since?: string }) {
  return (
    <div className="flex flex-col items-center gap-[10px] text-white/35">
      <QuestionGlyph />
      <p className="text-[0.8125rem] font-medium text-white/70">
        No report from this camera
      </p>
      <p className="-mt-[4px] max-w-[240px] text-center text-[0.75rem] text-white/35">
        {since ?? "The tower has not said whether it is working."}
      </p>
    </div>
  );
}

/**
 * A session is open and negotiating. There is no picture yet, and none is
 * being claimed.
 *
 * Separate from `ConnectingFallback`, which is about the *camera* reconnecting
 * to its tower. This is about *our* stream to it — the same picture, two
 * different reasons it is missing, and an operator deciding whether to wait or
 * escalate needs to know which.
 */
/**
 * A camera that is live, and that this screen has deliberately not opened a
 * stream for.
 *
 * ⚠ THIS EXISTS BECAUSE THE ALTERNATIVE IS A PICTURE-SHAPED HOLE. A real camera
 * carries no poster — `map.ts` refuses to attach one, because the seed's
 * posters are photographs of a different site and putting one under a LIVE chip
 * would be the most convincing lie this app could tell. So on the fleet wall,
 * where the video policy says not to stream, there is nothing to draw: an empty
 * `<img>` under a green chip reads as a broken tile at best and as a dark scene
 * at worst.
 *
 * The honest answer is to say why the frame is empty and where the picture is.
 * Grey, because nothing is wrong — this is a choice the app made, not a fault
 * at the site, and the chip beside it is still correctly reporting the camera
 * as live.
 */
/**
 * A camera that is live but not being streamed HERE, and why.
 *
 * ⚠ THE COPY USED TO SAY "the fleet wall does not hold sessions open", which
 * was true when the wall drew stills and is now false: a tile streams when it
 * is on screen. The two remaining reasons are different enough to need
 * different words, and both are things an operator can actually be looking at.
 *
 *   `offscreen` — including the moment a tile has scrolled in and is still
 *     settling. It says what will happen rather than reporting a fault,
 *     because nothing is wrong.
 *   `capped` — more cameras on screen than the wall will stream at once. This
 *     is the one that needs an explanation and a way out, so it keeps the
 *     button: the tower view streams the camera regardless.
 */
/**
 * The path dropped and is being rebuilt.
 *
 * ⚠ NOT `AwaitingMediaFallback`, and the difference is what the operator is
 * owed. Awaiting is a feed that has never played; this one was playing a moment
 * ago and they expect it back. Saying which attempt it is on is the honest part:
 * "2 of 5" is the difference between "give it a second" and "this is not coming
 * back", which is exactly the judgement somebody is trying to make while they
 * watch a still frame.
 */
export function ReconnectingFallback({
  attempt,
  of,
}: {
  attempt: number;
  of: number;
}) {
  return (
    <div className="flex flex-col items-center gap-[8px] px-[16px] text-center text-white/35">
      <CameraOffGlyph />
      <p className="text-[0.8125rem] font-medium text-white/70">Reconnecting\u2026</p>
      <p className="-mt-[2px] max-w-[240px] text-[0.75rem] text-white/35">
        The connection dropped. Attempt {attempt} of {of}.
      </p>
    </div>
  );
}

export function NotStreamingFallback({
  reason = "capped",
  onOpen,
}: {
  reason?: "offscreen" | "capped";
  onOpen?: () => void;
}) {
  const offscreen = reason === "offscreen";
  return (
    <div className="flex flex-col items-center gap-[8px] px-[16px] text-center text-white/35">
      <CameraOffGlyph />
      <p className="text-[0.8125rem] font-medium text-white/70">
        {offscreen ? "Live — not on screen" : "Live — not streaming here"}
      </p>
      <p className="-mt-[2px] max-w-[240px] text-[0.75rem] text-white/35">
        {offscreen
          ? "Scroll it into view and it starts streaming."
          : "Too many cameras on screen to stream them all. Open the tower to watch this one."}
      </p>
      {onOpen && !offscreen && (
        <button
          type="button"
          onClick={onOpen}
          className="mt-[2px] h-[28px] rounded-[6px] border border-white/12 px-[12px] text-[0.75rem] text-white/70 transition-colors hover:border-white/25 hover:text-white lg:text-[0.6875rem]"
        >
          Open tower
        </button>
      )}
    </div>
  );
}

export function AwaitingMediaFallback({ name }: { name: string }) {
  return (
    <div className="flex flex-col items-center gap-[12px]">
      <span className="text-white/50">
        <Spinner />
      </span>
      <p className="text-[0.8125rem] font-medium text-white/75">Waiting for video…</p>
      <p className="-mt-[6px] text-[0.75rem] text-white/35">
        Negotiating a direct stream · {name}
      </p>
    </div>
  );
}

/**
 * Signalling worked and no media arrived.
 *
 * ⚠ THIS STATE EARNS ITS OWN FALLBACK BECAUSE SILENCE HERE IS A LIE. Media
 * flows direct from the tower to this browser while signalling goes through
 * coordination, so the offer and answer can round-trip perfectly while not one
 * packet ever arrives. Without a state of its own the operator sees a `<video>`
 * that simply stays black — which is indistinguishable from a dark scene at
 * night, and is exactly the fake picture the media seam exists to refuse.
 *
 * Amber rather than red: nothing is faulty at the site. The tower is up, the
 * camera is up, and the route between here and there is the problem — which is
 * amber's usual claim, *this needs you*, and is usually a network fix rather
 * than a site visit.
 */
export function NoMediaPathFallback({ onRetry }: { onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-[10px]">
      <span className="text-warn/70">
        <SignalOffGlyph />
      </span>
      <p className="text-[0.8125rem] font-medium text-white/70">Camera unavailable</p>
      {/* The second sentence used to explain that media travels direct from
          the tower rather than through coordination. True, load-bearing, and
          the reason this state exists at all — but it is our network topology,
          offered to somebody looking at a black rectangle. The fact they can
          use is the first half: the tower is fine, the picture is not. The
          topology is in the comment above this component, where it belongs. */}
      <p className="-mt-[4px] max-w-[280px] text-center text-[0.75rem] text-white/35">
        The tower is answering, but its video isn't getting through.
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[4px] h-[28px] rounded-[6px] border border-white/12 px-[12px] text-[0.75rem] text-white/70 transition-colors hover:border-white/25 hover:text-white lg:text-[0.6875rem]"
        >
          Retry
        </button>
      )}
    </div>
  );
}

/**
 * The grant expired, or was revoked, and the picture is no longer authorised.
 *
 * Terminal, so it goes on the tile rather than in a dismissible banner — an
 * operator must not be able to wave away the only thing telling them they are
 * looking at nothing. Grey, not red: an ending is not a fault.
 */
export function SessionEndedFallback({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-[10px] text-white/35">
      <CameraOffGlyph />
      <p className="text-[0.8125rem] font-medium text-white/70">Viewing ended</p>
      <p className="-mt-[4px] max-w-[260px] text-center text-[0.75rem] text-white/35">
        {message}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[4px] h-[28px] rounded-[6px] border border-white/12 px-[12px] text-[0.75rem] text-white/70 transition-colors hover:border-white/25 hover:text-white lg:text-[0.6875rem]"
        >
          Resume viewing
        </button>
      )}
    </div>
  );
}

/**
 * Establishing a stream, or re-establishing one.
 *
 * ⚠ THERE IS NO ATTEMPT COUNT, AND THAT IS DELIBERATE. This used to read
 * "Reconnecting… attempt 3 of 5" with both numbers hardcoded — a fabricated
 * progress report on the one line whose entire job is to tell an operator how
 * much longer to wait. It was worse than silence: it implied a bounded retry
 * that would give up at five, and neither number came from anywhere.
 *
 * Nothing exposes a real count. Checked, not assumed: the SDK has no such
 * field, coordination's projection has none, and the tower agent's own backoff
 * (`broker/link.py`) is a tower-to-coordination concern that is never
 * projected to a viewer. The projection's `link` is a WORD with an open arm —
 * `"up" | "down" | (string & {})` — specifically so a third value like
 * `"reconnecting"` can arrive later without a breaking change. If it does, that
 * is where this state comes from, and it will still carry no count.
 *
 * So: say that it is reconnecting, and do not say how far along.
 */
export function ConnectingFallback({
  name,
  reconnecting = false,
}: {
  name: string;
  /** Re-establishing after a drop, rather than connecting for the first time. */
  reconnecting?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-[12px]">
      <span className={reconnecting ? "text-warn/70" : "text-white/50"}>
        {reconnecting ? <SignalOffGlyph /> : <Spinner />}
      </span>
      {reconnecting ? (
        <>
          <p className="text-[0.8125rem] font-medium text-white/75">
            Signal lost
          </p>
          {/* No count. See the header — an invented "3 of 5" was worse than
              saying nothing, because it promised an end. */}
          <p className="-mt-[6px] flex items-center gap-[6px] text-[0.75rem] text-white/35">
            <span className="text-warn/70">
              <Spinner size={12} />
            </span>
            Reconnecting to {name}
          </p>
        </>
      ) : (
        <>
          <p className="text-[0.8125rem] font-medium text-white/75">
            Connecting…
          </p>
          <p className="-mt-[6px] text-[0.75rem] text-white/35">
            Establishing secure stream · {name}
          </p>
        </>
      )}
    </div>
  );
}

export function ErrorFallback({
  error,
  onRetry,
}: {
  error: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-[10px]">
      <span className="text-critical/70">
        <AlertTriangleGlyph />
      </span>
      <p className="text-[0.8125rem] font-medium text-white/70">
        Stream unavailable
      </p>
      {/* The raw transport error, verbatim — never paraphrased into "oops". */}
      <p className="-mt-[4px] font-mono text-[0.75rem] text-white/35">
        {error}
      </p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[4px] h-[28px] rounded-[6px] border border-white/12 px-[12px] text-[0.75rem] lg:text-[0.6875rem] text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Retry
        </button>
      )}
    </div>
  );
}
