import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

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

/**
 * Reload when the SDK is rebuilt.
 *
 * ⚠ THIS COST A DEBUGGING SESSION AND WOULD HAVE COST MORE. The SDK gained a
 * field, `npm run build` regenerated its `dist/`, and every dev server already
 * running kept serving the code it had transformed at boot — so the browser
 * showed "No signal reading" for a signal that was plainly there in the Network
 * tab. Four servers were up; the two started before the rebuild were wrong and
 * the two started after were right, on identical source.
 *
 * Vite is not at fault and neither is `optimizeDeps.exclude` above, which is
 * doing its job. The dependency is a SYMLINK to a sibling repo, so its real
 * path is outside the project root, and the file watcher only walks the root —
 * nothing tells the server that file ever changed. An unwatched module is
 * cached for the life of the process, and the failure is silent: no error, no
 * warning, just yesterday's parser quietly dropping a field today's server
 * sends.
 *
 * So the watcher is told about it explicitly. A full reload rather than HMR
 * because this is the module boundary the whole app's data passes through —
 * patching it in place would leave half the tree holding values parsed by the
 * old copy.
 */
function watchLinkedSdk(): Plugin {
  const dist = fileURLToPath(new URL("../sentry-sdk/dist", import.meta.url));
  return {
    name: "watch-linked-sdk",
    apply: "serve",
    configureServer(server) {
      server.watcher.add(dist);
      server.watcher.on("change", (file) => {
        if (!file.startsWith(dist)) return;
        server.config.logger.info(
          "[watch-linked-sdk] @kallon/sentry-sdk rebuilt — reloading",
          { timestamp: true },
        );
        server.ws.send({ type: "full-reload", path: "*" });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), watchLinkedSdk()],
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
