/**
 * How every password box behaves: what it says, and who may fill it.
 *
 * TWO RULES, ASSERTED TOGETHER because they are one decision about these
 * fields. A saved password may fill the SIGN-IN screen and nothing else; and
 * every box says what to type in words rather than in dots.
 *
 * ── Every password box says what to type, in words.
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

/**
 * Blank out comments, keeping every newline so line numbers survive.
 *
 * Needed because this codebase documents its own rules in prose and the prose
 * quotes the thing it forbids — a scan for a `<form` tag is otherwise failed by
 * the comment saying there are no forms.
 */
function stripComments(source) {
  const blank = (m) => m.replace(/[^\n]/g, " ");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:"'`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
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

describe("autofill is allowed on the sign-in screen and nowhere else", () => {
  /* THE RULE, in one place:
       · the SIGN-IN screen pairs `username` + `current-password`, so a saved
         password fills there and only there;
       · every OTHER password box uses `new-password`, which is the token
         Chrome respects by not offering a stored credential — it ignores
         `autocomplete="off"` on password inputs by design.

     `new-password` on a field asking for the CURRENT password is semantically
     wrong and is the lesser wrong: a confirmation box pre-filled by the
     browser confirms the browser, not the person. */

  const LOGIN = join(SRC, "components", "LoginView.tsx");

  test("the sign-in screen pairs username with current-password", async () => {
    const source = await readFile(LOGIN, "utf8");
    const inputs = inputElements(source);

    const user = inputs.find((el) => el.attrs.includes('autoComplete="username"'));
    const pass = inputs.find((el) => el.attrs.includes('type="password"'));
    assert.ok(user, "sign-in needs a username field for a manager to pair against");
    assert.ok(pass, "sign-in needs a password field");
    assert.match(
      pass.attrs,
      /autoComplete="current-password"/,
      "the sign-in password must stay current-password so saved passwords fill",
    );
  });

  test("the sign-in identifier is NOT `organization`", async () => {
    /* It was. `organization` describes the field's CONTENT, which is right,
       and is not a credential role — a manager pairs a saved login by finding
       a username beside a password, so `organization` made pairing weaker than
       it looked. The content type is what the label and placeholder say. */
    const source = await readFile(LOGIN, "utf8");
    for (const el of inputElements(source)) {
      assert.ok(
        !el.attrs.includes('autoComplete="organization"'),
        `LoginView:${el.line} still declares autoComplete="organization"`,
      );
    }
  });

  test("NO password field outside the sign-in screen says current-password", async () => {
    /* ⚠ THE ONE THAT ENFORCES THE DECISION. A `current-password` anywhere else
       is an invitation for Chrome to fill a box the person must type. */
    const offenders = [];
    for (const file of await tsxFiles()) {
      if (file === LOGIN) continue;
      const source = await readFile(file, "utf8");
      for (const el of inputElements(source)) {
        if (!el.attrs.includes('type="password"')) continue;
        if (el.attrs.includes('autoComplete="current-password"')) {
          offenders.push(`${file}:${el.line}`);
        }
      }
    }
    assert.deepEqual(offenders, [], "password fields that invite autofill");
  });

  test("every Settings password field declares new-password", async () => {
    const settings = join(SRC, "components", "SettingsView.tsx");
    const source = await readFile(settings, "utf8");
    const fields = inputElements(source).filter((el) =>
      el.attrs.includes('type="password"'),
    );
    assert.equal(fields.length, 4, "expected four password fields in Settings");
    for (const el of fields) {
      assert.match(
        el.attrs,
        /autoComplete="new-password"/,
        `SettingsView:${el.line} must declare new-password to stop autofill`,
      );
    }
  });

  test("the rename box does not invite an organization fill either", async () => {
    /* Not a password, same class of bug: a value nobody typed, sitting in the
       control that changes what you sign in with. */
    const settings = join(SRC, "components", "SettingsView.tsx");
    const source = await readFile(settings, "utf8");
    for (const el of inputElements(source)) {
      assert.ok(
        !el.attrs.includes('autoComplete="organization"'),
        `SettingsView:${el.line} would be filled with the saved organization`,
      );
    }
  });

  test("there are no <form> elements, which is what keeps the save prompt away", async () => {
    /* Chrome's "save password?" prompt is driven by a form submission. This app
       has never used one — handlers and an explicit Enter binding instead — so
       the prompt has no submission to hang off. That is a property worth
       asserting rather than assuming: adding a <form> to one of these screens
       would bring the prompt back, and the person who added it would have no
       way to know that was a consequence. */
    const offenders = [];
    for (const file of await tsxFiles()) {
      const source = await readFile(file, "utf8");
      /* COMMENTS BLANKED FIRST, and that is not fussiness: both LoginView and
         SettingsView carry a note reading "NO <form>", so a naive scan is
         failed by the very comment that documents the rule. Blanked rather
         than deleted, so a failure's line number still points at the real
         place. */
      const code = stripComments(source);
      for (const m of code.matchAll(/<form[\s/>]/g)) {
        offenders.push(`${file}:${code.slice(0, m.index).split("\n").length}`);
      }
    }
    assert.deepEqual(offenders, [], "form elements that would trigger the save prompt");
  });
});
