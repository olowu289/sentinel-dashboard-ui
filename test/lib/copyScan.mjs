/**
 * Pull the strings a customer can actually read out of the dashboard source.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY A SCANNER AND NOT A REVIEW
 * ══════════════════════════════════════════════════════════════════════
 *
 * The writing rules in CLAUDE.md are the kind that hold for a week. Somebody
 * adds a row, writes one helpful sentence under it, and the screen is back to
 * where it was. So the rules are read off the source on every run: an
 * em-dash in a label, or the word "sub" in a value, fails the suite the moment
 * it is written rather than the next time somebody looks at the screen.
 *
 * ── WHAT COUNTS AS USER-FACING ────────────────────────────────────────
 *
 * Two things, and deliberately nothing else:
 *
 *   1. JSX TEXT -- the words between tags, which is what a browser paints;
 *   2. the value of a RENDERING PROP -- `label`, `value`, `placeholder`,
 *      `title` and the rest of `RENDER_PROPS`, which this codebase uses to
 *      pass text down into its own row components.
 *
 * Comments are stripped first and are not covered, because they are written
 * for whoever is reading the code and the house style is full of em-dashes.
 * Nor is anything else: a string that is a class name, a key, an id, a path or
 * a token is not read by anybody and a scanner that flagged those would be
 * turned off within a day.
 *
 * ⚠ IT IS A HEURISTIC, AND IT ERRS TOWARDS SILENCE. It cannot see a sentence
 * assembled from variables, and it will miss one passed through a prop this
 * list does not name. That is the right direction to be wrong in: a check that
 * cries wolf gets an allowlist, and an allowlist gets everything added to it.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Props this codebase passes rendered text through. */
export const RENDER_PROPS = [
  "label",
  "value",
  "placeholder",
  "title",
  "note",
  "detail",
  "summary",
  "description",
  "message",
  "reason",
  "hint",
  "heading",
  "subtitle",
  "caption",
  "cta",
  "confirm",
  "cancel",
  "empty",
  "emptyText",
  "error",
  "helpText",
  "alt",
  "aria-label",
  "ariaLabel",
  "aria-description",
  "text",
  "word",
  "name",
];

/** Everything under `dir` with one of these extensions, recursively. */
export async function sourceFiles(dir, exts = [".ts", ".tsx"]) {
  const out = [];
  async function walk(at) {
    for (const entry of await readdir(at, { withFileTypes: true })) {
      const full = join(at, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        await walk(full);
      } else if (exts.some((e) => entry.name.endsWith(e))) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  return out.sort();
}

/**
 * Is the quote at `i` opening a string, or is it an apostrophe in JSX text?
 *
 * ⚠ THIS IS NOT A NICETY, IT IS THE DIFFERENCE BETWEEN WORKING AND NOT.
 * `<p>its video isn't getting through.</p>` is painted text, and the naive
 * reading takes that apostrophe as the start of a string literal: everything
 * from there to the next apostrophe in the file stops being scanned, comments
 * included, so the next block comment leaks out as if it were copy. One
 * contraction in TileFallback was hiding four comment paragraphs and however
 * much real text came between.
 *
 * The tell is the character immediately before. A string literal in code is
 * never glued to a letter or a digit; an apostrophe in prose almost always is.
 * `>` is the one that needs a second look -- it ends a JSX tag, so `>Don't`
 * is prose, but it also ends an arrow, so `=> 'x'` is code.
 */
function opensString(src, i) {
  let j = i - 1;
  while (j >= 0 && (src[j] === " " || src[j] === "\t")) j -= 1;
  const prev = src[j];
  if (prev === undefined) return true;
  if (/[A-Za-z0-9]/.test(prev)) return j === i - 1 ? false : true;
  if (prev === ">") {
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k -= 1;
    return src[k] === "=";  // an arrow, not a closing tag
  }
  return true;
}

/**
 * Where does the regex literal starting at `i` end?
 *
 * ⚠ A REGEX IS FULL OF CHARACTERS THAT MEAN SOMETHING ELSE IN CODE.
 * `const ILLEGAL = /[<>:"/\\|?* -]+/g` in `snapshot.ts` holds a double quote,
 * and reading it as code opened a string that ran on until the next quote --
 * which was inside a comment nine lines down, so that comment came out of the
 * scanner looking like copy. Returns the index after the closing slash, or -1
 * if this slash was division after all.
 */
function endOfRegex(src, i) {
  let j = i + 1;
  let inClass = false;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "\n") return -1;          // regexes do not span lines; it was division
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return j + 1;
    j += 1;
  }
  return -1;
}

