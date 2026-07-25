/**
 * Everything that renders in place of video. Offline, connecting and error all
 * sit on the same `tile-dead` surface so a feed recovering through those states
 * never flashes brightness — only the glyph, copy and badge change.
 *
 * Only the terminal error tier gets a button: offline and reconnecting resolve
 * themselves, and a Retry there just invites pointless clicking.
 */

function CameraOffGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M2 6.5A1.5 1.5 0 0 1 3.5 5h9A1.5 1.5 0 0 1 14 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 17.5v-11ZM14 10l6-3.5v11L14 14"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
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
      <path d="M12 9v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="12" cy="17" r="1" fill="currentColor" />
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
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
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
      <p className="text-[13px] font-medium text-white/70">Camera offline</p>
      <p className="-mt-[4px] text-[12px] text-white/35">Last seen {lastSeen}</p>
    </div>
  );
}

export function ConnectingFallback({
  name,
  attempt,
  maxAttempts,
}: {
  name: string;
  attempt?: number;
  maxAttempts?: number;
}) {
  const reconnecting = attempt !== undefined;
  return (
    <div className="flex flex-col items-center gap-[12px]">
      <span className={reconnecting ? "text-warn/70" : "text-white/50"}>
        {reconnecting ? <SignalOffGlyph /> : <Spinner />}
      </span>
      {reconnecting ? (
        <>
          <p className="text-[13px] font-medium text-white/75">Signal lost</p>
          {/* Tell the operator how long this will take, not just that
              something is happening. A silent spinner is unfalsifiable. */}
          <p className="-mt-[6px] flex items-center gap-[6px] text-[12px] text-white/35 tabular-nums">
            <span className="text-warn/70">
              <Spinner size={12} />
            </span>
            Reconnecting… attempt {attempt} of {maxAttempts}
          </p>
        </>
      ) : (
        <>
          <p className="text-[13px] font-medium text-white/75">Connecting…</p>
          <p className="-mt-[6px] text-[12px] text-white/35">
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
      <p className="text-[13px] font-medium text-white/70">Stream unavailable</p>
      {/* The raw transport error, verbatim — never paraphrased into "oops". */}
      <p className="-mt-[4px] font-mono text-[12px] text-white/35">{error}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-[4px] h-[28px] rounded-[6px] border border-white/12 px-[12px] text-[11px] text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Retry
        </button>
      )}
    </div>
  );
}
