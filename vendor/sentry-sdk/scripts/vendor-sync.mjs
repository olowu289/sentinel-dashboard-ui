// Re-vendor this package into an app: `node scripts/vendor-sync.mjs <dest>`
//
// The copy it makes is EXACT -- the same file set the manifest covers, the
// manifest itself, and nothing else -- and anything already in the destination
// that is not in that set is removed. A vendored tree that still holds a file
// this repo deleted is drift of the kind that is hardest to see.
//
// Run it after `npm run build && npm run vendor:manifest`; it refuses if the
// manifest does not match this tree, because vendoring an unverified tree is
// how the copies came apart in the first place.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, resolve, sep } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dest = process.argv[2] ? resolve(process.argv[2]) : null;

if (!dest) {
  console.error("usage: node scripts/vendor-sync.mjs <path-to>/vendor/sentry-sdk");
  process.exit(2);
}

// VERIFY FIRST. A manifest that does not describe this tree describes nothing.
try {
  execFileSync(process.execPath, [join(root, "scripts", "vendor-manifest.mjs"), "--check"], {
    cwd: root,
    stdio: "inherit",
  });
} catch {
  console.error("\nRefusing to vendor a tree that does not match its own manifest.");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(root, "VENDOR.json"), "utf8"));
const wanted = new Set([...Object.keys(manifest.files), "VENDOR.json"]);

// This script DELETES whatever in the destination is not part of the package,
// so it will only point at an empty directory or at an existing copy of this
// same package. A mistyped path must not be able to empty somebody's folder.
const destPkg = join(dest, "package.json");
if (existsSync(dest) && readdirSync(dest).length > 0) {
  const name = existsSync(destPkg)
    ? JSON.parse(readFileSync(destPkg, "utf8")).name
    : "(no package.json)";
  if (name !== manifest.name && name !== "@kallon/sentry-sdk") {
    console.error(
      `Refusing to sync into ${dest}: it holds ${name}, not @kallon/sentry-sdk.\n` +
        "Point this at an empty directory or at an existing vendored copy.",
    );
    process.exit(1);
  }
}

let copied = 0;
for (const rel of wanted) {
  const from = join(root, rel.split("/").join(sep));
  const to = join(dest, rel.split("/").join(sep));
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  copied += 1;
}

// Then take away what is no longer part of the package. `node_modules` is the
// app's business (the `file:` link puts one there) and is left alone.
let removed = 0;
const sweep = (dir) => {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      sweep(p);
      if (readdirSync(p).length === 0) rmSync(p, { recursive: true });
    } else if (!wanted.has(relative(dest, p).split(sep).join("/"))) {
      rmSync(p);
      removed += 1;
    }
  }
};
sweep(dest);

console.log(
  `vendored ${manifest.version} into ${dest}: ${copied} files copied, ${removed} stale removed`,
);
