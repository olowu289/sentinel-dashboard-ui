/**
 * The typed duration: what is accepted, what is refused, and what it says.
 *
 * ── WHY THIS IS TESTED AT ALL ─────────────────────────────────────────────
 *
 * Four buttons were not enough -- real shares are "ten minutes while the truck
 * turns round" -- so the picker gained a field to type into, and a typed field
 * means parsing and bounds and an error sentence. All three live in
 * `lib/durations`, with no component around them, so they can be checked as
 * what they are: rules.
 *
 * ⚠ THE BOUNDS ARE THE SERVER'S AND THIS IS A COPY. Nothing here decides a
 * policy. The point of the copy is that somebody who types 2 minutes is told
 * so under the field they typed it in, instead of after a round trip; the
 * server refuses it either way, and if the two ever disagree the server is
 * right and the box was wrong. `MIN_SEC`/`MAX_SEC` come from the SDK, which is
 * the contract, which is what the server enforces -- so this file also fails
 * if somebody changes one of them in only one place.
 *
 *     node --test test/durations.test.mjs
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/* Bundled the way the other lib tests are: this is TypeScript importing from
   `@kallon/sentry-sdk`, and esbuild resolves both in one step. */
const out = mkdtempSync(join(tmpdir(), "durations-"));
execFileSync(
  "node",
  [
    join("node_modules", "esbuild", "bin", "esbuild"),
    "src/lib/durations.ts",
    "--bundle",
    "--format=esm",
    "--platform=neutral",
    `--outdir=${out}`,
    "--out-extension:.js=.mjs",
  ],
  { stdio: "pipe" },
);
const d = await import(pathToFileURL(join(out, "durations.mjs")).href);

describe("the quick choices", () => {
  test("are the four lengths people actually pick", () => {
    assert.deepEqual(
      d.QUICK_DURATIONS.map((q) => q.label),
      ["15 min", "1 hour", "4 hours", "24 hours"],
    );
  });

  test("are all inside the bounds, or a button would be refused by the server", () => {
    for (const q of d.QUICK_DURATIONS) {
      assert.ok(q.sec >= d.MIN_SEC, `${q.label} is under the floor`);
      assert.ok(q.sec <= d.MAX_SEC, `${q.label} is over the ceiling`);
    }
  });

  test("name themselves, so a chosen one is not also shown as a typed value", () => {
    assert.equal(d.quickLabel(3600), "1 hour");
    assert.equal(d.quickLabel(45 * 60), null, "45 minutes is typed, not picked");
  });
});

describe("typing a length", () => {
  test("minutes and hours both work, because people say both", () => {
    assert.equal(d.parseDuration("10", "minutes").sec, 600);
    assert.equal(d.parseDuration("45", "minutes").sec, 2700);
    assert.equal(d.parseDuration("3", "hours").sec, 10800);
  });

  test("an EMPTY field is not an error", () => {
    // Somebody clearing it to type again has not made a mistake, and shouting
    // at them mid-keystroke is how a form becomes unusable.
    const got = d.parseDuration("", "minutes");
    assert.equal(got.sec, null);
    assert.equal(got.problem, null);
  });

  test("whitespace alone is the same as empty", () => {
    assert.equal(d.parseDuration("   ", "hours").problem, null);
  });

  test("something that is not a number says so and names the unit", () => {
    const got = d.parseDuration("ten", "minutes");
    assert.equal(got.sec, null);
    assert.match(got.problem, /whole number of minutes/);
  });

  test("a decimal is refused rather than silently rounded", () => {
    // 1.5 hours is a reasonable thing to mean and an unreasonable thing to
    // guess at: 90 minutes and 1 hour are both defensible readings.
    assert.equal(d.parseDuration("1.5", "hours").sec, null);
  });

  test("a negative is refused, not treated as a length", () => {
    assert.equal(d.parseDuration("-5", "minutes").sec, null);
  });

  test("zero says what a length has to be instead", () => {
    const got = d.parseDuration("0", "minutes");
    assert.equal(got.sec, null);
    assert.match(got.problem, /at least 5 minutes/);
  });
});

describe("the bounds, and what they say when missed", () => {
  test("under the floor names the floor and says why there is one", () => {
    const got = d.parseDuration("2", "minutes");
    assert.equal(got.sec, null);
    assert.match(got.problem, /at least 5 minutes/);
    assert.match(got.problem, /still connecting/);
  });

  test("exactly the floor is allowed: a bound you cannot reach is a lie", () => {
    assert.equal(d.parseDuration("5", "minutes").sec, d.MIN_SEC);
  });

  test("over the ceiling names the ceiling and says what to do instead", () => {
    const got = d.parseDuration("40", "hours".replace("hours", "hours"));
    assert.equal(got.sec, 40 * 3600, "forty hours is fine");
    const far = d.parseDuration("2000", "hours");
    assert.equal(far.sec, null);
    assert.match(far.problem, /at most 30 days/);
    assert.match(far.problem, /Administration/,
      "because the answer to wanting it for longer is not a longer share");
  });

  test("exactly the ceiling is allowed", () => {
    assert.equal(d.parseDuration("720", "hours").sec, d.MAX_SEC);
  });
});

describe("a chosen length is said in the words it was chosen in", () => {
  test("the button's own words win over the largest even unit", () => {
    // Somebody pressed "24 hours" and the panel answering them read "They
    // asked for 1 day": the same length, said two ways, on two screens about
    // one share.
    assert.equal(d.spellDuration(86400), "1 day");
    assert.equal(d.sayDuration(86400), "24 hours");
  });

  test("and a typed length falls back to the spelled one", () => {
    assert.equal(d.sayDuration(2700), "45 minutes");
    assert.equal(d.sayDuration(10 * 60), "10 minutes");
  });

  test("every quick choice says exactly what its button says", () => {
    for (const q of d.QUICK_DURATIONS) assert.equal(d.sayDuration(q.sec), q.label);
  });
});

describe("saying a length back", () => {
  test("in the largest unit that divides evenly", () => {
    assert.equal(d.spellDuration(300), "5 minutes");
    assert.equal(d.spellDuration(3600), "1 hour");
    assert.equal(d.spellDuration(4 * 3600), "4 hours");
    assert.equal(d.spellDuration(30 * 86400), "30 days");
  });

  test("singular where it should be", () => {
    assert.equal(d.spellDuration(60), "1 minute");
    assert.equal(d.spellDuration(86400), "1 day");
  });

  test("and a length that divides into nothing is minutes", () => {
    assert.equal(d.spellDuration(2700), "45 minutes");
  });
});

describe("reopening a picker on a value", () => {
  test("hours when it divides evenly, because 240 minutes is a worse sentence", () => {
    assert.deepEqual(d.splitDuration(4 * 3600), { amount: "4", unit: "hours" });
  });

  test("minutes otherwise", () => {
    assert.deepEqual(d.splitDuration(2700), { amount: "45", unit: "minutes" });
  });

  test("round trips: what it splits, parse puts back together", () => {
    for (const sec of [300, 600, 2700, 3600, 4 * 3600, 86400, 30 * 86400]) {
      const { amount, unit } = d.splitDuration(sec);
      assert.equal(d.parseDuration(amount, unit).sec, sec, `${sec}s`);
    }
  });
});
