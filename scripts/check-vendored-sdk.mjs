// Fail if `vendor/sentry-sdk` is no longer an exact copy of the sentry-sdk repo.
//
// ── WHY ───────────────────────────────────────────────────────────────────
//
// `vendor/sentry-sdk` is a `file:` dependency, so its `dist/` is what this app
// actually executes, and its `src/` is sitting right there, editable. It was
// edited. For a while the vendored copy and the sentry-sdk repo were two
// different packages both calling themselves `0.2.0`: the copy had a whole
// feature the repo had never seen (hub archive playback) and the repo had sites
// work the copy had never seen. Nothing compared them, so nothing said so.
//
// The SDK repo is the source of truth. This app's copy is downstream of it, and
// the only correct way to change the SDK is to change it there and re-vendor:
//
//   cd ../sentry-sdk
//   npm run build && npm run vendor:manifest
//   node scripts/vendor-sync.mjs ../Terra-Sentinel/vendor/sentry-sdk
//
// ── WHAT THIS CHECKS ──────────────────────────────────────────────────────
//
//   1. The vendored tree matches the `VENDOR.json` vendored with it. This is
//      the one that catches an edit made HERE, and it needs nothing but this
//      repo, so it runs in CI and on a laptop with no second checkout.
//   2. If `../sentry-sdk` is checked out, that its manifest is the same one.
//      This is the one that catches "the SDK moved on and nobody re-vendored".
//      Skipped, loudly, when the repo is not there -- a skipped check that
//      announces itself is honest; a silent pass is not.
//
// It is not a security boundary: whoever can edit the tree can regenerate the
// manifest. It is a smoke alarm for accidents, and every drift so far has been
// an accident.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const vendored = join(root, "vendor", "sentry-sdk");
const manifestPath = join(vendored, "VENDOR.json");
const checker = join(vendored, "scripts", "vendor-manifest.mjs");

const die = (...lines) => {
  console.error(lines.join("\n"));
  process.exit(1);
};

if (!existsSync(manifestPath) || !existsSync(checker)) {
  die(
    "vendor/sentry-sdk has no VENDOR.json or no scripts/vendor-manifest.mjs.",
    "",
    "That means the copy predates the drift check, or was pruned. Re-vendor it:",
    "  cd ../sentry-sdk && npm run build && npm run vendor:manifest",
    "  node scripts/vendor-sync.mjs ../Terra-Sentinel/vendor/sentry-sdk",
  );
}

// 1. The copy against the manifest that came with it. The vendored script is
//    run rather than reimplemented here, so there is exactly one definition of
//    what "matches" means, and it travels with the thing it describes.
try {
  execFileSync(process.execPath, [checker, "--check"], { cwd: vendored, stdio: "inherit" });
} catch {
  die(
    "",
    "vendor/sentry-sdk does not match its own manifest: somebody edited the",
    "vendored copy in place. Do not fix it here -- the edit belongs in the",
    "sentry-sdk repo, which is the source of truth. Move it there and re-vendor.",
  );
}

const mine = JSON.parse(readFileSync(manifestPath, "utf8"));

// 2. The copy against the repo it came from, when that repo is to hand.
const sibling = join(dirname(root), "sentry-sdk", "VENDOR.json");
if (!existsSync(sibling)) {
  console.log(
    `vendor/sentry-sdk is ${mine.name}@${mine.version} and matches its manifest.\n` +
      "SKIPPED the comparison with the sentry-sdk repo: ../sentry-sdk is not checked\n" +
      "out here, so this run cannot tell whether the SDK has moved on since.",
  );
  process.exit(0);
}

const theirs = JSON.parse(readFileSync(sibling, "utf8"));
const problems = [];
if (theirs.version !== mine.version) {
  problems.push(`version: the repo is at ${theirs.version}, this copy is ${mine.version}`);
}
for (const [p, h] of Object.entries(theirs.files)) {
  if (mine.files[p] === undefined) problems.push(`the repo has a file this copy lacks: ${p}`);
  else if (mine.files[p] !== h) problems.push(`differs from the repo: ${p}`);
}
for (const p of Object.keys(mine.files)) {
  if (theirs.files[p] === undefined) problems.push(`this copy has a file the repo deleted: ${p}`);
}

if (problems.length > 0) {
  console.error(`\nvendor/sentry-sdk has drifted from ../sentry-sdk (${problems.length}):\n`);
  for (const p of problems.slice(0, 30)) console.error(`  ${p}`);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  die(
    "",
    "Re-vendor from the repo, which is the source of truth:",
    "  cd ../sentry-sdk && npm run build && npm run vendor:manifest",
    "  node scripts/vendor-sync.mjs ../Terra-Sentinel/vendor/sentry-sdk",
    "",
    "If the change you want is only in this copy, move it into the repo first.",
  );
}

console.log(
  `vendor/sentry-sdk is an exact copy of ../sentry-sdk ` +
    `(${mine.name}@${mine.version}, ${Object.keys(mine.files).length} files).`,
);
