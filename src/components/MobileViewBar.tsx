import { MaskIcon } from "./Icon";

export type MobileView = "wall" | "alerts";

/**
 * Below lg the wall and the alerts feed each take the whole screen, so
 * something has to switch between them.
 *
 * Deliberately only two entries. The icon rail has six destinations, but
 * `onSelect` is unwired — they navigate nowhere. Promoting them into a bottom
 * bar would ship six taps that silently do nothing, which is worse than a
 * smaller bar that tells the truth about what exists.
 */
export function MobileViewBar({
  view,
  alertCount,
  onSelect,
}: {
  view: MobileView;
  alertCount: number;
  onSelect: (v: MobileView) => void;
}) {
  const items = [
    { id: "wall" as const, label: "Cameras", icon: "/icons/nav-towers.svg" },
    { id: "alerts" as const, label: "Alerts", icon: "/icons/nav-alerts.svg" },
  ];

  return (
    <nav
      aria-label="View"
      /* pb honours the home-indicator inset on notched devices; without it the
         bar's tap targets sit under the system gesture area. */
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-line bg-ink pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      {items.map((item) => {
        const active = view === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            aria-current={active ? "page" : undefined}
            className={`relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-[3px] transition-colors ${
              active ? "text-white" : "text-[#cccccc]/55"
            }`}
          >
            <span className="relative">
              <MaskIcon src={item.icon} size={22} />
              {/* Unread count rides the icon so a switched-away operator still
                  sees the feed is moving. */}
              {item.id === "alerts" && alertCount > 0 && (
                <span className="absolute -right-[7px] -top-[3px] min-w-[15px] rounded-full bg-critical px-[4px] text-center font-display text-[10px] leading-[15px] text-white tabular-nums">
                  {alertCount > 99 ? "99+" : alertCount}
                </span>
              )}
            </span>
            <span className="font-display text-[11px] uppercase tracking-[0.11px]">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
