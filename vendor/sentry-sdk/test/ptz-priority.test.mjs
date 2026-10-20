/**
 * PTZ priority between sites, from the client's side.
 *
 * The rule the server enforces is simple -- THE CAMERA'S OWN SITE ALWAYS WINS
 * -- and this suite covers the two things a client must get right about it,
 * because getting either wrong produces a screen that lies rather than an error
 * anybody notices:
 *
 *   THE REFUSAL MUST KEEP ITS DETAIL. A `ptz_yielded` whose `holder_site` was
 *   dropped somewhere in the error path leaves the UI with "refused" and
 *   nothing a person can act on. The envelope is rebuilt twice on the way out
 *   (once in the transport, once into the exception), and the detail has to
 *   survive both.
 *
 *   THE YIELD IS NOT A SESSION FAULT. A 409 with no entry in the code map
 *   falls through to the status fallback and arrives as a
 *   `SessionConflictError`, which reads as "your session is broken" for what is
 *   the normal outcome of lending a camera to another site.
 *
 *   `control` RIDES ON EVERY REPLY, so controls can be disabled before a
 *   command is refused rather than after. Its ABSENCE is the old unrestricted
 *   behaviour and must parse cleanly, or this SDK cannot talk to a coordination
 *   service that does not arbitrate control at all.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PtzYieldedError,
  PtzError,
  SentryClient,
  SessionConflictError,
  isPtzYielded,
  isPtzPermissionDenied,
  parsePtzResult,
} from "../dist/esm/index.js";

const SID = "ses_01K3F9QW7YB2X4";

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const r = (await handler(url, init)) ?? {};
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: (k) => (k.toLowerCase() === "content-type" ? "application/json" : null) },
      text: async () => r.body ?? "",
    };
  };
  fn.calls = calls;
  return fn;
}

const clientFor = (fetch) =>
  new SentryClient({ baseUrl: "https://coord.example", token: () => "t", fetch });

/** What coordination answers a shared user whose site does not own the camera. */
const YIELDED = {
  status: 409,
  body: JSON.stringify({
    error: {
      code: "ptz_yielded",
      message: "North Gate is controlling this camera",
      holder_site: "North Gate",
      retry_after_sec: 31,
    },
  }),
};

/* ======================================================================
 * The refusal
 * ====================================================================== */

test("a yield arrives as PtzYieldedError carrying the site and the countdown", async () => {
  const c = clientFor(fakeFetch(() => YIELDED));
  const err = await c.ptzMove(SID, 1, { pan: 0.5 }).then(
    () => null,
    (e) => e,
  );

  assert.ok(err instanceof PtzYieldedError, `got ${err?.name}`);
  // A PTZ problem, so code that already handles PtzError keeps working.
  assert.ok(err instanceof PtzError);
  assert.equal(err.code, "ptz_yielded");
  assert.equal(err.status, 409);
  // The two fields the UI has to show. Dropped anywhere on the way out and the
  // screen can only say "refused".
  assert.equal(err.holderSite, "North Gate");
  assert.equal(err.retryAfterSec, 31);
  // Written for a person, by the server, and rendered verbatim.
  assert.equal(err.message, "North Gate is controlling this camera");
  assert.ok(isPtzYielded(err));
});

test("a yield is NOT a session conflict, which is where a 409 would otherwise land", async () => {
  const c = clientFor(fakeFetch(() => YIELDED));
  const err = await c.ptzMove(SID, 1, { pan: 0.5 }).catch((e) => e);
  assert.ok(!(err instanceof SessionConflictError));
});

test("a yield is not a permission denial: never versus not now", async () => {
  const c = clientFor(fakeFetch(() => YIELDED));
  const err = await c.ptzMove(SID, 1, { pan: 0.5 }).catch((e) => e);
  // `grant_permission` means this viewer may never drive this camera and the
  // controls go away for the session; a yield means somebody else has it now.
  assert.equal(isPtzPermissionDenied(err), false);

  const denied = clientFor(
    fakeFetch(() => ({
      status: 403,
      body: JSON.stringify({ error: { code: "grant_permission", message: "no ptz" } }),
    })),
  );
  const other = await denied.ptzMove(SID, 1, { pan: 0.5 }).catch((e) => e);
  assert.equal(isPtzYielded(other), false);
  assert.equal(isPtzPermissionDenied(other), true);
});

