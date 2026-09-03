import { useCallback, useEffect, useRef, useState } from "react";

/**
 * One pattern for "this action is in flight / it failed / try it again".
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THIS IS `useExportPhase` GROWN A FAILURE HALF
 * ══════════════════════════════════════════════════════════════════════
 *
 * The app already had a three-phase action grammar — `idle | working | done`,
 * invented for the simulated clip export — and it is already designed, shipped
 * and accessible: a spinner while it works, a check that *retracts* rather than
 * blinking out, `aria-busy`, and an `sr-only` `role="status"` because an icon
 * swap is invisible to a screen reader. Two surfaces use it and agree.
 *
 * So this inherits all of that and adds only what was missing: an `error`
 * phase carrying the REAL error, and a retry that re-runs the same work.
 * Nothing about the pending or success language is new, which is the point —
 * an operator should not have to learn a second vocabulary for "wait" because
 * the wait happens to be a network round trip this time.
 *
 * ── KEYED BY TARGET, AND THAT IS STRUCTURAL ────────────────────────────
 *
 * `run` takes a key. Every consumer passes the id of the thing being acted on,
 * and single-target callers pass a constant.
 *
 * It is keyed rather than single-valued because of a trap this codebase
 * documents and has already been bitten by: `AlertDetail` is DELIBERATELY never
 * remounted — `AlertsPanel` renders it without a `key` so arrowing through the
 * feed swaps its content in place and bulk triage stays instant. Any `useState`
 * added inside it therefore survives the swap and shows up against the NEXT
 * alert. A pending spinner or a red failure appearing against an alert nobody
 * touched is the worst version of that bug, because it is a lie about an
 * auditable action.
 *
 * Keying by id makes that unrepresentable rather than merely discouraged: the
 * state belongs to the alert, not to the panel, so swapping the panel's content
 * cannot carry it across. `PersonDetail` is keyed (`key={selected.id}`) and is
 * safe either way; know the asymmetry.
 *
 * ── NO OPTIMISM ────────────────────────────────────────────────────────
 *
 * This hook never touches your data. It reports what an action is doing; the
 * consumer commits the change inside `fn`, AFTER the await resolves. A value
 * that changes and then reverts is one the operator may already have acted on,
 * and on a monitoring surface that is worse than a slower control.
 *
 * Optimism is defensible only for pure view state — the wall arrangement, a
 * dismissed notice — which does not go through here.
 */

export type MutationPhase =
  | { kind: "idle" }
  | { kind: "pending" }
  /** Briefly, so the check can retract. Skipped when the consumer is `quiet`. */
  | { kind: "done" }
  | { kind: "error"; error: unknown; message: string };

const IDLE: MutationPhase = { kind: "idle" };

/**
 * How long a success is shown before it retracts.
 *
 * `useExportPhase` holds its check for 2.2s (done at 1200ms, idle at 3400ms).
 * The same interval here, because it is the same reassurance doing the same
 * job — long enough to be seen, short enough that a control does not sit
 * congratulating itself.
 */
const CONFIRM_MS = 2_200;

/**
 * Pull the most specific wording available out of a thrown value.
 *
 * The typed errors this app throws already say the right thing — `AuthRejected`
 * carries the uniform credential message, `PlaybackError` carries "the tower
 * did not answer", the claim errors carry a real next step. Replacing any of
 * that with "Something went wrong" would throw away the only part an operator
 * can act on, so the message is carried through untouched.
 */
export function mutationMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "The action did not complete";
}

export interface Mutation {
  /**
   * Run an action for one target.
   *
   * Idempotent while in flight: a second call for the same key joins the first
   * rather than issuing a second write. The guard is a ref, not the phase —
   * phase is state, and two clicks in one tick both read the stale value.
   *
   * Resolves when the action settles. It does NOT rethrow: the failure is the
   * phase, and a caller that also had to catch would have two places to keep in
   * step. Read `phase(key)` if you need to branch.
   */
  run: (key: string, fn: () => Promise<void>) => Promise<void>;
  /** The phase for one target. `idle` for anything untouched. */
  phase: (key: string) => MutationPhase;
  /** True while this target's action is in flight. */
  isPending: (key: string) => boolean;
  /** Re-run the last action for this target. Deliberate; there is no auto-retry. */
  retry: (key: string) => Promise<void>;
  /** Back to idle — for dismissing a failure without re-running it. */
  reset: (key: string) => void;
}

