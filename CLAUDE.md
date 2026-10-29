# Sentinel — working notes

Operator monitoring portal for a fleet of camera towers. React 19 + TypeScript +
Vite + Tailwind v4, `motion/react` for animation. No component library, no
router, no backend — `src/lib/data.ts` is the seed.

Two screens, switched by `App.tsx`: `DashboardView` (the fleet — tower list plus
a wall of every camera) and `TowerView` (one tower). The dashboard is the
landing screen and the parent.

**Read `README.md` first.** It is not a scaffold readme; it is the design record
and explains *why* almost everything is the way it is. This file covers only the
conventions that are easy to violate by accident.

## Commands

```bash
npm run dev        # never run a dev server any other way
npm run typecheck  # tsc --noEmit
npm run build      # typecheck + vite build
```

There is no test runner and no linter. `npm run build` is the gate.

**The dev server runs on 5173 and only 5173.** `strictPort` is on, so if that
port is busy Vite REFUSES TO START rather than quietly taking the next one.
When you see `Port 5173 is already in use`, kill what is on it — do not start a
second server beside it.

That is the whole point, and it is not tidiness. This config used to bump to a
free port, and in one session four Terra dev servers accumulated on 5173, 5174,
5190 and 5191. Two were serving a stale SDK build, so a browser pointed at the
wrong one showed a field as missing that the server was plainly sending — and
the bug looked like it was in the parser. A refusal you have to read is cheaper
than a duplicate you never notice.

`PORT=5180 npm run dev` still wins when you genuinely want a second one, and it
is strict too: being handed a port you did not ask for is the same bug at a
different number.

The neighbouring project (Bayana / ai-tracking) sits on **5199**, so 5173 is
ours. If the preview looks like a different app, check the port anyway.

## Non-negotiables

These are load-bearing decisions with reasons recorded in the README or in
comments at the site. Changing one is a real decision, not a cleanup.

**Colour is reserved.** Green is live, amber is degraded or a detection, red is a
fault or live transmission. Nothing else gets a hue, with the one extension the
alert feed argued for and won: `--color-recovering` (purple) and
`--color-recovered` (teal), spent on footage catching up after an outage and
nowhere else. That is a job running and then a job finished, which is the one
class of event here that is neither a reading about a site nor a fault — red
or amber would paint a system recovering correctly as broken, and green would
say LIVE. The hub decides which alert wears which, and sends a `colours` map so
a type this bundle has never heard of still renders. Do not reach for `terra` to
mean "selected", "primary" or "success" — selection and primary actions are
white-on-black. A green pill on a monitoring screen reads as a signal, not a
setting. The one extension is `PendingTowerCard`, which the design washes in
20% detect amber for a tower whose setup is unfinished — not a reading, but the
same claim amber always makes: *this needs you*. There is now no blue at all.
`--color-drag` was the one exception, allowed *because* it was outside that set
and only for the length of a drag: a held band had to say "you have this"
without also seeming to report on the site. The wall takes the TOWERS list's
order and has no arrangement of its own, so the gesture is gone and the token
went with it rather than waiting to be spent on something that persists. A blue
that outlives a gesture is the thing this rule was written against.

**Times are wall-clock, in site time, labelled.** `formatEventTime` /
`formatClock`, never the viewer's timezone and never a relative age. There are
exactly two documented exceptions, both `formatRelative`: the new-alert banner
and the tower card's alert strip. Both are one transient line whose whole job is
*this just happened*, and neither re-ticks. `src/lib/time.ts` explains it. Do
not reach for it in `AlertRow` or `AlertDetail`.

**Timestamps are epoch ms in the data layer**, never pre-formatted strings — the
filter and the timeline deltas both need to compare them.

**Absence is diagnostic.** Empty fields stay visible and say *why* the value is
missing (`Not acknowledged`, `Not scored`, `No footage — feed was down`). Never
blank a row or substitute a zero.

**A tower's footage block is a sibling of `health`, and only one module reads
it.** `tower.footage` is the SDK's own `DeviceFootage`, straight through the
mapper, and `src/lib/footageStatus.ts` is the only thing that interprets it.
The Towers board's Footage and Waiting cells and the settings panel's Footage
and Waiting rows both call the same two functions, so the board cannot say a
site is up to date while its own settings say it cannot reach the hub.

⚠ `sync.reason` IS THE HUB'S VERDICT, NOT THE TOWER'S REFUSAL CODE. It
changed meaning in SDK 0.13.0: the five values are `ok`, `behind`,
`unreachable`, `no_recording_disk` and `recording_off`, and the tower's own
codes moved aside to `sync.blocked_by`. Two of the five cannot come from a
tower at all — `unreachable` needs a link state only the hub observes and
`behind` needs a clock — so **a tower that reported footage and no `sync` block
has said nothing, and silence renders as no row rather than as "Up to date"**.
A monitoring screen that reports a site as fine because it failed to answer is
the one direction this product may never guess in. Do not fold `blocked_by` a
second time on this side; that is how two builds end up disagreeing about one
tower in front of a customer.

