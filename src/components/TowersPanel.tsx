import { useMemo } from "react";
import type { Alert, Tower } from "@/lib/types";
import type { Claim } from "@/lib/api/claim";
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
  pendingClaim,
  onResumeSetup,
  onOpenTower,
  dismissedNotices,
  onDismissNotice,
  loading = false,
  problem = null,
  seeded = false,
  className = "",
}: {
  towers: Tower[];
  alerts: Alert[];
  /** Registered, not yet connected. Sits at the top because it is the only
   *  card on this panel with something outstanding on it. */
  pendingClaim?: Claim | null;
  onResumeSetup?: () => void;
  /** `showAlerts` lands the tower view on its alerts feed rather than its
   *  wall — the count on a card is a question about alerts, so answering it
   *  should not cost a second click once you are inside. */
  onOpenTower: (towerId: string, showAlerts?: boolean) => void;
  /** Read notices, owned by the shell. */
  dismissedNotices?: ReadonlySet<string>;
  onDismissNotice?: (towerId: string) => void;
  /** The real fleet has not answered yet. */
  loading?: boolean;
  /** Why the fleet could not be read, if it could not. */
  problem?: string | null;
  /** The list on screen is fixture data, not this account's fleet. */
  seeded?: boolean;
  className?: string;
}) {
  /* Tower ids, not alert ids, and view state rather than fleet state.
     Dismissing says "I have read this site's notice", not "these alerts are
     handled" — so the strip retires for the whole tower while its alerts stay
     in the feed and stay in the count on the pill. Keyed by alert it would read
     as broken: hiding the newest one just promotes the next.

     ⚠ IT USED TO LIVE HERE, AND THAT WAS THE BUG. This panel unmounts on every
     drill-in, so a dismissed notice came back the moment an operator visited a
     tower and returned — the control appeared not to work. It is owned by the
     shell now, and remembered per account. */

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
        {pendingClaim && (
          <PendingTowerCard
            claim={pendingClaim}
            onResume={() => onResumeSetup?.()}
          />
        )}

        {/* Fixture data must never pass for a fleet. The reference dashboard
            carries the same badge for the same reason: "no login needed" and
            "signed in" must not be confusable, and neither must "demo towers"
            and "your towers". */}
        {seeded && (
          <p className="shrink-0 rounded-[6px] bg-detect/20 px-[10px] py-[6px] font-display text-[0.6875rem] tracking-[0.11px] text-detect">
            SEEDED FLEET — NOT YOUR TOWERS
          </p>
        )}

        {/* Three different empty walls, and they are not the same fact.
            Loading is a wait. A problem is a failure to read, and it says so
            rather than looking like an empty fleet. Genuinely empty is a valid
            answer — a new account has no towers, and coordination returns an
            empty list with a 200, never a refusal. */}
        {!loading && problem && towers.length === 0 && (
          <div className="flex flex-col gap-[6px] rounded-[8px] bg-critical/12 px-[14px] py-[12px]">
            <p className="text-[0.8125rem] leading-[20px] text-critical">
              Could not read your fleet.
            </p>
            <p className="text-[0.75rem] leading-[16px] text-muted">{problem}</p>
          </div>
        )}
        {loading && towers.length === 0 && (
          <p className="px-[2px] py-[8px] font-display text-[0.75rem] tracking-[0.12px] text-muted">
            LOADING FLEET…
          </p>
        )}
        {!loading && !problem && towers.length === 0 && !pendingClaim && (
          <p className="px-[2px] py-[8px] text-[0.8125rem] leading-[20px] text-muted">
            No towers on this account yet. Add one and it appears here.
          </p>
        )}

        {towers.map((tower) => (
          <TowerCard
            key={tower.id}
            tower={tower}
            alerts={byTower.get(tower.id) ?? []}
            noticeDismissed={dismissedNotices?.has(tower.id) ?? false}
            onOpen={() => onOpenTower(tower.id)}
            onOpenAlerts={() => onOpenTower(tower.id, true)}
            onDismissNotice={() => onDismissNotice?.(tower.id)}
          />
        ))}
      </div>
    </aside>
  );
}
