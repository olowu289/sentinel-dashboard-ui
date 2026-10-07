import { motion } from "motion/react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ENTER } from "@/lib/motion";
import { placePopover } from "@/lib/popover";

/**
 * "Sign out of Sentry?" — a popover beside the rail's sign-out button.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY IT IS A PORTAL, AND IT IS NOT BELT-AND-BRACES
 * ══════════════════════════════════════════════════════════════════════
 *
 * The first version was `fixed inset-0`, centred, rendered where it sat in the
 * tree — inside `IconRail`. It drew SQUEEZED INTO THE 71px RAIL: the title
 * wrapped one word per line, Cancel was off-screen and the Sign out button was
 * clipped.
 *
 * `position: fixed` is resolved against the viewport ONLY while no ancestor
 * establishes a containing block. A `transform`, `filter`, `perspective`,
 * `backdrop-filter` or `will-change` on any ancestor takes that job — and this
 * app animates with `motion`, which sets `transform` on the elements it
 * animates. So `inset-0` meant "fill the rail", not "fill the screen", and no
 * amount of z-index or width would have helped.
 *
 * `createPortal` into `document.body` is the fix rather than a workaround: the
 * node leaves the transformed subtree entirely, so no parent's transform,
 * width, overflow or stacking context can reach it. React keeps the event
 * bubbling and the context, so `useSession` and the handlers behave as if it
 * were still in the rail.
 *
 * ── ANCHORED, NOT CENTRED ──────────────────────────────────────────────
 *
 * It belongs beside the control it is about. Measured from the button's own
 * rect each time it opens, and on resize: the rail is fixed-width but the
 * window is not, and a popover that remembers where it was when the window was
 * wider is a popover half off the screen.
 *
 * PREFERS DOWN, FLIPS UP, THEN CLAMPS. The button lives at the BOTTOM of the
 * rail, so in practice it almost always flips up — but the rule is written in
 * the order the layout is tried, not in the order it usually resolves, because
 * the rail's contents are conditional (the simulator button comes and goes with
 * a feature) and the button is not always at the same height.
 *
 * ── MEASURED BEFORE IT IS SEEN ─────────────────────────────────────────
 *
 * `useLayoutEffect`, and hidden until placed. The flip needs the card's real
 * height, which needs it rendered — so a first paint at a guessed position
 * would be a visible jump on every open. It renders invisible, measures, places
 * itself, and only then becomes visible, all before the browser paints.
 */

/** The card's width. The geometry lives in `lib/popover.ts` so it is testable
 *  with real numbers — see the note there on why placement does not belong
 *  buried in a component. */
const WIDTH = 320;

