import type { FeedState } from "@/lib/types";

/** mm:ss, tabular — a jittering timer in a control room is unacceptable. */
export function formatElapsed(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const DOT: Record<FeedState, string> = {
  recording: "bg-critical",
  live: "bg-terra",
  delayed: "bg-warn",
  frozen: "bg-warn",
  connecting: "bg-white/45",
  offline: "bg-white/45",
};

/** The chip is the only thing that says a feed is live. Absence reads as dead. */
function stateLabel(state: FeedState, name: string, elapsedSec?: number) {
  switch (state) {
    case "recording":
      return `RECORDING ${formatElapsed(elapsedSec ?? 0)}: ${name}`;
    case "live":
      return `LIVE: ${name}`;
    case "delayed":
      return `DELAYED: ${name}`;
    case "frozen":
      return `FROZEN ${elapsedSec ?? 0}S: ${name}`;
    case "connecting":
      return `CONNECTING: ${name}`;
    case "offline":
      return `OFFLINE: ${name}`;
  }
}

function latencyTone(ms: number) {
  if (ms < 80) return "text-white";
  if (ms < 250) return "text-warn";
  return "text-critical";
}

export function FeedChip({
  state,
  name,
  elapsedSec,
  latencyMs,
  error = false,
}: {
  state: FeedState;
  name: string;
  elapsedSec?: number;
  latencyMs?: number;
  /** A failed stream is its own tier — the badge must not read OFFLINE. */
  error?: boolean;
}) {
  const animated = state === "recording" || state === "live";
  const hasLink = latencyMs !== undefined;

  if (error) {
    return (
      <div className="chip-blur flex items-center gap-[8px] rounded-[4px] bg-black/50 px-[8px] py-[4px] opacity-80">
        <span aria-hidden className="size-[8px] shrink-0 rounded-full bg-critical" />
        <p className="font-display text-[14px] tracking-[0.14px] whitespace-nowrap text-critical">
          ERROR: {name}
        </p>
      </div>
    );
  }

  return (
    <div className="chip-blur flex items-center gap-[6px] rounded-[4px] bg-black/50 px-[8px] py-[4px] opacity-80">
      <div className="flex items-center gap-[8px]">
        <span
          aria-hidden
          className={`size-[8px] shrink-0 rounded-full ${DOT[state]} ${
            animated ? "pulse-dot" : ""
          }`}
        />
        <p className="font-display text-[14px] tracking-[0.14px] whitespace-nowrap text-white tabular-nums">
          {stateLabel(state, name, elapsedSec)}
        </p>
      </div>

      {hasLink && (
        <>
          <span
            aria-hidden
            className="size-[3px] shrink-0 rounded-full bg-white/40"
          />
          <div className="flex items-center gap-[6px]">
            <p
              className={`font-display text-[14px] uppercase tracking-[0.14px] whitespace-nowrap tabular-nums ${latencyTone(
                latencyMs,
              )}`}
            >
              {latencyMs}ms
            </p>
            <img
              src={
                latencyMs < 80 ? "/icons/wifi-good.svg" : "/icons/wifi-warn.svg"
              }
              alt=""
              width={16}
              height={16}
            />
          </div>
        </>
      )}
    </div>
  );
}
