/**
 * The Content-Security-Policy the BUILD emits, which is the only one that ships.
 *
 * WHY THIS EXISTS. The player on sentri.watch was blocked by CSP:
 *
 *   Loading media from 'https://s3.us-east-005.backblazeb2.com/...' violates the
 *   following Content Security Policy directive: "media-src 'self' blob:
 *   https://coord.artemisfalcon.com:9081". The action has been blocked.
 *
 * Nothing was broken. `index.html` carries a deliberately permissive policy, and the
 * plugin in `vite.config.ts` NARROWS it at build time to the one coordination origin
 * the bundle talks to. `VITE_MEDIA_ORIGINS` exists to add the bucket host for the
 * presigned-URL backend, and it simply was not set in the deploy environment. A
 * safety feature with a config knob and no test is a safety feature that gets
 * narrowed correctly and then quietly locks out a legitimate origin.
 *
 * So these tests BUILD and read the emitted `dist/index.html`. They deliberately do
 * not unit-test the rewrite function in isolation: the thing that went wrong lives in
 * the wiring (does `loadEnv` see a variable supplied by the deploy platform rather
 * than a .env file?), and only a real build answers that.
 *
 * Each case builds with its own `envDir`, through Vite's JS API, so `.env.local` is
 * not consulted and the working tree is never touched. Builds are slow; there are
 * four of them on purpose and no more.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "vite";

/** Build with exactly these VITE_ vars and return the emitted media-src directive. */
async function mediaSrcFor(env) {
  const dir = await mkdtemp(join(tmpdir(), "csp-env-"));
  const out = await mkdtemp(join(tmpdir(), "csp-out-"));
  const body = Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  await writeFile(join(dir, ".env"), body + "\n", "utf8");

  await build({
    configFile: "vite.config.ts",
    envDir: dir,
    logLevel: "silent",
    build: { outDir: out, emptyOutDir: true },
  });

  const html = await readFile(join(out, "index.html"), "utf8");
  // The policy that ships is the meta tag's content attribute. The file also
  // contains an explanatory comment mentioning media-src, so match the real tag.
  const meta = html.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/,
  );
  assert.ok(meta, "no CSP meta tag in the built index.html");
  const directive = meta[1]
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("media-src"));
  assert.ok(directive, `no media-src in the built policy: ${meta[1]}`);
  return directive;
}

const COORD = "https://coord.artemisfalcon.com:9081";
const BUCKET = "https://s3.us-east-005.backblazeb2.com";

test("a cloud build names the bucket origin, and nothing wider", async () => {
  const got = await mediaSrcFor({
    VITE_COORDINATION_URL: COORD,
    VITE_MEDIA_ORIGINS: BUCKET,
  });

  // THE FIX, end to end: this is the exact directive sentri.watch needs.
  assert.equal(got, `media-src 'self' blob: ${COORD} ${BUCKET}`);

  // TIGHT. A bare scheme or a wildcard here would let a <video> load media from
  // any host on the internet, which is most of what this directive is for.
  const values = got.split(/\s+/).slice(1);
  assert.ok(!values.includes("https:"), `bare https: survived: ${got}`);
  assert.ok(!values.includes("http:"), `bare http: survived: ${got}`);
  assert.ok(!values.some((v) => v.includes("*")), `a wildcard survived: ${got}`);
  assert.deepEqual(values, ["'self'", "blob:", COORD, BUCKET]);
});

test("without VITE_MEDIA_ORIGINS the bucket is absent, which is the bug that shipped", async () => {
  const got = await mediaSrcFor({ VITE_COORDINATION_URL: COORD });

  // Not an assertion that this is DESIRABLE. It pins that the knob is load-bearing:
  // if someone makes media-src permissive again, or stops honouring the variable,
  // this and the test above cannot both keep passing.
  assert.equal(got, `media-src 'self' blob: ${COORD}`);
  assert.ok(!got.includes("backblazeb2.com"));
});

test("a hub build is unchanged: same-origin, policy left as the static text", async () => {
  // No VITE_COORDINATION_URL is how the hub bundle is built (same-origin, served by
  // the hub's own coordination, no internet). The narrowing branch must not run, or
  // an offline hub's player would be locked out by a policy naming a host it never
  // talks to. scripts/build-hub-dashboard.sh depends on this.
  const got = await mediaSrcFor({ VITE_MEDIA_ORIGINS: BUCKET });
  assert.equal(got, "media-src 'self' blob: https:");
  assert.ok(
    !got.includes("backblazeb2.com"),
    "a hub build must not acquire a cloud bucket origin",
  );
});

test("messy values are reduced to origins and junk is dropped", async () => {
  const got = await mediaSrcFor({
    VITE_COORDINATION_URL: COORD,
    // A path, a trailing slash, a second host, and two unparseable entries. The
    // whole string arrives from a deploy-platform text box, so it will be messy.
    VITE_MEDIA_ORIGINS: [
      `${BUCKET}/kallon-footage-test/hub-kln-lab/`,
      "https://minio.example.internal:9000/bucket",
      "not a url",
      "ftp:::",
    ].join(","),
  });

  const values = got.split(/\s+/).slice(1);
  assert.deepEqual(values, [
    "'self'",
    "blob:",
    COORD,
    BUCKET, // the path and trailing slash are gone
    "https://minio.example.internal:9000",
  ]);
  // A path in a CSP source would be a path-restricted match, which is not what an
  // operator pasting a bucket URL means, and silently narrower than it looks.
  assert.ok(!got.includes("kallon-footage-test"), `a path survived: ${got}`);
  assert.ok(!got.includes("not a url"));
});
