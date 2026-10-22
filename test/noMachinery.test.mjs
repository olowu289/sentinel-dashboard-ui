/**
 * NOTHING A CUSTOMER READS IS WRITTEN FOR US. Scanned across the whole app.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY A SECOND, WIDER TEST
 * ══════════════════════════════════════════════════════════════════════
 *
 * `said.test.mjs` proves the MAPPER refuses machinery. It cannot prove that
 * every screen asks the mapper, and the round that wrote it missed the live
 * video paths entirely — which is where a customer spends their day. A viewer
 * whose share did not include steering pressed an arrow and read
 *
 *     PTZ FAILED — PTZ_FORBIDDEN
 *
 * and when the share ran out the tile said
 *
 *     kln_lab_000002 IS UNAVAILABLE
 *     This tower is not on your fleet any more.
 *
 * Neither string went near `said.ts`: `api/ptz.ts` kept its own table and its
 * own shouting fallback, and `App.tsx` interpolated the device id straight
 * into a heading.
 *
 * So this scans the SHIPPED SOURCE for the shapes those two had: a code in
 * CAPS_WITH_UNDERSCORES, a `kln_`/`hub-`/`acct_` identifier, an API path, the
 * contract vocabulary, a bare HTTP status, a stack line.
 *
 *     node --test test/noMachinery.test.mjs
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { before, describe, test } from "node:test";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");

async function sourceFiles() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  await walk(SRC);
  return out;
}

/** Comments blanked: a note ABOUT a bug must not count as the bug. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + m.slice(p.length).replace(/./g, " "));
}

/** `${...}` is code, not text: blanked before anything is judged. */
const blank = (text) => text.replace(/\$\{[^}]*\}/g, " ");

/** This app's vocabulary for "words that go on a screen". */
const RENDER_PROPS = [
  "message",
  "title",
  "placeholder",
  "label",
  "hint",
  "why",
  "blurb",
  "consequence",
  "confirmLabel",
  "aria-label",
  "alt",
  "headline",
  "question",
].join("|");

/**
 * The strings that can reach a screen.
 *
 * ⚠ BY POSITION, NOT BY EXISTENCE, and the difference is the whole usefulness
 * of this file. Scanning every literal flagged `"/v1/account"` — which is the
 * path we CALL — and `"HTTP 501 not_configured"`, which is an error's
 * `detail`, logged and never rendered. Both are right as they are, and a test
 * that fails on them is a test somebody turns off.
 *
 * So three positions, which between them are everything a person reads:
 *
 *   1. JSX TEXT: `<p>kln_lab_000002 IS UNAVAILABLE</p>`;
 *   2. a RENDERED PROP, from the list above;
 *   3. a RETURNED SENTENCE: `return "PTZ FAILED — ..."`. A returned string
 *      with a SPACE in it is prose; one without is an identifier, a path or a
 *      CSS class, which nobody reads.
 */
function screenStrings(source) {
  const code = stripComments(source);
  const out = [];

  for (const m of code.matchAll(/>\s*([A-Za-z][^<>{}\n]{6,200})\s*</g)) {
    out.push(m[1]);
  }

  const propRe = new RegExp(
    "(?:" + RENDER_PROPS + ')=(?:"([^"\\n]{4,300})"|\\{`([^`]{4,300})`\\})',
    "g",
  );
  for (const m of code.matchAll(propRe)) out.push(blank(m[1] ?? m[2] ?? ""));

  for (const m of code.matchAll(/return\s+"([^"\n]{4,300})"/g)) {
    if (m[1].includes(" ")) out.push(m[1]);
  }
  for (const m of code.matchAll(/return\s+`([^`]{4,300})`/g)) {
    const t = blank(m[1]);
    if (t.includes(" ")) out.push(t);
  }
  /* A sentence assigned to a message-shaped field, which is how a phase or a
     failure object carries it to a component. */
  for (const m of code.matchAll(/(?:message|error|text|headline):\s*"([^"\n]{4,300})"/g)) {
    out.push(m[1]);
  }
  return out;
}

/** What must never be in one of those strings, and what to call it. */
const BANNED = [
  [/\bPTZ_[A-Z]+\b/, "a shouted server code"],
  [/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/, "a CAPS_WITH_UNDERSCORES code"],
  [/\bkln_[a-z0-9_]+/i, "a tower serial"],
  [/\bacct_[A-Za-z0-9]{6,}/, "an account id"],
  [/\bhub[-_][a-z0-9][a-z0-9-]{2,}/i, "a hub id"],
  [/\bsite_[0-9a-f]{6,}/i, "a site id"],
  [/\/v\d+\//, "an API path"],
  [/\bdocumented shape\b/i, "contract vocabulary"],
  [/\bschema\b/i, "contract vocabulary"],
  [/\bfield:\s/i, "a validator prefix"],
  [/\bHTTP \d{3}\b/, "an HTTP status"],
  [/\bat [A-Za-z$_][\w$.]*\s*\(/, "a stack line"],
  [/\.(?:ts|tsx|js|mjs):\d+/, "a source location"],
];

describe("no machinery reaches a screen", () => {
  test("every string a screen can print is written for a person", async () => {
    const offenders = [];
    for (const file of await sourceFiles()) {
      const source = await readFile(file, "utf8");
      const rel = file.slice(ROOT.length + 1).replace(/\\/g, "/");
      /* THE MAPPERS ARE EXEMPT FROM THEMSELVES. `said.ts` holds the code table
         it maps FROM and `auditSentence.ts` the action names it writes
         sentences for; both would otherwise flag their own contents. */
      if (rel === "src/lib/said.ts" || rel === "src/lib/auditSentence.ts") continue;
      for (const text of screenStrings(source)) {
        for (const [re, why] of BANNED) {
          if (re.test(text)) {
            offenders.push(`${rel}: ${why} -> ${JSON.stringify(text.slice(0, 120))}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(offenders, [], `machinery on screen:\n${offenders.join("\n")}`);
  });

  test("the scanner finds the shapes it is looking for", () => {
    /* A scanner that matches nothing passes forever. These are the real
       strings from the bug reports, as they were written. */
    for (const s of [
      "PTZ FAILED — PTZ_FORBIDDEN",
      "kln_lab_000002 IS UNAVAILABLE",
      "people list from /v1/admin/people is not the documented shape",
      "HTTP 404 not_found",
      "at SentryClient.adminListPeople (client.js:1587)",
    ]) {
      assert.ok(
        BANNED.some(([re]) => re.test(s)),
        `the scanner does not catch ${JSON.stringify(s)}`,
      );
    }
  });

  test("and it reads the positions it claims to read", () => {
    /* The scanner itself, exercised: a bug in it is a green test that proves
       nothing, which is the failure mode of every source-scanning test. */
    const sample = [
      'const a = <p className="x">kln_lab_000002 IS UNAVAILABLE</p>;',
      'const b = <X message="PTZ FAILED - PTZ_FORBIDDEN" />;',
      'function f() { return "PTZ FAILED - PTZ_FORBIDDEN"; }',
      'const d = { message: "HTTP 404 not_found" };',
      'const path = "/v1/admin/people";',
    ].join("\n");
    const found = screenStrings(sample);
    assert.equal(found.length, 4, found.join(" | "));
    assert.ok(
      !found.some((t) => t === "/v1/admin/people"),
      "a path we call is not text somebody reads",
    );
  });
});