/** Can a `/` here open a regex, or is the thing before it a value to divide? */
function regexAllowed(src, i) {
  let j = i - 1;
  while (j >= 0 && /\s/.test(src[j])) j -= 1;
  const prev = src[j];
  if (prev === undefined) return true;
  if (/[A-Za-z0-9_$)\]]/.test(prev)) {
    return /\b(return|typeof|case|in|of|do|else|delete|void|instanceof)$/
      .test(src.slice(Math.max(0, j - 12), j + 1));
  }
  return true;
}

/**
 * Blank out comments, keeping the file's length and line breaks.
 *
 * Length-preserving so a reported line number still points at the real line.
 * It walks the file one character at a time rather than using a regex,
 * because a regex cannot tell `// not a comment` inside a string from a
 * comment, and this codebase has URLs in strings.
 */
export function stripComments(src) {
  const out = Array.from(src);
  let i = 0;
  const n = src.length;
  let state = "code";
  let quote = "";
  /* A template literal's `${...}` is code again, and this codebase puts whole
     comments in there -- the className holes in TopBar are three lines of
     prose each. Treating a backtick as opaque to its closing backtick leaves
     those comments standing and, worse, hides every string inside a hole from
     the scanner. The stack remembers the quote to come back to. */
  const holes = [];
  let depth = 0;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (state === "code") {
      if (c === "{" && holes.length) depth += 1;
      else if (c === "}" && holes.length) {
        if (depth === 0) {
          const back = holes.pop();
          quote = back.quote;
          depth = back.depth;
          state = "string";
          i += 1;
          continue;
        }
        depth -= 1;
      }
      if (c === "/" && next === "/") {
        state = "line";
        out[i] = out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        state = "block";
        out[i] = out[i + 1] = " ";
        i += 2;
        continue;
      }
      if (c === "/" && regexAllowed(src, i)) {
        const end = endOfRegex(src, i);
        if (end > 0) { i = end; continue; }
      }
      if ((c === '"' || c === "'" || c === "`") && opensString(src, i)) {
        state = "string";
        quote = c;
        i += 1;
        continue;
      }
      i += 1;
      continue;
    }
    if (state === "line") {
      if (c === "\n") state = "code";
      else out[i] = " ";
      i += 1;
      continue;
    }
    if (state === "block") {
      if (c === "*" && next === "/") {
        out[i] = out[i + 1] = " ";
        state = "code";
        i += 2;
        continue;
      }
      if (c !== "\n") out[i] = " ";
      i += 1;
      continue;
    }
    // inside a string
    if (c === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && c === "$" && next === "{") {
      holes.push({ quote, depth });
      depth = 0;
      state = "code";
      quote = "";
      i += 2;
      continue;
    }
    if (c === quote) {
      state = "code";
      quote = "";
    }
    i += 1;
  }
  return out.join("");
}

