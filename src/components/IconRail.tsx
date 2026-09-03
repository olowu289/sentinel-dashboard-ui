import { useSession } from "@/components/AuthProvider";
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
                /* The alerts entry is a bell, and a bell swings — the same
                   one the tower bar and the fleet header use. Nothing else in
                   this stack is a bell, so nothing else takes it. */
                className={`flex size-[34px] items-center justify-center rounded-[8px] transition-colors ${
                  item.id === "alerts" ? "group/bell" : ""
                } ${
                  isActive
                    ? "text-white"
                    : "text-[#cccccc]/55 hover:bg-white/5 hover:text-[#cccccc]"
                }`}
              >
                <MaskIcon
                  src={item.icon}
                  size={24}
                  className={item.id === "alerts" ? "bell-swing" : undefined}
                />
              </button>
            </li>
          );
        })}
      </ul>

      {/* A stack rather than two absolutely-positioned buttons, because the
          simulator button is conditional and anything pinned above it would
          float when it is absent. */}
      <div className="absolute bottom-[24px] left-1/2 flex -translate-x-1/2 flex-col items-center gap-[10px]">
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
            className={`flex size-[34px] items-center justify-center rounded-[8px] transition-colors ${
              moreOpen
                ? "bg-white/8 text-white"
                : "text-[#cccccc]/55 hover:bg-white/5 hover:text-[#cccccc]"
            }`}
          >
            <MaskIcon src="/icons/nav-more.svg" size={24} />
          </button>
        )}

        <SignOutButton />
      </div>
    </nav>
  );
}

/**
 * Sign out.
 *
 * Reads the session directly rather than taking a prop, because every screen
 * renders this rail and threading one handler through five of them is the
 * drift `onSelect` already demonstrated — two screens shipped a nav bar that
 * did not navigate. Session is the one Context in this app, and the rail is
 * always inside the gate.
 *
 * It names the account in its label rather than drawing it. A rail is 71px and
 * an organization name is not, and the fleet screen already carries the
 * identity where there is room for it.
 *
 * TODO(assets): the glyph is hand-drawn because the exported set has no
 * sign-out mark — the same reason `TileFallback` draws its own. Replace it with
 * a Figma export when the set gains one; nothing else here changes.
 */
function SignOutButton() {
  const { account, signOut } = useSession();
  const label = account ? `Sign out of ${account.login}` : "Sign out";

  return (
    <button
      type="button"
      onClick={() => void signOut()}
      aria-label={label}
      title={label}
      className="flex size-[34px] items-center justify-center rounded-[8px] text-[#cccccc]/55 transition-colors hover:bg-white/5 hover:text-[#cccccc]"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M10.5 8.5 14 12l-3.5 3.5M14 12H4"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
