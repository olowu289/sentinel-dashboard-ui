/**
 * The sign-in lockout, as something a person can read and wait out.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHAT HAPPENED
 * ══════════════════════════════════════════════════════════════════════
 *
 * `guest2`'s login was `guest2.terra-industries`; every screen in the product
 * says `Terra Industries`. An administrator typed the organization the way it
 * is written, five times, and was told:
 *
 *     Too many sign-in attempts. Wait a few minutes and try again
 *
 * The server had sent the exact number of seconds. The browser could not read
 * it (a cross-origin page cannot see `Retry-After` unless the server exposes
 * the header, and it did not), the body did not carry it, so the screen
 * guessed "a few minutes" — and an attempt made too early EXTENDS the lock,
 * which is how a fifteen-minute wait becomes an hour.
 *
 * Everything here is the arithmetic and the wording behind the countdown. The
 * component is thin on purpose: a deadline, a one-second tick, and these
 * functions.
 *
 *     node --test test/lockout.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const out = mkdtempSync(join(tmpdir(), "lockout-"));
execFileSync(
  "node",
  [
    join("node_modules", "esbuild", "bin", "esbuild"),
    "src/lib/lockout.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    `--outdir=${out}`,
    "--out-extension:.js=.mjs",
  ],
  { stdio: "pipe" },
);

/* A LOCAL STORAGE THAT BEHAVES LIKE ONE, including throwing when it is full,
   because the module has to survive that: a hub's LAN dashboard runs in
   whatever browser is in the control room. */
function fakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}
globalThis.window = { localStorage: fakeStorage() };

const {
  LOCKED_MESSAGE,
  deadlineFor,
  forgetLock,
  formatCountdown,
  lockKey,
  lockedButtonLabel,
  lockedUntil,
  loginExampleFor,
  rememberLock,
  secondsLeft,
  wrongCredentialMessage,
} = await import(pathToFileURL(join(out, "lockout.mjs")).href);

describe("the countdown", () => {
  test("mm:ss under an hour, never raw seconds", () => {
    assert.equal(formatCountdown(299), "4:59");
    assert.equal(formatCountdown(900), "15:00");
    assert.equal(formatCountdown(61), "1:01");
    assert.equal(formatCountdown(9), "0:09");
    assert.equal(formatCountdown(0), "0:00");
  });

  test("and hours when the lock has doubled past one", () => {
    assert.equal(formatCountdown(3_600), "1:00:00");
    assert.equal(formatCountdown(3_899), "1:04:59");
  });

  test("it ticks: one second less per second", () => {
    const until = deadlineFor({ retryAfterSec: 300 }, 1_000_000);
    assert.equal(secondsLeft(until, 1_000_000), 300);
    assert.equal(secondsLeft(until, 1_001_000), 299);
    assert.equal(formatCountdown(secondsLeft(until, 1_001_000)), "4:59");
  });

  test("a tab that slept wakes up with the right time, not the time it slept at",
    () => {
      /* ⚠ THE REASON IT IS A DEADLINE AND NOT A TIMER. A background tab has
         its intervals throttled, so a counter that decremented itself would
         still say four minutes after ten minutes asleep. */
      const until = deadlineFor({ retryAfterSec: 300 }, 1_000_000);
      assert.equal(secondsLeft(until, 1_000_000 + 10 * 60_000), 0);
      assert.equal(secondsLeft(until, 1_000_000 + 120_000), 180);
    });

  test("it never goes negative, and zero means over", () => {
    const until = deadlineFor({ retryAfterSec: 5 }, 0);
    assert.equal(secondsLeft(until, 60_000), 0);
    assert.equal(formatCountdown(secondsLeft(until, 60_000)), "0:00");
  });

  test("a nonsense Retry-After cannot disable the button until next week", () => {
    const until = deadlineFor({ retryAfterSec: 99_999_999 }, 0);
    assert.equal(secondsLeft(until, 0), 86_400);
  });

  test("no number at all is no deadline, rather than a deadline of now", () => {
    assert.equal(deadlineFor({ retryAfterSec: 0 }), 0);
    assert.equal(deadlineFor({ retryAfterSec: NaN }), 0);
    assert.equal(secondsLeft(0), 0);
  });
});

