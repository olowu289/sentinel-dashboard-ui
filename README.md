# Sentinel

Operator portal for a fleet of Sentinel camera towers. Two screens: a fleet
dashboard — every tower's health beside every camera's picture — and, one level
in, the tower view, with feed chrome and a real-time alerts rail. Built from the
Figma file
[`Terra Sentinel`](https://www.figma.com/design/a57qfGEtTBzzNj5R9DIJ8x/Terra--Sentinel).

```bash
npm install
npm run dev        # vite, http://localhost:5173
npm run build      # tsc --noEmit && vite build
npm run typecheck  # tsc --noEmit
npm run preview    # serve the production build
```

Vite 7, React 19, TypeScript 5.9, Tailwind v4, Motion 12. Quantico for technical
labels and Sora for content, both loaded from Google Fonts in `index.html`.

There is no test runner and no lint config in this repo. `npm run build` runs
`tsc --noEmit` first, so a type error fails the build.

## What this is

A prototype, not a deployment. There is no backend: feeds are looping stills,
alerts are static data, and the export, talk-down and siren actions simulate
their side effects locally. The states are the deliverable, so every state an
operator can reach is reachable here.

Press `Shift+S`, or use the `...` button at the bottom of the icon rail, to open
the feed state simulator. It exposes all eight feed states, the empty alerts
feed, and new alert arrival. It is a review affordance, not product chrome.

## Screens

The dashboard is the landing screen and the tower view is its child. That was
already the claim the tower view made: its breadcrumb has read `TOWERS ›
TWR-1042` since the first build, and `TOWERS` pointed at nothing. It is a button
now, and so are two of the rail's entries. `Dashboard` lands here, because the
fleet screen *is* the fleet. `Towers` drills in instead — to the site something
last happened at, the tower carrying the newest alert of any status. A nav item
that returns you to the screen you are already standing on is a dead control,
and the fleet's own list is already in the panel next to it. It is deliberately
not the same target as the header bell, which wants the newest *unclaimed*
alert and opens the feed: the rail asks "where did something last happen", the
bell asks "what has nobody picked up". With no alerts at all it falls back to
the first tower, so the button always goes somewhere. The other four rail
destinations are still decorative.

There is no router. Two screens do not need URLs, and adding them would be the
only thing in the repo pretending to be a deployment.

Camera and alert state live in `App.tsx` rather than in either screen. The
recording tick and the latency walk are live, so a copy each would have the
fleet wall and the tower wall disagreeing about the same camera within a second
— and an operator drilling in to check a figure would find it had changed on the
way. The wall's *arrangement* is up there for a different reason: the dashboard
unmounts on every drill-in, and an arrangement that resets on the way back
teaches operators not to arrange it.

`TowerView` is keyed on `${id}|${showAlerts}`, so arriving at a tower is always
a fresh entry. Carrying one site's selected alert, filter or collapse state into
another's feed is the failure that key exists to prevent.

## Fleet dashboard

Rail, then a 417px `TOWERS` panel, then the video wall under a 46px bar carrying
`ACTIVE CAMERAS:`, the site clock and a bell. The index is on the left because it
is what you navigate *from* — reading order puts it before the content, which is
the mirror of the alerts rail sitting to the right of the tower wall.

The bell goes to whatever is actually waiting: the newest alert nobody has
claimed, opened on its tower's feed. A fleet screen has no alerts list of its
own — every alert belongs to a tower — so a bell that only decorated the bar
would be the one control on this screen that answers nothing. With no unclaimed
alert it is disabled rather than hidden, because an empty inbox is a reading.

The clock ticks, seconds and all, which looks like the relative ages this app
threw out. It is not the same thing. What was removed was a *rail full* of
per-row counters, each a separate moving target competing with the video. This
is one clock in a fixed position, and it is the number read out on a handoff. It
lives in its own component so the tick cannot re-render the tile tree — that
would push a re-render through the wall once a second against an unchanged
`layoutKey`, which is the documented way to make a takeover snap.

### Tower cards

Site name over status word, a mast drawing, a pill carrying two readings, and —
when the site has raised something nobody has picked up — a strip along the
bottom.

Status is the tile grammar one level up: green online, amber degraded, red dark.
A tower with a dead camera or a poor uplink is still reachable, so it is not
`offline` — and calling it `online` would let a half-blind site read as healthy,
which is the one thing a fleet screen exists to prevent.

Both seed towers currently ship `online`, so nothing on the fleet screen
exercises the amber or red branches. `TWR-2071` still carries `link: "warn"`,
which is the condition `degraded` was there to describe — worth knowing when
reading the seed, and worth restoring the moment the fleet grows past two.

The mast replaced a row of three telemetry glyphs parked on the card. The
readings came back where the design put them: **hovering the mast opens a panel
carrying solar state, cabinet temperature and charge**, three cells divided by
hairlines on a black pill.

The mast is a `<button>` for it. Anything that takes a pointer on this card sits
on top of the stretched primary target, so rather than punching a dead hole in
the middle of the card it carries the same action — and focus opens the panel
too, which is more than the `title` attribute those readings used to live in
ever offered.

All three glyphs are single-colour exports, so they go through `MaskIcon` and
take their own reading's tone rather than the fill they were drawn with: the
frame draws the sun amber, the thermometer grey and the battery green because
that is this palette at the state it drew. Rendered as exported they would say
that about every tower forever, which is exactly the trap the old glyph row fell
into. The battery glyph uses the same tiers `TowerBattery` paints the cell with,
so the reading beside the mast and the charge inside it cannot disagree.

Temperature is new to the model. These are sealed enclosures in the sun with a
battery inside, so heat is a reading in its own right rather than weather —
amber from 45°C, red from 55.

The panel is black at 60% behind a 4px backdrop blur rather than solid: it is
*about* the mast it covers, and blanking that out mid-hover reads as the drawing
being replaced. Four, not the five the feed chips use — those sit over live
video and need more, this sits over line art.

### The battery cell

The design shipped three exports of the mast, and they are not colour variants:
they are the same cell drawn full, half and nearly empty, differing only in
where the top edge of the fill sits. The first pass picked between them by
`tower.status`, so a site at 87% showed a full cell because it happened to be
`online` and one at 34% showed a half cell because it happened to be `degraded`.
The two agreed by luck.

`TowerBattery` reconstructs the fill from the full-level geometry and a clip, so
charge is continuous. The clip's top edge carries the drawing's own surface
slope — the cell is in oblique projection and a horizontal cut reads as the fill
tipping forward. Feeding the design's own half and empty exports back through
the model puts them at ~53% and ~6%, which is what says the numbers are right.

Colour follows charge, on this repo's existing battery tiers: green at or above
40%, amber from 20, red below. The receding face takes 81% of each channel — the
step the amber export already uses (`#f3cf58` → `#c4a749`), applied to all three
so the cell is lit the same way at every level.

It renders *under* `twr-mast.svg`, not over it. In the export the fill is the
first thing painted and all 133 mast strokes come after, so the cage struts
cross in front of the cell; an overlay would paint them out. Two absolutely
positioned layers on the same 59×101 grid, so registration is exact and only two
paths are inlined.

The charge is real: `App.tsx` ticks a charging tower up 1% a second and stops at
full, alongside the recording tick and for the same reason — a card claiming to
be charging while the number sits still is the one reading on this screen an
operator could catch out. It caps rather than wrapping, because a battery that
quietly reset to 5% would be reporting a fault it does not have. `towers` moved
out of the module constant into state to carry it.

Colour follows the level across the thresholds as it climbs, and cross-fades
over 1.4s rather than cutting — slower than the 1s charge step on purpose, so
crossing 20 or 40 arrives as the reading shading over and not as a second tick.

On top of the real climb, charging adds the flourish a phone shows: the fill
runs from where the battery actually is up to full, rests there a beat, and
settles back to the true reading. That distance is different on every card and
changes every second, which a keyframe cannot hold — `TowerBattery` sets it as
`--charge-gap` and the keyframe translates by it. At 100% the gap is zero and
the animation does nothing, which is correct: there is nothing left to fill.

Four seconds, ease-in-out, and it ends where it started. The true level is where
the cycle sits for most of its length so the charge is still readable at a
glance, and the pace keeps it in the same register as the dot pulse — this is a
list an operator watches for hours, and a gauge that visibly works competes with
the video wall for exactly the reason the per-row age counters were thrown out.
It moves the clip, not the fill, so the cell's outline holds still and only the
charge inside it climbs.

Both seed towers ship charging, from 87% and 5%, because a cell that climbs the
whole way from red through amber into green next to one that only tops off is
what shows the gauge is a reading rather than a decoration.

The card is several targets, not one. The body opens the tower on its wall; the
pill's left glyph does the same, **its count opens the alerts feed directly**,
and the strip opens the alert it is reporting. That rules out a single
`<button>` wrapper: a button inside a button is not something a browser or a
screen reader forgives. Instead the primary target is stretched behind the
content, the decorative layers are `pointer-events-none`, and the controls sit
above them. The telemetry readings lost their per-glyph tooltips to that and
moved into the card's own label and title, which reads better than three
separate hover targets anyway.

The strip is the second place in the app allowed a relative age, and for the
same reason as the first (see `formatRelative`). What was thrown out was a rail
full of ticking counters competing with the video; this is one line per site,
rendered once, and *this just happened* is the question a fleet index exists to
answer. Following it lands on the alert, where the time goes back to wall-clock.
Its dismiss clears the notice, not the alert — the count on the pill does not
move, because reading a notice is not handling an incident. It is keyed by
*tower*, not by alert: dismissing one alert id looks correct and is not, because
the next-newest immediately takes the slot and the × appears to do nothing. The
count only changes when an operator goes into the feed and actually deals with
something.

The card grows 44px to make room for the strip rather than overlaying it, so the
mast and the pill keep their clearances. The mast is therefore pinned to the
bottom edge; measured from the top it would float when the card grew. The height
is the *only* thing that changes: an alerting card briefly took a raised fill as
well, and the design levelled it back — the strip is already unmissable, and
lifting the card said the same thing twice in two vocabularies.

### Wall tiles

`MonitorTile`, not `CameraTile`. The tower view's tile carries the actuators —
PTZ, record, talk-down, siren — behind a hover reveal on a wall you have already
drilled into. This wall shows four cameras across two sites at once, and putting
a talk-down button one stray click from four different yards is exactly the
reflex the tower view is careful not to train. Picture, one chip, one button;
the actuators are one level in.

This was a 40px header bar until the design settled the other way, on the
argument that four feeds side by side are read as a column of labels first and
pictures second. Both walls now wear the same `FeedChip` — which is the stronger
argument, because they show the same cameras and an operator crossing between
them was reading two layouts of the same four facts. The bar also cost every
tile 40px of picture, four times over, on the screen whose whole job is picture.
Rendering `FeedChip` itself rather than restating its state word and dot palette
is also what stops a seventh feed state being added to one wall and missed by
the other.

The drill-in went with the bar. The frame draws one chip and one button, the
towers panel on the left is already a list of drill-ins, and the tower id is on
every tile's `aria-label` — so nothing here names a site the panel does not.

The expand button is revealed on hover, not drawn at rest, so a resting wall is
picture and chip and nothing else. Transparent rather than `invisible`, so Tab
still reaches it — landing on it is what reveals it, and that is the only route
to the takeover for anyone not using a mouse. It stays lit in fullscreen: it is
the way out, and a way out that has to be found by hovering is not one.

The design draws a capture button at the bottom-right of the video, parked
outside its clipped parent — it is invisible in the frame and is not built.

### Bands

The wall is banded by tower, one header per site over the row of its cameras.
Four tiles in an anonymous grid made "whose north gate?" a question every tile
had to answer for itself, which is what the old per-tile tower label was for; a
band header answers it once and gives the picture its corner back.

Bands are *read out of* the arrangement rather than stored beside it — a tower
appears where its first camera does, and its cameras keep their relative order.
One source of truth for both, so a tile drag and a band drag can never leave the
wall describing two different arrangements.

The 3×3 glyph on a band header is that band's handle: drag it to move the whole
site, arrows to step it. Unlike the tile handle it is always visible, because a
band header is chrome already — there is no picture underneath for it to sit on
top of. Moving a band moves every tile in it at once, which is why the shell
exposes `onReorder` alongside `onMove`: walking a band into place one tile at a
time would animate the wall through arrangements nobody asked for.

A band fills `--color-drag`, the app's only blue, for exactly as long as its
handle is held. It appears on `pointerdown` — not once a drag is under way,
which would put it after the operator has already started moving, and not on
click, which would latch it — and it goes on the release. The fill answers "have
I got hold of it", so it lives as long as the grip and no longer; a band left
lit with nothing holding it is a thing to explain rather than a thing to ignore.

`pointercancel` is handled alongside `pointerup` because that is what fires when
a press turns into a native drag. From that point `draggingBand` carries the
fill, and both clear together when the band lands.

Blue is allowed here precisely because it is outside the status set: green,
amber and red all mean something about a site, so none of them could say "you
are holding this" without also seeming to report on the tower. A tile drag still
fades instead — a wash of colour over live video is a different thing from a wash
in the seams around it.

### Rearranging

Rearranging is a band gesture and only a band gesture: the 3×3 glyph on a band
header moves a whole site. Tiles carried their own handles for a while too,
which meant two grammars for one job and a handle parked in the corner of every
picture. The wall is arranged by site now, and the cameras under a site keep the
order the site lists them in.

**Arrow keys on a focused handle do the same job**, one band up or down.
Dragging is a pointer gesture with no keyboard equivalent, and this wall is
desktop-only, so without that the arrangement would simply be unavailable to
anyone not using a mouse.

The drag plumbing sits on the band `<section>`, which is plain rather than a
`motion.*` element — motion replaces the native `onDragStart`/`onDragEnd` with
its own pan handlers, which know nothing about `dataTransfer`. Each tile still
sits inside a plain wrapper of its own, which holds the grid cell open during a
fullscreen takeover so the wall does not reflow underneath it and the exit lands
back in its own slot.

### Below 1024px

The dashboard is the tower list, full width. The wall does not follow it down.
Four tiles stacked on a phone is four screens of scrolling to check one site,
and side by side gives each about 180px — too small to identify anyone, which is
the entire job. On a phone the fleet *is* the list, and the wall you actually
want belongs to one tower, one tap away, already laid out for the screen. Band
reordering goes with it: HTML5 drag never fires on touch.

## Tower view layout

Three panes at 1024px and up: a 71px icon rail, the camera wall, and a 417px
alerts panel, under a 46px breadcrumb bar.

Below 1024px the app recomposes rather than shrinking. Fixed chrome of 71px plus
417px does not fit a phone, and the earlier build clipped the camera wall to zero
width rather than scrolling it, so the primary content was silently unreachable.

| Viewport | Rail | Wall | Alerts |
|---|---|---|---|
| Below 1024px | hidden | full width, always stacked | full screen, switched to |
| 1024px and up | 71px | flexible | 417px column |

Below 1024px a bottom bar switches between Cameras and Alerts. It carries only
those two entries. The rail's six destinations are decorative (`onSelect` is not
wired), and promoting them into a tab bar would ship six taps that silently do
nothing.

