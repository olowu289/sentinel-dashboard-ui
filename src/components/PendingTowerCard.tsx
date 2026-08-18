import type { PendingTower } from "@/lib/types";

/**
 * A tower that has been claimed but not finished.
 *
 * Deliberately not a `TowerCard`. That card is a set of readings — status word,
 * charge, temperature, uplink — and this tower has none of them yet, because
 * nobody has told it what it is watching. Rendering it as a fleet card with the
 * readings blanked would be the one thing the dashboard must never do: show a
 * site that looks monitored and is not.
 *
 * So it gets no status dot and no hue. Green, amber and red are readings here,
 * and the honest thing to say about a half-set-up tower is that it is not
 * reporting anything — which a dashed edge says without spending a colour.
 */
export function PendingTowerCard({
  pending,
  onResume,
}: {
  pending: PendingTower;
  onResume: () => void;
}) {
  const named = pending.site.trim();

  return (
    <div className="relative w-full shrink-0 overflow-hidden rounded-[12px] border border-dashed border-stroke bg-card/60">
      <button
        type="button"
        onClick={onResume}
        aria-label={
          named
            ? `Finish setting up ${named.toUpperCase()}, ${pending.unit.towerId}`
            : `Finish setting up ${pending.unit.towerId}, serial ${pending.unit.serial}`
        }
        className="absolute inset-0 rounded-[12px]"
      />

      <span
        aria-hidden
        className="pointer-events-none flex flex-col gap-[4px] px-[15px] pt-[13px]"
      >
        <span className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white">
          {named ? named.toUpperCase() : pending.unit.towerId}
        </span>
        <span className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-muted">
          SETUP UNFINISHED
        </span>
      </span>

      {/* The action names the next step rather than the state. "Pending" is a
          word an operator can do nothing with; "Finish setup" is the thing they
          came to the card to do. It is the only thing on the right-hand side —
          saying "not reporting" beside "setup unfinished" was the same fact
          twice in two registers. */}
      <span className="pointer-events-none flex items-center justify-between gap-[12px] px-[15px] pb-[13px] pt-[16px]">
        <span className="pointer-events-auto rounded-[132px] bg-pill px-[10px] py-[5px] font-display text-[0.75rem] tracking-[0.12px] text-white">
          Finish setup
        </span>
        <span className="font-display text-[0.75rem] tracking-[0.12px] text-muted">
          {pending.unit.serial}
        </span>
      </span>
    </div>
  );
}
