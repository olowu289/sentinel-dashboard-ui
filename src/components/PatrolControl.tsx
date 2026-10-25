/**
 * One movable camera's patrol: the switch, two dropdowns and a Save.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  ONE COMPONENT, EVERY PLACE PATROL IS SET
 * ══════════════════════════════════════════════════════════════════════
 *
 * The tower settings panel draws this under its Patrol row, the hub mast
 * panel draws the same thing, and the camera side panel in Settings → Cameras
 * draws it again. Three routes to one setting, and three renderings is the
 * arrangement where one of them eventually offers an interval the others do
 * not, or keeps reading "Every 4 hours" after another turned it off.
 *
 * ⚠ NOTHING IS SENT UNTIL SAVE, AND THAT IS A CHANGE FROM SENDING ON EVERY
 * PRESS. A person choosing "every 12 hours, anticlockwise" makes three
 * presses; sending each one put two schedules on the camera that nobody asked
 * for, and each was a write to a tower over a radio link. The draft is local,
 * Save is the only thing that writes, and Save is dead until something
 * actually differs from what the device reports.
 *
 * ⚠ AND THE DROPDOWNS ARE HIDDEN WHILE IT IS OFF. An interval and a direction
 * for a patrol that is not running are two settings describing nothing. They
 * come back with their last values the moment the switch goes on, because the
 * draft keeps them -- turning patrol off and on again must not silently reset
 * a schedule somebody chose.
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

const FIELD =
  "h-[36px] w-full rounded-[8px] border border-stroke bg-card px-[10px] text-[0.8125rem] text-body-ink outline-none transition-colors focus-visible:outline-1 focus-visible:outline-terra disabled:text-body-ink/40";

const LABEL =
  "font-display text-[0.6875rem] uppercase leading-[16px] tracking-[0.1px] text-dim";

const same = (a: PatrolEdit, b: PatrolEdit) =>
  a.enabled === b.enabled && a.every === b.every && a.direction === b.direction;

export function PatrolControl({
  patrol,
  cameraName,
  showName,
  phase = { kind: "idle" },
  onSave,
}: {
  /** What the device reports. The only thing drawn once a save settles. */
  patrol: Patrol;
  cameraName: string;
  /** Name the camera, for a device with more than one movable one. */
  showName: boolean;
  phase?: PatrolPhase;
  onSave: (edit: PatrolEdit) => void;
}) {
  const pending = phase.kind === "pending";

  /**
   * The operator's choices, before they are sent.
   *
   * ⚠ RESET BY THE DEVICE'S ANSWER, WHICHEVER WAY IT WENT. The effect follows
   * `patrol`, so a refusal -- which changes nothing, by contract -- puts every
   * control back where it was rather than leaving them on a request that was
   * turned down.
   */
  const current: PatrolEdit = {
    enabled: patrol.enabled,
    every: patrol.every,
    direction: patrol.direction,
  };
  const [draft, setDraft] = useState<PatrolEdit>(current);

  /* ⚠ NOT WHILE A SAVE IS IN FLIGHT. A fleet refresh landing mid-save
     carries the OLD patrol -- that is the whole reason `heldWrites` exists --
     and this effect would take the operator's chosen values off the screen
     and put the old ones back under a "Saving…" label. The device's answer is
     what resets these, and until it arrives the choice stands. */
  useEffect(() => {
    if (pending) return;
    setDraft({ enabled: patrol.enabled, every: patrol.every, direction: patrol.direction });
  }, [pending, patrol.enabled, patrol.every, patrol.direction]);

  /* ⚠ AND A REFUSAL PUTS THEM BACK. Nothing was changed, by contract, so the
     last confirmed values are what `patrol` already holds -- but they have
     not CHANGED, so the effect above would never fire for them. Leaving the
     controls on a rejected choice beside the refusal reads as a change that
     half happened. */
  const failed = phase.kind === "failed";
  useEffect(() => {
    if (!failed) return;
    setDraft({ enabled: patrol.enabled, every: patrol.every, direction: patrol.direction });
  }, [failed, patrol.enabled, patrol.every, patrol.direction]);

  const changed = !same(draft, current);

  return (
    <div className="flex flex-col gap-[12px]">
      {showName && <span className={LABEL}>{cameraName}</span>}

      <div className="flex items-center justify-between gap-[12px]">
        <span className="text-[0.875rem] leading-[18px] text-body-ink">Patrol</span>
        <button
          type="button"
          role="switch"
          aria-checked={draft.enabled}
          aria-label={`Patrol on ${cameraName}`}
          disabled={pending}
          onClick={() => setDraft((d) => ({ ...d, enabled: !d.enabled }))}
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

      {draft.enabled && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={FADE}
          className="flex flex-col gap-[10px]"
        >
          <label className="flex flex-col gap-[4px]">
            <span className={LABEL}>Every</span>
            <select
              value={draft.every}
              disabled={pending}
              onChange={(e) =>
                setDraft((d) => ({ ...d, every: e.target.value as PatrolEvery }))
              }
              className={FIELD}
            >
              {PATROL_INTERVALS.map((v) => (
                <option key={v} value={v}>
                  {everyChoice(v)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-[4px]">
            <span className={LABEL}>Direction</span>
            <select
              value={draft.direction}
              disabled={pending}
              onChange={(e) =>
                setDraft((d) => ({ ...d, direction: e.target.value as PatrolDirection }))
              }
              className={FIELD}
            >
              {PATROL_DIRECTIONS.map((v) => (
                <option key={v} value={v}>
                  {directionWord(v)}
                </option>
              ))}
            </select>
          </label>
        </motion.div>
      )}

      <div className="flex items-center gap-[10px]">
        <button
          type="button"
          /* ⚠ DEAD UNTIL SOMETHING DIFFERS. A Save that is always live invites
             a write that changes nothing, over a radio, to a tower. */
          disabled={!changed || pending}
          aria-busy={pending || undefined}
          onClick={() => onSave(draft)}
          className={`h-[32px] rounded-[8px] px-[14px] text-[0.8125rem] font-medium transition-colors ${
            changed && !pending
              ? "bg-action text-action-ink hover:opacity-90"
              : "cursor-not-allowed bg-card text-body-ink/30"
          }`}
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <PatrolLine patrol={patrol} phase={phase} changed={changed} />
      </div>
    </div>
  );
}

/**
 * The one line beside Save, and there is only ever one.
 *
 * ⚠ IN THIS ORDER, AND IT IS A PRECEDENCE RATHER THAN A LAYOUT. A refusal
 * outranks everything: it is the only thing here a person has to act on.
 * Then: while a draft differs from the device, the device's own state is no
 * longer what the controls say, so saying "next patrol" beside an unsaved
 * change would describe a schedule that is not the one on screen. Then what
 * the camera is doing, then when it next goes. Off says nothing at all.
 */
function PatrolLine({
  patrol,
  phase,
  changed,
}: {
  patrol: Patrol;
  phase: PatrolPhase;
  changed: boolean;
}) {
  /* One minute, the finest thing a next-patrol time shows. */
  const now = useNow();

  if (phase.kind === "failed") {
    return (
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={FADE}
        className="min-w-0 text-[0.75rem] leading-[16px] text-critical"
      >
        {phase.message}
      </motion.p>
    );
  }
  if (phase.kind === "pending" || changed) return null;
  if (!patrol.enabled) return null;
  if (patrol.running) {
    return <p className="text-[0.75rem] leading-[16px] text-terra">Patrolling now</p>;
  }
  if (patrol.nextAt === null) return null;
  const at = Date.parse(patrol.nextAt);
  if (!Number.isFinite(at)) return null;
  return (
    <p className="text-[0.75rem] leading-[16px] text-muted">
      {/* The app's one clock for a time the server reported. See
          `formatConnectedSince`: site time, no zone label, no seconds. */}
      Next patrol: {formatConnectedSince(at, now)}
    </p>
  );
}
