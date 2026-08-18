import { MaskIcon } from "./Icon";

const NAV = [
  { id: "add", label: "New", icon: "/icons/nav-add.svg" },
  { id: "dashboard", label: "Dashboard", icon: "/icons/nav-dashboard.svg" },
  { id: "towers", label: "Towers", icon: "/icons/nav-towers.svg" },
  /* Not "Team" — the glyph is a person, and what it opens is the watchlist:
     upload a face, and a camera that sees it raises an alert. The people this
     names are the subject of the monitoring, not the staff doing it, and those
     two readings of one icon are as far apart as this product gets. */
  { id: "poi", label: "People of interest", icon: "/icons/nav-team.svg" },
  { id: "alerts", label: "Alerts", icon: "/icons/nav-alerts.svg" },
  { id: "settings", label: "Settings", icon: "/icons/nav-settings.svg" },
];

export function IconRail({
  active = "towers",
  onSelect,
  onMore,
  moreOpen = false,
  className = "",
}: {
  active?: string;
  onSelect?: (id: string) => void;
  onMore?: () => void;
  moreOpen?: boolean;
  className?: string;
}) {
  return (
    <nav
      aria-label="Primary"
      className={`relative w-[71px] shrink-0 border-r border-line-rail bg-ink ${className}`}
    >
      <a
        href="#"
        aria-label="Terra Sentinel — home"
        className="absolute left-1/2 top-[6px] flex size-[39px] -translate-x-1/2 items-center justify-center rounded-[12px] transition-colors hover:bg-white/5"
      >
        {/* Wordless mark: 22.286 × 19.5 inside a 39px hit target. */}
        <img
          src="/icons/logo.svg"
          alt=""
          width={22.286}
          height={19.5}
          className="block"
        />
      </a>

      {/* Figma pins the stack at y=233 with a 24px rhythm; the 34px buttons are
          centred on the 24px glyphs so the hit target clears WCAG 2.2 without
          disturbing the spacing. */}
      <ul className="absolute left-1/2 top-[233px] flex -translate-x-1/2 flex-col items-center gap-[24px]">
        {NAV.map((item) => {
          const isActive = active === item.id;
          return (
            <li key={item.id} className="flex h-[24px] items-center">
              <button
                type="button"
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
                title={item.label}
                onClick={() => onSelect?.(item.id)}
                className={`flex size-[34px] items-center justify-center rounded-[8px] transition-colors ${
                  isActive
                    ? "text-white"
                    : "text-[#cccccc]/55 hover:bg-white/5 hover:text-[#cccccc]"
                }`}
              >
                <MaskIcon src={item.icon} size={24} />
              </button>
            </li>
          );
        })}
      </ul>

      {/* Only rendered where something handles it. It used to draw on all four
          screens and work on one, which is the same dead-control bug as an
          unwired nav item — just one row further down. */}
      {onMore && (
        <button
          type="button"
          aria-label="Feed state simulator"
          aria-expanded={moreOpen}
          title="Feed state simulator (Shift+S)"
          onClick={onMore}
          className={`absolute bottom-[24px] left-1/2 flex size-[34px] -translate-x-1/2 items-center justify-center rounded-[8px] transition-colors ${
            moreOpen
              ? "bg-white/8 text-white"
              : "text-[#cccccc]/55 hover:bg-white/5 hover:text-[#cccccc]"
          }`}
        >
          <MaskIcon src="/icons/nav-more.svg" size={24} />
        </button>
      )}
    </nav>
  );
}