Tablet gets the mobile treatment rather than a middle layout. At 768px a three
pane split leaves the wall about 280px, narrower than on a phone, so the wall
takes the full width and the panel becomes a separate view.

### Wall orientation

The top bar carries a view control that switches the wall between portrait
(tiles side by side, the default) and landscape (tiles stacked in rows). The
glyph is the layout itself, a divider across a frame turned to match the axis,
and it shows the current view rather than the one you would switch to, so the
bar always reads as a statement of what is on screen.

Portrait and a collapsed alerts panel go together. With the panel open, portrait
tiles narrow to a 0.55 aspect and `object-cover` on a 4:3 source keeps only
about a third of each frame, cropping the left and right edges where things
enter shot. Collapsed, the same tiles sit at 0.80 and keep about 45 percent,
matching what landscape gives.

It is hidden below 1024px, where the wall is forced to a single stacked column.
Side by side on a phone gives each tile about 180px, too small to identify
anyone, which is the entire job.

## Motion

All animated transitions are driven from JS through `src/lib/motion.ts`, which is
the single source of truth for timings. There are deliberately no mirrored CSS
custom properties: everything animated is JS driven, so a duplicate token set
would have no consumers and would drift. The standing CSS keyframes (the pulse
dot, the siren) keep their own timings in `index.css`, since Motion never touches
them.