**The timeline's tail is not a gap, and undated footage is not on the
timeline.** A tower records to its own SSD and ships finished fifteen-minute
files up, so the newest 15 to 30 minutes of every camera is always still on the
mast: `towerSpans` draws it as its own hatched band with a legend, in neither
green (which on that bar means "playable") nor a hue of its own. And a recorder
that started before its clock synced writes a complete file whose start nothing
can establish — `timeUnknown`, rendered as a list UNDER the timeline with the
arrival labelled as an arrival, never a position on it. Placing one at the
moment it arrived would show footage at a time it was not recorded *and* cut
the real segment before it short to the invented gap in front of it. Its
download carries no time at all (`undatedFilename`).

**The alert feed is real, and every word in it is ours.** Coordination raises
five kinds (`TOWER_OFFLINE`, `CAMERA_STOPPED`, `TOWER_ONLINE`,
`FOOTAGE_RECOVERING`, `FOOTAGE_RECOVERED`) with a `type`, a `colour` and
**no `message` field anywhere** — the website owns every sentence a customer
reads, and the easiest way to keep the first writing rule is to have nothing on
the wire that could break it. `src/lib/alertCopy.ts` is the whole vocabulary
and the only place a switch over `type` may live. A type this bundle was built
before gets a generic sentence and the colour the server picked for it, never
its code and never nothing: an operator who reads "Something happened at WEST
TOWER" goes and looks.

⚠ `TOWER_OFFLINE` reads **"offline"**, never "down". A hub cannot tell a dead
tower from a dead radio link, and "down" asserts the first. That one word is
what sentry-core's own spec says this repository owes it.

**The feed lists once and then streams. Nothing polls.** `useSiteAlerts` reads
`GET /v1/viewer/site-alerts` on open and holds `GET /v1/viewer/events` after
that. Drops are EXPECTED rather than exceptional — a slow reader is closed
rather than waited for, because the publisher is the loop watching the fleet,
and a node holds at most 64 streams — so the SDK recovers with `since=` and
`reconnecting` is a quiet line, never a reason to clear the list. The
subscription deliberately does not depend on the fleet's names or the toast
callback; both are read through refs, because a stream rebuilt on every render
of the shell is a stream the server closes for being the 64th.

**There are TWO revision gates and they guard different things.** The SDK's
drops out-of-order frames off the stream; `useSiteAlerts` drops out-of-order
rows reaching the store. An acknowledgement is a POST whose response never
touches the subscription, so only the second one stops a recovery read from
un-acknowledging an alert a second after somebody acknowledged it.

**An alert's colour is the SERVER's.** The list sends a `colours` map with
every response precisely so an unknown type still renders. `ALERT_COLOUR` maps
the colour KEY to a token, never the type: red is `critical`, orange is
`detect`, green is `terra` (a tower that is BACK, which is the house meaning of
green), and the recovery pair takes `--color-recovering` and `--color-recovered`
— two tokens added for the one class of event that is neither a reading about
a site nor a fault, but a job running and then finished. **Blue is still the
sharing toast's and nothing else's.** This is also the one place
`notifications.tsx`'s "one token per kind" rule bends: `Notification.strip`
exists so the hub's own judgement reaches the card, and it is still one class
on one 2px bar.

**There is no resolve, and no un-acknowledge.** Acknowledging is one-way and
the first one wins; a camera coming back writes `recovered_at` onto the SAME
alert rather than closing it. Those are facts about different actors — a
person noticing, and hardware returning — and a button collapsing them would
let a screen imply somebody dealt with an outage that simply ended. The ack
sends **no body**: who acknowledged is the authenticated caller, and the screen
takes the returned alert as the truth rather than writing optimistically.

**A clip URL is never cached, and `AlertClips` must be keyed on the alert id.**
`url` and `download_url` are minted per request and a presigned bucket URL
lives fifteen minutes; `key` is the stable identity. A 403 re-reads the alert
and retries ONCE — once, because a second failure is not an expiry and a loop
against a refusing server is this app causing the outage it reports. A 404 is
the budget having swept the file, and the alert stays: an alert is the record
that the camera stopped at 03:14. The three no-clip states are three different
sentences — "Clip coming", "Clip no longer kept", and no clip area at all for
the recovery pair, which has no moment to cut around. And the keying is the
`AlertDetail` trap in CLAUDE.md applied: that panel is never remounted, so
every piece of player state would otherwise appear against the next alert.

