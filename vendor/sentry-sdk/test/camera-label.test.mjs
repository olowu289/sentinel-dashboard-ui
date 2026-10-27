/**
 * A camera's own name survives validation.
 *
 * ══════════════════════════════════════════════════════════════════════
 *  THE SECOND FIELD THIS WHITELIST SWALLOWED
 * ══════════════════════════════════════════════════════════════════════
 *
 * `patrol` was the first. `label` is the same mistake one field over, and the
 * comment the dashboard had left at its own read site is why it took so long
 * to find:
 *
 *     "`CameraInfo` is a version behind ... narrowing here rather than
 *      editing the vendored type"
 *
 * ⚠ THE REASONING WAS ABOUT THE TYPE. The problem is the VALIDATOR.
 * `parseCameraInfo` builds a NEW object from the fields it names, so a cast
 * that reads `label` off the parsed camera reads a field that is no longer
 * there. Coordination sent "Gate test", the hub stored it, every GET carried
 * it, the PATCH answered with it — and every screen said CAMERA 1.
 *
 * So: a line in the validator and a test, for every field. The bodies below
 * are shaped like the real `/v1/viewer/towers` and the real PATCH answer.
 *
 *   node --test test/camera-label.test.mjs
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { parseTowerInfo } from "../dist/esm/index.js";

const tower = (cameras, over = {}) => ({
  device_id: "kln_lab_000002",
  label: "WEST TOWER",
  link: "up",
  as_of: "2026-10-27T09:00:00Z",
  sensors: [],
  cameras,
  ...over,
});

/** Camera 1 of the lab's west tower, after the rename. */
const named = {
  index: 1,
  lens: "ptz",
  ptz_capable: true,
  status: "live",
  name_rev: 3,
  resolution: { width: 2560, height: 1440 },
  profiles: [{ id: "sub", default: true }],
  patrol: {
    enabled: false,
    every: "4h",
    direction: "clockwise",
    next_at: null,
    running: false,
  },
  patrol_rev: 86,
  label: "Gate test",
};

test("a camera's label crosses", () => {
  const { cameras } = parseTowerInfo(tower([named]));
  assert.equal(cameras[0].label, "Gate test");
});

test("⭐ and so does everything beside it", () => {
  /* The real camera carries eight fields now. One new one must not cost the
     others, which is what a whitelist is for and what makes it dangerous. */
  const { cameras } = parseTowerInfo(tower([named]));
  const cam = cameras[0];
  assert.equal(cam.index, 1);
  assert.equal(cam.ptz_capable, true);
  assert.equal(cam.resolution.width, 2560);
  assert.equal(cam.profiles.length, 1);
  assert.equal(cam.patrol.every, "4h");
});

test("⭐ a CLEARED name is absent, not empty", () => {
  /* Clearing a name is a real act and the absence IS the cleared state: a
     client printing "" where it falls back to `CAMERA 1` would show a blank
     caption on a tile. */
  for (const label of [undefined, "", "   "]) {
    const { cameras } = parseTowerInfo(tower([{ ...named, label }]));
    assert.equal(cameras[0].label, undefined, JSON.stringify(label));
  }
});

test("a camera that was never named carries none", () => {
  const { cameras } = parseTowerInfo(
    tower([{ index: 2, lens: "fixed", ptz_capable: false, status: "live", name_rev: 0 }]),
  );
  assert.equal(cameras[0].label, undefined);
});

test("⭐ name_rev and patrol_rev are accepted, and raise no issue", () => {
  /* They arrived in a release this build did not know about. A strict reading
     would have taken the whole fleet off the screen over a number it has no
     use for. */
  const { cameras } = parseTowerInfo(tower([named]));
  assert.equal(cameras[0].name_rev, 3);
  assert.equal(cameras[0].patrol_rev, 86);
});

test("a tower's own name_rev is accepted too", () => {
  const parsed = parseTowerInfo(tower([named], { name_rev: 7 }));
  assert.equal(parsed.name_rev, 7);
  assert.equal(parsed.label, "WEST TOWER");
});

test("a junk revision is ignored rather than fatal", () => {
  const parsed = parseTowerInfo(
    tower([{ ...named, name_rev: "three", patrol_rev: null }], { name_rev: {} }),
  );
  assert.equal(parsed.cameras[0].label, "Gate test", "the label went with the junk");
  assert.equal(parsed.cameras[0].name_rev, undefined);
  assert.equal(parsed.name_rev, undefined);
});

test("⭐ both cameras of a tower keep their own names", () => {
  const { cameras } = parseTowerInfo(
    tower([named, { ...named, index: 2, label: "Yard", name_rev: 1 }]),
  );
  assert.equal(cameras[0].label, "Gate test");
  assert.equal(cameras[1].label, "Yard");
});
