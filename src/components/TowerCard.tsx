import type { Alert, Tower, TowerStatus } from "@/lib/types";
import { formatRelative } from "@/lib/time";
import { MaskIcon } from "./Icon";

/* Status is the same three-tier grammar the tiles use, one level up. Nothing
   here gets a hue for being a card: green is a healthy site, amber a degraded
   one, red a dark one. */
const STATUS: Record<TowerStatus, { label: string; dot: string }> = {
  online: { label: "ONLINE", dot: "bg-terra" },
  degraded: { label: "DEGRADED", dot: "bg-warn" },
  offline: { label: "OFFLINE", dot: "bg-critical" },
};

/* The mast drawing carries the status in one accent part — green mast head,
   amber, red — and is otherwise identical across the three. Three exported
   files rather than one tinted file because the accent is a fill buried in a
   90-path illustration; a mask would flatten the whole drawing to one colour
   and lose the grey structure that makes it read as a mast at 58px. */
const ILLUSTRATION: Record<TowerStatus, string> = {
  online: "/icons/twr-illus-online.svg",
  degraded: "/icons/twr-illus-degraded.svg",
  offline: "/icons/twr-illus-offline.svg",
};

const LINK_LABEL = {
  good: "Link good",
  warn: "Link fair",
  bad: "Link poor",
} as const;

const SOLAR_LABEL = {
  charging: "Solar charging",
  idle: "Solar idle",
  fault: "Solar array fault",
} as const;

