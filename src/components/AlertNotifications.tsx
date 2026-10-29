import { useEffect, useRef } from "react";
import { alertColour } from "@/lib/alertCopy";
import { ACTIONABLE_TTL_MS, useNotifications } from "@/lib/notifications";
import type { ArrivedAlert } from "@/lib/useSiteAlerts";

/**
 * AN ALERT ARRIVES WHILE SOMEBODY IS WATCHING SOMETHING ELSE.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE RULE THE WHOLE STACK EXISTS FOR: NOBODY LEAVES THE FEED
 * ══════════════════════════════════════════════════════════════════════
 *
 * Share requests were the first card through this stack and deliberately not
 * the only shape it holds — `notifications.tsx` says so, and it reserved the
 * `alert` kind with the note "NOTHING RAISES ONE YET". Something does now.
 *
 * The card is the same card: the app's card, with the type's colour as a 2px
 * strip along the top and not a pixel more. A tinted panel with a tinted
 * border and a coloured heading is what the share card used to be, and it made
 * the one small surface that sits on live video the loudest thing in a black
 * and white product.
 *
 * ── THE COLOUR COMES OFF THE WIRE, AND THIS IS THE ONE PLACE IT MAY ───
 *
 * ⚠ `KINDS` SAYS "ONE TOKEN PER KIND AND NOTHING ELSE", AND THIS PASSES A
 * `strip` OVERRIDE. That is a real exception and it is argued rather than
 * taken: the server decides an alert's colour and sends a `colours` map with
 * every list precisely so a type this bundle was built before still renders,
 * in the colour the hub picked for it. A `switch` here would make this build
 * the authority on which alert is red, and a newer hub would be overruled by
 * whatever the website last shipped. The five keys map to five tokens in
 * `lib/alertCopy.ts`; a sixth lands on the neutral one rather than on nothing.
 *
 * ── TRANSIENT, NOT PERSISTENT ─────────────────────────────────────────
 *
 * A share request STAYS, because a question that fades is a question answered
 * by whoever was looking the other way. An alert is not a question: it is
 * already in the feed, already counted on its tower's card, and already
 * durable on the hub for ninety days. The card is the interruption, not the
 * record, so it times out — and it uses the long `ACTIONABLE_TTL_MS` rather
 * than the nine-second default because it carries a button somebody might
 * want, and nine seconds is less than the time it takes to look up.
 *
 * Several at once stack, newest nearest the corner, and the overflow waits
 * rather than being dropped — all of which the stack already does. Three
 * visible, because the fourth covers the picture.
 */
export function AlertNotifications({
  arrivals,
  onOpen,
}: {
  /** Newest first. The shell appends to this as `alert.new` frames land. */
  arrivals: readonly ArrivedAlert[];
  /** Open the alert's own feed, at that alert. */
  onOpen: (alertId: string) => void;
}) {
  const { notify } = useNotifications();
  /* ⚠ ONE CARD PER ALERT, FOR THE LIFE OF THE TAB. `arrivals` is an array in
     the shell's state, so this effect re-runs whenever any OTHER alert lands
     and would re-notify every entry still in it. `notify` replaces by id and
     keeps the card's position, so the visible result would be right and the
     lifetime would not: each re-notify carries a fresh `at`, which restarts
     the timeout, and a busy night would leave the first card of the evening
     on screen for ever. */
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    /* Oldest first, so when two land together they stack in arrival order
       rather than in reverse. */
    for (const arrived of [...arrivals].reverse()) {
      const { alert, colour } = arrived;
      if (seen.current.has(alert.id)) continue;
      seen.current.add(alert.id);
      notify({
        id: `alert:${alert.id}`,
        kind: "alert",
        strip: alertColour(colour).strip,
        /* The moment the thing HAPPENED, so the corner reads the event's own
           age -- "2m" on an alert the hub debounced for a minute before
           raising. The card's LIFETIME is measured from arrival by the
           provider and not from this; the two were one field, and an alert's
           `at` is in the past by construction, so every card was retired
           before it could be seen. See the note on `Held`. */
        at: alert.at,
        /* ⚠ THE LONG ONE, BECAUSE THIS CARD CARRIES A BUTTON. Nine seconds
           is for a statement nobody has to act on; "Open" is a thing an
           operator might want, and nine seconds is less than the time it
           takes to look up from a camera wall. */
        ttlMs: ACTIONABLE_TTL_MS,
        title: alert.title,
        render: ({ dismiss }) => (
          <div className="flex items-center gap-[8px]">
            <button
              type="button"
              onClick={() => {
                onOpen(alert.id);
                dismiss();
              }}
              className="h-[28px] flex-1 rounded-[6px] bg-action px-[10px] text-[0.75rem] font-medium text-action-ink transition-opacity hover:opacity-90"
            >
              Open
            </button>
            {/* The quiet one is a hairline, like every secondary button in
                this product. "Dismiss" and not "Ignore": the alert is still
                in the feed and still on its tower's card, and only the card
                is going away. */}
            <button
              type="button"
              onClick={dismiss}
              className="h-[28px] rounded-[6px] border border-card-line px-[10px] text-[0.75rem] text-body-ink/70 transition-colors hover:bg-overlay/8"
            >
              Dismiss
            </button>
          </div>
        ),
      });
    }
  }, [arrivals, notify, onOpen]);

  return null;
}
