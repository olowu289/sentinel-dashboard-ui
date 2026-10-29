# Changelog

## 0.13.1

Additive. One field.

`AlertProgress.footage`, a string beside the four numbers, from
`sentry-core/docs/alerts.md` section 2 "No footage of that moment" at
sentry-core `775fe7b`.

`"none"` means the hub **answered** and has no recording covering that moment
-- the disk was full, the camera was not recording, the box was rebuilt. It is
a verdict, not a measurement, and it is the whole of `progress` on a
`HUB_OFFLINE` alert that got one: no `files_left`, no bar to draw. A screen
reading it says "No footage of that moment" and stops waiting.

Its ABSENCE is not "there is footage" -- nothing answered yet is also absent,
which is where every `HUB_OFFLINE` alert starts and may sit for weeks while its
hub is away. Only `"none"` is a statement. Left as a plain string, like `type`
and `colour`, so a later verdict needs no SDK release to pass through.

Tested on the row coordination's own store produces (`raise_alert` ->
`set_progress` -> `to_wire`), both as a parsed alert and as the `alert.updated`
frame the data centre publishes the moment it is set.

## 0.13.0

Additive. Nothing in 0.12.0 changed shape.

Site alerts, the live channel they arrive on, and the footage facts a screen
could not read before. Specs: `sentry-core/docs/alerts.md` (sections 4 and 8)
and `docs/footage-sync.md` (sections 3.3, 3.4, 3.4.1, 3.5, 4.4.2), at
sentry-core `8a5b019`.

### Added - site alerts

- **`listSiteAlerts({since, limit})`**, returning the alerts **and the
  `colours` map**. Render a row by looking its `type` up in that map, not with
  a switch in your bundle: the map is sent precisely so a type this build of
  the website has never heard of still appears, in the colour the server picked
  for it (`grey` when the server could not name it either).
  `since` is a **recovery tool**, not a cursor.
- **`getSiteAlert(id)`** and **`ackSiteAlert(id)`**. The ack sends **no body**:
  who acknowledged is the authenticated caller, never a name in a request, and
  it is one-way - the first one wins.
- **`SiteAlert`**, `AlertClip`, `AlertProgress` and the parsers, holding the
  field rules the server promises:
  **absent never null** (so `"recovered_at" in alert` is the check, and a
  `null` arriving from an older tier is dropped rather than carried through);
  **`acknowledged` always a boolean** (a missing one FAILS - `false` and "an
  older hub that did not say" must not be one thing on a screen);
  **`type` and `colour` are codes** with no `message` field anywhere;
  **`rev` for ordering**; and **`url`/`download_url` never cached**, because
  both are minted per request and a presigned bucket URL lives fifteen minutes.
  `key` is the stable identity.
- **`AlertRevisionGate`** - drops an out-of-order update by `rev`. The live
  channel and the recovery read are two sources for one row and nothing orders
  them against each other, so without it a stale forward overwrites a fresh one
  and a recovered alert flips back to live on screen.

### Added - the live channel

- **`subscribeSiteAlerts({onAlert, onError, since})`** over
  `GET /v1/viewer/events`, with `SseBuffer`, `parseSseFrame` and
  `alertEventOf` exported for anyone framing it themselves.
  ⚠ **It uses `fetch()` and a body reader, NOT `EventSource`**, which cannot
  set an `Authorization` header - and this route is authenticated like every
  other viewer route. A credential in the query string is what the clip ticket
  exists to avoid.
  It reassembles frames split across reads, ignores the 15-second
  `: keepalive`, ignores unknown event kinds, and **on every drop re-reads
  `listSiteAlerts({since})` from the last alert seen** before reconnecting -
  drops are expected, not exceptional: a slow reader is closed rather than
  waited for, and a node holds at most 64 streams.
- `HttpTransport.open()` for it, deliberately **with no per-call deadline**: a
  stream is supposed to sit idle, and a 10-second timeout would close a healthy
  connection. Cancellation is the caller's `signal`.

### Added - the timeline gains what is not on the hub yet

`listArchivedRecordings` now returns four more fields. **All are empty on a
healthy link, never an error** - a tower with none of this sends nothing.

- **`timeUnknown`** (`UndatedSegment[]`) - real footage with no time. Kept out
  of `segments` on purpose, and an entry carrying `start` or `duration` is
  **rejected**: the absence is the message, and drawing such a row would place
  footage where it was not recorded AND cut the real segment before it short to
  the gap in front of it. `arrived` is when the hub RECEIVED it.
- **`towerSpans`** (`TowerSpan[]`) - stretches the tower holds and the hub does
  not, carrying the same `start`/`startEpoch`/`duration` a segment does so one
  piece of arithmetic lays both out, and **no URL**, which is the only honest
  difference.
- **`towerSync`** (`{state, reason}`), **`towerCopy`**, and
  **`towerTimesUnreliable`** (`true` only).

### Added - the device `footage` block

- **`DeviceFootage` on `TowerInfo`**, a sibling of `health`, parsed by
  `parseDeviceFootage` and reaching the tower LIST as well as the detail.
  **Absent is not an empty archive**: a tower that has never reported footage is
  not a tower with nothing.
- **`footage.sync.reason`** is a **verdict over a fixed five** - `ok`,
  `behind`, `unreachable`, `no_recording_disk`, `recording_off`.
  ⚠ **This key used to carry the tower's refusal code.** Those moved to
  **`sync.blocked_by`**, unchanged in value. A consumer reading `reason` as a
  refusal code is reading an older contract.
  Absent when the tower said nothing about its sync - `ok` from silence is a
  guess on a screen.
- **`oldest_unconfirmed_start`** and **`oldest_unconfirmed_exact`** on each
  camera stream. The tower had reported both all along and neither crossed the
  projection's whitelist, so no screen could say "the oldest footage still on
  that mast is from 03:00". `_exact` is `false` when the start could not be
  established and **absent when it could**; it is read as `=== false` and never
  defaulted, because the absence is the stronger statement.

### Tests

`test/alerts-and-footage.test.mjs` (36), on
`test/fixtures/alerts_and_footage.json` - which is the **output of
coordination's own code** (`project_footage`, `SiteAlert.to_wire`,
`timeline_extras`, `COLOURS`) dumped to JSON, not a transcription of the docs.
A fixture written by hand agrees with the type written beside it and proves
nothing, which is how `label` and `patrol` were both lost: the type was right
and the validator never read the field.

