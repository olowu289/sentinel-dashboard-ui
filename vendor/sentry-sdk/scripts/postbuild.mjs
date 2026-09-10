// Zero-dependency postbuild.
//
// tsc cannot emit a CommonJS tree under a package.json that declares
// "type": "module" without a per-directory override, so we drop the two
// marker files it needs. This is the whole reason a postbuild step exists.
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

await writeFile(
  join(root, "dist", "cjs", "package.json"),
  JSON.stringify({ type: "commonjs" }, null, 2) + "\n",
);
await writeFile(
  join(root, "dist", "esm", "package.json"),
  JSON.stringify({ type: "module" }, null, 2) + "\n",
);

console.log("postbuild: wrote dist/cjs/package.json and dist/esm/package.json");
