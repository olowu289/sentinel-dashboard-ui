import { useEffect, useRef, useState } from "react";

export type ExportPhase = "idle" | "working" | "done";

/**
 * The simulated evidence export, shared by the clip card and the review player.
 *
 * Prototype: nothing is written to disk. The *states* are the deliverable —
 * a real export is slow enough that a button which does nothing visible gets
 * clicked repeatedly, and duplicate evidence exports are a real problem in a
 * control room. Both surfaces show the same three phases because they are the
 * same action; two different waits for one operation would read as two
 * different operations.
 */
export function useExportPhase() {
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
    },
    [],
  );

  const start = () => {
    if (phase !== "idle") return;
    setPhase("working");
    timers.current.push(
      setTimeout(() => setPhase("done"), 1200),
      setTimeout(() => setPhase("idle"), 3400),
    );
  };

  return { phase, start };
}