export function useMutation(
  options: {
    /**
     * Skip the success flash. For ROUTINE acts where the new value is itself
     * the confirmation — a renamed tower already reads as renamed — and a check
     * would be the control congratulating itself for doing its job.
     *
     * Consequential acts keep it: acknowledging an alert changes an auditable
     * record and its own row does not obviously move, so the confirmation is
     * the only thing that says it landed.
     */
    quiet?: boolean;
    confirmMs?: number;
  } = {},
): Mutation {
  const { quiet = false, confirmMs = CONFIRM_MS } = options;

  const [phases, setPhases] = useState<Record<string, MutationPhase>>({});

  /* In-flight promises by key. A ref, because `phases` is state: two clicks
     dispatched in one tick both read the same stale `idle` and both would
     write. The same latch the sign-in path needed, for the same reason. */
  const inFlight = useRef<Map<string, Promise<void>>>(new Map());
  /* The last action per key, so `retry` re-runs the real work rather than
     asking the caller to remember it. */
  const lastFn = useRef<Map<string, () => Promise<void>>>(new Map());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    const running = timers.current;
    return () => {
      alive.current = false;
      running.forEach(clearTimeout);
      running.clear();
    };
  }, []);

  const set = useCallback((key: string, phase: MutationPhase) => {
    if (!alive.current) return;
    setPhases((prev) => ({ ...prev, [key]: phase }));
  }, []);

  const run = useCallback(
    (key: string, fn: () => Promise<void>): Promise<void> => {
      const existing = inFlight.current.get(key);
      if (existing) return existing;

      lastFn.current.set(key, fn);

      const clearTimer = timers.current.get(key);
      if (clearTimer) {
        clearTimeout(clearTimer);
        timers.current.delete(key);
      }

      const attempt = async () => {
        set(key, { kind: "pending" });
        try {
          /* The consumer commits its change in here, after its own await. This
             hook never writes the value — see the note on optimism. */
          await fn();
          if (!alive.current) return;
          if (quiet) {
            set(key, IDLE);
            return;
          }
          set(key, { kind: "done" });
          timers.current.set(
            key,
            setTimeout(() => {
              timers.current.delete(key);
              set(key, IDLE);
            }, confirmMs),
          );
        } catch (err) {
          if (!alive.current) return;
          /* The real error, with its real wording. It stays until the operator
             retries or dismisses it — a failure that fades on a timer is one
             somebody can miss entirely. */
          set(key, { kind: "error", error: err, message: mutationMessage(err) });
        } finally {
          inFlight.current.delete(key);
        }
      };

      /* `attempt()` runs synchronously to its first await, so the latch is set
         before any other click in the same tick can be dispatched. */
      const running = attempt();
      inFlight.current.set(key, running);
      return running;
    },
    [confirmMs, quiet, set],
  );

  const retry = useCallback(
    (key: string): Promise<void> => {
      const fn = lastFn.current.get(key);
      if (!fn) return Promise.resolve();
      return run(key, fn);
    },
    [run],
  );

  const reset = useCallback(
    (key: string) => {
      const t = timers.current.get(key);
      if (t) {
        clearTimeout(t);
        timers.current.delete(key);
      }
      set(key, IDLE);
    },
    [set],
  );

  const phase = useCallback(
    (key: string): MutationPhase => phases[key] ?? IDLE,
    [phases],
  );

  const isPending = useCallback(
    (key: string): boolean => (phases[key] ?? IDLE).kind === "pending",
    [phases],
  );

  return { run, phase, isPending, retry, reset };
}
