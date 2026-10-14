# Changelog

## 0.3.0

Additive. Nothing in 0.2.0 changed shape, so a 0.2.0 consumer keeps working --
the bump exists because this package has been the vendored source of truth for
two features that were never recorded here, and because two checkouts both
claiming `0.2.0` had already diverged by three methods.

### Added - PTZ step and the 360 sweep

Built against `sentry-core` `docs/ptz-api.md` at commit `c02211f`, which is the
contract this SDK is held to. Where a shape here disagrees with that file, that
file is right.

- **`ptzStep(ref, camera, params)`** - one fixed nudge, as an ONVIF
  RelativeMove. A DISTANCE, not a duration: link delay changes when it happens
  and never how far it goes, so repeated clicks move the same amount every
  time. `pan`/`tilt` are signed multipliers clamped to -1..1; `degrees`
  overrides the camera's configured step size and is clamped to
  `PTZ_STEP_DEG_MIN`..`PTZ_STEP_DEG_MAX`.
  **Check `result.done`:** a step blocked by the tilt limit answers HTTP 200,
  `ok: true`, `done: false`, with a `reason` written for a person. It is a
  refusal, not an error, so nothing throws.
- **`sweepStart` / `sweepPause` / `sweepResume` / `sweepStop` /
  `sweepStatus`** - each returns the `SweepStatus` as it now stands, so a
  caller never polls to learn what its own command did. The sweep runs ON THE
  DEVICE: a closed tab or a dropped link does not stall it. One sweep per
  camera, and a second `sweepStart` is not an error.
- **`PtzStopParams.keep_sweep`** - the release of a tilt/zoom hold taken during
  a sweep. Drops the held axes and leaves the pan turning.
  ⚠ **A UI that omits this kills the operator's sweep every time they let go
  of tilt**, because a release and a Stop arrive as the same `stop` and only the
  caller knows which gesture it was.
- `sweepOf(result)` and `parseSweepStatus(raw)`.
  ⚠ **The block's position depends on the action:** a `sweep` reply puts it
  in `result` itself, every other reply nests it at `result.sweep`. The five
  sweep methods handle the first; `sweepOf` is for the second. `undefined` from
  `sweepOf` means "this reply says nothing about a sweep", which is NOT the same
  as `{state: "idle"}`.
- `PtzStatusResult.sweep`, so a `status` poll reports a sweep another operator
  started without a second request.
- Constants: `PTZ_CLICK_MS` (how long a press must be held to be a hold rather
  than a click -- a gesture reading, not a wire value), `PTZ_STEP_DEG_MIN`,
  `PTZ_STEP_DEG_MAX`, `SWEEP_SECONDS_MIN`, `SWEEP_SECONDS_MAX`.
  The sweep bounds are exported because the device **refuses** a duration
  outside them rather than clamping it, and this SDK does not pre-empt that.
- Types: `PtzStepParams`, `PtzStepResult`, `SweepOp`, `SweepParams`,
  `SweepPhase`, `SweepStatus`. `PtzAction` and `PtzCommand` gain `step` and
  `sweep`.

`ptzMove` and `ptzHold` are UNCHANGED. The continuous-move request did not move
-- what changed is the speed the device executes it at (halved by default, per
camera), which is reported back as `result.speed_scale` and needs nothing from
a caller. `ptzHold`'s `stop()` already forwards `PtzStopParams`, so it carries
`keep_sweep` with no new argument.

### Added - hub archive playback

Present in the vendored copy since the hub recordings work and never recorded
here. This is the drift that made two `0.2.0` checkouts different packages:

- **`listReviewableTowers()`** - which towers the archive actually holds footage
  for, as opposed to which are connected now.
- **`listArchivedRecordings(deviceId, camera?, range?)`** - the hub's archived
  segments. Storage-agnostic: each segment's `url` is ready to play and
  self-authorizing, and a consumer must never inspect which backend served it.
  `archiveEnabled: false` with no segments is the honest "this hub does not
  archive", not a transient empty.
- **`getSegmentUrl(deviceId, camera, key)`** - a FRESH pair of URLs for one
  segment. The list's URLs begin ageing when the list is built; a clip opened
  minutes later can stall part-way with no error at all, which looks exactly
  like a slow start. Call this when a segment is actually opened.
- Types: `ReviewableTower`, `ArchivedRecordingList`, `ArchivedSegment`,
  `FreshSegmentUrl`.

## 0.2.0

**0.2.0 conforms to session-protocol §4.2 frozen inventory contract; supersedes 0.1.0's
path-required / online:boolean assumptions.**

