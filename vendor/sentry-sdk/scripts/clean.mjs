// Zero-dependency clean: remove dist/ before a build so stale output can never
// be committed alongside fresh output.
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
await rm(join(root, "dist"), { recursive: true, force: true });
