import { AnimatePresence, motion } from "motion/react";
import { ENTER, FADE } from "@/lib/motion";
import { MaskIcon } from "./Icon";

export type WallLayout = "landscape" | "portrait";

export function TopBar({
  towerId,
  online,
  onNavigateUp,
  layout,
  onToggleLayout,
  alertsCollapsed = false,
  alertsUnread = false,
  onExpandAlerts,
  onOpenSettings,
  settingsOpen = false,
}: {
  towerId: string;
  online: boolean;
  /** Up to the fleet dashboard. The crumb named a parent long before one
   *  existed; now that it does, it is a real control rather than an anchor to
   *  nowhere — a breadcrumb that does not navigate is a lie about hierarchy. */
  onNavigateUp: () => void;
  layout: WallLayout;
  onToggleLayout: () => void;
  alertsCollapsed?: boolean;
  /** An alert has landed that the operator has not been shown the feed for. */
  alertsUnread?: boolean;
  onExpandAlerts?: () => void;
  /** Opens the tower's camera settings in the rail's column. */
  onOpenSettings?: () => void;
  settingsOpen?: boolean;
}) {
  const next = layout === "landscape" ? "portrait" : "landscape";

  // Asymmetric padding is per the design: breadcrumb at 16px, view control at 9px.
  return (
    <header className="flex h-[46px] shrink-0 items-center justify-between border-b border-line pl-[16px] pr-[9px]">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-[4px]"
      >
        <button
          type="button"
          onClick={onNavigateUp}
          title="Back to all towers"
          className="rounded-[2px] font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-muted transition-colors hover:text-white"
        >
          TOWERS
        </button>
        <img src="/icons/chevron-right.svg" alt="" width={16} height={16} />
        <span className="flex items-center gap-[6px]">
          <span
            aria-current="page"
            className="font-display text-[0.875rem] leading-[20px] tracking-[0.14px] text-white"
          >
            {towerId}
          </span>
          <span
            className={`flex items-center justify-center rounded-[2px] px-[6px] py-px font-display text-[0.75rem] uppercase tracking-[0.12px] ${
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
      <div className="flex items-center gap-[8px]">
        <button
          type="button"
          onClick={onToggleLayout}
          aria-label={`${layout} view, switch to ${next}`}
          title={`Switch to ${next} view`}
          /* Hidden below lg: the wall is forced to a single stacked column
             there, so a control that switches the split axis would do nothing. */
          className="hidden items-center gap-[6px] py-[2px] text-dim transition-colors hover:text-white lg:flex"
        >
          {/* The label crossfades in place. `mode="popLayout"` would reflow the
              row as one word replaces the other; both are absolutely stacked in
              a fixed-width box instead, so the icon beside them never moves. */}
          <span className="relative block h-[20px] w-[104px] font-display text-[0.875rem] leading-[20px] uppercase tracking-[0.14px]">
            <AnimatePresence initial={false}>
              <motion.span
                key={layout}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={FADE}
                className="absolute inset-0 flex items-center justify-end whitespace-nowrap"
              >
                {layout} view
              </motion.span>
            </AnimatePresence>
          </span>

          {/* The wall reflows on `ENTER` when this toggles — `layoutKey` carries
              `layout`, so every tile runs a layout animation. The glyph used to
              cut instantly while the thing it describes took 200ms to move.
              Same tween, so the icon and the wall are one gesture.

              A quarter turn carries the motion and a crossfade covers the rest:
              the two exports are not rotations of each other — landscape is a
              single rounded rect, portrait a decomposed frame — so rotating one
              does not land on the other. */}
          <span className="relative block size-[20px]">
            <AnimatePresence initial={false}>
              <motion.span
                key={layout}
                initial={{ opacity: 0, rotate: -90 }}
                animate={{ opacity: 1, rotate: 0 }}
                exit={{ opacity: 0, rotate: 90 }}
                transition={ENTER}
                className="absolute inset-0"
              >
                <MaskIcon
                  src={`/icons/view-${layout}.svg`}
                  size={20}
                  className="text-[#e9e9e9]"
                />
              </motion.span>
            </AnimatePresence>
          </span>
        </button>

        {/* Camera settings, where the frame puts them: in the tower's bar
            rather than on a tile. That placement is the argument for the scope
            — these are the tower's cameras, and the bar is the one control
            surface that belongs to the tower rather than to one picture. */}
        <span aria-hidden className="hidden h-[14px] w-px bg-stroke lg:block" />
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={
            settingsOpen ? "Close camera settings" : "Camera settings"
          }
          title="Camera settings"
          className={`group/gear hidden size-[24px] items-center justify-center rounded-[4px] transition-colors hover:text-white lg:flex ${
            settingsOpen ? "text-white" : "text-[#e9e9e9]"
          }`}
        >
          <MaskIcon src="/icons/nav-settings.svg" size={20} className="gear-turn" />
        </button>

        {/* Only appears once the panel is collapsed — it is the sole way back,
            so it lives in the bar that is always on screen rather than in the
            surface it restores. No rule before it: the frame draws one, after
            the view control, and the settings gear now sits on the far side of
            it. A second rule would divide two glyphs that belong together. */}
        {alertsCollapsed && onExpandAlerts && (
          <>
            <button
              type="button"
              onClick={onExpandAlerts}
              aria-label={
                alertsUnread
                  ? "Show alerts panel, new alert"
                  : "Show alerts panel"
              }
              title={alertsUnread ? "New alert" : "Show alerts"}
              className={`relative hidden size-[24px] items-center justify-center rounded-[4px] text-[#e9e9e9] transition-colors hover:text-white lg:flex ${
                /* No swing while something is unread. The ring below already
                   says it, and the alert rail carries the pulse — a swinging
                   bell on top of those is three things saying one thing. */
                alertsUnread ? "" : "group/bell"
              }`}
            >
              <MaskIcon
                src="/icons/nav-alerts.svg"
                size={20}
                className="bell-swing"
              />
              {/* Rides the glyph so the bell still reads as the alerts control
                  rather than becoming a generic badge. The ring punches it off
                  the bell's own outline at 6px. */}
              {alertsUnread && (
                <span
                  aria-hidden
                  className="absolute right-[2px] top-[2px] size-[6px] rounded-full bg-critical ring-2 ring-ink"
                />
              )}
            </button>
          </>
        )}
      </div>
    </header>
  );
}
