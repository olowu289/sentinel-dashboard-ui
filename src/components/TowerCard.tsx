import type { Alert, Tower, TowerStatus } from "@/lib/types";
import { formatRelative } from "@/lib/time";
import { MaskIcon } from "./Icon";
import { TowerBattery } from "./TowerBattery";

/* Status is the same three-tier grammar the tiles use, one level up. Nothing
   here gets a hue for being a card: green is a healthy site, amber a degraded
   one, red a dark one. */
const STATUS: Record<TowerStatus, { label: string; dot: string }> = {
  online: { label: "ONLINE", dot: "bg-terra" },
  degraded: { label: "DEGRADED", dot: "bg-warn" },
  offline: { label: "OFFLINE", dot: "bg-critical" },
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

/* All three hover glyphs are single-colour exports, so they go through
   `MaskIcon` and take their own reading's tone rather than the fill they
   happened to be drawn with. The frame draws the sun amber, the thermometer
   grey and the battery green, which is this palette at the state it drew —
   charging, temperate, healthy. Rendered as exported they would say that about
   every tower forever, which is the same trap the old telemetry row fell into. */
const SOLAR_TONE = {
  charging: "text-warn",
  idle: "text-white/45",
  fault: "text-critical",
} as const;

/** Sealed cabinet in the sun. Past 45 the battery is losing life, past 55 it is
 *  a fault waiting to happen. */
function tempTone(c: number) {
  return c >= 55 ? "text-critical" : c >= 45 ? "text-warn" : "text-[#cccccc]";
}

/** Same tiers `TowerBattery` paints the cell with, so the glyph beside the mast
 *  and the charge inside it can never disagree. */
function batteryTone(pct: number) {
  return pct < 20 ? "text-critical" : pct < 40 ? "text-warn" : "text-terra";
}

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

  /* The gauge on the mast is decorative; this is where the reading actually
     lives for anyone not looking at it, so the charging state has to be in it. */
  const telemetry = `${SOLAR_LABEL[tower.solar]} · Battery ${tower.batteryPct}%${
    tower.solar === "charging" && tower.batteryPct < 100 ? " and rising" : ""
  } · ${LINK_LABEL[tower.link]}`;
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
      {/* No `title` here on purpose. It used to carry the telemetry string, and
          the browser drew it as an OS tooltip over the card the moment a
          pointer crossed the name or the status word — a second, uglier copy of
          what the mast panel now shows, arriving first and in the wrong place.
          The reading still lives in `aria-label`, which is where it was always
          doing the real work. */}
      <button
        type="button"
        onClick={onOpen}
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
          would then float.

          Two layers in one 58×101 box, both on the export's 59×101 grid so they
          register exactly: the charge underneath, the mast over it. That order
          is the export's own — the fill is the first thing it paints, and the
          cage struts that cross in front of the cell come after. */}
      {/* A button, not a decoration. It has to take a pointer to open the
          readings on hover, and anything that takes a pointer here sits on top
          of the stretched primary target — so rather than punching a dead hole
          in the card it carries the same action. Focus gets the readings too,
          which is more than the `title` they used to live in ever offered. */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`${tower.id} telemetry — ${telemetry}`}
        className={`group/mast absolute right-[33px] block h-[101px] w-[58px] ${
          latest ? "bottom-[58px]" : "bottom-[14px]"
        }`}
      >
        <TowerBattery
          pct={tower.batteryPct}
          charging={tower.solar === "charging"}
          className="absolute inset-0 size-full"
        />
        {/* Both axes pinned. The export is 59×101, so a width-only rule would
            let the intrinsic ratio decide the height and land it 1.7px short of
            the frame. */}
        <img
          src="/icons/twr-mast.svg"
          alt=""
          width={58}
          height={101}
          className="absolute inset-0 block h-[101px] w-[58px]"
        />

        {/* The telemetry row, back as a hover panel rather than three glyphs
            parked on the card. Anchored to the mast's own bottom so it holds
            its place when the card grows for the alert strip, and pulled left
            of the mast because it is 299px wide in a 386px card — right-aligned
            to the card's gutter it clears the name block above and the pill
            below, and only ever covers the thing that summoned it. */}
        <span
          aria-hidden
          /* Translucent and blurred rather than solid, so the mast it covers
             stays legible underneath it — the panel is *about* the thing behind
             it, and blanking that out mid-hover reads as the drawing being
             replaced. 4px, not the 5 the feed chips use: those sit over live
             video and need more, this sits over line art. */
          className="pointer-events-none absolute bottom-[24px] right-[-18px] flex h-[32px] origin-bottom-right scale-95 items-center rounded-[8px] bg-black/60 opacity-0 backdrop-blur-[4px] transition-[opacity,transform] duration-150 ease-out group-hover/mast:scale-100 group-hover/mast:opacity-100 group-focus-visible/mast:scale-100 group-focus-visible/mast:opacity-100"
        >
          <span className="flex items-center gap-[6px] border-r border-white/7 px-[8px] py-[6px] font-display text-[0.75rem] leading-[20px] font-bold tracking-[0.12px] whitespace-nowrap text-white/78">
            <span className={SOLAR_TONE[tower.solar]}>
              <MaskIcon src="/icons/twr-solar.svg" size={16} />
            </span>
            {SOLAR_LABEL[tower.solar].toUpperCase()}
          </span>

          <span className="flex items-center gap-[8px] border-r border-white/7 px-[8px] py-[6px] font-display text-[0.75rem] leading-[20px] font-bold tracking-[0.12px] whitespace-nowrap text-[#cccccc] tabular-nums">
            <span className={tempTone(tower.tempC)}>
              <MaskIcon src="/icons/twr-temp.svg" size={16} />
            </span>
            {tower.tempC}˚
          </span>

          <span className="flex items-center gap-[8px] px-[8px] py-[6px] font-display text-[0.75rem] leading-[20px] font-bold tracking-[0.12px] whitespace-nowrap text-[#cccccc] tabular-nums">
            {/* 19.2 in a 16 box, as the frame draws it — the glyph is bled to
                its own edges where the other two carry a margin. */}
            <span className={`flex size-[16px] items-center ${batteryTone(tower.batteryPct)}`}>
              <MaskIcon src="/icons/twr-battery.svg" size={19.2} />
            </span>
            {tower.batteryPct}%
          </span>
        </span>
      </button>

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
