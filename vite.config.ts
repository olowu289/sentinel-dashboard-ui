import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";

/* `@kallon/sentry-sdk` LIVES IN THIS REPO NOW, at `vendor/sentry-sdk`, and the
   dependency is `file:./vendor/sentry-sdk`.

   It used to be `file:../sentry-sdk` — a sibling directory that exists on the
   machine this was written on and on no build server anywhere. Vercel clones
   one repo, so `npm install` had nothing to resolve and the deploy died on
   "Cannot find module '@kallon/sentry-sdk'". A dependency that only exists on
   one laptop is not a dependency, it is a local arrangement.

   npm still resolves a `file:` dependency to a SYMLINK, so the shape is
   unchanged — what changed is that the target is now inside the project root
   and is cloned with it. `fs.allow` no longer needs the path spelled out for
   that reason, and it is kept only because a symlink's realpath is the thing
   Vite checks and being explicit costs nothing.

   Prebundling is still skipped: see `optimizeDeps.exclude` below. */
const SDK_PATH = fileURLToPath(new URL("./vendor/sentry-sdk", import.meta.url));

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
  const dist = fileURLToPath(new URL("./vendor/sentry-sdk/dist", import.meta.url));
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

/**
 * The Content Security Policy, fitted to the mode (security report H-14).
 *
 * `index.html` carries the PRODUCTION policy in a `<meta>`, and `vercel.json`
 * repeats it as a header at the edge. Both are static text, and two things
 * about this app are not:
 *
 *   IN DEV, Vite's React plugin injects an inline preamble script into the
 *   page and Vite serves CSS by appending `<style>` elements from JS. Neither
 *   passes `script-src 'self'` / `style-src 'self'`. So the dev server rewrites
 *   the meta to allow inline script and style — dev runs on localhost, and a
 *   policy that breaks `npm run dev` is a policy someone deletes.
 *
 *   AT BUILD, the coordination origin is known: `VITE_COORDINATION_URL` is
 *   inlined into the bundle, so the one host this app fetches from can be
 *   named in `connect-src` instead of the `https:` that stands in for it in
 *   the static text. The edge header stays at `https:` (Vercel cannot read the
 *   build env into a header); the browser enforces the INTERSECTION of the
 *   two, so the effective policy is the narrow one.
 *
 * What is NOT here: WebRTC. The live tiles are `MediaStream`s and the ICE/TURN
 * traffic is not governed by CSP at all, so no directive is needed for video
 * to work, and none is loosened for it. Verified against a live tower with a
 * headless browser and the console open — see the commit that added this.
 */
function contentSecurityPolicy(): Plugin {
  let serve = false;
  let coordinationOrigin: string | undefined;

  const META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"\s*\/?>/;

  const rewrite = (policy: string): string => {
    const directives = new Map<string, string>();
    for (const part of policy.split(";")) {
      const [name, ...rest] = part.trim().split(/\s+/);
      if (name) directives.set(name, rest.join(" "));
    }
    const add = (name: string, ...values: string[]) => {
      const have = (directives.get(name) ?? "").split(" ").filter(Boolean);
      for (const v of values) if (!have.includes(v)) have.push(v);
      directives.set(name, have.join(" "));
    };
    if (serve) {
      add("script-src", "'unsafe-inline'");
      add("style-src", "'unsafe-inline'");
      /* HMR is a WebSocket back to this same origin ('self' covers it in
         current browsers; `ws:` for the ones where it does not), and a dev
         box may point at any coordination, TLS or not. */
      add("connect-src", "ws:", "wss:", "http:", "https:");
    } else if (coordinationOrigin) {
      directives.set("connect-src", `'self' ${coordinationOrigin}`);
    }
    return [...directives].map(([k, v]) => (v ? `${k} ${v}` : k)).join("; ");
  };

  return {
    name: "content-security-policy",
    config(_config, env) {
      serve = env.command === "serve";
    },
    configResolved(config) {
      const env = loadEnv(config.mode, config.envDir ?? config.root, "VITE_");
      const raw = env.VITE_COORDINATION_URL;
      if (!raw) return;
      try {
        /* The ORIGIN only — the app's own config.ts refuses a URL with a path,
           and a CSP source is an origin anyway. */
        coordinationOrigin = new URL(raw).origin;
      } catch {
        /* Not a URL. config.ts will say so at runtime, loudly; the policy
           simply stays at `https:`. */
      }
    },
    transformIndexHtml(html) {
      const match = html.match(META);
      if (!match) return html;
      return html.replace(META, (tag) => tag.replace(match[1], rewrite(match[1])));
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), watchLinkedSdk(), contentSecurityPolicy()],
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