Also wired `camera-patrol` and `camera-label` into `npm test`. Both existed,
both passed, and nothing ran them - a test file nothing runs cannot fail, which
is the same gap those two tests were written to close.

## 0.5.0

Additive. Nothing in 0.4.0 changed shape.

Sharing stops being a page you visit and becomes something that happens where
the video is, so the model gains the two things a card needs and the one thing
a live share was missing.

### Added - a share can SAY something

- **`Share.message`**, and `createShare({ message })`.
  ⚠ **Required on a REQUEST**, where it is the only thing the site being asked
  has to decide on. The server refuses a request without one. Optional on an
  offer, which carries its own meaning in its scope and its duration.
  `SHARE_MESSAGE_MAX` (500) is exported so a box can count down rather than be
  refused after sending.
- A server that predates the field reads as `message: null`, which is also what
  an offer with nothing to say sends.

### Added - a request names no cameras

- **`createShare({ scope })` is now optional**, and an omitted scope goes on the
  wire as `[]`.
  ⚠ **This is the shape of asking.** Site 1 knows Site 2 by NAME and by nothing
  else: not its hubs, not its masts, not how many cameras it has. So a request
  cannot name what it wants, and the site answering is the one that chooses.
  `acceptShare` then requires a non-empty scope, because a share that lends
  nothing becomes an active share the asker cannot tell apart from being
  ignored.
- An OFFER still requires a scope, and the server still refuses one naming
  cameras the offering site does not own.

### Added - more time

- **`extendShare(shareId, durationSec)`** - `POST /v1/shares/{id}/extend`.
  Measured FROM NOW, not from the old expiry: "another fifteen minutes" means
  fifteen minutes from when somebody says it.
  Only the site that OWNS the cameras may extend, whichever direction the share
  started in (`403` otherwise), and only while it is live (`409`). A revoked or
  expired share cannot be brought back this way: ask again, which leaves a
  record of having asked.
- **`SHARE_DEFAULT_SEC`** (900) - fifteen minutes, the default a UI should
  offer. The short one is the safe one, because the failure that matters when
  it is not your camera is the share nobody notices outliving its reason.

## 0.4.0

Additive. Nothing in 0.3.0 changed shape.

Two things happened at once here, and the second is the more important: this
version adds sites and sharing, AND it makes this repo the single source of
truth again. Before it, `sentry-sdk` and the vendored copy inside the dashboard
were two different packages both calling themselves `0.2.0` -- the copy was a
whole feature ahead (hub archive playback), the repo had sites work the copy
never saw, and the copy carried two uses of `URLSearchParams` that this package
cannot compile at all. See "Reconciled" below, and `VENDOR.json`.

### Added - sites, people, sharing and the audit log

An organization now has SITES (a place, with its hubs and towers), people who
belong to one, and SHARES, which lend one site's cameras to another for a
while. Authorization for all of it is the server's: these methods carry no
claim a caller could choose, which is why none of them takes a role or a
permission as an argument.