Everything is a tween, never a spring. A spring overshooting on a video frame
reads as the stream glitching, which is the wrong reflex to train in an operator.
Deterministic durations are also load bearing: the fullscreen exit holds its
z-index for the length of the animation, and a spring has no length to hold for.

`MotionConfig reducedMotion="user"` wraps the tree, so layout and transform
animations resolve instantly for users who ask for reduced motion. The
`@media (prefers-reduced-motion: reduce)` block in `index.css` covers the CSS
keyframes separately. The two are complementary, not redundant.

### One rule worth knowing before you edit

Motion cuts an in-flight layout animation to its end state when a component
re-renders and reports no layout change. This app re-renders every tile on a 1s
recording tick and a 1.4s latency walk, so without a guard roughly one fullscreen
toggle in three would visibly snap, at random.

`CameraTile` takes a `layoutKey` prop that gates layout measurement. It must
change when, and only when, something actually reflows the wall:

```tsx
layoutKey={`${fullscreenId ?? ""}|${layout}|${alertsCollapsed}|${newAlertId ?? ""}`}
```

**Anything you add that changes a tile's box belongs in that key.** This has been
missed three times so far (the orientation toggle, the alerts collapse, the new
alert banner), and each time the symptom was the same: the wall snaps instead of
animating, with no error.

