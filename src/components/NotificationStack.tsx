/**
 * The cards themselves: a corner of the screen, over the video, never in it.
 *
 * ── WHY THE BOTTOM RIGHT, AND NOT ANYWHERE ELSE ───────────────────────
 *
 * A tile's own controls are drawn in two places: the control stack at the TOP
 * RIGHT and the PTZ pad at the BOTTOM LEFT. The bottom right is the one corner
 * of a tile that holds nothing, which is why cards go there and why they must
 * keep going there. Anywhere else and answering a question about a camera
 * means covering the camera, or the buttons that point it.
 *
 * On a PHONE there are no corners worth the name: the cards go full width at
 * the bottom, above the safe area, and the stack is capped at two because a
 * third would be most of the screen.
 *
 * ── THE KEYBOARD ──────────────────────────────────────────────────────
 *
 * The stack is a `region`, each card is a `group`, and every control inside
 * one is an ordinary button in document order -- so Tab walks the cards and
 * Shift+Tab walks back out, with no focus trap anywhere. Escape dismisses the
 * card that focus is inside, which is the one gesture a keyboard user
 * otherwise has no way to perform (the X is reachable, but Escape is what
 * everybody tries first).
 *
 * `aria-live="polite"` on the stack, not `assertive`: a share request is not
 * an emergency, and interrupting a screen reader mid-sentence to say so would
 * make the product unusable for the person it is announcing to.
 *
 * ── WHAT THE HISTORY IS FOR ───────────────────────────────────────────
 *
 * Cards go away -- answered, timed out, or taken away by the thing they were
 * about. "I saw something about the west gate and now I cannot find it" is a
 * real way to lose a request, so everything that passes through the stack
 * leaves a line behind, with what happened to it.
 */

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ENTER, EXIT } from "@/lib/motion";
import {
  CARD_SKIN,
  CARD_TITLE,
  KINDS,
  MAX_VISIBLE,
  sinceLabel,
  useNotifications,
  type Notification,
} from "@/lib/notifications";
import { MaskIcon } from "./Icon";

/** One card. The frame is this file's; everything inside it is the caller's. */
function Card({
  n,
  onDismiss,
}: {
  n: Notification;
  onDismiss: () => void;
}) {
  const style = KINDS[n.kind];
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    /* The corner stamp is a relative time, so it has to move. Once a minute:
       this is the only thing on screen that would re-render for it. */
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <motion.div
      layout
      role="group"
      aria-label={n.title}
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98 }}
      transition={ENTER}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDismiss();
        }
      }}
      className={`chip-blur pointer-events-auto w-full overflow-hidden rounded-[10px] border ${CARD_SKIN} shadow-[0_8px_30px_rgba(0,0,0,0.45)] sm:w-[340px]`}
    >
      {/* ⚠ THE ONLY COLOURED PIXEL ON THE CARD. The card itself is the app's
          card; the kind is a 2px strip. It used to be a tinted panel with a
          tinted border, a coloured heading and a coloured button, which made
          the one small surface that sits on live video the loudest thing in a
          black and white product. */}
      <div className={`h-[2px] w-full ${style.strip}`} aria-hidden />
      <div className="flex items-start gap-[10px] p-[12px]">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-[8px]">
            <p
              className={`font-display text-[0.6875rem] uppercase tracking-[0.11px] ${CARD_TITLE}`}
            >
              {n.title}
            </p>
            <span className="ml-auto shrink-0 text-[0.6875rem] tabular-nums text-muted">
              {sinceLabel(n.at, now)}
            </span>
          </div>
          {n.render ? (
            <div className="mt-[8px]">{n.render({ dismiss: onDismiss })}</div>
          ) : null}
        </div>
      </div>
    </motion.div>
  );
}

