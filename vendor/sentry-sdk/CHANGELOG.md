# Changelog

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
