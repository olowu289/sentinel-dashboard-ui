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
 * How long to wait for a rebuild to stop writing before reloading.
 *
 * Long enough that three tsc passes land as one reload, short enough to feel
 * immediate.
 */
const REBUILD_SETTLE_MS = 500;

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

      let pending: ReturnType<typeof setTimeout> | null = null;

      const rebuilt = (file: string) => {
        if (!file.startsWith(dist)) return;

        /* Re-arm on every event. `npm run build` deletes the whole directory
           before writing it, and a watcher whose target has been removed can
           stop following the path it was given — so the recreated tree would
           arrive unwatched and the NEXT rebuild would be silent again. */
        server.watcher.add(dist);

        /* One reload per build, not one per file. A build writes the ESM, CJS
           and type trees, which is dozens of events in a burst; firing on each
           would reload the browser mid-write and could hand it a half-written
           dist. The trailing wait lets the build settle first. */
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          pending = null;
          server.config.logger.info(
            "[watch-linked-sdk] @kallon/sentry-sdk rebuilt — reloading",
            { timestamp: true },
          );
          server.ws.send({ type: "full-reload", path: "*" });
        }, REBUILD_SETTLE_MS);
      };

      /* ⚠ ALL THREE EVENTS, AND `change` IS THE ONE THAT MATTERS LEAST.
         Listening only for `change` is what this plugin did first, and it meant
         the plugin never fired on the operation it exists for: `npm run build`
         runs `clean` first (`rm -rf dist`), so a real rebuild emits `unlink`
         for every old file and `add` for every new one and NOT A SINGLE
         `change`. It caught a hand-edited dist — which nobody does — and missed
         every actual build, which is the only way that directory ever moves. */
      for (const event of ["change", "add", "unlink"] as const) {
        server.watcher.on(event, rebuilt);
      }
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
    /* ONE PORT, AND AN ERROR IF IT IS TAKEN.
       
       This used to bump to the next free port when 5173 was busy, on the
       reasoning that another local project also answers to "sentinel". The
       collision it was written to avoid turned out to be rarer than the one it
       caused: four Terra dev servers accumulated in a single session, on 5173,
       5174, 5190 and 5191, and TWO OF THEM WERE SERVING A STALE SDK BUILD. A
       browser pointed at the wrong one showed a field as missing that the
       server was plainly sending, and the bug looked like it was in the parser.
       
       Silently starting a second server is the failure. `strictPort` turns it
       into a refusal you have to read: if 5173 is busy, kill what is on it
       rather than stacking another beside it. `PORT=... npm run dev` still
       wins for the rare case of genuinely wanting a second one — and it is
       strict too, because being handed a port you did not ask for is the same
       bug at a different number.
       
       The neighbouring project (Bayana / ai-tracking) sits on 5199, so 5173 is
       ours. See the note in CLAUDE.md. */
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    fs: { allow: [".", SDK_PATH] },
  },
});
