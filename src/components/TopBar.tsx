import { MaskIcon } from "./Icon";

export type WallLayout = "landscape" | "portrait";

export function TopBar({
  towerId,
  online,
  layout,
  onToggleLayout,
}: {
  towerId: string;
  online: boolean;
  layout: WallLayout;
  onToggleLayout: () => void;
}) {
  const next = layout === "landscape" ? "portrait" : "landscape";

  // Asymmetric padding is per the design: breadcrumb at 16px, view control at 9px.
  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line pl-[16px] pr-[9px]">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-[4px]"
      >
        <a
          href="#"
          className="font-display text-[14px] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
        >
          TOWERS
        </a>
        <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
        <span className="flex items-center gap-[6px]">
          <span
            aria-current="page"
            className="font-display text-[14px] leading-[20px] tracking-[0.14px] text-white"
          >
            {towerId}
          </span>
          <span
            className={`flex items-center justify-center rounded-[2px] px-[6px] py-px font-display text-[12px] uppercase tracking-[0.12px] ${
              online ? "bg-terra/15 text-terra" : "bg-critical/15 text-critical"
            }`}
          >
            {online ? "Online" : "Offline"}
          </span>
        </span>
      </nav>

      {/* The glyph is the layout itself — a divider across the frame, turned to
          match the axis the tiles are stacked on. It shows the current view
          rather than the one you would switch to, so the bar always reads as a
          statement of what is on screen; the label carries the same word. */}
      <button
        type="button"
        onClick={onToggleLayout}
        aria-label={`${layout} view, switch to ${next}`}
        title={`Switch to ${next} view`}
        /* Hidden below lg: the wall is forced to a single stacked column there,
           so a control that switches the split axis would do nothing. */
        className="hidden items-center gap-[6px] py-[2px] text-dim transition-colors hover:text-white lg:flex"
      >
        <span className="font-display text-[14px] leading-[20px] uppercase tracking-[0.14px]">
          {layout} view
        </span>
        <MaskIcon
          src={`/icons/view-${layout}.svg`}
          size={20}
          className="text-[#e9e9e9]"
        />
      </button>
    </header>
  );
}
