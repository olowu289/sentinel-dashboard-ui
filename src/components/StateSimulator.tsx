import type { CameraFeed, FeedState } from "@/lib/types";

/**
 * Review affordance, not product chrome. The design covers one moment in time;
 * this makes every other state the wall can be in reachable without a backend.
 */
/** `reconnecting` is `connecting` that has already failed once — same state,
 *  different tier, so it is its own switch rather than a hidden variant. */
export type SimState = FeedState | "error" | "reconnecting";

const STATES: { id: SimState; label: string }[] = [
  { id: "recording", label: "Recording" },
  { id: "live", label: "Live" },
  { id: "delayed", label: "Delayed" },
  { id: "frozen", label: "Frozen" },
  { id: "connecting", label: "Connecting" },
  { id: "reconnecting", label: "Signal lost" },
  { id: "offline", label: "Offline" },
  { id: "error", label: "Stream error" },
];

export function StateSimulator({
  feeds,
  alertsEmpty,
  onSetFeedState,
  onToggleAlertsEmpty,
  onClose,
}: {
  feeds: CameraFeed[];
  alertsEmpty: boolean;
  onSetFeedState: (feedId: string, state: SimState) => void;
  onToggleAlertsEmpty: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-[24px] left-[79px] z-30 w-[248px] rounded-[10px] border border-line bg-[#0e0e10] p-[12px] shadow-2xl shadow-black/60">
      <div className="mb-[10px] flex items-center justify-between">
        <p className="font-display text-[11px] uppercase tracking-[0.11px] text-white/45">
          Feed state
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close simulator"
          className="text-white/40 transition-colors hover:text-white"
        >
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {feeds.map((feed) => {
        const current: SimState = feed.error
          ? "error"
          : feed.state === "connecting" && feed.elapsedSec !== undefined
            ? "reconnecting"
            : feed.state;
        return (
          <div key={feed.id} className="mb-[12px] last:mb-0">
            <p className="mb-[6px] text-[11px] text-white/35">{feed.name}</p>
            <div className="flex flex-wrap gap-[4px]">
              {STATES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSetFeedState(feed.id, s.id)}
                  className={`rounded-[4px] px-[6px] py-[3px] text-[11px] transition-colors ${
                    current === s.id
                      ? "bg-white text-black"
                      : "bg-white/6 text-white/60 hover:bg-white/12 hover:text-white"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      <div className="mt-[12px] border-t border-white/8 pt-[10px]">
        <button
          type="button"
          onClick={onToggleAlertsEmpty}
          className={`w-full rounded-[4px] px-[6px] py-[5px] text-[11px] transition-colors ${
            alertsEmpty
              ? "bg-white text-black"
              : "bg-white/6 text-white/60 hover:bg-white/12 hover:text-white"
          }`}
        >
          Empty alerts feed
        </button>
      </div>
    </div>
  );
}
