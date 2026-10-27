import { useLayoutEffect, useRef, type ChangeEvent, type RefObject } from "react";
import { deviceName } from "@/lib/deviceName";

/**
 * A name box that capitalises as somebody types, WITHOUT MOVING THE CURSOR.
 *
 * ── WHY THIS IS NOT ONE LINE ───────────────────────────────────────────
 *
 * `onChange={(e) => setDraft(deviceName(e.target.value))}` is the whole of the
 * capitalising, and on its own it is unusable. A controlled input whose state
 * differs from what the browser put in the box makes React write the value
 * back onto the node — and assigning `value` PUTS THE CARET AT THE END. Type
 * one letter into the middle of a name and the next letter lands after the
 * last one, so correcting "WST GATE" means retyping it.
 *
 * It only bites when the transformation changes something, which is exactly
 * when the person is typing a lower-case letter — the common case, and the
 * whole point of the box. Caps Lock on, and the bug is invisible.
 *
 * So the caret is caught before the state change and put back after the DOM
 * has it. `useLayoutEffect` rather than `useEffect`: the restore has to happen
 * before the browser paints, or the caret is visibly in the wrong place for a
 * frame.
 *
 * The returned `ref` must go on the input. A box that also wants the node for
 * something else — selecting its contents when editing opens — uses this one
 * rather than a second ref; two refs on one input is two chances for one of
 * them to be the stale one.
 */
export function useCapitalName(set: (next: string) => void): {
  ref: RefObject<HTMLInputElement | null>;
  onChange: (e: ChangeEvent<HTMLInputElement>) => void;
} {
  const ref = useRef<HTMLInputElement | null>(null);
  /** Where the caret was before React rewrote the value. `null` between keys. */
  const caret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const at = caret.current;
    caret.current = null;
    if (at === null) return;
    const el = ref.current;
    /* Only while the box still has the caret. A render that lands after a blur
       — a save finishing, say — must not steal focus back to put a caret in a
       field nobody is in. */
    if (el && document.activeElement === el) el.setSelectionRange(at, at);
  });

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const typed = e.target.value;
    const next = deviceName(typed);
    const at = e.target.selectionStart;
    /* Capitals are usually the same length, but not always: ß uppercases to
       SS, so the caret moves by whatever the transformation added. Measuring
       it beats assuming, and costs one subtraction. */
    caret.current = at === null ? null : at + (next.length - typed.length);
    set(next);
  };

  return { ref, onChange };
}