It is a shared token rather than a per tile boolean on purpose. A takeover
changes one tile's `fullscreen` but reflows all of them, so gating on a per tile
value leaves the siblings unmeasured.

## Feed states

`state, duration`, one chip per tile, and the chip is the only thing that asserts
liveness. A tile with no chip reads as dead, which is the safe failure mode for
the frozen frame trap.

| State | Chip | Body |
|---|---|---|
| Recording | red pulse, `RECORDING mm:ss` | video |
| Live | green pulse, `LIVE` | video |
| Delayed / Frozen | amber, elapsed | video |
| Connecting | grey `CONNECTING` | spinner, `Establishing secure stream` |
| Signal lost | amber | `Reconnecting... attempt 3 of 5` |
| Offline | grey `OFFLINE` | `Camera offline`, `Last seen 14:02` |
| Stream error | red `ERROR` | raw transport error, `Retry` |

Offline, connecting and error share one surface (`--color-tile-dead`) so a feed
recovering through them never flashes brightness. Only the terminal error tier
gets a button, because the other two resolve themselves.

Latency is a live random walk pulled back toward each camera's baseline, held
inside one digit count (10 to 99, or 100 to 999) so the number never changes
width mid tick. A degraded feed raises the floor, so the number can never
contradict the word beside it.