test("a yield without detail still reads as empty, not as undefined", async () => {
  // An older or terser server. The getters answer with the empty value rather
  // than letting `undefined` reach a template.
  const c = clientFor(
    fakeFetch(() => ({
      status: 409,
      body: JSON.stringify({ error: { code: "ptz_yielded", message: "yielded" } }),
    })),
  );
  const err = await c.ptzMove(SID, 1, { pan: 0.5 }).catch((e) => e);
  assert.ok(isPtzYielded(err));
  assert.equal(err.holderSite, "");
  assert.equal(err.retryAfterSec, 0);
});

test("every other refusal keeps its own class: the detail path changes nothing", async () => {
  const c = clientFor(
    fakeFetch(() => ({
      status: 409,
      body: JSON.stringify({ error: { code: "session_duplicate", message: "already open" } }),
    })),
  );
  const err = await c.ptzMove(SID, 1, { pan: 0.5 }).catch((e) => e);
  assert.ok(err instanceof SessionConflictError);
  assert.equal(isPtzYielded(err), false);
});

/* ======================================================================
 * The control block
 * ====================================================================== */

test("control rides on a successful reply, with the holder named", async () => {
  const c = clientFor(
    fakeFetch(() => ({
      body: JSON.stringify({
        session_id: SID,
        ok: true,
        result: { pan: 0.1, tilt: 0, zoom: 0 },
        control: {
          held: true,
          yours: false,
          holder_site: "North Gate",
          holder_is_owner: true,
          expires_in_sec: 44,
        },
      }),
    })),
  );
  const out = await c.ptzStatus(SID, 1);
  assert.equal(out.control.held, true);
  assert.equal(out.control.yours, false);
  assert.equal(out.control.holder_site, "North Gate");
  assert.equal(out.control.holder_is_owner, true);
  assert.equal(out.control.expires_in_sec, 44);
});

test("a free camera reads as yours, so the controls are live", () => {
  const out = parsePtzResult({ session_id: SID, ok: true, control: { held: false, yours: true } });
  assert.equal(out.control.held, false);
  assert.equal(out.control.yours, true);
  // Nobody holds it, so there is no site to name and no countdown to show.
  assert.equal(out.control.holder_site, undefined);
  assert.equal(out.control.expires_in_sec, undefined);
});

test("no control block at all is not an error: it is the old behaviour", () => {
  // A coordination service that does not arbitrate control sends nothing here.
  // Treating that as a validation failure would make this SDK unable to talk to
  // it at all, which is a far worse outcome than unrestricted controls.
  const out = parsePtzResult({ session_id: SID, ok: true, result: { pan: 0 } });
  assert.equal(out.control, undefined);
  assert.equal(out.ok, true);
});

test("a control block missing its two required fields IS reported", () => {
  // The distinction that matters: absent means "not arbitrated", present but
  // malformed means the server is wrong and silence would hide it.
  assert.throws(
    () => parsePtzResult({ session_id: SID, ok: true, control: { holder_site: "North Gate" } }),
    (e) => e.name === "ValidationError" && e.issues.some((i) => i.startsWith("control.held")),
  );
});

test("a sweep reply carries control too, on the raw path", async () => {
  // ⚠ THE FIVE SWEEP HELPERS RETURN `SweepStatus`, so they drop `control` on
  // the floor -- the sweep block is what a caller asked them for. A screen that
  // gates its controls does so on the `control` from a status poll or from
  // `sendPtz` itself, which is what this covers; widening those five return
  // types would be a breaking change for the one field they do not need.
  const c = clientFor(
    fakeFetch(() => ({
      body: JSON.stringify({
        session_id: SID,
        ok: true,
        result: { state: "sweeping", percent: 12 },
        control: { held: true, yours: true, holder_site: "West Yard", holder_is_owner: false },
      }),
    })),
  );
  const out = await c.sendPtz(SID, { camera: 1, action: "sweep", params: { op: "start" } });
  assert.equal(out.control.yours, true);
  assert.equal(out.control.holder_is_owner, false);

  // And the helper still answers with the sweep, unchanged by any of this.
  const sweep = await c.sweepStart(SID, 1, { seconds: 120 });
  assert.equal(sweep.state, "sweeping");
  assert.equal(sweep.percent, 12);
});