**The detection vocabulary is kept and nothing raises one.** `person`,
`vehicle`, `speaker`, `matchedPersonId`, `confidence`, `zone`, `source` and the
timeline steps are all still here, and `Alert.source`/`zone` are now optional
because coordination's five kinds have neither. A server alert gets the detail
cells that are true of it; "Not scored" under AI Confidence on a hardware fault
is rule 4 the wrong way round.

**A clip is reviewed in `ClipPlayer`, the same player the detection alerts
use.** A real alert briefly had an inline transport of its own — two videos, a
play button and a range input — and the lab got the plain bar while the better
player sat unused two files away. `AlertClips` is the design's HERO now
(picture, camera name in the corner, centre play, duration badge) and hands its
panes up; the panel owns the player. For `TOWER_OFFLINE` and `TOWER_ONLINE`,
`ClipPlayer` takes `companions` and drives both cameras on ONE transport.

⚠ **A SEEK BEFORE THE ELEMENT CAN SEEK IS DROPPED SILENTLY, AND CAN STALL
THE PANE FOR GOOD.** No error, no event: `currentTime` is written and reads
back unchanged on the next line. Worse, a seek issued at `loadedmetadata` —
which fires as soon as the duration is known, long before `seekable` has
anything in it — can leave a paused element parked at `HAVE_METADATA`, never
loading further and never becoming playable, with a perfectly good file behind
it. `restorePosition` checks `v.seekable` before writing and is called from
every readiness step the element reports. The player's videos are
`preload="auto"` for the same reason: a paused element on `metadata` never
reaches `canplay` and cannot seek. This is the family the lab's "shows 0s / 1m
and never plays" came from.

⚠ **AN OPEN PLAYER MUST NOT HOLD A SNAPSHOT OF ITS CLIP.** `AlertsPanel` and
`AlertsView` record WHICH CAMERA is leading and re-derive the panes from the
live alert on every render. Not the attachment (captured when the hero was
pressed, so a 2K cut landing while somebody watches changes nothing on screen)
and not the clip key (the upgrade is a new key for the same camera). A camera
number is the one identity that survives the swap. The position is carried
across from `t`, the transport's own clock, read DURING RENDER — by the time
an effect runs React has written the new `src` and the browser has zeroed it.

**A camera is called what the customer called it, and the noun appears once.**
`CameraNameOf` returns `CameraFeed.label`, which is present only when somebody
actually named a camera — NOT `CameraFeed.name`, which is always populated and
would make every camera look named.

⚠ **`cameraSubject` IS THE ONLY THING THAT DECIDES WHETHER "camera" IS
APPENDED**, and it tests the NAME rather than branching on whether one was
set. Three cases, one rule: NORTH GATE takes the noun from the sentence,
CAMERA 1 (the fallback) already carries it, and TEST GATE CAMERA — somebody
putting the word in the name themselves, which is ordinary — already carries
it too. Whole word and case-blind, so CAMERAMAN HILL does not count. Two
places write this clause (the title in `alertCopy.ts` and the timeline's first
step in `alertStory.ts`) and fixing only one is how "CAMERA 1 camera stopped
working" survived its own fix in the second one.

**An alert's id is shortened for READING ONLY.** `shortAlertId` makes
`ALT-95AE76`; the full 32-character id is on the clipboard behind the header
and is what every request still carries. Thirty-two hex characters cannot be
read aloud on a handoff or compared by eye, which is rule 3.

**The detail's Timeline is built by `lib/alertStory.ts` and every stamp on it
is the server's, with one derivation.** "Alert raised" is `started_at + 60 s`
because the hub debounces for exactly that before raising anything and stamps
the alert at the EVENT (docs/alerts.md §1). A step may have NO clock — the 2K
upgrade is attached during a sweep and the row carries no time for it — and it
draws none rather than an invented one.

**The alert detail's footer reserves `lg:pb-[46px]` for the notifications
chip.** `NotificationStack` is a fixed overlay pinned 16px from the bottom
right of the viewport and the detail ends in that same corner at lg, so the
"Recent" chip painted over Escalate. Fixed on the panel rather than by moving
the overlay: the overlay is global and correct, and the panel is what chose to
end in an occupied corner. If the chip moves, re-measure.

⚠ **A `useState` UPDATER DOES NOT RUN WHEN YOU CALL `setState`, AND A SIDE
EFFECT THAT READS ITS RESULT ON THE NEXT LINE READS NOTHING.** `useSiteAlerts`
decided "do these clips need URLs?" inside a `setRaws` updater and pushed the
ids onto an array it looped over immediately after — so no request was ever
made, and DevTools showed zero `site-alerts` calls after an `alert.updated`.

