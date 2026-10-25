/**
 * What the server has just confirmed, held until a refresh agrees with it.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE FLICKER THIS EXISTS TO REMOVE
 * ══════════════════════════════════════════════════════════════════════
 *
 * Saving a patrol showed "2 hours", then "1 hour" again, then "2 hours" a few
 * seconds later. Nothing was broken in the save: the PUT answered 200 with the
 * new value and the screen drew it. What overwrote it was the FLEET REFRESH —
 * a `listFleet` that had been in flight, or that ran a moment later against a
 * read model which had not caught up, carrying the old patrol for that camera
 * and replacing every feed wholesale.
 *
 * So the screen was telling the truth three times in a row and was wrong twice
 * of the three, which is worse than being slow. An operator who sets a patrol
 * and watches it revert has no way to know which of the two numbers is real.
 *
 * ── WHY A HOLD AND NOT "STOP POLLING FOR A WHILE" ─────────────────────
 *
 * Because the poll carries everything else: link state, battery, cameras
 * coming back, a tower going dark. Pausing it to protect one field would
 * freeze the whole fleet view to make one row steady. The hold is narrower:
 * it protects exactly the fields somebody has just changed, and lets every
 * other fact through untouched.
 *
 * ── AND WHY IT EXPIRES ────────────────────────────────────────────────
 *
 * A hold is a claim that the server agreed and has not caught up yet. After
 * `HOLD_MS` that claim stops being credible: something else may have changed
 * the value — another operator, the device itself, a rollback — and the
 * server's answer is the one that counts. Two minutes is long enough for any
 * read model to settle and short enough that a stale hold cannot outlive the
 * session that made it.
 *
 * ⚠ THE HOLD IS CLEARED BY AGREEMENT, NOT BY TIME ALONE. The moment a
 * refresh carries the value that was confirmed, the hold has done its job and
 * goes — so the common case holds for one poll, not for two minutes.
 */

/** How long a confirmed value outranks the server's, at most. */
export const HOLD_MS = 2 * 60_000;

/** One confirmed write: what the server answered, and when. */
interface Held {
  value: unknown;
  at: number;
}

/**
 * The key a hold is filed under.
 *
 * Per OBJECT and per FIELD, so holding a camera's patrol does not also hold
 * its name: two people changing two different things about one camera must
 * not overwrite each other, and a refresh agreeing about one must not clear
 * the other.
 */
export const holdKey = (kind: "camera" | "tower", id: string, field: string) =>
  `${kind}:${id}:${field}`;

/** Compared by value, because a patrol block is rebuilt on every parse. */
function agrees(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== "object" || typeof b !== "object") return false;
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(ao), ...Object.keys(bo)]);
  for (const k of keys) if (!agrees(ao[k], bo[k])) return false;
  return true;
}

/**
 * The store itself.
 *
 * A plain object rather than a hook, because the thing that writes to it is an
 * async callback and the thing that reads it is the same callback a moment
 * later — neither renders from it. What renders is the ARRAY it returns, which
 * is ordinary state. Holding this in React state instead would re-render the
 * whole app twice per poll to change nothing anybody can see.
 */
export class HeldWrites {
  private held = new Map<string, Held>();

  /** Record a value the SERVER has confirmed. */
  confirm(key: string, value: unknown, now = Date.now()): void {
    this.held.set(key, { value, at: now });
  }

  /** Forget one, for a refusal: there is nothing confirmed to hold. */
  release(key: string): void {
    this.held.delete(key);
  }

  /** What is held for this key, or `undefined`. Expired holds are dropped. */
  peek(key: string, now = Date.now()): unknown | undefined {
    const h = this.held.get(key);
    if (!h) return undefined;
    if (now - h.at >= HOLD_MS) {
      this.held.delete(key);
      return undefined;
    }
    return h.value;
  }

  /** How many holds are live. For the tests, and for nothing else. */
  get size(): number {
    return this.held.size;
  }

  /**
   * Put the held values back over a server answer.
   *
   * ⚠ IT ALSO CLEARS, AND THAT IS WHY IT TAKES THE WHOLE LIST. A hold exists
   * to bridge the gap between a confirmed write and the read model catching
   * up; the moment this sees the server carrying the same value, the gap is
   * closed and the hold goes. Expiry is the backstop, not the mechanism.
   *
   * `read` gets the field off an item and `write` puts it back, so one method
   * serves cameras and towers and whatever is next.
   */
  apply<T>(
    items: readonly T[],
    kind: "camera" | "tower",
    field: string,
    idOf: (item: T) => string,
    read: (item: T) => unknown,
    write: (item: T, value: unknown) => T,
    now = Date.now(),
  ): readonly T[] {
    if (this.held.size === 0) return items;
    let changed = false;
    const out = items.map((item) => {
      const key = holdKey(kind, idOf(item), field);
      const h = this.held.get(key);
      if (!h) return item;
      if (now - h.at >= HOLD_MS) {
        /* The claim has stopped being credible. Something else may have
           changed this since -- another operator, the device, a rollback --
           and the server's answer is the one that counts. */
        this.held.delete(key);
        return item;
      }
      if (agrees(read(item), h.value)) {
        /* Caught up. The hold has done its whole job. */
        this.held.delete(key);
        return item;
      }
      changed = true;
      return write(item, h.value);
    });
    return changed ? out : items;
  }
}
