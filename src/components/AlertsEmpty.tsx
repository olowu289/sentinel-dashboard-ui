/**
 * A quiet feed is a *good* state, so this stays achromatic and carries no CTA —
 * a button here would imply the operator has something to fix. Green is
 * withheld deliberately: it belongs to the live/online dots, and two greens
 * competing on one screen is how a wall stops being scannable.
 *
 * The filtered variant is a genuinely different state and does get an action,
 * because there the emptiness is something the operator caused.
 */
export function AlertsEmpty({
  filtered = false,
  onClearFilters,
}: {
  filtered?: boolean;
  onClearFilters?: () => void;
}) {
  return (
    <div className="flex min-h-[220px] flex-1 flex-col items-center justify-center px-[24px] text-center">
      <span className="flex size-[40px] items-center justify-center rounded-[12px] border border-white/6 bg-white/4 text-white/35">
        {filtered ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M3 5h18l-7 8v6l-4 2v-8L3 5Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M12 3 4 6v6c0 4.4 3.2 8.4 8 9.5 4.8-1.1 8-5.1 8-9.5V6l-8-3Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="m9 12 2 2 4-4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>

      <p className="mt-[16px] text-[15px] font-medium text-white/85">
        {filtered ? "No alerts match these filters" : "All clear"}
      </p>
      <p className="mt-[6px] max-w-[280px] text-[13px] leading-[1.5] text-white/40">
        {filtered
          ? "Nothing was detected in the selected range."
          : "No alerts in the last 24 hours. Detections will appear here in real time."}
      </p>

      {filtered && (
        <button
          type="button"
          onClick={onClearFilters}
          className="mt-[16px] h-[30px] rounded-[6px] border border-white/12 px-[12px] text-[12px] text-white/70 transition-colors hover:border-white/25 hover:text-white"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}
