/**
 * One movable camera's patrol: the switch, the interval and the direction.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE COMPONENT, TWO SCREENS, SO THEY CANNOT DISAGREE
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tower settings panel draws this under its Patrol row, and Settings →
 * Cameras draws the same thing beside each camera. They are two routes to one
 * setting, and two renderings of one setting is the arrangement where one of
 * them eventually offers an interval the other does not, or keeps showing
 * "Every 4 hours" after the other turned it off.
 *
 * So the markup lives here, the words live in `lib/patrol.ts`, and both
 * screens pass the same three things: what the device reports, what the save
 * is doing, and what to call when somebody changes something.
 *
 * ⚠ IT RENDERS WHAT THE DEVICE REPORTS, NEVER WHAT WAS ASKED FOR. Every
 * refusal in the contract leaves the camera exactly as it was, so a failed
 * save must put the controls back rather than leave them on the operator's
 * request -- a screen showing a patrol that is not running is worse than one
 * that says the change did not save. The draft below exists only for the
 * moment between a press and an answer.
 */

import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { FADE } from "@/lib/motion";
import { formatConnectedSince } from "@/lib/time";
import { useNow } from "@/lib/useNow";
import {
  PATROL_DIRECTIONS,
  PATROL_INTERVALS,
  directionWord,
  everyChoice,
  type Patrol,
  type PatrolDirection,
  type PatrolEdit,
  type PatrolEvery,
} from "@/lib/patrol";

/** What a save is doing, in the shape every other row on these screens uses. */
export type PatrolPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "failed"; message: string };

const CHOICE =
  "flex items-center gap-[8px] rounded-[6px] px-[10px] py-[7px] text-left text-[0.8125rem] transition-colors";

function Dot({ picked }: { picked: boolean }) {
  return (
    <span
      aria-hidden
      className={`size-[8px] shrink-0 rounded-full ${picked ? "bg-action" : "bg-overlay/20"}`}
    />
  );
}

function Row<T extends string>({
  label,
  options,
  value,
  disabled,
  onPick,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  disabled: boolean;
  onPick: (v: T) => void;
}) {
  return (
    <div className="flex flex-col gap-[4px]">
      <span className="px-[10px] font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.1px] text-dim">
        {label}
      </span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-[2px]">
        {options.map((o) => {
          const picked = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={picked}
              disabled={disabled}
              onClick={() => onPick(o.value)}
              className={`${CHOICE} ${
                picked ? "bg-panel text-body-ink" : "text-body-ink hover:bg-panel/60"
              } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
            >
              <Dot picked={picked} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const EVERY_OPTIONS = PATROL_INTERVALS.map((v) => ({ value: v, label: everyChoice(v) }));
const DIRECTION_OPTIONS = PATROL_DIRECTIONS.map((v) => ({ value: v, label: directionWord(v) }));

export function PatrolControl({
  patrol,
  cameraName,
  showName,
  phase = { kind: "idle" },
  onChange,
}: {
  /** What the device reports. The only source of what is drawn. */
  patrol: Patrol;
  cameraName: string;
  /** Name the camera, for a device with more than one movable one. */
  showName: boolean;
  phase?: PatrolPhase;
  onChange: (edit: PatrolEdit) => void;
}) {
  const pending = phase.kind === "pending";
  /**
   * The operator's press, held until the device answers.
   *
   * ⚠ CLEARED BY THE DEVICE'S ANSWER, WHICHEVER WAY IT WENT. The effect
   * below follows `patrol`, so a refusal -- which changes nothing, by
   * contract -- puts every control straight back where it was. Without it the
   * switch would sit on "on" under a sentence saying the change did not save.
   */
  const [draft, setDraft] = useState<PatrolEdit>({
    enabled: patrol.enabled,
    every: patrol.every,
    direction: patrol.direction,
  });
  useEffect(() => {
    setDraft({ enabled: patrol.enabled, every: patrol.every, direction: patrol.direction });
  }, [patrol.enabled, patrol.every, patrol.direction]);

  const send = (next: PatrolEdit) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <div className="flex flex-col gap-[10px]">
      {showName && (
        <span className="px-[10px] font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.1px] text-dim">
          {cameraName}
        </span>
      )}

      <div className="flex items-center justify-between gap-[12px] px-[10px]">
        <span className="text-[0.875rem] leading-[18px] text-body-ink">Patrol</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={`Patrol on ${cameraName}`}
          disabled={pending}
          onClick={() => send({ ...draft, enabled: !draft.enabled })}
          className={`flex h-[22px] w-[38px] shrink-0 items-center rounded-full px-[3px] transition-colors ${
            draft.enabled ? "bg-action" : "bg-stroke"
          } ${pending ? "cursor-not-allowed opacity-60" : ""}`}
        >
          <span
            className={`size-[16px] rounded-full transition-transform ${
              draft.enabled ? "translate-x-[16px] bg-black" : "bg-overlay/70"
            }`}
          />
        </button>
      </div>

      <Row
        label="Every"
        options={EVERY_OPTIONS}
        value={draft.every}
        disabled={pending}
        onPick={(every: PatrolEvery) => send({ ...draft, every })}
      />
      <Row
        label="Direction"
        options={DIRECTION_OPTIONS}
        value={draft.direction}
        disabled={pending}
        onPick={(direction: PatrolDirection) => send({ ...draft, direction })}
      />

      <PatrolLine patrol={patrol} phase={phase} />
    </div>
  );
}

/**
 * The one line under the controls, and there is only ever one.
 *
 * ⚠ IN THIS ORDER, AND IT IS A PRECEDENCE RATHER THAN A LAYOUT. A refusal
 * outranks everything: it is the only thing on this panel a person has to act
 * on. Then what the camera is doing right now, then when it will next go. Off
 * says nothing at all -- a row reading "Off" under a switch reading off is the
 * screen agreeing with itself out loud.
 */
function PatrolLine({ patrol, phase }: { patrol: Patrol; phase: PatrolPhase }) {
  /* One minute, the finest thing a next-patrol time shows. */
  const now = useNow();

  if (phase.kind === "failed") {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
        className="px-[10px] text-[0.75rem] leading-[16px] text-critical"
      >
        {phase.message}
      </motion.p>
    );
  }
  if (phase.kind === "pending") {
    return <p className="px-[10px] text-[0.75rem] leading-[16px] text-muted">Saving…</p>;
  }
  if (!patrol.enabled) return null;
  if (patrol.running) {
    return <p className="px-[10px] text-[0.75rem] leading-[16px] text-terra">Patrolling now</p>;
  }
  if (patrol.nextAt === null) return null;
  const at = Date.parse(patrol.nextAt);
  if (!Number.isFinite(at)) return null;
  return (
    <p className="px-[10px] text-[0.75rem] leading-[16px] text-muted">
      {/* The app's one clock for a time the server reported. See
          `formatConnectedSince`: site time, no zone label, no seconds. */}
      Next patrol: {formatConnectedSince(at, now)}
    </p>
  );
}