describe("the button", () => {
  test("says when, not that it is disabled", () => {
    assert.equal(lockedButtonLabel(299), "TRY AGAIN IN 4:59");
  });

  test("and the message never says throttle, or a code, or raw seconds", () => {
    const whole = `${LOCKED_MESSAGE} You can try again in ${formatCountdown(299)}.`;
    assert.doesNotMatch(whole, /throttl/i);
    assert.doesNotMatch(whole, /\b429\b/);
    assert.doesNotMatch(whole, /\b\d{2,} seconds\b/);
    assert.match(whole, /for your security/i);
    assert.match(whole, /4:59/);
  });
});

describe("surviving a refresh", () => {
  test("a remembered lock is still there, with less time on it", () => {
    window.localStorage.clear();
    const until = deadlineFor({ retryAfterSec: 300 }, Date.now());
    rememberLock("guest2.terra-industries", until);
    /* The page reloads here: new module state, same storage. */
    const restored = lockedUntil("guest2.terra-industries");
    assert.equal(restored, until);
    assert.ok(secondsLeft(restored) <= 300 && secondsLeft(restored) > 290);
  });

  test("a lock that has run out is not restored", () => {
    window.localStorage.clear();
    rememberLock("guest2.terra-industries", Date.now() - 1_000);
    assert.equal(lockedUntil("guest2.terra-industries"), 0);
  });

  test("it is per login, so one person's lock is not everybody's", () => {
    window.localStorage.clear();
    rememberLock("guest2.terra-industries", Date.now() + 300_000);
    assert.ok(lockedUntil("guest2.terra-industries") > 0);
    assert.equal(lockedUntil("dele.terra-industries"), 0);
    assert.equal(lockedUntil("Terra Industries"), 0);
  });

  test("the three ways of typing one login share one lock", () => {
    /* ⚠ THE SAME FOLDING THE SERVER COUNTS BY. It locks the account, not the
       spelling, so a screen that keyed on the spelling would offer an enabled
       button that answers 429. */
    window.localStorage.clear();
    rememberLock("guest2.Terra Industries", Date.now() + 300_000);
    assert.ok(lockedUntil("guest2.terra-industries") > 0);
    assert.ok(lockedUntil("GUEST2.terra industries") > 0);
    assert.equal(lockKey("guest2.Terra Industries"), "guest2.terra-industries");
  });

  test("an organization's own login is keyed byte for byte, as the server matches it",
    () => {
      /* `" Terra Industries"` is a DIFFERENT login from `"Terra Industries"`
         and has been since the beginning. */
      assert.equal(lockKey("Terra Industries"), "Terra Industries");
      assert.notEqual(lockKey(" Terra Industries"), lockKey("Terra Industries"));
    });

  test("a success forgets it", () => {
    window.localStorage.clear();
    rememberLock("guest2.terra-industries", Date.now() + 300_000);
    forgetLock("guest2.terra-industries");
    assert.equal(lockedUntil("guest2.terra-industries"), 0);
  });

  test("a browser that refuses storage still signs in", () => {
    const saved = window.localStorage;
    window.localStorage = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
    };
    assert.doesNotThrow(() => rememberLock("x.y", Date.now() + 1_000));
    assert.equal(lockedUntil("x.y"), 0);
    window.localStorage = saved;
  });
});

describe("the refusal before any lockout", () => {
  test("it says to check the spelling, with a real example", () => {
    const msg = wrongCredentialMessage("guest2.Terra Industries");
    assert.match(msg, /do not match/);
    assert.match(msg, /name\.terra-industries/);
    /* ⚠ NOT A PLACEHOLDER. `name.<organization>` was printed on a screen in
       production, angle brackets and all, and somebody typed it in. */
    assert.doesNotMatch(msg, /[<>]/);
  });

  test("it reveals nothing about whether the login exists", () => {
    /* The same sentence for all four causes, because the server answers one
       uniform 401 for all four. The only thing that varies is the example,
       which is built from what the person typed. */
    const a = wrongCredentialMessage("guest2.terra-industries");
    const b = wrongCredentialMessage("nobody.terra-industries");
    assert.equal(a, b);
  });

  test("with no dot there is nothing to echo and it says so generically", () => {
    assert.equal(loginExampleFor("Terra Industries"), "name.your-organization");
    assert.match(wrongCredentialMessage("Terra Industries"), /name\.your-organization/);
  });
});