export function SignOutConfirm({
  anchorRef,
  account,
  busy = false,
  onCancel,
  onConfirm,
}: {
  /** The button this is about. Its rect is where the card is placed. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The organization being left. Named so a shared kiosk says whose session. */
  account?: string;
  /** True while the sign-out request is in flight. */
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);

  /**
   * Measure, then place. The arithmetic — which way it opens, when it flips,
   * how it is clamped — is `placePopover`, which takes plain numbers and has a
   * test carrying the exact rail-and-button rect from the bug report.
   */
  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const card = cardRef.current;
    if (!anchor || !card) return;

    const a = anchor.getBoundingClientRect();
    setAt(
      placePopover({
        anchor: { top: a.top, left: a.left, right: a.right, bottom: a.bottom },
        width: WIDTH,
        height: card.offsetHeight,
        viewport: { width: window.innerWidth, height: window.innerHeight },
      }),
    );
  }, [anchorRef]);

  /* BEFORE PAINT, so the measure-then-place never shows as a jump. */
  useLayoutEffect(() => {
    place();
  }, [place]);

  /* The window can change under an open popover — a resize, a rotated tablet,
     or the kiosk's screen coming back from a blank. Re-placed rather than
     closed: closing would be a confirmation dismissed by something the person
     did not do. */
  useEffect(() => {
    const onChange = () => place();
    window.addEventListener("resize", onChange);
    window.addEventListener("orientationchange", onChange);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("orientationchange", onChange);
    };
  }, [place]);

  /* Cancel takes focus on open. A ref rather than `autoFocus`, which inside an
     animated subtree is applied before layout and is dropped often enough not
     to rely on. Waits for placement so focus does not scroll the page to a card
     that is still at 0,0. */
  useEffect(() => {
    if (at) cancelRef.current?.focus();
  }, [at]);

  /**
   * Escape cancels, and Tab cannot leave.
   *
   * CAPTURE PHASE, and it stops propagation for the keys it owns — the same
   * reasoning `ClipPlayer` documents: the alerts panel binds Escape on the
   * window to drop its selection, so a bubbling Escape here would close this
   * AND change the screen behind it.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onCancel();
        return;
      }
      if (e.key !== "Tab") return;
      /* Two focusable things, so the cycle is explicit rather than computed
         from a query of focusable descendants. */
      e.preventDefault();
      e.stopPropagation();
      const onCancelBtn = document.activeElement === cancelRef.current;
      (onCancelBtn ? confirmRef : cancelRef).current?.focus();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [busy, onCancel]);

  /* Clicking anywhere outside cancels. Guarded on the target being the catcher
     ITSELF, so a click inside the card never bubbles out as a dismissal. */
  const onOutside = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target !== e.currentTarget) return;
      if (!busy) onCancel();
    },
    [busy, onCancel],
  );

  /* ⚠ PORTALLED TO document.body — see the header. Rendering this where it sits
     in the tree put it inside the 71px rail. */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      /* A transparent catcher, not a dim. This is a POPOVER about one small
         control, and dimming an entire video wall for it would read as a much
         bigger interruption than it is. It still covers the screen, because
         "click outside" has to mean anywhere outside. */
      className="fixed inset-0 z-200"
      onMouseDown={onOutside}
    >
      <motion.div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="signout-title"
        aria-describedby="signout-body"
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: at ? 1 : 0, scale: at ? 1 : 0.98 }}
        transition={ENTER}
        style={{
          /* `fixed` is safe HERE because the portal put this under <body>,
             where nothing is transformed. */
          position: "fixed",
          width: WIDTH,
          top: at?.top ?? 0,
          left: at?.left ?? 0,
          /* Hidden until measured, so the flip never shows as a jump. */
          visibility: at ? "visible" : "hidden",
        }}
        className="flex flex-col gap-[16px] rounded-[12px] border border-line bg-panel p-[18px] shadow-2xl"
      >
        <div className="flex flex-col gap-[6px]">
          <h2
            id="signout-title"
            className="font-display text-[0.9375rem] leading-[20px] tracking-[0.15px] text-body-ink"
          >
            Sign out of Sentry?
          </h2>
          {/* ONE LINE OF EXPLANATION, and it wraps normally. The squeezed
              version broke one word per line because its container was 71px
              wide; at 320px with no `break-words` this is ordinary text. */}
          <p
            id="signout-body"
            className="text-[0.8125rem] leading-[18px] text-sub/80"
          >
            {account
              ? `You will be signed out of ${account} on this device.`
              : "You will be returned to the sign-in screen."}
          </p>
        </div>

        {/* SIDE BY SIDE, both fully visible. Cancel FIRST in the DOM, so it is
            first in the tab order and the focused default; the destructive
            action sits to its right. */}
        <div className="flex items-center justify-end gap-[8px]">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="h-[38px] shrink-0 rounded-[8px] border border-stroke px-[14px] text-[0.8125rem] text-sub transition-colors hover:bg-card-hover hover:text-body-ink disabled:cursor-not-allowed disabled:text-sub/40"
          >
            Cancel
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy || undefined}
            /* `critical`, because it ends the session — the only saturated
               colour here, so it is unmistakably the one that acts. Its ink is
               a token that does NOT invert: the red fill keeps its colour in
               light mode, so white-on-red stays white-on-red. */
            className="h-[38px] shrink-0 whitespace-nowrap rounded-[8px] bg-critical px-[14px] text-[0.8125rem] font-medium text-critical-ink transition-colors hover:bg-critical/90 disabled:cursor-not-allowed disabled:bg-critical/40"
          >
            {busy ? "Signing out…" : "Sign out"}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
