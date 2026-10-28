/**
 * The writing rules in CLAUDE.md, enforced on every string a customer reads.
 *
 *   node --test test/userFacingCopy.test.mjs
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS IS A TEST AND NOT A REVIEW
 * ══════════════════════════════════════════════════════════════════════
 *
 * Writing rules are the kind that hold for a week. Somebody adds a row, writes
 * one helpful sentence under it to be kind, and the screen is back where it
 * started. These are read off the source on every run instead, so an em-dash
 * in a label or the word "sub" in a value fails the moment it is written
 * rather than the next time somebody photographs the screen.
 *
 * The scanner (`test/lib/copyScan.mjs`) is deliberately conservative: JSX text
 * and the value of a rendering prop, with comments stripped. It cannot see a
 * sentence assembled from variables. That is the right direction to be wrong
 * in -- a check that cries wolf gets an allowlist, and an allowlist gets
 * everything added to it.
 */

import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { everyString, stripComments, userFacingStrings } from "./lib/copyScan.mjs";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** The harness is not the product: it is a fixture picker for screenshots. */
const SKIP = ["screens.tsx"];

/** `strings` is the careful read; `all` is every literal in the tree. */
let strings = [];
let all = [];
before(async () => {
  strings = await userFacingStrings(SRC, { skip: SKIP });
  all = await everyString(SRC, { skip: SKIP });
});

const show = (hits, n = 8) =>
  hits.slice(0, n).map((h) => `${h.file}:${h.line} [${h.kind}] ${h.text}`).join("\n  ");

/* ======================================================================
 *  RULE 7 — no em-dashes
 * ====================================================================== */

describe("rule 7: no em-dashes in anything a customer reads", () => {
  test("⭐ not one, anywhere", () => {
    /* Run over EVERY string in `src`, not the careful user-facing read. An
       em-dash cannot hide in a class list or a key, so the blunt scan costs
       nothing and catches the three places the careful one cannot see: an
       object literal's `hint:`, a ternary inside a JSX hole, and a sentence
       glued together with `+`. All three were full of them. */
    const hits = all.filter((s) => s.text.includes("—"));
    assert.equal(hits.length, 0,
      `${hits.length} em-dash(es) in user-facing text:\n  ${show(hits, 20)}`);
  });

  test("nor an en-dash standing in for one", () => {
    /* The obvious way to satisfy the rule without honouring it. An en-dash
       between words is the same punctuation wearing a hat; between numbers
       (`09:00–17:00`) it is a range and is fine. */
    const hits = all.filter((s) => /[A-Za-z] – |– [a-z]/.test(s.text));
    assert.equal(hits.length, 0, `en-dash used as an em-dash:\n  ${show(hits)}`);
  });

  test("and the scanners are actually looking at something", () => {
    /* A guard against the whole suite passing because a scanner found no
       strings at all -- which is how a check like this quietly dies. */
    assert.ok(strings.length > 200, `only ${strings.length} prose strings`);
    assert.ok(all.length > 2000, `only ${all.length} raw strings`);
  });
});

/* ======================================================================
 *  RULE 3 — no internal words
 * ====================================================================== */

