/**
 * Step and the 360 sweep: the request that goes on the wire, and the reply.
 *
 * `node --test`, built-in runner, against the BUILT esm output with an injected
 * `fetch` -- the same discipline as smoke.test.mjs, and the reason `FetchLike`
 * exists. Built against sentry-core docs/ptz-api.md at c02211f.
 *
 * What is worth testing here rather than reading:
 *
 *   THE SWEEP BLOCK IS IN TWO DIFFERENT PLACES depending on the action. A
 *   `sweep` reply puts it in `result` itself; every other reply nests it at
 *   `result.sweep`. Getting that backwards yields an `undefined` that renders
 *   as "no sweep" on a camera that is turning, which is the exact class of
 *   silent wrong answer this suite is for.
 *
 *   `keep_sweep` IS THE ONE FLAG THAT CANNOT BE INFERRED. A tilt release and a
 *   Stop are the same command on the wire, so if it is not on the request the
 *   device cannot put it there.
 *
 *   A STEP IS CLAMPED, NOT VALIDATED. The bounds are the contract's, so they
 *   are enforced before the round trip; a zero-direction step is deliberately
 *   left for the device to refuse in its own words.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  PTZ_CLICK_MS,
  PTZ_STEP_DEG_MAX,
  PTZ_STEP_DEG_MIN,
  SWEEP_SECONDS_MAX,
  SWEEP_SECONDS_MIN,
  SentryClient,
  clampStep,
  parseSweepStatus,
  sweepOf,
} from "../dist/esm/index.js";

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => {
    calls.push({ url, ...init });
    const r = (await handler(url, init)) ?? {};
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      text: async () => r.body ?? "",
    };
  };
  fn.calls = calls;
  return fn;
}

const SID = "ses_01K3F9QW7YB2X4";

/** A client whose every PTZ call answers with `result`. */
function clientReplying(result) {
  const fetch = fakeFetch(() => ({
    body: JSON.stringify({ session_id: SID, ok: true, result }),
  }));
  const client = new SentryClient({ baseUrl: "https://hub.example", token: () => "t", fetch });
  return { client, fetch };
}

const body = (fetch, i = 0) => JSON.parse(fetch.calls[i].body);

/* ======================================================================
 *  STEP: the request
 * ====================================================================== */

test("a step posts action:step with the signed multipliers", async () => {
  const { client, fetch } = clientReplying({ done: true, step_deg: 2 });
  await client.ptzStep(SID, 1, { pan: 1, tilt: 0 });
  assert.equal(fetch.calls.length, 1);
  assert.match(String(fetch.calls[0].url), /\/v1\/viewer\/sessions\/.*\/ptz$/);
  assert.deepEqual(body(fetch), {
    camera: 1,
    action: "step",
    params: { pan: 1, tilt: 0 },
  });
});

test("a step's pan and tilt are clamped to -1..1 before they leave", async () => {
  const { client, fetch } = clientReplying({ done: true });
  await client.ptzStep(SID, 1, { pan: 4.5, tilt: -9 });
  assert.deepEqual(body(fetch).params, { pan: 1, tilt: -1 });
});

test("a step's degrees override is clamped to the contract's bounds", () => {
  assert.equal(clampStep({ degrees: 900 }).degrees, PTZ_STEP_DEG_MAX);
  assert.equal(clampStep({ degrees: 0 }).degrees, PTZ_STEP_DEG_MIN);
  // A sweep cannot be requested as a step, which is what the ceiling is for.
  assert.ok(PTZ_STEP_DEG_MAX < 360);
});

test("a step omits what it was not given rather than sending zeros", () => {
  // `pan: 0, tilt: 0` is a refusal on the device; an absent axis is not the
  // same request and must not be turned into one here.
  assert.deepEqual(clampStep({ pan: 1 }), { pan: 1 });
  assert.deepEqual(clampStep({}), {});
});