## Tile chrome

At 1024px and up, only the fullscreen button is permanent. PTZ and the action
controls appear when the pointer enters a tile. Pointing a real camera head or
opening a talk-down channel should not be one stray click away. Feed identity,
state, latency and link quality stay rendered at all times, so nothing diagnostic
is ever hidden, only the actuators are.

Hidden controls use `visibility`, not `opacity`, so they leave the tab order
rather than sitting invisible and clickable. Focusing the permanent fullscreen
button fires `:focus-within` on the tile and reveals the rest, which is the
keyboard route in.

**Below 1024px every control is persistent.** Touch fires neither hover nor
focus-within on a tap, so a hover only reveal makes the entire control stack
unreachable on a phone.

Top to bottom: fullscreen (permanent), record, talk-down, sound alarm, capture
still, zoom in, zoom out, camera overlays. Record, talk and alarm are toggles and
take a saturated fill when engaged. Capture still is momentary and answers with a
shutter flash, because a capture that gives no feedback gets taken twice.

### Fullscreen

The takeover is a class swap on the same `<section>`, animated with Motion's
`layout` rather than `layoutId`. `layoutId` would require unmounting one element
and mounting another, which remounts the media, resets the first frame flag and
black flashes the feed.

The media sits inside its own frame wrapper so the two transform systems never
share an element: Motion owns the wrapper, PTZ owns the media. Put them on one
element and Motion silently erases the pan and zoom.