- **`capabilities()`** - `GET /v1/capabilities`. What this deployment can do.
  Read it before rendering anything site-shaped: the SAME BUNDLE runs against
  the cloud and against a hub on a LAN, and on a hub there are no sites, so the
  UI gates on this answer rather than on a build flag.
- **`listSites()` / `getSite(id)`** - the sites this account may see, which is
  its own plus any shared with it, and one site with its hubs, towers and cells.
- **`listShares()`**, **`createShare(...)`**, **`acceptShare(id, scope?)`**,
  **`declineShare(id)`**, **`revokeShare(id)`** - the share lifecycle.
  ⚠ **`acceptShare` NARROWS, it never widens.** A site accepting a share may
  drop cameras or permissions from what was offered and may not add any; the
  server enforces that, and a UI that offers "accept all" on a scope it edited
  is asking for a refusal.
  ⚠ **Revocation BITES AT ONCE**, including on sessions already open. A
  revoked share is not "no new sessions" -- it is "that view goes dark now".
- **`isShareLive(share, now?)`** - whether a share is in force at an instant.
  Status alone is not enough: an `active` share whose window has passed is not
  live, and that is the state a list is most often rendered in.
- **Admin:** `adminListShares()`, `adminCreateSite(name)`,
  `adminUpdateSite(...)`, `adminSetSiteHubs(...)`, `adminListPeople()`,
  `adminCreatePerson(...)`, `adminUpdatePerson(...)`,
  `adminResetPassword(...)`, `adminAudit(filter?)`.
  `adminAudit`'s `action` is a PREFIX, so `"share."` matches every share action.
- **`isAdminRole(role)`**, and types `Capabilities`, `Site`, `SiteStatus`,
  `Cell`, `Share`, `ShareStatus`, `ShareDirection`, `ShareScopeEntry`,
  `Person`, `AuditEntry` with their list responses, and parsers for each.

### Added - PTZ priority between sites

THE CAMERA'S OWN SITE ALWAYS WINS. An operator at the site a camera belongs to
must never find it being driven by somebody they lent it to.

- **`PtzResult.control`** (the new `PtzControl`) - now on EVERY ptz reply: `held`,
  `yours`, and when somebody has it, `holder_site`, `holder_is_owner` and
  `expires_in_sec`. Gate controls on `yours` and nothing else; it already
  accounts for a free camera, for your own hold, and for a hold that lapsed.
  Its ABSENCE is not an error -- it means the server does not arbitrate
  control, which is the behaviour every earlier version had.
- **`ptz_yielded`** (`409`) and **`PtzYieldedError`**, with `holderSite` and
  `retryAfterSec`, plus **`isPtzYielded(err)`**. Mapped explicitly, because a
  `409` with no mapping arrives as a `SessionConflictError` -- a session fault,
  for what is the normal outcome of sharing a camera.
  ⚠ **Not `isPtzPermissionDenied`.** That one means this viewer may NEVER
  drive this camera (disable it for the session); this means NOT NOW (name the
  site, leave the controls able to come back).
  ⚠ **Do not retry on a timer.** `retryAfterSec` is a countdown for a person:
  the owning side refreshes its hold with every command.
- `ApiError` gains `holder_site` and `retry_after_sec`, set by that one code,
  so the detail survives the envelope being rebuilt on the way to the
  exception.
- The five sweep helpers still return `SweepStatus` and so do not carry
  `control`; read it from a `status` poll or from `sendPtz` directly. Widening
  them would break callers for a field they do not need.

### Reconciled - one source of truth, enforced

- **`VENDOR.json`** plus `npm run vendor:manifest` / `vendor:check` and
  `scripts/vendor-sync.mjs <dest>`: a sha256 of every file in the package,
  carried INTO the vendored copy. `npm test` fails if this tree does not match
  it, and the consuming app fails if its copy does not. Re-vendoring is one
  command and removes stale files, so a copy can no longer quietly become a
  fork. What it cannot catch is a change made identically in both places; it is
  a smoke alarm for accidents, and every drift so far has been an accident.
- **Fixed: this package did not compile in its own repo.** `getSegmentUrl` and
  `adminAudit` used `URLSearchParams`, which is neither in `lib: ["ES2022"]`
  nor in any `@types` this package depends on. It only looked fine from inside
  the dashboard, whose node_modules supplied the types. Both now build their
  query by hand, as the rest of the file always did, and `npm run typecheck` is
  clean.
- The hub archive playback methods (`listArchivedRecordings`,
  `getSegmentUrl`, `listReviewableTowers`) and PTZ step/sweep, which existed
  only in the vendored copy, are recorded in 0.3.0 above and are now here.
- `npm test` runs all four suites. It ran two.

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