test("a zero-direction step is NOT rejected locally", async () => {
  // Deliberate: the device refuses it with a message written for the purpose,
  // and a second refusal invented here would give two errors for one mistake.
  const { client, fetch } = clientReplying({ done: false, reason: "no direction" });
  await client.ptzStep(SID, 1, { pan: 0, tilt: 0 });
  assert.equal(fetch.calls.length, 1);
});

/* ======================================================================
 *  STEP: the reply
 * ====================================================================== */

test("a step blocked by the tilt limit resolves rather than throwing", async () => {
  /* THE TRAP THIS GUARDS. HTTP 200, ok:true, done:false -- a refusal, not an
     error. A caller that treats a resolved promise as movement reports a step
     that never happened, so the reply has to arrive intact rather than as an
     exception. */
  const { client } = clientReplying({
    done: false,
    tilt_limit: "max",
    reason: "at the tilt limit; the step would drive into it",
  });
  const res = await client.ptzStep(SID, 1, { tilt: 1 });
  assert.equal(res.ok, true);
  assert.equal(res.result.done, false);
  assert.equal(res.result.tilt_limit, "max");
  assert.match(res.result.reason, /tilt limit/);
});

test("a step reports the size it actually commanded, and whether zoom scaled it", async () => {
  const { client } = clientReplying({
    done: true, step_deg: 1.4, requested_deg: 2, zoom_scaled: true, zoom_ratio: 4.2,
  });
  const res = await client.ptzStep(SID, 1, { pan: 1 });
  assert.equal(res.result.step_deg, 1.4);
  assert.equal(res.result.requested_deg, 2);
  assert.equal(res.result.zoom_scaled, true);
  assert.equal(res.result.zoom_ratio, 4.2);
});

/* ======================================================================
 *  STOP: keep_sweep
 * ====================================================================== */

test("a plain stop sends no keep_sweep", async () => {
  const { client, fetch } = clientReplying({ done: true });
  await client.ptzStop(SID, 1);
  assert.deepEqual(body(fetch), { camera: 1, action: "stop", params: {} });
});

test("keep_sweep rides on the stop that releases a hold during a sweep", async () => {
  const { client, fetch } = clientReplying({ done: true, kept_sweep: true });
  await client.ptzStop(SID, 1, { keep_sweep: true });
  assert.equal(body(fetch).params.keep_sweep, true);
});

test("a held move's stop can carry keep_sweep without a new argument", async () => {
  const { client, fetch } = clientReplying({ done: true });
  const held = await client.ptzHold(SID, 1, { mode: "continuous", pan: 0, tilt: 1, zoom: 0 });
  await held.stop({ keep_sweep: true });
  const last = body(fetch, fetch.calls.length - 1);
  assert.equal(last.action, "stop");
  assert.equal(last.params.keep_sweep, true);
});

/* ======================================================================
 *  SWEEP: the five ops
 * ====================================================================== */

test("each sweep op posts action:sweep with its own op", async () => {
  for (const [method, op] of [
    ["sweepStart", "start"],
    ["sweepPause", "pause"],
    ["sweepResume", "resume"],
    ["sweepStop", "stop"],
    ["sweepStatus", "status"],
  ]) {
    const { client, fetch } = clientReplying({ state: "idle" });
    await client[method](SID, 2);
    assert.deepEqual(body(fetch), { camera: 2, action: "sweep", params: { op } }, method);
  }
});

test("seconds rides only on start", async () => {
  const { client, fetch } = clientReplying({ state: "sweeping", percent: 0 });
  await client.sweepStart(SID, 1, { seconds: 120 });
  assert.deepEqual(body(fetch).params, { op: "start", seconds: 120 });
});

test("start without seconds sends none, leaving the camera's own default", async () => {
  const { client, fetch } = clientReplying({ state: "sweeping" });
  await client.sweepStart(SID, 1);
  assert.deepEqual(body(fetch).params, { op: "start" });
});

test("an out-of-range duration is NOT pre-empted locally", async () => {
  /* The device REFUSES rather than clamping, and its message is the
     authoritative one. The bounds are exported so a UI can refuse first. */
  const { client, fetch } = clientReplying({ state: "idle" });
  await client.sweepStart(SID, 1, { seconds: 99_999 });
  assert.equal(body(fetch).params.seconds, 99_999);
  assert.ok(SWEEP_SECONDS_MIN < SWEEP_SECONDS_MAX);
});

