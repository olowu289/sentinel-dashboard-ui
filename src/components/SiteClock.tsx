import { useEffect, useState } from "react";
import { SITE_TZ_LABEL, formatSiteStamp } from "@/lib/time";

/**
 * The fleet wall's running site clock.
 *
 * Its own component purely so the tick is contained. Everything else on this
 * screen is already re-rendering on the 1s recording counter and the 1.4s
 * latency walk; adding a third source of re-renders to the view root would
 * push it through the tile tree once a second, and the tiles gate motion's
 * layout measurement on a key that would not have changed — the documented
 * way this app makes a takeover snap instead of animate.
 */
export function SiteClock({ className = "" }: { className?: string }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const { date, time } = formatSiteStamp(now);

  return (
    <p
      className={`font-display text-[0.875rem] leading-[20px] tracking-[0.14px] whitespace-nowrap text-dim uppercase tabular-nums ${className}`}
    >
      {/* One tone across the whole stamp, per the frame. The date used to sit
          muted beside a white time; on a header that now also carries a bell,
          two weights of the same reading read as two readings. */}
      {date}, {time} {SITE_TZ_LABEL}
    </p>
  );
}
