// The manifest that makes drift between this repo and a vendored copy FAIL
// rather than accumulate.
//
// ── WHY THIS EXISTS ────────────────────────────────────────────────────────
//
// This package is consumed two ways: as `@kallon/sentry-sdk` from this repo,
// and as a vendored tree inside an app (`Terra-Sentinel/vendor/sentry-sdk`,
// linked with `file:`). Vendored source is EDITABLE source, and it was edited:
// two checkouts both calling themselves `0.2.0` had diverged by three methods,
// a whole feature (hub archive playback) existed only in the copy, and two uses
// of `URLSearchParams` reached it that this package cannot even compile (no DOM
// lib, no `@types/node`) -- they only looked fine because the app's own
// node_modules supplied the types.
//
// Nobody noticed any of that because nothing ever compared the two. This does.
//
// ── WHAT IT CATCHES, AND WHAT IT CANNOT ───────────────────────────────────
//
//   * `--check` here: the committed tree does not match the committed manifest.
//     In this repo that means source was changed without regenerating, or the
//     build output no longer matches the source it was built from.
//   * `--check` run against a VENDORED tree (the copy carries this script and
//     the manifest with it): somebody edited the vendored source or its `dist`
//     in place. That is the drift that actually happened.
//   * The consuming app compares its vendored manifest with THIS repo's, when
//     both are checked out, which is the one way to catch "the repo moved on
//     and the copy was never updated".
//
// It cannot catch a change made in both places identically, and it is not a
// security boundary: anyone editing the tree can regenerate the manifest. It is
// a smoke alarm for accidents, and every drift so far has been an accident.
//
// ── DIST IS IN THE MANIFEST ON PURPOSE ────────────────────────────────────
//
// `dist/` is what a consumer actually executes, and it is committed (see the
// README). A manifest covering only `src/` would pass while the vendored
// JavaScript said something else entirely. The cost is that rebuilding with a
// different TypeScript patch release changes bytes and fails this check -- and
// that failure is CORRECT, because such a build is no longer the one that was
// vendored. Regenerate and re-vendor; both are one command.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const MANIFEST = join(root, "VENDOR.json");

/**
 * Everything that constitutes the package. Directories are walked; files are
 * taken as named. `package-lock.json` is deliberately absent: it pins this
 * repo's devDependencies, has no bearing on what a consumer runs, and would
 * make every lockfile refresh look like drift.
 */
const DIRS = ["src", "test", "scripts", "dist"];
const FILES = [
  // `.gitattributes` IS PART OF THE PACKAGE, not repo furniture. It carries
  // `* text=auto eol=lf`, and the app this is vendored into has no root
  // `.gitattributes` of its own -- so without this file a fresh clone on
  // Windows checks the vendored tree out with CRLF, every hash below fails at
  // once, and `dist/` fills review with line-ending noise.
  ".gitattributes",
  ".gitignore",
  "package.json",
  "tsconfig.json",
  "tsconfig.cjs.json",
  "tsconfig.esm.json",
  "tsconfig.types.json",
  "README.md",
  "CHANGELOG.md",
];

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Path as it is written in the manifest: relative, and `/` on every OS. */
const key = (p) => relative(root, p).split(sep).join("/");

function hashes() {
  const files = [...DIRS.flatMap((d) => walk(join(root, d))), ...FILES.map((f) => join(root, f))];
  const out = {};
  for (const p of files.sort()) {
    if (!existsSync(p)) continue;
    // Hashed as BYTES, not as text: a line ending that changed is a change,
    // and on Windows that is the likeliest one of all.
    out[key(p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
  }
  return out;
}

const { name, version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const mode = process.argv.includes("--check") ? "check" : "write";

if (mode === "write") {
  const files = hashes();
  writeFileSync(
    MANIFEST,
    JSON.stringify({ name, version, files }, null, 2) + "\n",
    "utf8",
  );
  console.log(`VENDOR.json: ${Object.keys(files).length} files, version ${version}`);
  process.exit(0);
}

if (!existsSync(MANIFEST)) {
  console.error("VENDOR.json is missing. Run: npm run vendor:manifest");
  process.exit(1);
}

const want = JSON.parse(readFileSync(MANIFEST, "utf8"));
const got = hashes();
const problems = [];

if (want.name !== name) {
  problems.push(`name: manifest says ${want.name}, package.json says ${name}`);
}
if (want.version !== version) {
  problems.push(`version: manifest says ${want.version}, package.json says ${version}`);
}
for (const [p, h] of Object.entries(want.files)) {
  if (got[p] === undefined) problems.push(`missing: ${p}`);
  else if (got[p] !== h) problems.push(`changed: ${p}`);
}
for (const p of Object.keys(got)) {
  if (want.files[p] === undefined) problems.push(`not in manifest: ${p}`);
}

if (problems.length === 0) {
  console.log(`VENDOR.json matches all ${Object.keys(got).length} files (version ${version}).`);
  process.exit(0);
}

console.error(`This tree does not match VENDOR.json (${problems.length} problem(s)):\n`);
for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
if (problems.length > 40) console.error(`  ... and ${problems.length - 40} more`);
console.error(
  [
    "",
    "If you changed this package on purpose:",
    "  npm run build && npm run vendor:manifest",
    "  node scripts/vendor-sync.mjs <path-to-app>/vendor/sentry-sdk   # re-vendor",
    "",
    "If you are looking at a VENDORED copy, do not fix it here: change the",
    "sentry-sdk repo, which is the source of truth, and re-vendor from it.",
  ].join("\n"),
);
process.exit(1);
