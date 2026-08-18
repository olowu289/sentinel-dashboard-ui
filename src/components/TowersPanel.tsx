import { useMemo, useState } from "react";
import type { Alert, PendingTower, Tower } from "@/lib/types";
import { PendingTowerCard } from "./PendingTowerCard";
import { TowerCard } from "./TowerCard";

/**
 * The fleet list. Sits left of the wall, where the alerts feed sits right of it
 * in the tower view — this panel is the thing you navigate *from*, and reading
 * order puts the index before the content.
 */
export function TowersPanel({
  towers,
  alerts,
  pending,
  onResumeSetup,
  onOpenTower,
  className = "",
}: {
  towers: Tower[];
  alerts: Alert[];
  /** Claimed, not finished. Sits at the top because it is the only card on
   *  this panel with something outstanding on it. */
  pending?: PendingTower | null;
  onResumeSetup?: () => void;
  /** `showAlerts` lands the tower view on its alerts feed rather than its
   *  wall — the count on a card is a question about alerts, so answering it
   *  should not cost a second click once you are inside. */
  onOpenTower: (towerId: string, showAlerts?: boolean) => void;
  className?: string;
}) {
  /* Tower ids, not alert ids, and view state rather than fleet state.
     Dismissing says "I have read this site's notice", not "these alerts are
     handled" — so the strip retires for the whole tower while its alerts stay
     in the feed and stay in the count on the pill. Keyed by alert it would read
     as broken: hiding the newest one just promotes the next. */
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  const byTower = useMemo(() => {
    const map = new Map<string, Alert[]>();
    for (const a of alerts) {
      const list = map.get(a.towerId);
      if (list) list.push(a);
      else map.set(a.towerId, [a]);
    }
    return map;
  }, [alerts]);

  return (
    <aside
      aria-label="Sentry towers"
      /* Full width below lg, where it is the whole dashboard. The right border
         only means anything once the wall is beside it. */
      className={`relative min-w-0 flex-1 flex-col bg-ink lg:w-[417px] lg:flex-none lg:shrink-0 lg:border-r lg:border-line-panel ${className}`}
    >
      <header className="flex h-[46px] shrink-0 items-center border-b border-line pl-[16px] pr-[14px]">
        <h2 className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white">
          TOWERS
        </h2>
      </header>

      {/* 58px in the design measures from the top of the panel, i.e. 12px clear
          of the 46px bar. Extra bottom padding on small screens so the last
          card scrolls clear of the home indicator. */}
      <div className="flex min-h-0 flex-1 flex-col gap-[8px] overflow-y-auto px-[15px] pb-[calc(20px+env(safe-area-inset-bottom))] pt-[12px]">
        {pending && (
          <PendingTowerCard
            pending={pending}
            onResume={() => onResumeSetup?.()}
          />
        )}

        {towers.map((tower) => (
          <TowerCard
            key={tower.id}
            tower={tower}
            alerts={byTower.get(tower.id) ?? []}
            noticeDismissed={dismissed.has(tower.id)}
            onOpen={() => onOpenTower(tower.id)}
            onOpenAlerts={() => onOpenTower(tower.id, true)}
            onDismissNotice={() =>
              setDismissed((prev) => new Set(prev).add(tower.id))
            }
          />
        ))}
      </div>
    </aside>
  );
}