Breaking, and only in the inventory shapes. The signaling surface — sessions, offer, ICE,
PTZ — is unchanged.

> **Package version only.** The WSS envelope stays `v: 1` and the viewer API stays
> `/v1/viewer/…`. §A.11 records why neither moves: `v` versions the WSS envelope and is an
> integer that additive fields do not disturb (§2.2), the viewer API is versioned by URL,
> and no server has ever served the old shape — the stub implements no towers endpoint at
> all, so there is no field deployment to protect. This bump exists to mark the SDK's own
> break, which is real, against consumers that pinned 0.1.0.

### Changed — `CameraInfo` (§A.2)

- **`path` is no longer required, or present.** 0.1.0 required it to join
  `health.feeds[]` for liveness. §A.2 serves `status` directly, so the join and its key
  are both gone (§A.12 #4) — and a camera absent from `feeds[]` can no longer read healthy
  for lack of an entry, which is what that join did.
- **`status` (`"live" | "down" | "unknown"`) added, required.** `"unknown"` is valid and
  expected: until §A.10.5 puts per-camera liveness on `tower.state`, a conforming service
  serves it rather than inferring.
- `index` is now validated as an **integer ≥ 1**, not merely a number.
- `lens` narrowed to `"ptz" | "fixed"` — a closed set per §A.2.
- **`enclosure` and `role` added** (§A.4/§A.5). A dual-lens body is two cameras sharing an
  enclosure, not one camera with sub-feeds. Presentation only — §A.7 forbids both from any
  session, PTZ or grant call.
- `codec` and `calibrated` **removed from the type**. §A.6 SHOULD-omit tier: tolerated in
  silence at runtime whether present or absent, but not typed, because a field with no
  consumer ossifies (§A.3.3).

### Changed — `TowerInfo` (§A.3)

- **`online: boolean` removed and replaced by `link: "up" | "down"`** (§A.12 #2). There is
  no boolean form to fall back to; a response sending `online: true` now fails as a
  missing `link`. The open string arm is deliberate — the field was reshaped as a word so
  a third state (`"reconnecting"`) can arrive without a breaking change, and the validator
  accepts any string so that stays true.
- **`label` added, required** (§A.3.1). The human name from the account layer. Without it
  a consumer falls back to slug-parsing `device_id` — the "Tower 1" trap.
- **`as_of` added, required** (§A.3.2). When the camera statuses were last confirmed;
  `null` before the first `tower.hello`. Required, but the key must be *present*: an
  absent stamp is the silent failure it exists to remove. **The SDK does not interpret
  it** — computing staleness is the dashboard's job.
- **`sensors` added, required** (§A.9). Reserved, may be empty, present even when empty.
- `agent_version`, `capabilities`, `last_seen` are now **optional** (§A.3.3) — a
  deliberate narrowing, not a prohibition; §4.2.3 still serves them.

### Added — §A.6 projection-leak rejection

`ProjectionLeakError` (a `ValidationError` subclass) and `assertNoProjectionLeak()`. A
projected inventory carrying `path`, `whep_path` or `boot_id` **anywhere in the document,
recursively**, is rejected with the exact field paths named.

This is the **one** exception to this SDK's unknown-field tolerance, and it is not an
inconsistency: an unknown field is usually a compatible addition (§2.2, §A.9), while these
three are a projection that failed to strip what §A.6 requires it to strip. §A.6 puts the
obligation on the consumer in as many words — reject it, "loud at the door, never silently
ignored". §A.13 records why `boot_id` sits in this tier rather than the SHOULD one.

### Added — `isPtzPermissionDenied()`

Narrower than `err instanceof GrantError`, which also covers `grant_expired` and
`grant_replay`. §A.8's flip-to-view-only behaviour should fire on `grant_permission` and
nothing else — a grant that aged out wants a new session, not a disabled control.

### Unchanged, and deliberately so

- **Signaling-only.** The SDK does not own `RTCPeerConnection` and gained no WebRTC.
- **`CreateSessionRequest` stays `{device_id, camera: <index>}`** — a bare integer, fixed
  by §4.2.1 and §A.7 as a security boundary. `enclosure`, `role` and `label` go nowhere
  near a session, PTZ or grant call.
- **`ptzHold` still owns the deadman keepalive cadence** (§5.1); the timing is not exposed
  or moved.
- Zero runtime dependencies. `tsc` only. `dist/` committed and rebuilt.

## 0.1.0

Initial build: shapes and the coordination client for the viewer-facing HTTPS API (§4.2),
against session-protocol v1.
