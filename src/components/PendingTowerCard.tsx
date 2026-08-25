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
 * The frame gives it a 20% wash of detect amber. That is the palette stretched
 * one notch — amber has meant "degraded or a detection", and this is neither —
 * but it is the same underlying claim in both cases: *something here is not
 * finished and it is on you*. It is the only card on the panel carrying an
 * outstanding action, and the mast is drawn without its battery cell because a
 * tower that has not been named is not reporting a charge either.
 */

/** Claim, name the site, watch it come online. Naming the cameras was a fourth
 *  step until it was cut — they are named by position at claim time now. */
const STEPS = 3;

export function PendingTowerCard({
  pending,
  onResume,
}: {
  pending: PendingTower;
  onResume: () => void;
}) {
  const named = pending.site.trim();

  /* The claim is always done — that is why this card exists at all. */
  const done = 1 + (named ? 1 : 0);
  const remaining = STEPS - done;

  return (
    <div className="relative h-[129px] w-full shrink-0 overflow-hidden rounded-[12px] bg-detect/20">
      <button
        type="button"
        onClick={onResume}
        aria-label={
          named
            ? `Finish setting up ${named.toUpperCase()}, ${remaining} of ${STEPS} steps remaining`
            : `Finish setting up ${pending.unit.towerId}, ${remaining} of ${STEPS} steps remaining`
        }
        className="absolute inset-0 rounded-[12px]"
      />

      <span
        aria-hidden
        className="pointer-events-none absolute left-[15px] right-[90px] top-[13px] flex flex-col gap-[4px]"
      >
        {/* "finish setup" — the frame writes it "finish set up" on this line and
            "FINISH SETUP" on the button below it. Two words is the verb (to set
            up a tower); one word is the noun, and "finish" takes the noun. */}
        <span className="truncate text-[0.75rem] leading-[15px] font-medium tracking-[0.12px] text-white">
          {named
            ? "Name the cameras to finish setup"
            : "Name the tower and cameras to finish setup"}
        </span>
        {/* Not the frame's "Step 3/4 remaining", which reads as "step 3 of 4" —
            i.e. which step you are on — while meaning the opposite. After a
            claim you are *on* step 2 and three are left, so the frame's own
            numbers only work under the reading nobody takes first. */}
        <span className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-detect">
          {remaining} of {STEPS} steps left
        </span>
      </span>

      {/* No battery cell — see `twr-mast.svg`. A tower nobody has named is not
          reporting a charge, and drawing one would be inventing a reading. */}
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
        FINISH SETUP
      </span>
    </div>
  );
}
