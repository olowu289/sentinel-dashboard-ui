import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/* `@kallon/sentry-sdk` is installed as `file:../sentry-sdk`, which npm resolves
   to a SYMLINK pointing outside this project. Two consequences, both proven
   necessary and sufficient by the Stage 0 spike:

   - the dev server refuses to serve files outside its root, so the SDK's path
     has to be allowed explicitly or every import 404s;
   - prebundling a symlinked source dependency is more trouble than skipping it.

   The dashboard sets `turbopack.root` for the same reason. Both go away if the
   dependency ever becomes a `github:` ref — the SDK commits its `dist/`
   precisely so that needs no build step. */
const SDK_PATH = fileURLToPath(new URL("../sentry-sdk", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ["@kallon/sentry-sdk"] },
  server: {
    /* 5173 by default, but overridable — another project on this machine also
       answers to "sentinel" and claims 5173, and a hardcoded port turns that
       collision into a dev server that silently serves someone else's app. */
    port: Number(process.env.PORT) || 5173,
    fs: { allow: [".", SDK_PATH] },
  },
});
