import { useEffect, useRef, useState } from "react";
import { NO_FILTER, RANGES, type DateFilter } from "@/lib/dateFilter";
import { siteToday } from "@/lib/time";
import { CalendarRange } from "./CalendarRange";

/**
 * Presets above, custom fields below, explicit Apply. The staging matters:
 * applying live would re-filter the feed on every keystroke of a half-typed
 * date, so the operator watches results vanish for ranges they never asked for.
 */
export function DateFilterPopover({
  value,
  counts,
  onApply,
  onClose,
}: {
  value: DateFilter;
  /** Result count per preset, so the cost of a range is visible before
   *  committing to it. */
  counts: Record<string, number>;
  onApply: (next: DateFilter) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<DateFilter>(value);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose(); // closes without applying
      } else if (e.key === "Enter") {
        e.preventDefault();
        onApply(draft);
        onClose();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    // Deferred so the click that opened the popover does not close it again.
    const t = setTimeout(() => window.addEventListener("mousedown", onClick));
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onClick);
      clearTimeout(t);
    };
  }, [onClose, onApply, draft]);

  const dirty =
    draft.range !== value.range ||
    draft.from !== value.from ||
    draft.to !== value.to;

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Time range"
      /* bg-panel, not the old one-off #16181d — that hex was a hair blue against
         a neutral system and belonged to no token. Elevation is carried by the
         border and shadow, which is what separates it from the same-coloured
         clip cards behind it. */
      className="absolute right-[15px] top-[42px] z-50 w-[320px] max-w-[calc(100vw-30px)] rounded-[12px] border border-white/10 bg-panel shadow-[0_16px_40px_rgba(0,0,0,0.7)]"
    >
      <div className="flex h-[44px] items-center justify-between border-b border-white/8 px-[14px]">
        <p className="text-[0.8125rem] font-semibold text-white">Time range</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-[22px] items-center justify-center rounded-[4px] text-white/45 transition-colors hover:bg-white/8 hover:text-white"
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
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>

      <div className="flex flex-wrap gap-[6px] p-[14px]">
        {RANGES.map((r) => {
          const active = draft.range === r.id;
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => setDraft({ range: r.id })}
              aria-pressed={active}
              /* White, not terra. Green in this app means a feed is live —
                 spending it on "this preset is selected" puts a camera-status
                 colour on a control that has nothing to do with the cameras,
                 and a bright green pill in the corner of a monitoring screen
                 reads as a signal rather than a setting. */
              className={`flex h-[28px] items-center gap-[6px] rounded-full px-[10px] text-[0.75rem] transition-colors ${
                active
                  ? "bg-white font-medium text-black"
                  : "bg-white/6 text-white/70 hover:bg-white/12 hover:text-white"
              }`}
            >
              {r.label}
              <span
                className={`tabular-nums ${
                  active ? "text-black/50" : "text-white/30"
                }`}
              >
                {counts[r.id] ?? 0}
              </span>
            </button>
          );
        })}
      </div>

      {/* A real grid instead of two `<input type="date">`. The native control
          renders OS chrome that ignores the theme, prints mm/dd/yyyy while
          every other date in this app is ISO or WAT wall-clock, and opens a
          picker built around the *viewer's* calendar rather than the tower's.
          On a dark operator surface it was the one light-mode object on screen. */}
      <div className="border-t border-white/8 px-[14px] py-[12px]">
        <p className="pb-[8px] font-display text-[0.75rem] lg:text-[0.6875rem] uppercase tracking-[0.11px] text-white/40">
          Custom
        </p>
        <CalendarRange
          from={draft.from}
          to={draft.to}
          today={siteToday()}
          onChange={(next) => setDraft({ range: "custom", ...next })}
        />
      </div>

      <div className="flex h-[52px] items-center justify-between border-t border-white/8 px-[14px]">
        <button
          type="button"
          onClick={() => setDraft(NO_FILTER)}
          className="text-[0.8125rem] text-white/55 transition-colors hover:text-white"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => {
            onApply(draft);
            onClose();
          }}
          disabled={!dirty}
          className="h-[30px] rounded-[6px] bg-white px-[14px] text-[0.8125rem] font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-30"
        >
          Apply
        </button>
      </div>
    </div>
  );
}