Fullscreen always fills the screen. A fit toggle is drafted (`ctl-fit.svg` and
`ctl-fill.svg` are in `public/icons`) but deliberately not wired up.

`Esc` or `f` exits, arrow keys move between cameras without exiting. The handler
is bound to the window, so the way out survives focus being anywhere at all.
Leaving the takeover returns focus to the control that opened it.

## Alarm

Arming the siren lights the tile as a beacon: two layers of corner glows pulsing
in antiphase, so opposite corners trade intensity and it reads as a rotating
light rather than a flashing rectangle. The overlay never takes pointer events,
because the operator must always be able to reach Silence.

The sound is synthesised in `useSiren`, not loaded from a file, so there is
nothing to ship or license. A sawtooth carrier at 660 Hz is swung by a 0.55 Hz
sine LFO (plus or minus 300 Hz) and rolled off through a lowpass, so it wails
rather than beeps and carries without being painful. Gain ramps in over 250 ms
and out over 180 ms, because stopping an oscillator at full amplitude produces an
audible click. Browsers refuse audio outside a user gesture, which the arm click
supplies.

A dead feed cannot be sounding an alarm at the site, so both the beacon and the
audio are gated on the feed being alive. Under `prefers-reduced-motion` the
beacon holds steady instead of pulsing: still unmistakable, just not moving.

## PTZ and zoom

The feed renders at `BASE_SCALE` 1.15 at rest so the head has somewhere to
travel. At exactly 1x a pan would just drag black in from the edge. Pan and zoom
are one CSS transform on the media element:

```
scale(BASE_SCALE * zoom) translate(x%, y%)
```

Pan is clamped to `(scale - 1) / (2 * scale)`, the point at which the media's own
edge would enter the frame. Zooming out re-clamps the pan rather than leaving the
frame parked outside its new envelope. Zoom runs 1x to 3x and the buttons disable
at each end. The zoom chip only appears once you leave 1x, since a permanent
`1.0x` on every tile is noise.

Because this is a transform on the media element, it works unchanged on a
`<video>`. `CameraFeed.video` renders a looping muted clip in place of the still
whenever one is supplied, with no other code changes needed.

## Alerts

A quiet feed is a good state, so the empty state is achromatic with no call to
action. The *filtered* empty state is a different thing and does get
`Clear filters`, because there the operator caused the emptiness.

The selection accent bar is a single shared element that slides between rows, so
arrowing through the feed tracks where you are instead of blinking between
positions.

### Detail

Drills in over the panel so the video wall is never lost. The triggering frame
sits above all metadata, because an operator confirms with their eyes before
reading anything. Empty fields stay visible (`Not acknowledged`) because absence
is diagnostic.

The lifecycle lives on the primary button: `Acknowledge` becomes `Resolve`, so
you cannot resolve what you have not acknowledged.

`Up` and `Down` step between alerts without closing the drawer, since operators
triage in bulk. `Esc` closes. The detail deliberately does not re-animate when
stepping, only when opening and closing.

The body is one scrolling column — frame, `Alert Details:`, `Timeline:` — built
from the Figma. It replaced a Details/Timeline tab pair. Tabs were hiding half
the record behind a click during triage, and with only two short panels the
split cost more than it saved.

`Alert Details:` is a 2×2 grid of fixed-height cells, at every width. Long
values truncate rather than reflow, so the four labels keep their baselines.
`AI Confidence:` reads `Not scored` for faults and operator actions — those are
events and decisions, not predictions, and a percentage there would invent a
machine judgement that was never made.

`Timeline:` runs oldest first, so the detections that caused an alert sit above
it. Each step carries the same exported badge as its alert row, its wall-clock
time, and elapsed since the first step. That delta is the point: several steps
inside one minute have near-identical stamps, and the gap between them is the
finding. Evidence captured at a step renders as a clip card indented beneath it,
because the clip belongs to the moment rather than to the alert as a whole.

The rail is a border on the step's own text column, so its length is derived
from that column's real height. The last step drops it — a line continuing past
the final badge promises an event that is not there.

