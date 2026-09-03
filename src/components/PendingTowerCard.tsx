import { useEffect, useState } from "react";
import { formatCountdown, msUntilExpiry, type Claim } from "@/lib/api/claim";

/**
 * A tower that has been registered but has not connected yet.
 *
 * Deliberately not a `TowerCard`. That card is a set of readings — status word,
 * charge, temperature, uplink — and this tower has none of them, because it has
 * not spoken to coordination yet. Rendering it as a fleet card with the readings
 * blanked would be the one thing the dashboard must never do: show a site that
 * looks monitored and is not.
 *
 * The frame gives it a 20% wash of detect amber. That is the palette stretched
 * one notch — amber has meant "degraded or a detection", and this is neither —
 * but it is the same underlying claim in both cases: *something here is not
 * finished and it is on you*. The mast is drawn without its battery cell,
 * because a tower that has not connected is not reporting a charge either.
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────
 *
 * This used to count local setup steps — "2 of 3 steps left" — over a claim
 * held in browser memory. There are no steps now: registration is one act, and
 * what follows is a wait on the tower. So the card shows the real deadline
 * instead, which is the thing an operator can actually act on. Fifteen minutes,
 * from the server, ticking.
 */
export function PendingTowerCard({
  claim,
  onResume,
}: {
  claim: Claim;
  onResume: () => void;
}) {
  const [left, setLeft] = useState(() => msUntilExpiry(claim));

  useEffect(() => {
    setLeft(msUntilExpiry(claim));
    const t = setInterval(() => setLeft(msUntilExpiry(claim)), 1000);
    return () => clearInterval(t);
  }, [claim]);

  const dead = claim.status === "expired" || left <= 0;

  return (
    <div className="relative h-[129px] w-full shrink-0 overflow-hidden rounded-[12px] bg-detect/20">
      <button
        type="button"
        onClick={onResume}
        aria-label={
          dead
            ? `${claim.label} — registration expired, register again`
            : `${claim.label} — registered, waiting for the tower to connect, ${formatCountdown(left)} left`
        }
        className="absolute inset-0 rounded-[12px]"
      />

      <span
        aria-hidden
        className="pointer-events-none absolute left-[15px] right-[90px] top-[13px] flex flex-col gap-[4px]"
      >
        <span className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white">
          {claim.label}
        </span>
        <span className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-detect">
          {dead ? "Registration expired" : "Waiting for the tower to connect"}
        </span>
        {!dead && (
          <span className="font-display text-[0.75rem] leading-[15px] tracking-[0.12px] text-detect/80 tabular-nums">
            {formatCountdown(left)} left
          </span>
        )}
      </span>

      {/* No battery cell — see `twr-mast.svg`. A tower that has not connected is
          not reporting a charge, and drawing one would be inventing a reading. */}
      <img
        src="/icons/twr-mast.svg"
        alt=""
        width={58}
        height={101}
        className="pointer-events-none absolute right-[18px] top-[14px] block h-[101px] w-[58px]"
      />

      {/* Inert on purpose. The whole card is the target — the stretched button
          above covers it — so this must not capture the pointer, or the most
          obviously clickable thing on the card would be the one dead spot. */}
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-[15px] left-[15px] flex h-[31px] items-center justify-center rounded-[60px] bg-white px-[24px] text-[0.75rem] leading-[15px] font-semibold tracking-[0.12px] text-black"
      >
        {dead ? "REGISTER AGAIN" : "VIEW REGISTRATION"}
      </span>
    </div>
  );
}
