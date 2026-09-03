import type { CameraFeed, FeedState } from "@/lib/types";

/**
 * Review affordance, not product chrome.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  IT REVIEWS THE GRAMMAR. IT IS NOT THE SOURCE OF IT.
 * ══════════════════════════════════════════════════════════════════════
 *
 * This was written when there was no backend, and it made every state the wall
 * can be in reachable by pressing a button. Most of those states are now REAL:
 * `live`, `offline` and `unknown` come from coordination's projection, and the
 * stale decay comes from `as_of` ageing past the freshness threshold. They are
 * induced by unplugging a tower, not chosen from a list.
 *
 * ⚠ SO THE FEED-STATE SWITCHES ARE WITHHELD FOR A REAL FLEET, and that is the
 * whole point of this stage's narrowing. Pressing "Offline" on a camera that
 * coordination has just reported as live would overwrite a true reading with a
 * false one — the app would be lying about a real site, from its own review
 * tool, with no mark on screen to say so. There is no version of that which is
 * acceptable on a monitoring surface, so the buttons are simply not there.
 *
 * What survives on a real fleet is what is still simulated anyway: the alert
 * arrival, the empty feed and the extended-viewing banner all sit on seeded
 * data (alerts have no backend at all) and the last one takes ten real minutes
 * to reach otherwise.
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
  liveViewWarning,
  realFleet = false,
  onSetFeedState,
  onToggleAlertsEmpty,
  onToggleLiveViewWarning,
  onRaiseAlert,
  onClose,
}: {
  feeds: CameraFeed[];
  alertsEmpty: boolean;
  /**
   * These cameras are real. Withholds the feed-state switches — see the header.
   */
  realFleet?: boolean;
  /** Whether the extended-viewing banner is currently up. */
  liveViewWarning: boolean;
  onSetFeedState: (feedId: string, state: SimState) => void;
  onToggleAlertsEmpty: () => void;
  onToggleLiveViewWarning: () => void;
  onRaiseAlert: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute bottom-[24px] left-[79px] z-30 w-[248px] rounded-[10px] border border-line bg-[#0e0e10] p-[12px] shadow-2xl shadow-black/60">
      <div className="mb-[10px] flex items-center justify-between">
        <p className="font-display text-[0.75rem] lg:text-[0.6875rem] uppercase tracking-[0.11px] text-white/45">
          Feed state
        </p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close simulator"
          className="text-white/40 transition-colors hover:text-white"
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 14 14"
            fill="none"
            aria-hidden
          >
            <path
              d="m3 3 8 8M11 3l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      {/* What the states now come from, said plainly, so nobody reads an
          absent control as a broken one. */}
      {realFleet && (
        <div className="mb-[12px] flex flex-col gap-[6px] border-b border-white/8 pb-[10px]">
          <p className="text-[0.75rem] leading-[16px] text-white/45 lg:text-[0.6875rem]">
            Feed states are real on this fleet — they come from the tower, not
            from here.
          </p>
          <p className="text-[0.75rem] leading-[16px] text-white/30 lg:text-[0.6875rem]">
            Induce them: cut the tower's power for offline, block the media path
            for no-media-path, let a grant lapse for session ended.
          </p>
        </div>
      )}

      {!realFleet &&
      feeds.map((feed) => {
        const current: SimState = feed.error
          ? "error"
          : feed.state === "connecting" && feed.elapsedSec !== undefined
            ? "reconnecting"
            : feed.state;
        return (
          <div key={feed.id} className="mb-[12px] last:mb-0">
            <p className="mb-[6px] text-[0.75rem] lg:text-[0.6875rem] text-white/35">
              {feed.name}
            </p>
            <div className="flex flex-wrap gap-[4px]">
              {STATES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onSetFeedState(feed.id, s.id)}
                  className={`rounded-[4px] px-[6px] py-[3px] text-[0.75rem] lg:text-[0.6875rem] transition-colors ${
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

      <div className="mt-[12px] flex flex-col gap-[6px] border-t border-white/8 pt-[10px]">
        {/* Arrival is the only alert event the wall itself reacts to, so it
            needs a trigger here — the banner is unreachable otherwise. */}
        <button
          type="button"
          onClick={onRaiseAlert}
          className="w-full rounded-[4px] bg-critical/20 px-[6px] py-[5px] text-[0.75rem] lg:text-[0.6875rem] text-critical transition-colors hover:bg-critical/30"
        >
          Raise new alert
        </button>
        <button
          type="button"
          onClick={onToggleAlertsEmpty}
          className={`w-full rounded-[4px] px-[6px] py-[5px] text-[0.75rem] lg:text-[0.6875rem] transition-colors ${
            alertsEmpty
              ? "bg-white text-black"
              : "bg-white/6 text-white/60 hover:bg-white/12 hover:text-white"
          }`}
        >
          Empty alerts feed
        </button>
        {/* The only state on this wall that costs ten real minutes to reach.
            The switch winds the viewing clock to the threshold rather than
            forcing the banner past it, so dismissing behaves exactly as it
            does for an operator who waited — which is the half worth
            reviewing. Off winds it back to zero. */}
        <button
          type="button"
          onClick={onToggleLiveViewWarning}
          className={`w-full rounded-[4px] px-[6px] py-[5px] text-[0.75rem] lg:text-[0.6875rem] transition-colors ${
            liveViewWarning
              ? "bg-white text-black"
              : "bg-white/6 text-white/60 hover:bg-white/12 hover:text-white"
          }`}
        >
          Extended viewing banner
        </button>
      </div>
    </div>
  );
}
