/**
 * A movable camera's `patrol` block survives validation.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  WHY THIS TEST EXISTS
 * ══════════════════════════════════════════════════════════════════════
 *
 * ⚠ BECAUSE A WHITELIST DROPS WHAT IT DOES NOT NAME, AND THAT IS SILENT.
 * `parseCameraInfo` builds a NEW object from the fields it lists, so a block
 * it has never heard of is not merely unvalidated — it is gone, with no
 * warning, no error and nothing in the parsed value to say anything was lost.
 *
 * That is correct and deliberate: §A.7 is the reason a field reaches a viewer
 * by NAME. But it means every new field needs a line here AND a test, because
 * the failure looks exactly like a server that never sent it. Coordination
 * sent `patrol` on all four cameras of the lab fleet, the dashboard's Patrol
 * row read `camera.patrol`, and the row simply never appeared — the field was
 * whitelisted out one layer above the code looking for it.
 *
 * The bodies below are shaped like `projection.py`'s output, because the
 * point is the real nesting: `patrol` sits directly on a camera, beside
 * `index` and `ptz_capable`, and carries exactly five fields.
 *
 *   node --test test/camera-patrol.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTowerInfo } from "../dist/esm/index.js";

/** One tower from `GET /v1/viewer/towers`, as the projection builds it. */
const tower = (cameras) => ({
  device_id: "kln_lab_000001",
  label: "LAB TOWER 1",
  link: "up",
  as_of: "2026-10-25T09:00:00Z",
  sensors: [],
  cameras,
});

const movable = (over = {}) => ({
  index: 1,
  lens: "ptz",
  ptz_capable: true,
  status: "live",
  patrol: {
    enabled: true,
    every: "4h",
    direction: "clockwise",
    next_at: "2026-10-25T14:40:00Z",
    running: false,
    ...over,
  },
});

test("a movable camera's patrol crosses, with every field", () => {
  const { cameras } = parseTowerInfo(tower([movable()]));
  assert.deepEqual(cameras[0].patrol, {
    enabled: true,
    every: "4h",
    direction: "clockwise",
    next_at: "2026-10-25T14:40:00Z",
    running: false,
  });
});

test("a FIXED camera carries none, and gains none", () => {
  /* The absence is the signal. A block defaulted in here would hand a camera
     that cannot turn a schedule it cannot keep, and the screens that hide the
     row on `undefined` would start showing it on every fixed dome. */
  const { cameras } = parseTowerInfo(
    tower([{ index: 2, lens: "fixed", ptz_capable: false, status: "live" }]),
  );
  assert.equal(cameras[0].patrol, undefined);
});

test("both cameras of a tower keep their own", () => {
  const { cameras } = parseTowerInfo(
    tower([movable(), { ...movable({ every: "12h" }), index: 2 }]),
  );
  assert.equal(cameras[0].patrol.every, "4h");
  assert.equal(cameras[1].patrol.every, "12h");
});

test("every interval and direction in the closed sets survives", () => {
  for (const every of ["1h", "2h", "4h", "6h", "12h", "24h", "random"]) {
    const { cameras } = parseTowerInfo(tower([movable({ every })]));
    assert.equal(cameras[0].patrol.every, every, every);
  }
  for (const direction of ["clockwise", "anticlockwise", "random"]) {
    const { cameras } = parseTowerInfo(tower([movable({ direction })]));
    assert.equal(cameras[0].patrol.direction, direction, direction);
  }
});

test("a value outside the set falls back rather than dropping the block", () => {
  /* A camera that IS patrolling keeps its row against a server that has grown
     an eighth interval; one unknown value must not cost the other four. */
  const { cameras } = parseTowerInfo(
    tower([movable({ every: "36h", direction: "widdershins" })]),
  );
  assert.equal(cameras[0].patrol.every, "4h");
  assert.equal(cameras[0].patrol.direction, "clockwise");
  assert.equal(cameras[0].patrol.enabled, true, "the rest of the block was lost");
});

test("a null next_at is NOT an error: it is what `off` reports", () => {
  const { cameras } = parseTowerInfo(tower([movable({ enabled: false, next_at: null })]));
  assert.equal(cameras[0].patrol.next_at, null);
  assert.equal(cameras[0].patrol.enabled, false);
});

test("the defaults a never-configured movable camera reports cross as sent", () => {
  /* `PATROL_DEFAULTS` in projection.py. "Nobody has configured this camera"
     is a real state with a real answer, and the SDK must not re-invent it. */
  const { cameras } = parseTowerInfo(
    tower([
      {
        index: 1,
        lens: "ptz",
        ptz_capable: true,
        status: "live",
        patrol: {
          enabled: false,
          every: "4h",
          direction: "clockwise",
          next_at: null,
          running: false,
        },
      },
    ]),
  );
  assert.deepEqual(cameras[0].patrol, {
    enabled: false,
    every: "4h",
    direction: "clockwise",
    next_at: null,
    running: false,
  });
});

test("running crosses, for a camera sweeping right now", () => {
  const { cameras } = parseTowerInfo(tower([movable({ running: true })]));
  assert.equal(cameras[0].patrol.running, true);
});

test("a patrol that is not an object is ignored, not fatal", () => {
  /* The tower reports; the projection validates; this validates again. None
     of the three may take the whole tower down over one bad block. */
  for (const bad of ["patrol", 7, []]) {
    const { cameras } = parseTowerInfo(
      tower([{ index: 1, lens: "ptz", ptz_capable: true, status: "live", patrol: bad }]),
    );
    assert.ok(cameras.length === 1, String(bad));
  }
});