describe("rule 3: the words inside the system stay inside it", () => {
  /**
   * PHRASES, so there is nothing for them to collide with in a class list or
   * a key. Checked over every string in the tree, because the places they
   * hid last time were exactly the ones `extract` cannot see: a `hint:` in a
   * row object, and a reason glued together with `+`.
   */
  const BANNED_PHRASES = [
    [/\bsub[- ]?stream\b/i, "sub stream"],
    [/\bmain[- ]?stream\b/i, "main stream"],
    [/\bstream\s+"(?:sub|main)"/i, 'stream "sub"'],
    [/\bsinew\b/i, "sinew"],
    [/\bSNMP\b/i, "SNMP"],
    [/\bthe tower reports\b/i, "the tower reports"],
    [/\btower reports no\b/i, "tower reports no"],
    [/\bSet by Kallon\b/i, "Set by Kallon"],
  ];

  /**
   * ⚠ THESE LOOK LIKE CODE BECAUSE THEY ARE CODE, so they can only run over
   * the careful read. `/v1/account` is a real request path and `device_id` is
   * a real property, and both appear all over `lib/api` doing their jobs.
   * What the rule forbids is one of them reaching a label or a sentence, and
   * that is the distinction `extract` draws and the blunt scan cannot.
   */
  const BANNED_INTERNALS = [
    [/\bOID\b/, "OID"],
    [/\/v1\//, "an API path"],
    [/\bdevice_id\b|\bstart_epoch\b|\barchive_enabled\b|\bhealth\.\w+/, "a field name"],
  ];

  for (const [pattern, name] of BANNED_PHRASES) {
    test(`never says "${name}"`, () => {
      const hits = all.filter((s) => pattern.test(s.text));
      assert.equal(hits.length, 0, `found "${name}":\n  ${show(hits)}`);
    });
  }

  for (const [pattern, name] of BANNED_INTERNALS) {
    test(`never shows ${name} as copy`, () => {
      const hits = strings.filter((s) => pattern.test(s.text));
      assert.equal(hits.length, 0, `found ${name} in copy:\n  ${show(hits)}`);
    });
  }

  test('⭐ no value is the bare word "sub" or "main"', () => {
    /* The row that started this: Stream Quality showed `sub`, which is the
       profile's id and means nothing to the person paying for the camera. */
    const hits = strings.filter((s) => /^(sub|main)$/i.test(s.text.trim()));
    assert.equal(hits.length, 0, `a stream id reached the screen:\n  ${show(hits)}`);
  });
});

/* ======================================================================
 *  RULES 1 and 2 — a setting is a label and a value
 * ====================================================================== */

describe("rules 1 and 2: no paragraphs on a settings screen", () => {
  test("⭐ the removed explanations have not come back", () => {
    /* Verbatim openings of the paragraphs this pass deleted. Checked as text
       rather than by length, because the point is these exact explanations. */
    const gone = [
      "Two streams leave this site",
      "Below is which stream",
      "More detail, and more of the uplink",
      "reports no resolution for it",
      "Set current position as home",
      "it has no position to save",
      "home is saved through the same authorized session",
    ];
    const all = strings.map((s) => s.text).join(" \u0000 ");
    const back = gone.filter((g) => all.includes(g));
    assert.deepEqual(back, [], `old explanation text is back: ${back.join(" | ")}`);
  });

  test("no single user-facing string is a paragraph", () => {
    /* A help line is one short line. Anything past this is an explanation of
       how the system works, which rule 1 puts in the code comments where the
       house style already keeps it. */
    const LIMIT = 150;
    const hits = strings.filter(
      (s) => s.text.length > LIMIT && !/\$\{/.test(s.text),
    );
    assert.equal(hits.length, 0,
      `${hits.length} string(s) over ${LIMIT} characters:\n  ${show(hits, 5)}`);
  });
});

/* ======================================================================
 *  RULE 4 — what does not apply is hidden
 * ====================================================================== */

describe("rule 4: absence is hidden, not narrated", () => {
  test('"Not measured" is not a value', () => {
    const hits = strings.filter((s) => /not measured/i.test(s.text));
    assert.equal(hits.length, 0, show(hits));
  });

  test("the settings panel hides its recording rows rather than emptying them", () => {
    /* The rows that only make sense on a device with its own disk are behind
       `recordsLocally`, so a mast that streams to the hub has no Recording
       resolution, no Recording and no Keep footage row at all. */
    const hits = strings.filter(
      (s) => s.file.endsWith("CameraSettingsPanel.tsx") && /^Recording quality$/.test(s.text),
    );
    assert.ok(hits.length <= 1, "the row is declared once, behind one guard");
  });
});

/* ======================================================================
 *  RULE 5 — a read-only value is plain text
 * ====================================================================== */

describe("rule 5: no note explaining why a value cannot be changed", () => {
  test("⭐ RowReading has no `note` prop to hang one on", async () => {
    /* "Set by Kallon" sat under three rows. Deleting the strings is not
       enough: the prop, the taller row and the dim token were all still
       there, one edit from being used again. Removing the mechanism is what
       makes the rule stick. */
    const { readFile } = await import("node:fs/promises");
    const panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    assert.ok(!/note\?: string;/.test(panel), "RowReading grew a `note` prop again");
    assert.ok(!/note="/.test(panel), "a row is carrying a note again");
    assert.ok(!/ROW_TALL/.test(panel), "the two-line row is back");
  });
});

/* ======================================================================
 *  RULE 4 — the rows that do not apply are GUARDED, not emptied
 * ====================================================================== */

describe("rule 4: the guards are in place", () => {
  let panel;
  before(async () => {
    const { readFile } = await import("node:fs/promises");
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
  });

  test("the recording rows are behind a positive test", () => {
    /* A mast that streams to the hub has no recording resolution, no
       recording mode and no retention window. Three rows reading "Not
       reported" under one heading look like three broken things. */
    assert.match(panel, /const recordsLocally =/);
    assert.match(panel, /\{recordsLocally && recordingResolution \?/);
    assert.match(panel, /if \(recordsLocally && retentionRow\.value\)/);

    /* ⚠ THE RECORDING ROW IS THE EXCEPTION, AND IT IS DELIBERATE. It used
       to be gated the same way, and a mast that records nothing got a
       different row in its place reading "Footage · Recorded at the hub".
       The hub records nothing from a tower now, so that row was telling an
       operator their evidence was safe somewhere it is not. The Recording
       row is what answers in both cases, which is why it is gated on having
       been TOLD something rather than on recording locally.

       ⭐ THE GUARDS MOVED OUT OF THE JSX. The Storage group had five
       optional rows and a `last` flag that had to know which of them was
       the final one, which was already wrong once. They are pushed onto
       `storageRows` now and the group renders when the array has anything,
       so these assertions read the pushes rather than the markup. */
    assert.match(panel, /if \(recordingModeRow && !recordingRowIsRedundant\(tower\.footage\)\)/);
    assert.match(panel, /\{storageRows\.length > 0 \? \(/);
    /* AND THE NEW TWO ARE GUARDED THE SAME WAY: `null` from
       `footageReading` is a tower that never said, and a tower that never
       said gets no row rather than a row reading "Up to date". */
    assert.match(panel, /if \(footageRow\)/);
    assert.match(panel, /if \(waitingRow\)/);
    /* ⚠ OVER THE STRIPPED SOURCE. The house comment style writes the old
       wording down to explain why it went, so a raw search finds the phrase
       in the very note that killed it. */
    assert.ok(
      !/Recorded at the hub/.test(stripComments(panel)),
      "the panel claims the hub holds a tower's footage again",
    );
  });

  test("Power is hidden when no pack is fitted", () => {
    assert.match(panel, /\{reportedBattery \? \(/);
  });

  test("Home position is hidden when nothing can move", () => {
    assert.match(panel, /\{movableFeeds\.length > 0 \?/);
  });
});

/* ======================================================================
 *  THE SETTINGS THE WEBSITE ALSO SHOWS
 * ====================================================================== */

describe("picture quality is named the way the website names it", () => {
  let panel;
  let rows;
  before(async () => {
    const { readFile } = await import("node:fs/promises");
    panel = await readFile(join(SRC, "components/CameraSettingsPanel.tsx"), "utf8");
    /* The naming moved out of the component so that the collapsed row and the
       choices under it provably share it -- see `lib/settingsRows.ts`. */
    rows = await readFile(join(SRC, "lib/settingsRows.ts"), "utf8");
  });

  test("⭐ the light one is Standard, the rest are resolutions", () => {
    assert.match(rows, /return "Standard";/);
    assert.match(rows, /if \(w >= 3840\) return "4K";/);
    assert.match(rows, /if \(w >= 2560\) return "2K";/);
    assert.match(rows, /if \(w >= 1920\) return "1080p";/);
    assert.match(rows, /return "HD";/);
  });

  test("⭐ and the panel does not keep a second copy of that naming", () => {
    /* The row and the choices under it disagreed once already, which is what
       `lib/settingsRows.ts` exists to make impossible. A `tierFor` back in the
       component is that disagreement waiting to happen again. */
    assert.ok(!/function tierFor/.test(panel), "tierFor is back in the panel");
    assert.ok(!/function profileLabel/.test(panel), "profileLabel is back");
  });

  test("there is no second line under the choices", () => {
    /* `profileNote` produced a sentence per option about the uplink and the
       battery, under a choice between two words. */
    assert.ok(!/function profileNote/.test(panel), "profileNote is back");
  });

  test("home position offers both halves", () => {
    assert.match(panel, />\s*Go home\s*</);
    assert.match(panel, />\s*Set as home\s*</);
  });
});