export function TowerCard({
  tower,
  alerts,
  noticeDismissed = false,
  onOpen,
  onOpenAlerts,
  onDismissNotice,
}: {
  tower: Tower;
  /** *All* of this tower's alerts, newest first. Never pre-filtered: the count
   *  on the pill is a fleet reading and must not move because somebody closed a
   *  notice — see `noticeDismissed`. */
  alerts: Alert[];
  /** The operator has closed this tower's notice. Hides the strip and nothing
   *  else — dismissing says "I have read this", and the strip is the only part
   *  of the card making that claim. The count keeps counting, because the
   *  alerts are still there and still nobody's. */
  noticeDismissed?: boolean;
  /** Open the tower on its camera wall. */
  onOpen: () => void;
  /** Open the tower with its alerts feed already up. The count is the reason
   *  an operator picks this card at all, so it is its own target rather than a
   *  label on the other one. */
  onOpenAlerts: () => void;
  /** Close the notice without opening anything. Takes no alert id on purpose:
   *  it retires the strip for the whole tower, not for one alert. Dismissing by
   *  id looks right and is not — the next-newest alert takes the slot the
   *  instant the first is hidden, so the × appears to do nothing. */
  onDismissNotice?: () => void;
}) {
  const status = STATUS[tower.status];
  const alertCount = alerts.length;
  /* The strip reports the newest one still waiting on somebody. A card is a
     summary; the feed inside the tower is where the rest of them live, and an
     alert that has already been claimed is not news. */
  const latest = noticeDismissed
    ? undefined
    : alerts.find((a) => a.status === "triggered");

  const telemetry = `${SOLAR_LABEL[tower.solar]} · Battery ${tower.batteryPct}% · ${LINK_LABEL[tower.link]}`;
  const alertsLabel = `${alertCount} ${alertCount === 1 ? "alert" : "alerts"}`;

  return (
    /* Several targets, so the card cannot be one <button>. The primary one is
       stretched behind the content and the decorative layers are inert, which
       keeps the whole card clickable without nesting interactive elements —
       the pill and the strip's dismiss are real controls, and a button inside a
       button is not something a browser or a screen reader will forgive. */
    <div
      /* One fill for every card. Only the height changes when the strip
         appears — see the note on `--color-card`. */
      className={`group relative w-full shrink-0 overflow-hidden rounded-[12px] bg-card transition-colors hover:bg-card-hover ${
        latest ? "h-[173px]" : "h-[129px]"
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        title={telemetry}
        aria-label={`${tower.id}, ${tower.site} — ${status.label}. ${telemetry}.`}
        className="absolute inset-0 rounded-[12px]"
      />

      {/* Sora, not the display face. The panel is a list of place names read as
          prose; Quantico is the instrument face and belongs on the readings. */}
      <span
        aria-hidden
        className="pointer-events-none absolute left-[15px] right-[80px] top-[13px] flex flex-col gap-[4px]"
      >
        <span className="truncate text-[0.875rem] leading-[18px] font-medium tracking-[0.14px] text-white">
          {tower.site}
        </span>
        <span className="flex items-center gap-[4px]">
          <span className="text-[0.75rem] leading-[15px] tracking-[0.12px] text-sub">
            {status.label}
          </span>
          <span className={`size-[4.711px] rounded-full ${status.dot}`} />
        </span>
      </span>

      {/* Bottom-anchored rather than pinned to the design's y=18: the card grows
          by 44px when the alert strip appears, and a mast measured from the top
          would then float. */}
      <img
        src={ILLUSTRATION[tower.status]}
        alt=""
        width={58}
        height={101}
        /* Both axes pinned. The export is 59×101, so a width-only rule would
           let the intrinsic ratio decide the height and land it 1.7px short of
           the frame. */
        className={`pointer-events-none absolute right-[33px] block h-[101px] w-[58px] ${
          latest ? "bottom-[58px]" : "bottom-[14px]"
        }`}
      />

      {/* Two readings in one pill, the way the frame draws them: what this
          tower has recorded, and what it has raised. They are separate targets
          because they answer different questions and land in different places. */}
      <span
        className="absolute left-[15px] top-[95px] flex items-center gap-[6px] rounded-[132px] bg-pill px-[6px] py-[4px]"
      >
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Open ${tower.id} camera wall`}
          title="Open camera wall"
          className="flex size-[16px] items-center justify-center text-white/80 transition-colors hover:text-white"
        >
          <MaskIcon src="/icons/card-clips.svg" size={16} />
        </button>

        <span aria-hidden className="h-[10px] w-px rounded-[25px] bg-pill-line" />

        <button
          type="button"
          onClick={onOpenAlerts}
          aria-label={`Open ${tower.id} alerts — ${alertsLabel}`}
          title={`Open alerts (${alertsLabel})`}
          className="flex items-center gap-[3px] text-[0.75rem] leading-[15px] font-medium tracking-[0.12px] text-white transition-colors tabular-nums hover:text-white/70"
        >
          <MaskIcon src="/icons/card-recent.svg" size={16} />
          {alertCount > 99 ? "99+" : `${alertCount}+`}
        </button>
      </span>

      {/* Relative age, and the second place in the app allowed to use it — see
          `formatRelative`. The objection to relative times was a rail full of
          ticking counters competing with the video; this is one line per site,
          rendered once, and its whole job is to say *this just happened*, which
          is the one question a fleet index exists to answer. Opening the strip
          lands on the alert itself, where the time goes back to wall-clock. */}
      {latest && (
        <span className="absolute inset-x-0 bottom-0 flex h-[36px] items-center gap-[4px] bg-alert-banner/15 pl-[8px] pr-[11px]">
          <img
            src="/icons/card-alert.svg"
            alt=""
            width={16}
            height={16}
            className="block shrink-0"
          />
          <button
            type="button"
            onClick={onOpenAlerts}
            className="min-w-0 flex-1 truncate text-left text-[0.8125rem] leading-[20px] tracking-[0.13px] text-alert-ink transition-colors hover:text-white"
          >
            Alert raised by {latest.source}, {formatRelative(latest.at)}.
          </button>
          <button
            type="button"
            onClick={onDismissNotice}
            aria-label={`Dismiss ${tower.id} alert notice — ${alertsLabel} remain`}
            title="Dismiss"
            className="flex size-[16px] shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
          >
            <MaskIcon src="/icons/card-close.svg" size={16} />
          </button>
        </span>
      )}
    </div>
  );
}