/** Does this look like prose rather than a class list, a key or a path? */
function looksLikeProse(text) {
  const t = text.trim();
  if (t.length < 2) return false;
  if (!/[A-Za-z]{2}/.test(t)) return false;
  // Tailwind class strings, paths, urls, ids, tokens.
  if (/^[a-z0-9:_\-/.[\]%]+$/.test(t) && !/\s/.test(t)) return false;
  if (/^(?:[a-z-]+:)?[a-z0-9-]+(?:\s+(?:[a-z-]+:)?[a-z0-9-]+)*$/.test(t)
      && /-/.test(t) && !/[.?!,]/.test(t)) return false;  // class lists
  if (/^https?:\/\//.test(t)) return false;
  if (/^\/[a-z0-9/_{}-]*$/i.test(t)) return false;
  /* ⚠ GENERICS AND ARROW BODIES LOOK LIKE JSX TEXT. `Record<string, X>` and
     `(a) => (b)` both put words between a `>` and a `<`, and the scanner found
     three of them on its first run. Anything carrying code punctuation is not
     a sentence somebody reads. */
  if (/=>|\?\?|&&|\|\||\.\.\.|::|\);|\({|=== |!== /.test(t)) return false;
  if (/(?:const|let|return|function|typeof|undefined|null)/.test(t)) return false;
  return true;
}

const LINE_OF = (src, index) => src.slice(0, index).split("\n").length;

/**
 * Every user-facing string in one file: `{file, line, kind, text}`.
 *
 * `kind` is "jsx" for painted text and the prop name for a rendering prop, so
 * a failure message can say where to look without the reader opening the file.
 */
export function extract(src, file) {
  const clean = stripComments(src);
  const found = [];

  /* 1. JSX TEXT. Between a closing `>` and the next `<`, with no braces in it
        -- `{foo}` is an expression and its own string literals are caught by
        the prop pass below if they are text at all. */
  const jsx = /> *([^<>{}\n][^<>{}]*?) *</g;
  let m;
  while ((m = jsx.exec(clean)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!looksLikeProse(text)) continue;
    if (/^[=:;,)(]/.test(text)) continue;
    found.push({ file, line: LINE_OF(clean, m.index), kind: "jsx", text });
  }

  /* 2. RENDERING PROPS. `label="..."`, `label={"..."}` and `label={`...`}`.
        A template literal keeps its `${}` holes: the words around them are
        still painted and still have to follow the rules. */
  for (const prop of RENDER_PROPS) {
    const attr = new RegExp(
      `\\b${prop.replace(/[-]/g, "\\-")}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\\{\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)\\s*\\})`,
      "g",
    );
    while ((m = attr.exec(clean)) !== null) {
      const text = (m[1] ?? m[2] ?? m[3] ?? m[4] ?? m[5] ?? "").trim();
      if (!looksLikeProse(text)) continue;
      found.push({ file, line: LINE_OF(clean, m.index), kind: prop, text });
    }
  }
  return found;
}

/**
 * Every string literal and every piece of JSX text in one file, unfiltered.
 *
 * ── WHY THIS EXISTS BESIDE `extract` ──────────────────────────────────
 *
 * `extract` has to decide what a person reads, so it is cautious and misses
 * things: a `hint:` in an object literal, a ternary inside a JSX hole, a
 * sentence built with `+`. The em-dash rule cannot afford those misses, and it
 * does not need the caution either -- A CLASS LIST HAS NO EM-DASH IN IT, and
 * neither does a key, a path or a token. So for punctuation the right scan is
 * the blunt one: take every string, let the character being searched for do
 * the filtering, and accept that a stray em-dash in a string nobody reads is
 * worth a look anyway.
 *
 * Comments are still stripped, and that is the whole load-bearing part: the
 * house style writes in em-dashes and always will.
 */
export function allStrings(src, file) {
  const clean = stripComments(src);
  const found = [];
  const lit = /"([^"\n]*)"|'([^'\n]*)'|`([^`]*)`/g;
  let m;
  while ((m = lit.exec(clean)) !== null) {
    const text = (m[1] ?? m[2] ?? m[3] ?? "").replace(/\s+/g, " ").trim();
    if (text) found.push({ file, line: LINE_OF(clean, m.index), kind: "string", text });
  }
  const jsx = /> *([^<>{}\n][^<>{}]*?) *</g;
  while ((m = jsx.exec(clean)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (text) found.push({ file, line: LINE_OF(clean, m.index), kind: "jsx", text });
  }
  return found;
}

/** `allStrings` over a whole tree. */
export async function everyString(root, { skip = [] } = {}) {
  const files = await sourceFiles(root);
  const out = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (skip.some((s) => rel === s || rel.startsWith(s))) continue;
    out.push(...allStrings(await readFile(file, "utf8"), rel));
  }
  return out;
}

/** Every user-facing string under `root`. */
export async function userFacingStrings(root, { skip = [] } = {}) {
  const files = await sourceFiles(root);
  const out = [];
  for (const file of files) {
    const rel = relative(root, file).replace(/\\/g, "/");
    if (skip.some((s) => rel === s || rel.startsWith(s))) continue;
    out.push(...extract(await readFile(file, "utf8"), rel));
  }
  return out;
}
