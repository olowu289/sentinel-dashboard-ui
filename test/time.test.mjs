/**
 * Durations an operator can read, and a zone that is always labelled.
 *
 *   npm run test:lib
 *
 * Both of these shipped wrong and were seen on sentri.watch:
 *
 *   A CLIP LENGTH PRINTED AS "13m 56.591999999999985s". The split took the
 *   modulus of a raw float, so seventeen digits of encoder timing were put in
 *   front of an operator as the length of a recording.
 *
 *   EVERY TIME WAS SHOWN IN UTC. The zone is read from the coordination
 *   process's own SITE_TZ, which defaults to UTC, and only the hub config sets
 *   it -- so the data centre reported ITS zone for footage recorded in another
 *   one. The upstream fix is the DC carrying each hub's zone; what is tested
 *   here is the half that lives in this app: a deployment can pin the zone, and
 *   whatever zone is in force gets a label rather than a bare number.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  formatDuration,
  setSiteTz,
  siteTz,
  siteTzLabel,
} from "../node_modules/.cache/footage-test/time.mjs";

/* ======================================================================
 *  DURATIONS
 * ====================================================================== */

test("⭐ a float duration is rounded to whole seconds", () => {
  /* THE BUG, verbatim: a real archive segment's duration. */
  assert.equal(formatDuration(836.591999999999985), "13m 57s");
});

test("⭐ no duration ever prints a decimal point", () => {
  for (const s of [0.5, 1.25, 59.4, 59.6, 61.01, 836.5919, 3599.999, 86399.4]) {
    assert.ok(!formatDuration(s).includes("."), `${s} -> ${formatDuration(s)}`);
  }
});

test("the rounding carries, rather than producing 60 seconds", () => {
  /* 59.6 is a minute, not "0m 60s" -- which is what rounding AFTER the split
     would have given. */
  assert.equal(formatDuration(59.6), "1m");
  assert.equal(formatDuration(119.7), "2m");
});

test("whole minutes say so, without a trailing zero", () => {
  assert.equal(formatDuration(900), "15m");
  assert.equal(formatDuration(60), "1m");
});

test("under a minute is seconds alone", () => {
  assert.equal(formatDuration(45.2), "45s");
  assert.equal(formatDuration(0), "0s");
});

test("seconds are zero-padded, so lengths line up in a list", () => {
  assert.equal(formatDuration(65), "1m 05s");
});

test("a junk duration is 0s rather than NaN on the screen", () => {
  assert.equal(formatDuration(NaN), "0s");
  assert.equal(formatDuration(-5), "0s");
  assert.equal(formatDuration(Infinity), "0s");
});

/* ======================================================================
 *  THE ZONE
 * ====================================================================== */

test("⭐ the site zone is labelled, never a bare offsetless time", () => {
  setSiteTz("Africa/Lagos");
  assert.equal(siteTz(), "Africa/Lagos");
  assert.equal(siteTzLabel(), "WAT");
});

test("a zone whose short name is a real abbreviation keeps it", () => {
  setSiteTz("America/New_York");
  assert.ok(/^E[SD]T$/.test(siteTzLabel()), siteTzLabel());
  setSiteTz("UTC");
  assert.equal(siteTzLabel(), "UTC");
});

test("⭐ an unknown zone keeps its OFFSET rather than inventing a name", () => {
  /* The rule this replaced took the initials of the long name, which gives WAT
     for West Africa Time and "UKT" for Europe/London -- an abbreviation nobody
     has ever written, printed next to a timestamp as though it were a fact. */
  setSiteTz("Europe/London");
  const label = siteTzLabel();
  assert.ok(/^(GMT|BST)/.test(label), label);
  assert.notEqual(label, "UKT");
});

test("a label is always produced, for any zone", () => {
  for (const tz of ["Africa/Nairobi", "Asia/Kolkata", "Australia/Sydney", "UTC"]) {
    setSiteTz(tz);
    const label = siteTzLabel();
    assert.ok(typeof label === "string" && label.length > 0, `${tz} -> ${label}`);
  }
});

test("an invalid zone is refused rather than adopted", () => {
  setSiteTz("Africa/Lagos");
  assert.equal(setSiteTz("Not/AZone"), false);
  assert.equal(siteTz(), "Africa/Lagos", "the previous zone stands");
});

test("an empty answer from the service does not clear the zone", () => {
  /* A hub too old to send `site.tz` must leave the fallback in place rather
     than resetting the app to the viewer's machine. */
  setSiteTz("Africa/Lagos");
  setSiteTz(null);
  setSiteTz("");
  assert.equal(siteTz(), "Africa/Lagos");
});