test("a sweep op returns the block from result ITSELF, not result.sweep", async () => {
  /* The shape difference that would otherwise be found in production. */
  const { client } = clientReplying({
    state: "sweeping", percent: 25, covered_deg: 90, target_deg: 360, seconds: 90,
  });
  const st = await client.sweepStart(SID, 1);
  assert.equal(st.state, "sweeping");
  assert.equal(st.percent, 25);
  assert.equal(st.covered_deg, 90);
});

test("a sweep reply is validated, so a junk percent cannot reach a progress bar", async () => {
  const { client } = clientReplying({ state: "sweeping", percent: 4000 });
  const st = await client.sweepStart(SID, 1);
  assert.equal(st.percent, 100);
});

/* ======================================================================
 *  SWEEP: reading the block off other replies
 * ====================================================================== */

test("sweepOf reads the block nested on an ordinary reply", () => {
  const st = sweepOf({
    session_id: SID, ok: true,
    result: { done: true, sweep: { state: "paused", percent: 52, resume_in_sec: 94 } },
  });
  assert.equal(st.state, "paused");
  assert.equal(st.percent, 52);
  assert.equal(st.resume_in_sec, 94);
});

test("sweepOf is undefined when a reply says nothing about a sweep", () => {
  /* ⚠ UNDEFINED IS NOT IDLE. "This reply mentions no sweep" and "there is
     no sweep on this camera" are different facts, and collapsing them is how a
     sweep started in another tab gets drawn as idle. */
  assert.equal(sweepOf({ session_id: SID, ok: true, result: { done: true } }), undefined);
  assert.equal(sweepOf({ session_id: SID, ok: true }), undefined);
  assert.equal(sweepOf(undefined), undefined);
  assert.equal(sweepOf(null), undefined);
});

test("a status reply carries the sweep, so progress needs no extra request", async () => {
  const { client } = clientReplying({
    pan: 0.1, tilt: 0.2, zoom: 0.3,
    sweep: { state: "sweeping", percent: 31, covered_deg: 111.6 },
  });
  const res = await client.ptzStatus(SID, 1);
  const st = sweepOf(res);
  assert.equal(st.state, "sweeping");
  assert.equal(st.percent, 31);
});

/* ======================================================================
 *  SWEEP: the status block's own rules
 * ====================================================================== */

test("an idle block parses to idle and carries no figures", () => {
  const st = parseSweepStatus({ state: "idle" });
  assert.equal(st.state, "idle");
  assert.equal(st.percent, undefined);
  assert.equal(st.last, undefined);
});

test("an idle block remembers how the last sweep ended, when it ran one", () => {
  const st = parseSweepStatus({ state: "idle", last: "stopped by the operator (stop) at 40%" });
  assert.match(st.last, /40%/);
});

test("a paused block's countdown is never negative", () => {
  assert.equal(parseSweepStatus({ state: "paused", resume_in_sec: -30 }).resume_in_sec, 0);
});

test("an unknown state reads as idle, which draws nothing", () => {
  /* The safe reading: a fourth state is unrenderable, and claiming a camera is
     turning on the strength of a word we do not know would be worse. */
  assert.equal(parseSweepStatus({ state: "orbiting" }).state, "idle");
  assert.equal(parseSweepStatus({}).state, "idle");
});

test("the three renderable states survive a round trip", () => {
  for (const state of ["idle", "sweeping", "paused"]) {
    assert.equal(parseSweepStatus({ state }).state, state);
  }
});

/* ======================================================================
 *  The click/hold threshold
 * ====================================================================== */

test("the click threshold is a gesture reading, and about 300ms", () => {
  /* Not a wire value -- the device knows nothing about it. It lives in the SDK
     so a dashboard and anything else driving this read a press the same way. */
  assert.equal(PTZ_CLICK_MS, 300);
});
