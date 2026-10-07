/**
 * Every password box says what to type, in words.
 *
 * WHY THIS IS A TEST AND NOT A STYLE NOTE. A password input renders real input
 * as dots, so a DOTTED placeholder is indistinguishable from a filled field:
 * it reads as "a password is already in here", and people either trust it or
 * clear it before typing. Words cannot be mistaken for a value.
 *
 * It is also the kind of thing that comes back. A dotted placeholder looks
 * tidy in a mockup, and the next person to style these boxes has no way to know
 * it was ever a problem — so the rule is asserted rather than remembered.
 *
 * ── A SOURCE TEST, AND IT SAYS SO ──────────────────────────────────────
 *
 * This reads the .tsx files rather than a rendered DOM, because this app has no
 * component test harness (no vitest, no testing-library) and adding one to
 * assert a placeholder would be a bigger change than the placeholder. The limit
 * is real: it checks the attribute is WRITTEN, not that it is VISIBLE. A field
 * hidden by CSS would still pass. That is an acceptable trade for the failure
 * being guarded against, which is the text itself.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..", "src");

/** Every .tsx under src/, recursively. */
async function tsxFiles(dir = SRC) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsxFiles(full)));
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

/** Each `<input … />` element in a file, whole, with its line number. */
function inputElements(source) {
  const out = [];
  const re = /<input\b(.*?)\/>/gs;
  let m;
  while ((m = re.exec(source)) !== null) {
    out.push({
      attrs: m[1],
      line: source.slice(0, m.index).split("\n").length,
    });
  }
  return out;
}

/** Characters that render as a dot or a blob, in any of the usual spellings. */
const DOTS = [
  "•", // •  bullet
  "·", // ·  middle dot
  "●", // ●  black circle
  "⚫", // ⚫ medium black circle
  "∙", // ∙  bullet operator
  "*",      // the ASCII stand-in
  "&bull;",
  "&#8226;",
];

describe("password fields", () => {
  test("there is at least one, so this file cannot pass by finding nothing", async () => {
    /* A test that asserts a property of an empty set passes forever. If the
       password fields are ever renamed or moved, this fails rather than going
       quietly green. */
    let found = 0;
    for (const file of await tsxFiles()) {
      const source = await readFile(file, "utf8");
      found += inputElements(source).filter((el) =>
        el.attrs.includes('type="password"'),
      ).length;
    }
    assert.ok(found >= 5, `expected at least 5 password inputs, found ${found}`);
  });

  test("every one has a placeholder", async () => {
    const missing = [];
    for (const file of await tsxFiles()) {
      const source = await readFile(file, "utf8");
      for (const el of inputElements(source)) {
        if (!el.attrs.includes('type="password"')) continue;
        if (!el.attrs.includes("placeholder=")) {
          missing.push(`${file}:${el.line}`);
        }
      }
    }
    assert.deepEqual(missing, [], "password inputs with no hint at all");
  });

  test("NO placeholder is a row of dots", async () => {
    /* ⚠ THE POINT OF THE FILE. Checked across every placeholder in the app, not
       only the password ones: a dotted hint is wrong in any box, and a
       restricted check would miss it being added to the next one. */
    const offenders = [];
    for (const file of await tsxFiles()) {
      const source = await readFile(file, "utf8");
      for (const m of source.matchAll(/placeholder=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const text = m[1] ?? m[2] ?? "";
        if (!text) continue;
        for (const dot of DOTS) {
          /* Two or more in a row is a dotted placeholder. One `*` on its own is
             a required-field marker, which is a different thing and allowed. */
          if (text.includes(dot.repeat(2))) {
            const line = source.slice(0, m.index).split("\n").length;
            offenders.push(`${file}:${line} -> ${JSON.stringify(text)}`);
            break;
          }
        }
      }
    }
    assert.deepEqual(offenders, [], "placeholders made of dots");
  });

  test("each password hint is readable words, not punctuation", async () => {
    const bad = [];
    for (const file of await tsxFiles()) {
      const source = await readFile(file, "utf8");
      for (const el of inputElements(source)) {
        if (!el.attrs.includes('type="password"')) continue;
        const m = el.attrs.match(/placeholder=(?:"([^"]*)"|\{`([^`]*)`\})/);
        const text = (m?.[1] ?? m?.[2] ?? "").replace(/\$\{[^}]*\}/g, "12");
        /* At least two words and a letter in each: enough to rule out "••••",
           "****" and "..." without dictating the wording. */
        const words = text.trim().split(/\s+/).filter((w) => /[a-z]/i.test(w));
        if (words.length < 2) {
          bad.push(`${file}:${el.line} -> ${JSON.stringify(text)}`);
        }
      }
    }
    assert.deepEqual(bad, [], "password hints that are not words");
  });
});