It passed every test, because React has an eager-state bailout: when a hook's
update queue is EMPTY it runs the reducer immediately to see whether the state
changed. One frame at a time takes that path and the array is populated in
time. Two frames back to back — a raise and its clip, which is every real
incident — leave an update pending, the bailout is skipped, the updater is
deferred to the render phase, and the effect runs first.

So the store is a `useRef` and the state is its mirror: every decision is made
against the ref, synchronously, and `setRaws` is handed a finished value and is
only how the screen hears about it. **A browser test that pushes one event and
waits cannot see this class of bug** — push two without awaiting between them.

**The event stream sends clips WITHOUT urls, and that is the server being
correct.** `url` and `download_url` are minted per request and must not be
cached — a presigned bucket URL lives fifteen minutes and a pushed frame can
sit in a queue — so the hub mints them on `GET` and leaves them off the push.
The browser's half of that bargain is to ask: `useSiteAlerts` re-reads an alert
whose clips lack URLs, debounced (`REFETCH_DEBOUNCE_MS`) so a burst of frames
about one incident is one request, and once per clip fingerprint so a clip
whose URLs never arrive costs one request rather than a loop. Without it the
detail sits on "Clip coming" until a reload, because only the LIST mints.

⚠ **AND A LATER FRAME MUST NOT ERASE THE URLS ALREADY FETCHED.**
`withKnownUrls` carries them forward by clip key. The recovery frame carries
the same clip list as the one that announced it, so applying it verbatim takes
a playable clip back off the screen — a recovery un-playing the clip of the
incident it is recovering from. That is not caching a URL: the alert in the
store already held it, `key` is still the identity, and the 403 path re-mints
an expired one.

⚠ **A NOTIFICATION'S LIFETIME IS MEASURED FROM WHEN IT ARRIVED, NOT FROM
`at`.** `Notification.at` is when the thing HAPPENED; `Held.addedAt` is when
the stack received it, and the expiry timer uses the second. They were one
field, and the hub stamps an alert at the event and raises it 60 s later after
the debounce — so every alert card was already older than the nine-second
default before it was created: added, retired on the next tick, straight into
"Recent" marked "passed", with no toast ever on screen. Share cards had the
same bug waiting for any share older than nine seconds when the poll found it.
A card that carries a button takes `ACTIONABLE_TTL_MS`, because nine seconds is
less than the time it takes to look up from a camera wall.

**A stopped stream says so.** `useSiteAlerts` exposes `paused` — `reconnecting`
held for longer than `PAUSED_AFTER_MS` (8 s, two failed attempts) — and both
alert surfaces draw the same `PausedNotice`. A feed that has stopped and a
quiet night are both a list that is not changing, and on a monitoring product
one of those is the best news on the screen and the other is the worst. It is
gated on the grace period because drops are ORDINARY on this channel, and a
notice that blinks all day is a notice nobody reads.

