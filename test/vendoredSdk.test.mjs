/**
 * `vendor/sentry-sdk` must stay an exact copy of the sentry-sdk repo.
 *
 * WHY THIS EXISTS. The SDK is a `file:` dependency, so its `dist/` is what this
 * app runs and its `src/` is sitting in the tree, editable. It was edited. For
 * months the vendored copy and the repo were two different packages both
 * calling themselves `0.2.0`:
 *
 *   * the copy was a whole feature ahead (hub archive playback: the archived
 *     recordings list, fresh segment urls, reviewable towers) and had PTZ step
 *     and the 360 sweep, none of which the repo had ever seen;
 *   * the repo had sites and sharing, which the copy had never seen;
 *   * and the copy had two uses of `URLSearchParams` that the SDK cannot even
 *     compile on its own -- they only looked fine because THIS app's
 *     node_modules supplied the types.
 *
 * Nothing compared the two, so nothing said so, and reconciling them later cost
 * a careful file-by-file diff. One command now re-vendors the package, and this
 * test is what makes forgetting it loud instead of silent.
 *
 * The check itself is `scripts/check-vendored-sdk.mjs`; this is the test that
 * runs it, so that it runs as part of `npm test` rather than only when somebody
 * remembers. The script prints what differs and how to fix it.
 *
 *   npm test
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { test } from "node:test";

const run = promisify(execFile);
const root = dirname(dirname(fileURLToPath(import.meta.url)));

test("vendor/sentry-sdk has not drifted from the sentry-sdk repo", async () => {
  const { stdout } = await run(process.execPath, [join(root, "scripts", "check-vendored-sdk.mjs")], {
    cwd: root,
  }).catch((err) => {
    // execFile rejects on a non-zero exit, and the script's own output is the
    // whole of what a person needs: which files differ, and the two commands
    // that fix it. Surfacing it verbatim beats any assertion message.
    assert.fail(
      `the vendored SDK has drifted:\n\n${err.stdout ?? ""}${err.stderr ?? ""}`,
    );
  });

  // The script passes in two ways and only one of them is a full check: when
  // ../sentry-sdk is not checked out it can verify the copy against its own
  // manifest but not against the repo. That is a real result, not a failure
  // (CI and a fresh laptop both look like that), so it passes -- but it says so
  // here too, because a test that reports "ok" for a partial check is how a
  // check quietly stops covering anything.
  if (stdout.includes("SKIPPED")) {
    console.log("  note: ../sentry-sdk is not checked out; only the copy's own manifest was verified");
  }
  assert.match(stdout, /matches all \d+ files/);
});