Below `lg` the header carries both a back chevron and a close X, per the design.
At `lg` the chevron goes: there the panel is a drawer beside the wall, nothing
was pushed, so "back" would name a journey that never happened.

### Clip review

Playing a clip — from a feed row or from a timeline step — opens a takeover
built on the camera takeover's shape: `fixed`, `role="dialog"`, `Esc` out, so
the two full-screen surfaces behave the same way. A clip is evidence, and
evidence gets looked at properly rather than in a 64px thumbnail.

Two things here that a consumer player does not have, and that this one exists
for.

**The frame carries the wall-clock of the playhead.** `00:05` is where you are
in the file; `12:23:42 PM WAT` is when it happened, and only the second is
quotable on a handoff or legible in a screenshot pasted into a report. It sits
in the letterbox rather than over the picture: the media is `object-contain`,
unlike the walls, because cropping evidence to fit a box is how the thing that
mattered ends up outside the frame.

**The scrubber is marked with the alert's own timeline.** Every step that falls
inside the clip's window becomes a mark, so the detections are visible as
positions before anything plays, and `Previous`/`Next detection` are buttons
rather than a hunt. Amber is already this app's word for a detection, so the
marks need no legend; a fault keeps red. The badge row at the right repeats the
exported badges the alert rows and the timeline already use.

Clips start `PRE_ROLL_SEC` before the step they hang off, because a camera holds
a rolling buffer and the run-up is usually what an investigator needs — the
detection is the consequence, the approach is the evidence. It is also what puts
the triggering event at a position on the track rather than at zero.

Speed is a segmented `0.5× 1× 2× 4×`, not a menu: review is mostly a hunt at
speed, and the whole range being visible makes changing rate one press instead
of open-read-choose. The rate genuinely scales playback rather than relabelling
the button.

The player's key handler is bound in the **capture** phase and stops propagation
for the keys it owns. The alerts panel binds `Esc` and the arrows on the window
to step through the feed; without that, closing the player would also drop the
alert selection behind it, and seeking would arrow to the next alert. `Up` and
`Down` are swallowed rather than used — swapping the alert underneath an open
player would leave one incident's footage under another's title.

State lives in `AlertsPanel`, not in the row or the detail. Both can open a
player, and the detail is never remounted, so a `useState` there would survive
an alert swap.

The transport is real; the media is not. There is no backend, so the clip is the
still the rest of the app uses and the playhead is driven by a clock. Swapping
in a real `<video>` means replacing that clock with `timeupdate` and leaving
everything else alone.

### Collapse

**The panel starts collapsed.** The wall is the job, and the feed announces
itself when it has something rather than holding 417px open on the chance that
it might. It can be dismissed again from its own header, handing that width back
to the wall.

A bell in the top bar, after a vertical rule, brings it back. The restore control
lives in the bar rather than the panel because the panel is the thing that just
disappeared. When an alert is waiting, the bell carries a red dot alongside the
banner, so the trace survives in the one control that is always on screen.

This is gated to 1024px and up. Below that the panel is already one of two
switchable views, so collapsing it would strand the operator on an empty screen
with no way back.

### Date filter

Presets carry their result count, so the cost of a range is visible before
committing to it. Custom ranges use a hand-built month grid rather than
`<input type="date">`: the native control renders OS chrome that ignores the
theme, prints `mm/dd/yyyy` while every other date here is ISO or WAT wall-clock,
and opens a picker built around the *viewer's* calendar rather than the tower's.
On a dark operator surface it was the one light-mode object on screen.

The grid is Monday-first, matching the ISO strings the filter compares, and is
built entirely in UTC calendar space. Cells are labels for calendar days, not
moments — the instant a day begins depends on a timezone, and dragging that into
grid construction is how pickers end up rendering a 30th the filter reads as the
29th. Only "today" is resolved in site time, via `siteToday()`.

Selection is neutral white, never `terra`. Green means a feed is live; spending
it on "this date is selected" puts a camera-status colour on a control with
nothing to do with the cameras. The endpoints invert to black-on-white, the same
primary language as `Acknowledge` and `Apply`.

Staging is deliberate: nothing filters until `Apply`. Filtering live would
re-run the feed on every keystroke of a half-finished range, so the operator
would watch results vanish for ranges they never asked for.