**A HUB IS NOT A TOWER, AND TWO ALERT TYPES ARE ABOUT ONE.** `HUB_OFFLINE`
(red) and `HUB_ONLINE` (green) are raised by the DATA CENTRE from the uplink
monitoring it already does, and `device_id` carries the HUB's id on those rows
— docs/alerts.md §1a, "a hub is not a device, and that is the one thing the
alert table had to absorb". The fleet cannot name one: it holds that hub's
MAST, which is a different box with a different id and a different name. So
`NameOf` takes the alert's TYPE as a second argument and the shell's resolver
asks the cells (`GET /v1/cells`, the only place a hub's chosen name lives) for
a hub and the fleet for everything else. `isHubAlert` is the one place that
decides. Fall back to the id rather than to a blank, same as a tower.

The wording is the same two sentences one tier up, and **"offline" matters more
here than it does for a tower**: all the data centre saw was a socket stop
answering, and the hub on the other end may be serving its own control room
perfectly over the LAN. "Down" would be a claim about the hub.

**A CLIP HAS SIX STATES AND FOUR OF THEM HAVE NO PICTURE.** `clipState` in
`alertCopy.ts` answers, `clipWords` says it, and the two are shared by the clip
area and the timeline so they cannot disagree. `playable` and `hubOnly` both
have clips to draw per camera, side by side; the rest are one line and one of
help. They are NOT interchangeable, which is the whole reason this is a state:

| state | when | and so |
| --- | --- | --- |
| `playable` | a clip carries a `url` | the player, as always |
| `hubOnly` | clips, none with a `url` | described, not pressable. The data centre keeps no video (§3a) and with no bucket there is nothing to mint, so the screen says where the footage IS: the dashboard at the site plays it |
| `pending` | a HUB alert with no clips | **not "in a minute".** `HUB_OFFLINE` is the one alert whose clip cannot be cut at the raise: the footage is on the box that went away, nothing polls, nothing expires, and a hub can be off a mast for WEEKS |
| `none` | `progress.footage == "none"` | the hub looked and had none. An ANSWER, so stop waiting |
| `coming` | a tower alert with no clips yet | the ordinary minute |
| `never` | the recovery pair | no clip area at all |

⚠ **`progress` IS NOT A PROMISE OF NUMBERS, AND AN EMPTY ANSWER MUST NOT DRAW
A 0% BAR.** An answered `HUB_OFFLINE` carries exactly `{footage: "none"}` —
a verdict, with no `files_left`, no fraction and nothing to draw. So
`recoveryDetail` and `recoveryProgress` test every field on its own and never
branch on the block existing: a bar at 0% over that alert would say "a
transfer is under way and has moved nothing", which is the opposite of what
the hub answered. Both the row and the detail draw from those two functions,
so getting it right once gets it right in both places.

⚠ **AND ITS ABSENCE IS NOT "THERE IS FOOTAGE".** Nothing answered yet is also
absent, and that is where every `HUB_OFFLINE` starts and may sit for weeks
while its hub is away. Only `"none"` is a statement; anything else, including
a verdict this bundle was built before, leaves the alert `pending`.

This field arrived in `@kallon/sentry-sdk` **0.13.1**. Before it, `progress`
was parsed as four numbers and everything else in the block was dropped, so
the whole thing reached this side as `{}` and the distinction never crossed
the wire. The reading here was written and tested first, with a
pending-dependency test asserting the parser dropped it — which failed the
moment 0.13.1 was vendored and said in its own message to delete itself. That
is the shape to copy when this side is finished before the SDK is: write the
reading, test it against the field fed in by hand, and leave a test that
fails the day the real one arrives.

**Motion lives in `src/lib/motion.ts`.** `ENTER` / `EXIT` / `FADE`, all tweens.
Springs overshoot, which on a wall of cameras reads as the stream glitching.
There are deliberately no CSS motion tokens — the standing keyframes in
`index.css` own their own timings.

**A tower has exactly two cameras.** `CAMERAS_PER_TOWER` in `types.ts`. It is
the hardware, and the fleet wall is built on it — a band is one site's header
over one row of two tiles, which is what the design draws and why the wall caps
its columns at two. Seed a third camera and the wall stops being a row per site.

**The wall's bands are the TOWERS list, in the TOWERS list's order.** One
function decides it — `fleetOrder` / `wallBands` in `src/lib/fleetOrder.ts` —
and `TowersPanel` and `DashboardView` both call it. Nothing stores an
arrangement anywhere: not in the shell, not in `ViewPrefs`, not in the view.

This reversed on 2026-10-27, and the reason is worth keeping. The wall used to
hold its own flat `order` of feed ids, seeded from the fixtures and reconciled
by appending whatever the fleet had gained to the end — so it accumulated the
order of every fleet the browser had ever read, and the two panels showed the
same three sites in two different orders. Band drag went with it: an
arrangement only one of the two panels can hold is exactly that disagreement,
re-introduced deliberately. A second source for band order gives you two
arrangements that drift apart, and the first thing that drifts is the operator's
ability to find on the wall the site they just read about in the list.

**Camera, alert and tower state belong to `App.tsx`, not to a screen.** Both screens
render the same feeds, and the recording tick and latency walk are live — give
either one a copy and the two walls disagree about the same camera within a
second. The wall's ORDER is no longer among them: it is derived from `towers`
and `feeds` on render (see above), so there is nothing for `DashboardView`
unmounting on a drill-in to lose.
`towers` is up there for the same reason once the batteries started filling —
both screens read a tower, and two copies of a moving number disagree. The
live-viewing clock behind the battery banner is up there too, and that one is
about *unmounting* rather than duplication: `TowerView` is keyed on the tower,
so a clock owned by it would reset every drill-in and an operator could watch a
camera all afternoon by ducking out to the fleet and back. It resets on a
different tower, not on leaving one — `watchedTower` in `App.tsx` is the ref
that tells those two apart.

**Live sessions are held by the manager, keyed by camera; screens only
attach.** `usePlayback` holds every WebRTC session this browser has open, one
per camera, shared by every screen. A screen declares what it shows
(`attachedTargets` in `App.tsx`) and never opens or closes a session itself.
Leaving a screen DETACHES: the session keeps streaming unseen and the next
screen to show that camera reuses it. Only the manager closes, and only by
its rules — `IDLE_CLOSE_MS` with nothing attached, a *different* tower opened
(the `watchedTower` line again), the held ceiling needing the slot, or
deliberately (camera no longer live, a profile chosen, retry, sign-out,
unload). Before this, the fleet and the tower each rebuilt their own set and
every drill-in renegotiated the camera the operator had just clicked. A new
screen that shows live video adds itself to `attachedTargets`; one that does
not attaches nothing and lets the wall idle behind it. And a profile is a
*requirement* only when the operator chose one — the fleet's `sub` is a
preference, so a camera that is already streaming is reused, not renegotiated.
**Nothing chooses one any more**, which makes that rule true by construction:
live video is standard on every tier and a mast advertises one profile, so the
Picture quality row and the `cameraProfiles` preference behind it are gone. No
target carries a `profile` field, and `defaultProfileField` is the different
thing that stays — it tells the manager what "opened with nothing" resolves
to. Do not reintroduce a per-browser quality pick: what a site keeps is
`FOOTAGE_STREAM`, decided on the hub, and it is not a view preference.

**Tokens live in the `@theme` block of `src/index.css`.** Use `bg-panel`,
`text-muted`, `border-line`, `text-critical` and friends. A raw hex in a
component is a bug unless it is a one-off scrim or overlay alpha.

## Writing for the screen

Every string a customer can read follows these. They cover the dashboard and
any text this repo sends that the website or the dashboard shows: error
messages, status labels, descriptions in API responses. They do **not** cover
logs, installer output, code comments or docs, which are written for us.

**1. A setting is a label and a value.** Nothing else. No paragraph explaining
how the system works, no justification of the design, no history. If the
explanation feels necessary, the label is wrong.

**2. At most one short line of help, and only where somebody would get it
wrong without it.** Not one per row. Most rows need none.

**3. Never show an internal word.** Not `sub`, `main`, `stream`, `node`,
`sinew`, `tunnel`, `OID`, `SNMP`, `tower reports`, an API path, a field name, a
code or an id. If a value only makes sense once you know how the system is
built, it is not a value a customer can use.

**4. What does not apply is hidden.** A tower that does not record locally has
no recording rows at all. Send nothing and let the screen hide it; do not send
"Not reported" as the text for something the device does not have. Absence of
a field and a field whose value is unknown are different, and only the second
gets words.

**5. A read-only value is plain text.** No note explaining why it cannot be
changed, and in particular no "Set by Kallon". A value with no control beside
it already reads as a value.

**6. An error is one sentence: what happened, and what to do.** No code, no
field name, no apology, no second sentence of context.

**7. No em-dashes.** Not in a label, a value, a help line, an error or a
placeholder. Use a full stop, a comma, or a middle dot `·` between parts of one
value.

**8. A tower's or a camera's name is in CAPITALS.** Typed, saved and shown:
`deviceName` in `src/lib/deviceName.ts` is the only place that decides, and
`useCapitalName` capitalises a rename box as somebody types without moving the
caret. Never a `uppercase` CSS class on a name — a text-transform changes the
glyphs and nothing else, so it never reaches the server, never reaches an
`aria-label` or a search, and has to be remembered at every one of the thirty
places a name appears. It was not: the claim wizard drew capitals and
registered what was typed. Organizations, people and evidence filenames are
NOT device names and are left exactly as they are.

These are enforced, not just agreed: `test/userFacingCopy.test.mjs` reads every
string in `src/` off the source on each run, so a new em-dash or a banned word
in user-facing text fails `npm test` the moment it is written. The scanner
behind it is `test/lib/copyScan.mjs`, and the one thing it must get right is
stripping comments — the house style above writes in em-dashes and always
will.

## Gotchas that have already bitten

**`AlertDetail` is deliberately never remounted.** `AlertsPanel` renders it
without a `key` so arrowing through the feed swaps content in place and bulk
triage stays instant. Any `useState` you add inside it therefore survives the
swap and will appear against the *next* alert. Key the subtree that owns the
state, not the panel.

**The clip player's keys are bound in the capture phase on purpose.**
`AlertsPanel` binds `Esc` and the arrows on the window to step the feed. The
player registers with `{ capture: true }` and calls `stopPropagation` for the
keys it owns, so closing it does not also clear the alert selection behind it.
Bind a new window key anywhere in this panel and check it against an open
player.

**Fixed pixel widths from Figma are desktop measurements.** `ClipCard` carried
the design's `w-[346px]`, which is its width at `lg` inside a 417px panel — on a
phone that left a dead 54px strip. Let containers drive width; keep the design's
fixed values for heights and gaps only.

**`layoutKey` applies to the fleet wall too.** `MonitorTile` gates motion the
same way `CameraTile` does, and its key already carries the takeover *and* the
wall's current arrangement — the fleet coming back with a site added, gone or
moved reflows every sibling. Anything else you add there that changes a tile's
box goes in that key or the wall snaps instead of animating.

**Two `transition-*` utilities on one element is one property list, not two.**
`ControlStack`'s buttons carried `transition-colors` for the hover chip and
`transition-[opacity,visibility]` for the hover reveal. Both set
`transition-property`; the colours won, and the controls had been appearing with
no fade at all since they were written. There is now a single `TRANSITION`
constant listing all four properties, and `index.css` delays only the first two
positionally so the stagger belongs to the reveal and a button's own hover
colour still answers at once. `transition-delay` takes a **comma**-separated
list — spaces make it invalid and the whole declaration is dropped silently.

**The same trap, for colour.** `CameraSettingsPanel`'s `VALUE` carried
`text-white`, and `RowReading` appended a `tone` beside it. Two colour utilities
are one `color` declaration, and Tailwind emits `text-white` *after* every
status colour — so every tone on that panel (the uplink's Great/Fair/Poor,
"Not connected", the storage warning) rendered white for as long as it existed,
while the code read as if it were green, amber and red. `VALUE_TYPE` is the
value's type without a colour; a row takes exactly one colour class. When a
tone "does nothing", check the computed colour before the logic.

**Feed state grammar has one home.** `FeedChip` owns `stateWord` and
`STATE_DOT`, and both walls render `FeedChip` itself. Add a seventh `FeedState`
and both pick it up; restate the switch locally and only one of them will.

**Both walls carry the actuators, and the set lives in `useTileControls`.**
This reversed on 2026-08-19. `MonitorTile` used to be a picture, a `FeedChip`
and an expand button, deliberately, so that a talk-down was not one stray click
from four yards at once on the fleet screen. That was overruled: the fleet tile
now renders the same eight controls, from the same hook, revealed by the same
cascade. The guard is the one the tower wall already relies on — nothing but the
expand button exists until the pointer is on the tile, the siren keeps its
saturated fill and its pulse, and a dead feed disables everything that reaches
the site. If the fleet screen ever needs a *narrower* set, cut it in the hook
behind a flag rather than rebuilding a second list, or the two walls will drift
the way `FeedChip` was written to stop.

The *components* are still separate and should stay that way. `CameraTile`
wraps the picture in a PTZ pad, a talk timer and a zoom readout; a 380px cell in
a grid of four has room for none of it. What is shared is what a control is, not
how a tile is laid out.

**Native drag handlers cannot go on a `motion.*` element.** Motion replaces
`onDragStart`/`onDragEnd` with its own pan handlers, which have no
`dataTransfer`. The fleet wall's band drag was the case this was written for and
that gesture is gone, but the trap is not: anything in here that wants HTML5
drag needs a plain element to carry it. `MonitorTile`'s own plain wrapper, which
holds the grid cell open during a takeover, is the shape to copy.

**Tower battery is live state.** `towers` is state in `App.tsx`, not the module
constant — a charging tower gains 1% a second. `TowerBattery` reads
`batteryPct` and `solar` and draws the cell from them; do not reintroduce
picking a mast illustration by `tower.status`, which is the bug the three
exports invited.

**Figma illustration exports bake in the whole page behind them.** The mast
arrived with the black canvas, the panel's right border and a 386×129 card rect
under the artwork, which painted a lighter patch over the real card. Strip
everything above the artwork group before committing an exported illustration,
and check the fill list for the surface colours (`#1e1e1e`, `#202022`) as the
tell.

**Figma and the browser disagree about winding.** The battery glyph exported
with three subpaths: the body, a notch near the cap, and the terminal nub.
Figma renders that notch *filled*; every browser renders it as a hole. Painted
as a colour it makes no difference, but `MaskIcon` masks on alpha, so the hole
punched a slot straight through the glyph and the panel showed through it —
node `194:2565` is a solid body at 100%. The notch is stripped from both
`twr-battery.svg` and `set-battery.svg`, with a comment in each. Check a new
mask asset against its Figma render, not against the export opened in a browser.

**The battery glyph's level maps to the body, not the box.** `batteryFill` in
`TowerBattery.tsx` runs its gradient from `BODY_START` to `BODY_END` (4.17%
to 85.42% of the icon's width) because the rest of the box is the gap and the
terminal. Span the raw box and everything from 86% up draws an identical full
body. The nub lights only at exactly 100%, which is what the frame shows.

**The battery cell renders *under* `twr-mast.svg`, not over it.** The fill is the
first thing the export paints and all 133 mast strokes come after, so the cage
struts cross in front of the cell. Two absolutely positioned layers on the same
59×101 grid; flip the order and the struts vanish.

**Figma MCP asset constants are ordered by first appearance, not by node
order.** `get_design_context` returns `imgFrame`, `imgFrame1`, `imgFrame2`… and
it is tempting to download them in order and name them by position. The clip
player's transport is four 40px chips and doing that shifted every glyph by one:
the mute button shipped rendering a *skip* icon, and the real speaker export was
never downloaded at all. Match each asset to its `data-node-id` in the returned
code, then render the mask at ~120px on a plain page before trusting it — that
also catches the winding trap below, which no amount of reading the path data
will.

**A second export is not always a second glyph.** The frame exports the player's
*next* button as its own asset, but its path data is the *previous* glyph to
five decimal places, wrapped in `rotate(180deg) scaleY(-1)`. Compare the `d`
attributes before committing a file — one asset turned is one asset to keep in
step, and the design does this deliberately.

**A running dev server does not notice the SDK being rebuilt.** This cost a
whole debugging session, and it fails *silently* — no error, no warning, just
yesterday's parser quietly dropping a field today's server sends. The symptom
was an Uplink row reading "No signal reading" while the Network tab plainly
showed `signal_dbm` in the response.

`@kallon/sentry-sdk` is a `file:` dependency, so npm resolves it to a symlink,
and Vite's watcher only walks the project root. `optimizeDeps.exclude` is not
the problem and is doing its job; the module simply stays cached for the life of
the process. Four servers were up that day, and the two started before the SDK
rebuild were wrong while the two started after were right, on identical source.

`vite.config.ts` adds the SDK's `dist/` to the watcher and full-reloads on
change, so this specific trap is closed.

**The SDK now lives IN this repo, at `vendor/sentry-sdk`** (`file:./vendor/sentry-sdk`).
It used to be `file:../sentry-sdk` — a sibling that exists on one laptop and on
no build server, so Vercel's clone had nothing to resolve and the deploy died on
`Cannot find module '@kallon/sentry-sdk'`. **The vendored copy is the source of
truth**: edit `vendor/sentry-sdk/src`, rebuild in place (`npm run build` inside
it — its `dist/` is committed on purpose so no build step is needed at deploy),
and the sibling `../sentry-sdk` is now a historical checkout, not the thing this
app compiles against.

⚠ **`.gitignore`'s build-output rules are anchored (`/dist`) and must stay that
way.** A bare `dist` matches a directory of that name at ANY depth, which
silently excludes `vendor/sentry-sdk/dist` — the one thing a clone needs. It
fails as a broken deploy, not as a git error. The same trap bites `tar
--exclude=dist`. The wider lesson stands: **if the
browser disagrees with the wire, check the dev server's start time against the
SDK's `dist/` mtime before touching any code.** And keep one dev server, not
four — `netstat -ano | grep :51` when in doubt.

**Vite HMR does not always pick up `data.ts` edits.** Module-level seed data is
captured at import. If the UI shows stale copy after a data change, hard-reload
before believing it.

This is not confined to `data.ts` — any module-level constant has it. Dropping
`LIVE_VIEW_WARNING_SEC` to 5s to verify the banner and restoring it to `10 * 60`
left the dev server still serving the 5, so the banner fired after thirty
seconds and looked correct. A reload was not enough; the preview server had to
be stopped and restarted. Treat a threshold you have just edited as unverified
until you have seen it *not* fire.

**A `{/* */}` comment cannot precede the root element of a `return`.** Put the
prose in a `/* */` block above `return (` instead.

## Design source

Figma: `Terra· Sentinel`, file `a57qfGEtTBzzNj5R9DIJ8x`. The alert detail is
node `72:230`. The file is iterated on between sessions — re-fetch before
assuming a frame matches what is in the repo, and expect the code to be ahead of
it in places where a static frame cannot express behaviour.

Three places the code deliberately departs from a frame. Each is a rule in
this file winning over a drawing, and each will look like a bug to anyone
diffing the two side by side:

- **`1080p HD` is not blue.** Node `202:1042` paints `HD` in `#667be2`. The
  colour rule above allows exactly one blue and only for the length of a
  gesture; a permanent blue label is what it forbids. Rendered in the neutral
  grammar instead.
- **The clip player's first crumb reads TOWERS and goes to the fleet.** The
  frame says `TOWER`, singular. Every other breadcrumb in the app says TOWERS
  and lands on the fleet, and a crumb naming one thing while going to a list of
  them is how a breadcrumb stops being trusted.
- **The battery banner says "the tower's battery", not "your camera's".** The
  frame's possessive is a consumer product's; this operator is watching somebody
  else's site.

The scrubber's green detection bands *are* built as drawn, and they are the one
place green does not mean live. Flagged rather than changed — if it reads as a
signal on a monitoring screen, amber is the app's word for a detection and it is
a one-line change in `ClipPlayer`.

Assets in `public/` are exported Figma files. Monochrome glyphs go through
`MaskIcon` (CSS mask, takes `currentColor`); the multi-colour alert badges and
link-quality icons render as `<img>` to keep their fills. Reuse these rather than
re-exporting or hand-drawing — the timeline badges, clip controls and alert rows
are all the same set.

## Comment style

Comments explain *why*, in prose, at the decision site. They are dense and they
are the point — match the register of the surrounding file. Do not add comments
that restate the code, and do not strip existing ones while refactoring.