/** The history panel. Small, and only opened deliberately. */
function History({ onClose }: { onClose: () => void }) {
  const { history, clearHistory } = useNotifications();
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={ENTER}
      role="dialog"
      aria-label="Recent notifications"
      onKeyDown={(e) => e.key === "Escape" && onClose()}
      className="chip-blur pointer-events-auto w-full overflow-hidden rounded-[10px] border border-line-panel bg-panel/95 sm:w-[340px]"
    >
      <div className="flex items-center gap-[8px] border-b border-row-line px-[12px] py-[9px]">
        <p className="font-display text-[0.6875rem] uppercase tracking-[0.11px] text-sub">
          Recent
        </p>
        <button
          ref={first}
          type="button"
          onClick={onClose}
          className="ml-auto rounded-[4px] px-[6px] py-[2px] text-[0.75rem] text-muted transition-colors hover:text-body-ink"
        >
          Close
        </button>
      </div>
      {history.length === 0 ? (
        /* ABSENCE IS DIAGNOSTIC. "Nothing has arrived" is a different
           statement from an empty box, and the operator is entitled to the
           first one. */
        <p className="px-[12px] py-[14px] text-[0.8125rem] leading-[18px] text-muted">
          Nothing yet. Requests and offers are listed here.
        </p>
      ) : (
        <>
          <ul className="max-h-[260px] overflow-y-auto">
            {history.map((h) => (
              <li
                key={`${h.id}-${h.at}`}
                className="flex items-baseline gap-[8px] border-b border-row-line/60 px-[12px] py-[8px] last:border-0"
              >
                <span
                  /* The history's rows have no strip to carry the kind, so the
                     dot does -- the same one colour, at 6px. */
                  className={`size-[6px] shrink-0 rounded-full ${KINDS[h.kind].strip}`}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-body-ink">
                  {h.title}
                </span>
                <span className="shrink-0 text-[0.6875rem] text-muted">
                  {h.ended === "resolved"
                    ? "answered"
                    : h.ended === "expired"
                      ? "passed"
                      : "closed"}
                </span>
                <span className="shrink-0 text-[0.6875rem] tabular-nums text-muted">
                  {sinceLabel(h.at)}
                </span>
              </li>
            ))}
          </ul>
          <div className="border-t border-row-line px-[12px] py-[8px]">
            <button
              type="button"
              onClick={clearHistory}
              className="text-[0.75rem] text-muted transition-colors hover:text-body-ink"
            >
              Clear
            </button>
          </div>
        </>
      )}
    </motion.div>
  );
}

export function NotificationStack() {
  const { visible, waiting, dismiss, history } = useNotifications();
  const [showHistory, setShowHistory] = useState(false);

  /* On a phone two cards are already most of the screen. The third waits with
     the rest, and the counter says so. */
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const sync = () => setNarrow(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const shown = visible.slice(0, narrow ? 2 : MAX_VISIBLE);
  const over = waiting + (visible.length - shown.length);

  if (shown.length === 0 && !showHistory && history.length === 0) return null;

  return (
    /* `pointer-events-none` on the column and `auto` on each card: the gaps
       between cards stay clickable, so a stack in the corner of a tile never
       takes a click meant for the picture behind it. */
    <section
      aria-label="Notifications"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-[12px] bottom-[12px] z-50 flex flex-col items-end gap-[8px] sm:inset-x-auto sm:bottom-[16px] sm:right-[16px]"
    >
      <AnimatePresence initial={false}>
        {showHistory ? (
          <History key="history" onClose={() => setShowHistory(false)} />
        ) : null}
        {shown.map((n) => (
          <Card key={n.id} n={n} onDismiss={() => dismiss(n.id)} />
        ))}
      </AnimatePresence>

      {(over > 0 || history.length > 0) && !showHistory ? (
        <motion.button
          layout
          type="button"
          transition={EXIT}
          onClick={() => setShowHistory(true)}
          className="chip-blur pointer-events-auto flex items-center gap-[6px] rounded-full border border-line-panel bg-panel/90 px-[10px] py-[5px] text-[0.75rem] text-muted transition-colors hover:text-body-ink"
        >
          <MaskIcon src="/icons/bell.svg" size={12} />
          {over > 0 ? `${over} more` : "Recent"}
        </motion.button>
      ) : null}
    </section>
  );
}