### New alert banner

When an alert arrives while the feed is out of sight, either collapsed on desktop
or on the camera view on a phone, a banner appears across the top of the wall.

It takes space rather than floating over the video. A toast would cover the exact
frame it is reporting on.

Raising an alert while the feed is already visible does not arm the banner, so
collapsing the panel an hour later cannot announce something the operator already
read.

The banner is the one place in the app that uses a relative timestamp. Relative
ages were tried and removed everywhere else, because a rail full of ticking
counters competes with the video wall for attention. A banner is one transient
line whose whole job is to say *this just happened*, and it is rendered once and
never re-ticked, so it still adds no motion. See the note in `src/lib/time.ts`.

## Colour is reserved, not decorative

Green is live. Amber is degraded, or a detection. Red is a fault or a live
transmission. Nothing else gets a hue. On a wall of tiles any extra colour costs
scannability.

The new alert banner is the one exception to the red rule, and it is a step
darker than `--color-critical`. At full wall width the brighter red glares and
pulls the eye off the feeds it is reporting on.

## Accessibility

- Every interactive element is a native control. There are no click handlers on
  non-interactive elements.
- The camera takeover sets `role="dialog"` and `aria-modal` synchronously with
  the visual change, never gated on an animation completing.
- The alert detail is marked `inert` while it animates out, so its buttons are
  not tabbable or clickable on the way off screen.
- Focus is returned rather than dropped when chrome unmounts.
- `prefers-reduced-motion` is honoured in both the JS and CSS layers.
- Tap targets meet the WCAG 2.2 minimum of 24 by 24 CSS pixels. The clip card's
  download and play buttons go further, to 44, because they sit side by side and
  do very different things — one writes evidence to the device, the other plays
  it — and at 24 with a 7px gap the two hit areas were closer together than a
  fingertip is wide. The glyphs stayed 24; only the reachable area grew.

Two known gaps: `aria-modal` on the fullscreen takeover does not actually trap
focus, so tabbing still reaches the panel behind it, and four of the icon rail's
six destinations are still not wired to anything (`Dashboard` and `Towers` are).

## Assets

All icons and stills are exported Figma assets in `public/`. Monochrome glyphs
render through `MaskIcon`, which paints them as a CSS mask so they take
`currentColor` for hover and active states. The multi-colour alert badges and
link quality icons render as `<img>` to keep their exported fills.

`MaskIcon` uses an alpha mask, so both stroked and filled SVGs work. Glyphs must
be square, since `maskSize` is `100% 100%` and the exports carry
`preserveAspectRatio="none"`.

## Known gaps

- Reduced motion is wired but has never been executed. Verify with DevTools,
  Rendering, Emulate `prefers-reduced-motion`.
- `env(safe-area-inset-*)` reads 0 in a desktop browser, so the bottom bar and
  detail footer padding is untested on a notched device.
- The `overlays` control in `CameraTile` toggles state that nothing reads.
- The fleet cards show no cameras-online-over-total. The count the view control
  displaced still has nowhere to live; a card is the obvious home for it, but
  the Figma frame does not draw one and it was not invented here.
- The wall arrangement is not persisted. It survives navigation, not a reload.
- Nothing on a fleet card says how fresh its readings are, so a tower whose
  telemetry died looks identical to one reporting every second.
- Tower status is authored in the seed rather than derived from the readings,
  so the word and the numbers beside it can disagree.
- The tower list cannot be filtered or sorted by health, which is the question
  that matters once the fleet outgrows one screen. A name filter existed and was
  removed with the search control the frame does not carry; health is the axis
  worth building, not the one that was there.
- The list and the wall do not acknowledge each other: hovering a degraded tower
  does not mark its tiles.
- The alert count carries no age, so eight alerts from Tuesday and eight from
  the last ten minutes render identically.
- `@utility sweep` in `index.css` is defined, reduced-motion guarded, and never
  used.
- `maxPan` assumes the media fills its box, which is true under the current
  always-fill behaviour but would be wrong if the fit toggle is wired up.
- The camera health count (online over total) was replaced by the view control
  and currently has nowhere to live.
