import type { FeedState } from "@/lib/types";

/** mm:ss, tabular — a jittering timer in a control room is unacceptable. */
export function formatElapsed(totalSec: number) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * States in which there is no picture, so the tile draws a fallback and every
 * actuator that reaches the site is disabled.
 *
 * It lives here, beside the state grammar, because it was duplicated in
 * `CameraTile` and `MonitorTile` — and a state added to one and not the other
 * gives you two walls disagreeing about whether a camera is dead. `unknown`
 * belongs in the set: nothing has confirmed the camera, so there is nothing to
 * show and nothing safe to act on.
 */
export const DEAD_STATES: ReadonlySet<FeedState> = new Set<FeedState>([
  "connecting",
  "offline",
  "unknown",
]);

const DOT: Record<FeedState, string> = {
  recording: "bg-critical",
  live: "bg-terra",
  delayed: "bg-warn",
  frozen: "bg-warn",
  connecting: "bg-white/45",
  offline: "bg-white/45",
  /* Grey, with the dead states. Not green, obviously — but not amber either:
     amber is a reading (degraded, a detection), and this is the absence of one.
     A tower that has never reported is not in a degraded condition; it is a
     tower we cannot speak for. */
  unknown: "bg-white/45",
};

/**
 * The chip is the only thing that says a feed is live. Absence reads as dead.
 *
 * ⚠ THE `: string` RETURN ANNOTATION IS THE GUARD, and it is not decoration.
 * Without it a switch missing a `FeedState` simply widens to `string |
 * undefined`, which flows into JSX without complaint and renders a chip with a
 * dot and no words — a state that looks handled and says nothing. With it, an
 * unhandled member makes the function fall through to an implicit `undefined`
 * return and the build fails.
 *
 * Verified by adding a bogus state and watching it break, rather than assumed.
 * `noFallthroughCasesInSwitch` does NOT do this job — that flag is about one
 * `case` body running into the next, not about covering the union.
 *
 * DO NOT add a `default` case. It would satisfy the annotation and silently
 * reintroduce exactly the hole this annotation closes.
 */
function stateLabel(state: FeedState, name: string, elapsedSec?: number): string {
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
    /* "NO REPORT" rather than "UNKNOWN", because it says which half is missing.
       The camera is not in an unknown condition — nobody has told us its
       condition, which is a statement about the link, not the lens. */
    case "unknown":
      return `NO REPORT: ${name}`;
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
        <span
          aria-hidden
          className="size-[8px] shrink-0 rounded-full bg-critical"
        />
        <p className="font-display text-[0.875rem] tracking-[0.14px] whitespace-nowrap text-critical">
          ERROR: {name}
        </p>
      </div>
    );
  }

  return (
    <div className="chip-blur flex min-w-0 items-center gap-[6px] rounded-[4px] bg-black/50 px-[8px] py-[4px] opacity-80">
      {/* min-w-0 + truncate all the way down: on a narrow tile the camera name
          is the part that gives, never the latency — a clipped link figure
          would misreport the feed. */}
      <div className="flex min-w-0 items-center gap-[8px]">
        <span
          aria-hidden
          className={`size-[8px] shrink-0 rounded-full ${DOT[state]} ${
            animated ? "pulse-dot" : ""
          }`}
        />
        <p className="truncate font-display text-[0.875rem] tracking-[0.14px] whitespace-nowrap text-white tabular-nums">
          {stateLabel(state, name, elapsedSec)}
        </p>
      </div>

      {hasLink && (
        <>
          <span
            aria-hidden
            className="size-[3px] shrink-0 rounded-full bg-white/40"
          />
          <div className="flex shrink-0 items-center gap-[6px]">
            <p
              className={`font-display text-[0.875rem] uppercase tracking-[0.14px] whitespace-nowrap tabular-nums ${latencyTone(
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