describe("the video tile's own states", () => {
  let tile;
  let fallback;
  let access;
  before(async () => {
    tile = await readFile(join(SRC, "components/CameraTile.tsx"), "utf8");
    fallback = await readFile(join(SRC, "components/TileFallback.tsx"), "utf8");
    access = await readFile(join(SRC, "components/AccessEnded.tsx"), "utf8");
  });

  test("a share that ended says so, with two ways forward", () => {
    assert.match(access, /Your access to these cameras has ended\./);
    assert.match(access, /Request more time/);
    assert.match(access, /Close/);
    assert.match(
      access,
      /Request sent\. You&rsquo;ll see the cameras again if it&rsquo;s accepted\./,
    );
  });

  test("the tile uses it when the camera was LENT, and not otherwise", () => {
    /* A session that expired on a camera this site owns is the ordinary case
       and keeps the ordinary words; only a borrowed camera whose loan ended
       gets the share sentence. */
    assert.match(stripComments(tile), /endedShare \? \(/);
    assert.match(stripComments(tile), /<SessionEndedFallback/);
  });

  test("offline and removed have their own sentences, never the share one", () => {
    assert.match(access, /This camera is offline right now\./);
    assert.match(access, /This camera is no longer available\./);
    assert.doesNotMatch(
      stripComments(fallback),
      /not on your fleet any more/,
      "the old sentence is gone",
    );
  });

  test("no state prints the tower's serial", () => {
    for (const source of [tile, fallback, access]) {
      for (const text of screenStrings(source)) {
        assert.doesNotMatch(text, /\bkln_/i, text);
      }
    }
    assert.doesNotMatch(stripComments(tile), /\{towerId\} ·/);
  });
});

describe("camera control says what happened in words", () => {
  let ptz;
  let said;
  before(async () => {
    ptz = await readFile(join(SRC, "lib/api/ptz.ts"), "utf8");
    said = await readFile(join(SRC, "lib/said.ts"), "utf8");
  });

  test("the refusal a viewer actually meets is a sentence", () => {
    /* THE ONE FROM THE REPORT. A share is per camera and per capability, so
       this says what was not included and leaves the next step obvious. */
    assert.match(
      said,
      /Moving this camera wasn't included in what was shared with you\./,
    );
    assert.match(said, /ptz_forbidden:/);
  });

  test("every PTZ and footage code the server can send has words", () => {
    for (const code of [
      "ptz_forbidden",
      "grant_permission",
      "grant_expired",
      "ptz_unavailable",
      "ptz_failed",
      "home_not_settable",
      "rate_limited",
      "camera_unknown",
      "tower_offline",
      "tower_timeout",
      "tower_unknown",
      "live_forbidden",
      "recordings_forbidden",
      "archive_disabled",
      "archive_misconfigured",
      "hub_at_capacity",
      "dc_media_unavailable",
      "session_unknown",
    ]) {
      assert.match(said, new RegExp(`\\b${code}:`), `${code} has no sentence`);
    }
  });

  test("and the shouting fallback is gone", () => {
    const code = stripComments(ptz);
    assert.doesNotMatch(code, /PTZ FAILED/);
    assert.doesNotMatch(code, /code\.toUpperCase\(\)/);
    assert.match(code, /saidQuiet/);
  });
});
