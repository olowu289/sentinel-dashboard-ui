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
way. The wall's *order* is not up there at all any more: it is the TOWERS
list's, derived on render from `towers` and `feeds`, so the dashboard unmounting
on a drill-in has nothing to lose. It used to be a stored arrangement, and
that is what let the two panels disagree — see **Bands** below.

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
into.

**The battery glyph fills to the charge.** The export is a single path with no
separable outline and fill — it draws a solid battery, so there is nothing
inside it to reveal. But `MaskIcon` paints *behind* the mask and the glyph is
effectively a hole, so a hard-stop `linear-gradient` at the charge level lights
the body left to right and leaves the rest at 16% white. No second export, no
hand-drawn icon, and the same tiers `TowerBattery` paints the mast cell with, so
the glyph and the charge inside the mast can never disagree.

The charge reads across the glyph's whole width, terminal nub included: at 100%
the nub lights with the body, which is what a full battery looks like, and below
that it sits in the empty tone, which is where the real cell's contact is
anyway.

There is deliberately no transition on it. The tower climbs 1% a second, which
on a 19.2px glyph is 0.19px a step — the level already moves smoothly because
the number does, and easing a sub-pixel change would only put the bar behind the
figure printed beside it.

**The sun pulses while the array is charging** — two seconds, brightening and
swelling, the same heartbeat the live dot keeps. Only while charging: an idle or
faulted array is a still sun, and the stillness is the reading.

"Charging" is derived rather than read raw. `Tower.solar` records what the array
is fitted to do; `solarState()` says what it is *doing*, which at 100% is
nothing. Reading the field directly meant a full tower claiming SOLAR CHARGING
with a pulsing sun and a sweep that had nothing left to sweep — three things
asserting a fourth thing's opposite. It is derived at read rather than written
at the tick because it is a projection of two facts and not a state of its own:
let the battery drain and it charges again with nothing to reset. A fault
outranks everything; a broken array is broken whether or not the battery is
full.

Two seconds rather than the four the battery sweep uses, and that is the whole
consideration. This glyph is only ever on screen while a pointer is parked on
the mast, so it has to read inside a *hover* rather than over a shift — matching
the sweep was the tidier idea and the wrong one, because nobody hovers long
enough to see half of a four-second cycle.

It brightens rather than turning. A sun does not rotate, and a rotating one
reads as a spinner, which would say "working on it" about a thing that is simply
happening.

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

### Names are capitals

A tower, a hub mast, a cell and a camera are all *devices*, and a device's
name is in capitals wherever it appears: the fleet list, the band headings,
the tiles and their feed chips, Settings, Sharing, the audit log's sentences,
the claim wizard's card. One function decides it — `deviceName` in
`src/lib/deviceName.ts` — and `useCapitalName` applies it to a rename box on
every keystroke, catching the caret before React rewrites the value and
putting it back after.

The rule used to be an `uppercase` class, and all three of its failure modes
were live at once. It never reached the server, so the claim wizard drew
capitals over a box and registered "north gate mast". It had to be remembered
at every site, and was not, so one camera read GATE TEST on the wall and
"Gate test" in Settings. And it is invisible to anything that is not a
browser: `FeedChip` builds `LIVE: ${name}` as a string, and no class on the
wall could ever have reached inside it.

Three things are deliberately outside it. An ORGANIZATION's name is a legal
thing somebody chose the capitalisation of. A PERSON's name is theirs.
And an EVIDENCE FILENAME keeps what it always had — `safeSegment` in
`lib/snapshot.ts` preserves rather than prettifies, so the camera name drawn
on the Footage screen goes through `deviceName` and the one in the downloaded
clip's filename does not. Those two lines sit next to each other in
`FootageView`, with a comment saying why.

Search is case-blind on both sides, through `nameMatches`, which folds the
query the same way the screen folds the name: a third opinion about what a
camera is called is how the first disagreement gets in.

### Bands

The wall is banded by tower, one header per site over the row of its cameras.
Four tiles in an anonymous grid made "whose north gate?" a question every tile
had to answer for itself, which is what the old per-tile tower label was for; a
band header answers it once and gives the picture its corner back.

Bands are in the TOWERS list's order, because they ARE the TOWERS list. One
function decides it — `fleetOrder` / `wallBands` in `src/lib/fleetOrder.ts` —
and both panels call it. A tower with no cameras gets no band: it is in the
list, with its status on its card, and a band header over an empty row would
promise a picture and deliver a gap.

Inside a band the cameras are in camera-number order, which is the number the
tower gives them and the one an operator says out loud.

### The order used to be the wall's own, and that was the bug

Until 2026-10-27 the wall held a separate flat arrangement of feed ids: seeded
from the fixtures, reconciled by dropping what had left and appending what was
new, and saved per account. So it carried the order of every fleet the browser
had read. On the lab fleet the list showed Terra Factory Tower 2, West tower,
Lab hub mast and the wall beside it showed Lab hub mast, then West tower. At
three sites that is an irritation. At thirty, finding on the wall the site you
just read about in the list is no longer something you can do at a glance,
which is the entire reason the wall is banded by site.

Band drag went with it, and that is the part worth defending rather than
explaining away. The gesture was good: a 3×3 handle on each band header, always
visible because a band header is chrome, arrow keys for the same job because
dragging has no keyboard equivalent, and the band filling `--color-drag` for
exactly as long as the grip lasted. What it could not be was *shared*. An
arrangement only the wall can hold is the disagreement above, deliberately
re-introduced, and a wall that follows the list cannot also be arranged against
it. The app's only blue went with the gesture, since the whole argument for
allowing a hue outside green/amber/red was that it lived for the length of one.

The reorder itself is free: bands are keyed on `towerId` and tiles on the feed
id, so a fleet that comes back in a new order has its sections MOVED by React
rather than rebuilt, and the `<video>` inside each one carries on playing.
`test/activeCamerasOrder.test.mjs` renders the real wall in a browser, stamps
each tile's DOM node, reorders the fleet and checks every stamp is still there.

Each tile still sits inside a plain wrapper of its own, which holds the grid
cell open during a fullscreen takeover so the wall does not reflow underneath it
and the exit lands back in its own slot. It is also the shape to copy if
anything here ever needs HTML5 drag again: motion replaces the native
`onDragStart`/`onDragEnd` with its own pan handlers, which know nothing about
`dataTransfer`.

### Below 1024px

The dashboard is the tower list, full width. The wall does not follow it down.
Four tiles stacked on a phone is four screens of scrolling to check one site,
and side by side gives each about 180px — too small to identify anyone, which is
the entire job. On a phone the fleet *is* the list, and the wall you actually
want belongs to one tower, one tap away, already laid out for the screen. Band
reordering goes with it: HTML5 drag never fires on touch.

## Adding a tower

Adding a tower is a **claim**, not a create. The design's own copy says the unit
is installed and powered on before anyone opens this screen, so nothing in the
flow asks the operator to describe their own hardware — charge, temperature,
uplink and camera count all come off the box. It asks for the two things the box
cannot know, the site's name and each camera's zone, and then shows the readings
arriving so the operator can see it is actually live.

Six steps: intro (`108:1150`, built as drawn) → phone hand-off *or* manual
entry → name the site → name the cameras → bringing it online → the tower view.
It is a screen, not a modal: six steps deep with a device hand-off in the middle
is a screen wearing a scrim, and a dialog would put the fleet behind it
pretending the operator could still reach it.

### The hand-off

The QR is printed inside a cabinet door, in a field, and this is a desktop
console. So `Scan QR Code` cannot mean "point this machine at it" — every
comparable pattern has the desktop *displaying* a QR for a phone, which is the
opposite direction. It means hand the job to a phone: the desktop shows a link,
the phone does the scanning, and **this page advances by itself** when the claim
lands. A Continue button after work that already happened on the phone would
make one flow read as two.

The QR encodes nothing. There is no backend to point it at, and a real-looking
code that resolves to nothing is a more convincing lie than an obviously fake
one — the module grid is derived from the pairing code so it is at least stable
across renders. Swap it for a real encoder when there is a link worth encoding.

Manual entry is one input behind six boxes, not six inputs: six fields need
focus-shuttling, break paste, and turn a backspace into a puzzle. The caret is a
ring on the active box instead — **and only while that input actually holds
focus**. Drawn unconditionally it was a lie about where typing would go: the
screen opened with the serial empty and the pairing code apparently active, so
the first field an operator reads off the label looked like the second one.

The serial takes focus on mount for the same reason. The label is read top to
bottom off a cabinet door, and landing anywhere else asks for a click before a
keystroke.

### Naming

The site step renders a **live `TowerCard`** of what you are typing. `PLACE:
ZONE` — `WAREHOUSE: PARKING LOT` — is a two-part convention nobody infers from a
placeholder, and one keystroke against the real card teaches it in a way helper
text cannot. Above it
sits the claimed unit read-only — the point is not the metadata, it is
confirming you have hold of the right box before you name it.

The camera step puts the first frame beside each field, because you name what
you can see. A camera returning nothing says `NO SIGNAL` and is still named: a
dead camera you cannot label is a dead camera you cannot report. Both names are
required — they end up in every chip on both walls.

### Bringing it online

Four readings resolving in order, in the fleet's own green/amber/red, rather than
a spinner or a `Done ✓`. This is a monitoring product; the honest last screen is
the tower reporting itself, and it is the first thing that teaches an operator
what the card colours mean.

**Amber does not block.** The tower is already claimed and real by this point;
refusing to finish because a camera is down would leave the operator holding a
site they cannot see. `status` is derived from the readings, not chosen — a new
tower with a dead camera joins the fleet `degraded`, because saying `online`
because it is new is exactly the lie the dashboard exists to catch.

### Copy

The flow was reviewed against Material's UX writing guidance and rewritten in
places. The pattern the review caught is worth remembering: three screens were
explaining *why the design is right* rather than what to do — no camera on the
console, not a progress bar, the tower cannot know its own name. That reasoning
is correct and it belongs here, in this file. On screen it cost the operator a
sentence before they learned what to press.

The intro's secondary button now reads `Enter serial instead` rather than the
frame's `Manually Enter` — verb-first, and the same words the hand-off uses for
the same destination. Worth pushing back into `108:1150`.

### Leaving before you finish

The claim is real from the moment the phone scans — that is what claiming
means — so leaving the flow cannot throw it away. It would strand a tower
nobody can see and nobody else can claim. Every exit runs through one `leave()`
that hands the draft back to the shell, and the tower waits at the top of the
towers panel with whatever naming was done. `Finish setup` resumes at the site
step with the typed name still in the field; making an operator re-scan a tower
they have already claimed is asking them to prove something they have proved.

`PendingTowerCard` is deliberately **not** a `TowerCard`. That card is a set of
readings, and this tower has none yet, because nobody has told it what it is
watching. Rendering it as a fleet card with the readings blanked would be the
one thing this dashboard must never do — show a site that looks monitored and
is not. It takes no status dot, and it stays off the wall entirely until its
cameras have names.

The frame (`152:3386`) gives it a 20% wash of detect amber and a white pill.
That stretches the palette one notch — amber has meant "degraded or a
detection", and this is neither — but the underlying claim is the same in both
cases: *something here is unfinished and it is on you*. It is the only card on
the panel carrying an outstanding action. The mast is drawn without its battery
cell, because a tower nobody has named is not reporting a charge either, and
`twr-mast.svg` is exactly that drawing.

The pill is inert. The whole card is the target, so if `FINISH SETUP` captured
the pointer the most obviously clickable thing on the card would be its one dead
spot.

Two copy changes against the frame. It writes "finish set up" on the first line
and "FINISH SETUP" on the button — two words is the verb, one word is the noun,
and *finish* takes the noun. And `Step 3/4 remaining` reads as "step 3 of 4",
which is which-step-you-are-on, while meaning the opposite: after a claim you
are on step 2 and three are left. It reads `3 of 4 steps left`, and it counts
down as the site and the cameras get named rather than sitting on 3.

### Not built

Three states still have no copy because they have no code: a unit already
claimed by another organisation, a unit claimed with no uplink, and a blocked
clipboard. There is also no way to release a claim — a pending tower can only be
finished, not handed back — because releasing one is a destructive operation
that needs a confirmation step, and a half-built one would be worse than none. The honest behaviour is
that the claim is real from the moment the phone scans, so the tower should
already exist as an unnamed row in the panel with a `Finish setup` action — that
needs a pending state in `TowersPanel` first, and a half-built one would be a
button that goes nowhere.

## People of interest

The rail's person glyph is the watchlist, not the staff list — those two
readings of one icon are as far apart as this product gets, and it was labelled
`Team` until somebody said so out loud.

A sighting is **not a new kind of event**. It is a `person` detection that also
carries an identity and a match confidence, so it lands in the alert feed, the
fleet card counts and the new-alert banner without any of them being taught
anything. `AlertKind` already had `person` with its own badge, `confidence` was
already documented as belonging only to predictions, and `--color-detect` was
already the amber `ClipPlayer` marks detections with. Inventing a seventh alert
kind would have forked a vocabulary that already covered this.

### A match is a possibility, never an identification

Face matching is probabilistic, so nothing in this feature asserts an identity.
Titles read `Possible match: M. Okonkwo on Gas Yard`, the confidence travels
with the name everywhere it appears, and a match takes **detect amber** — red is
a fault or a live transmission, and somebody walking past a camera is neither.

The alert footer carries **`Not them`**, which keeps the detection and drops the
identity: the camera did see somebody, and deleting the alert would lose that.
Without it the only way to answer a wrong match is to resolve an alert that
never happened.

### Reason and expiry are required, and that is the design

A watchlist entry with no stated reason is an accusation with no author, and the
reason is the only thing that lets a second operator judge a match they did not
create — so it is shown with every match. A watchlist that never expires becomes
permanent surveillance of people whose reason lapsed months ago, so entries stop
matching on their own and have to be extended deliberately. Extending runs from
*now*, not from the old expiry: renewing a lapsed entry is a fresh decision to
watch somebody, not a correction of a clerical slip.

Expired entries drop to their own section, stop matching, and stay readable — a
list that quietly forgets who was on it is a list nobody can audit. `addedBy` is
on every entry for the same reason.

### Taking somebody off

Two halves, and the split is the point. **Stop watching** is what an operator
does when somebody should not be watched any more: matching ends immediately and
the entry drops to `EXPIRED`, where it can still be read. **Delete entry** is
only offered once it is already stopped — you cannot erase the record of
somebody the fleet is still looking for, and by then the entry is a record
rather than an instruction. Deleting never touches the alerts a person's matches
raised: those record what a camera saw, which happened whether or not the entry
still exists.

Both confirm inline rather than in a dialog. This app has no dialog primitive,
and inventing one for a two-line consequence would be a bigger decision than the
action it guards — but the consequence is still read before the second press.

The confirm closes when the action fires, and that is load-bearing. It is keyed
to the person rather than to the action, so leaving it open re-armed it as
`Delete entry` the instant watching stopped: the second press of a two-press
guard landing on a different and worse action than the one it was aimed at.

Deleting lands on whoever is next in the list, not on nothing. The panel also
distinguishes an empty list from an empty selection — telling an operator that
nobody is on the list while three people sit in the panel beside it is the kind
of wrong that makes them distrust the rest of the screen.

### Enrolment has two doors, and the obvious one is secondary

The path this gets used through is **from an alert**: an operator watching a
person detection with the clip in front of them presses `Add person`, and
enrolment opens with that frame and that zone already filled in. Re-finding a
face they are already looking at would be busywork. Uploading a file from the
roster is the fallback, not the path.

`Never seen` is a reading, not a zero — the same rule the empty alert fields
follow.

### The rail routes from one place

Four screens render `IconRail`, and each one used to wire its own `onSelect`.
It drifted exactly as you would expect: two screens shipped a nav bar that did
not navigate at all, and the two that did disagreed about what `Towers` meant.
Routing now lives in `App.navigate` and every screen passes it straight through,
so adding a destination lights it up everywhere rather than in whichever view
you remembered. Leaving the setup flow through the rail is an exit like any
other and still keeps the claim.

`Alerts` and `Settings` are drawn by the frame and go nowhere yet — clicking
them leaves you where you are rather than blanking the screen. The `...`
simulator now renders only where something handles it; it used to draw on all
four screens and work on one, which is the same dead-control bug one row lower.

### Not built

There is no matcher. The two sightings in the seed are authored, not generated,
because a stub that invents faces is worse than one that repeats: a random match
would put a name on a person who was never there. The reference photos are a
drawn silhouette for the same reason — a stock photograph of a real person used
as a fake person-of-interest is not a placeholder, it is a picture of somebody
on a watchlist.

Nothing enforces who may enrol. `addedBy` records it and the roster shows it,
but any operator can add anyone; a real deployment needs that gated.

There is no copy for a photo the matcher cannot use — `This photo can't be
matched. Try a clearer, front-on face.` needs a matcher to raise it.

### Copy

Reviewed against the ux-writing skill. Two changes were worth more than the
tidying: the reason field was labelled `WHY`, which is the least serious word
available for the most serious field on a screen that may end up in an incident
review; and the enrolment screen never said what enrolling *does*. It now leads
with **"Every camera in the fleet will match against this face and raise an
alert"** — said before the act rather than after it, because this feature puts a
named person under fleet-wide automated matching on one operator's say-so, and
the interface should be plain about that at the moment of the decision. The
submit reads `Start watching` for the same reason: it names the outcome, not the
form.

Roster rows use `formatClockShort` — seconds are the information on an incident
timeline, where three detections can share a minute, and four characters of
noise in a list that is scanned.

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

## Camera settings

Per tower, not per camera — the frame (`63:1606`) puts the gear in the tower's
own bar, between the layout rule and the bell, and that placement *is* the
argument for the scope. A control on a tile would imply the other tile had one
of its own. The panel says so before it says anything else: *"These apply to
both cameras on TWR-1042 — GAS YARD and EAST CORRIDOR."* A panel that changes
two cameras while showing the name of one is the kind of thing an operator
discovers by breaking the camera they were not looking at.

It opens over the alerts rail rather than beside it. The operator has to see the
pictures the settings are about, and the rail is the one thing on that screen
they are not reading at that moment — it is a list of what already happened.

### The alert feed stopped being a lie

Six alerts loaded on every fleet, naming TWR-1042 and TWR-2071, towers no
account has. They were counted on real tower cards and spoken for by the
new-alert banner, and the code said so in a block headed "FIXTURE ALERTS, ON
EVERY FLEET — NOT REAL DETECTIONS". The note finished: *the way out is a real
feed, or a mark on screen — swap the line below back the moment coordination
serves alerts.*

Coordination serves alerts. Five kinds, each with a fixed colour and a clip of
the minute before it happened.

| what the hub saw | what the screen says |
| --- | --- |
| a tower's control link lost for 60 s | **WEST TOWER offline** |
| a camera's feed lost while its tower is up | **CAMERA 1 camera stopped working**, and "Back at 13:04" once it returns |
| a tower that was offline is back | **WEST TOWER back online** |
| a reconnected tower sending its backlog | **Recovering footage from WEST TOWER**, with "6 files, about 29 min left" and a bar |
| that backlog cleared | **Footage recovered from WEST TOWER** |

**None of those sentences crosses the wire.** An alert carries a `type` and a
`colour` and no `message` field at all — deliberately, on both sides. The
website owns every word a customer reads, from one place, in one voice, and
the easiest way to keep that rule is to have nothing on the wire that could
break it.

One of those words is owed rather than chosen. A tower is **offline**, never
"down": a hub cannot tell a dead tower from a dead radio link, and "down"
asserts the first.

And a type we have never heard of still appears. A newer hub forwards one, the
`colours` map it comes with says what colour the hub thinks it is, and the row
reads "Something happened at EAST TOWER" rather than `GENERATOR_LOW` and rather
than nothing. An operator who reads the first goes and looks.

### The minute before it happened

Every tower camera's stream is recorded into a three-minute ring on the hub,
and 60 seconds is cut out of it when an alert fires. What comes back depends on
what happened, and the shape of the screen follows:

A **camera stopping** is one camera, so it is one pane. A **tower going
offline** is the control link, which took the whole mast — so both cameras,
side by side, on **one transport**. They are the same moment seen from two
places: a vehicle leaves one frame and enters the other, and finding that by
scrubbing two players separately is the work this screen exists to not make
somebody do. One play, one scrub, and a drift correction that keeps the
follower within a third of a second of the leader.

If the tower survives and later syncs the 2K segment covering that window, the
hub cuts the same minute again at full size and `best_quality` flips. The
player switches to it **without losing the place** — it is the same sixty
seconds at a better resolution, so somebody looking at 00:42 is still looking
at 00:42. A naive source swap resets to zero, which on a minute of evidence
means finding the moment again.

⚠ **A clip URL is good for fifteen minutes and is never cached.** An operator
who leaves the feed open through a shift and then opens an alert from this
morning gets a 403, and a player that read that as "broken" would be telling
them the evidence is gone when it is one request away. So a 403 re-reads the
alert for fresh URLs and retries **once** — once, because a second failure is
not an expiry, and a loop against a server that is refusing is this app causing
the outage it is reporting.

There are three ways to have no clip, and they are three different sentences:

- **"Clip coming."** A `TOWER_ONLINE` clip is the first 60 s *after* the tower
  returned, so it lands about a minute later. The alert is right and the
  evidence is on its way.
- **"Clip no longer kept."** The clip budget is swept oldest-first under disk
  pressure, and clips go before footage, never the other way round. The alert
  survives its clip on purpose: an alert is the record that the camera stopped
  at 03:14, and deleting it to save an attachment would be deleting the
  incident.
- **Nothing at all.** The two footage-recovery alerts have no moment to cut
  around, so they get no clip area rather than a box reporting the absence of
  something that was never going to be there.

### What a lab hub found

Six things, from the first run against real alerts on real hardware. Four were
copy and layout; two were the kind of bug that only a real file over a real
network can produce.

**A camera is called what the customer called it.** The feed read "CAMERA 1
camera stopped working" on a mast whose cameras are NORTH GATE and YARD: the
wrong name, and the noun twice. The second half is what a template with a
variable in it does the moment the value already contains the noun, so the
sentence is chosen rather than filled: a named camera takes the noun from the
sentence ("NORTH GATE camera stopped working") and a numbered one already
carries it ("CAMERA 1 stopped working"). The name comes from the field that is
only set when somebody actually named a camera, not from the one that always
has a value in it.

There is a third case, and it is the one the fallback hid: somebody naming a
camera **TEST GATE CAMERA**. The rule is not "was it named?" but "does the name
already say it?", so that reads "TEST GATE CAMERA stopped working" — whole word
and case-blind, so CAMERAMAN HILL is still a place and gets the noun. Two
places write that clause, the title and the timeline's first step, and fixing
only the first is how the doubled noun survived its own fix in the second.

**The header showed `95ae76a8085641718fc1a64cbda85280`.** Thirty-two hex
characters cannot be read aloud on a handoff, compared by eye against another
screen, or fitted on the line the design drew. It reads `ALT-95AE76` now, and
the full id is on the clipboard behind it — which is where the one reader who
needs it, us in a log, can get it.

**The Timeline came back.** It was dropped for server alerts on the argument
that coordination's five kinds are single events and a heading would sit over
one line repeating the title. That was wrong on a real hub: an alert carries up
to four moments, and the gaps between them are the reading. "Frames stopped at
13:00, raised at 13:01, back at 13:04, acknowledged at 13:05" is the handoff;
four separate cells are not.

One of those stamps is derived rather than read: the raise is the event plus
sixty seconds, because the hub debounces for exactly that before raising
anything and stamps the alert at the event so the clip lands on the minute
BEFORE it. And one step has no clock at all — "2K clip added" is attached
during a sweep and the row carries no time for it, so it draws none rather than
an invented one.

**And the "Recent" chip sat on top of Escalate.** The notifications stack is a
fixed overlay pinned to the bottom right of the viewport; the alert detail ends
in that same corner on a wide screen. The panel gives way, not the overlay: the
overlay is global and correct where it is, and the panel is the thing that
chose to end in an occupied corner.

### One player, and the seek that stalls a video

A real alert was getting a plain inline bar — two videos, a play button and a
range input — while the detection alerts had a player with a scrub bar, a
wall-clock readout, the alert's own timeline marked on the track, speed, mute
and a download. Two players in one product, and the worse one was on the only
path that now has real footage behind it.

So the hero is the design's: the picture, the camera's name in the corner, the
centre play button, the duration badge. Pressing it opens the real player, and
for a tower alert it opens both cameras side by side on one transport. The
poster is the clip's own first frame, because the hub cuts video and not a
still — an honest frame of the actual footage rather than a placeholder
standing in for one.

Then the bug worth writing down.

A clip that arrived AFTER its alert was opened came up with a transport reading
`0s / 1m` and would not start. The file was fine: 200, 6.8 MB, 52.7 seconds,
starting on a keyframe. An alert whose clip already existed when it was opened
played perfectly.

⚠ **A seek issued before the element can seek is dropped silently, and can
stall the element for good.** `currentTime` is written and reads back unchanged
on the next line — no error, no event. And a seek at `loadedmetadata`, which
fires as soon as the duration is known and long before `seekable` has anything
in it, can leave a paused element parked at `HAVE_METADATA`: never loading
further, never becoming playable, with a perfectly good file behind it. The old
code wrote `currentTime` from a `setTimeout(0)` onto a freshly mounted element,
which is exactly that, and then swallowed the resulting rejection in a bare
`catch`.

Three changes, and all three were wrong on their own:

- the position is only written once `seekable` says the element can go there,
  and is retried at each step up in readiness;
- the player's videos are `preload="auto"`, because a paused element on
  `metadata` never reaches a state it can seek or play in;
- a failed `play()` says what happened, in one sentence. The lab could only
  report "never plays" because the reason was being discarded.

There was a second one underneath it. An open player was holding the clip it
was given when the hero was pressed — a snapshot — so a 2K cut landing while
somebody was watching changed the alert and changed nothing on screen. The
panels record which CAMERA is leading and re-derive the panes from the live
alert on every render: not the attachment, and not the clip key either, because
an upgrade is a new key for the same camera.

### Acknowledging, and the thing there is no button for

The ack route reads **no body**. Who acknowledged is the authenticated caller,
never a name in a request — which is why the panel carried a visibly fake
"A. Okafor" for as long as there was no route at all, rather than quietly
substituting the session's own name and making an unverified claim look
verified. The screen now takes the returned alert as the truth, name and all,
and writes nothing optimistically: an acknowledgement is an auditable record of
who noticed, and painting the row before the server agrees is the same
unverified claim half a second earlier.

There is no **Resolve**, and that is not an omission. Acknowledging is one-way
and the first one wins; a camera coming back writes `recovered_at` onto the
*same* alert rather than closing it. Those are facts about different actors —
a person noticing, and hardware returning — and one button collapsing them
would let this screen imply somebody dealt with an outage that simply ended.
The detail shows both, in separate cells, with separate labels.

**Escalate stays, and stays disabled.** There is still nowhere to hand an alert
to: no ticket, no rota, no recipient. A button removed is a feature forgotten,
and this one has to be wired the day there is one.

### The hub itself, and footage that arrives later

Two more types, raised a tier up. The data centre watches every hub's uplink
the way a hub watches its towers' links, with the same state machine and the
same sixty-second debounce, and `HUB_OFFLINE` and `HUB_ONLINE` are what it says
when one stops answering and when it dials back in. Red and green, the same
colours as the tower pair, deliberately: one incident type, one colour,
whichever tier noticed it.

"Offline", never "down", and the reason is stronger than a tower's. All the
data centre observed is a socket that stopped answering. The hub on the other
end may be serving its own site perfectly over the LAN, recording and watching
and raising its own alerts, with nothing gone but the link to the internet.
"Down" would be a claim about the hub; "offline" is a claim about the link,
which is all there is evidence for.

**A hub is not in the fleet, and that is what had to change on this side.**
`device_id` carries the hub's id on these rows, and the fleet holds that hub's
MAST, under a different id and with a different name on it. Asking the fleet
gets `undefined`, and the row then reads `HUB-KLN-LAB OFFLINE` — a code on the
one line somebody reads out over a radio. So the name resolver takes the
alert's TYPE as well as its id, and the shell asks the cells list for a hub and
the fleet for everything else. One function decides which is which.

### Four ways to have no picture, and they are not the same thing

The clip area used to ask one question: is there something to play? That was
enough while every alert's clip was cut at the moment it was raised. A hub's is
not, and the gap between the states is now the information.

`HUB_OFFLINE` is the one alert whose clip **cannot** be cut when it is raised.
The footage is on the hub, which is the thing that just went away, and the data
centre keeps no video at all. Nothing polls for it and nothing expires: the
hub cuts it from its own archive when it dials back in, and a hub can be away
for weeks — off a mast for maintenance, a site without power, a SIM to replace.
So "Clip coming", which promises the next minute, would be the wrong sentence
for a wait that may outlast the month. It says **"Footage pending, the hub is
away"**.

When the clips do arrive they may arrive with no URL, and that is not a
failure either. The data centre stores no video by design; the URLs it hands
out are presigned into a bucket, and where no bucket is configured there is
nothing to presign. The clip still has a camera, a quality, a length and a
start, so it is drawn: two boxes side by side with their labels, not pressable,
and one line underneath saying **"Clip on the hub only"** and where it can be
watched, which is the screen in the control room.

And a hub that is asked and has nothing — the disk was full, the camera was not
recording, the box was rebuilt — answers with an empty list, which is an
**answer**. "No footage of that moment" ends the waiting, which is the thing
the other three sentences cannot do.

That last one is a `progress` block with no numbers in it at all: just
`{footage: "none"}`, a verdict rather than a measurement. Which is the one
thing worth saying about it on this side, because every other `progress` block
in this product drives a bar, and a bar drawn at 0% over this one would say "a
transfer is under way and has moved nothing" over an alert whose entire content
is that there is nothing to transfer. The row and the detail both read the
block field by field and draw nothing when there is no number, rather than
branching on whether the block is there.

And its absence says nothing either. An alert whose hub has not answered yet
also has no `footage`, which is where every one of them starts, so only the
word `"none"` ends the waiting.

It took an SDK release to arrive: `progress` was parsed as four numbers and
anything else in the block was dropped, so the verdict reached this side as
`{}`. The reading was built and tested before it could arrive, behind a test
that asserted the field was being dropped and failed the day it stopped being
— which is how the next person found out it was time to turn the real one on.

### Two things the stream does not do for you

The event channel works, and watching it in DevTools on the lab hub showed
three frames for one incident: the raise, the clip, and the recovery. Both
remaining bugs were on this side, and both were invisible rather than wrong.

**The push carries clips with no URLs, on purpose.** `url` and `download_url`
are minted per request and must not be cached — a presigned bucket URL lives
fifteen minutes, and a frame can sit in a queue or be replayed to a
reconnecting reader. So the hub mints them on `GET` and leaves them off the
push, which is the only honest thing it can do with a credential that expires.

What was missing was the browser's half of that. A frame carrying a clip and no
URL was stored as it came, the player had nothing to play, and the detail sat
on "Clip coming" until somebody reloaded the tab — at which point the list
minted the URLs and the clip appeared, which is why it looked like a caching
bug. Now an alert whose clips lack URLs is re-read, debounced so a burst of
frames about one incident is one request, and once per set of clips so a clip
whose URLs never arrive costs one request rather than a loop.

⚠ And a later frame must not take them away again. The recovery frame carries
the same clip list as the one that announced it, so applying it verbatim
overwrote the URLs just fetched and the clip went back to "Clip coming" — a
recovery un-playing the clip of the incident it was recovering from. They are
carried forward by clip key, which is not caching: the alert in the store
already held them.

### The request that was never made

The fix above shipped and the clip still sat on "Clip coming" until a refresh.
DevTools was unambiguous: zero `site-alerts` requests after the event, and a
single-alert `GET` that returns every URL when you make it by hand.

The SDK was the obvious suspect and was innocent — the hub's exact payload
through the real parser yields the clip intact, with `url` simply absent, which
is what it should do.

The cause was a line of mine. The decision "do these clips need URLs?" was made
inside a `setRaws` updater, which pushed ids onto an array that was looped over
on the next line. **A `useState` updater does not run when you call
`setState`.** React has an eager-state bailout — when the hook's update queue
is empty it runs the reducer immediately to see whether the state actually
changed — and that is the only reason it ever appeared to work. One frame at a
time takes that path. Two frames back to back, which is a raise followed by its
clip and therefore every real incident, leave an update pending: the bailout is
skipped, the updater is deferred to the render phase, and the side effect reads
an empty array.

The store is a ref now and the state is its mirror. Every decision is made
against the ref, synchronously; `setRaws` is handed a finished value and is
only how the screen hears about it. An updater that must be pure and a decision
that must happen now do not belong in the same function.

The test that missed it is worth more than the fix. It pushed one event and
waited — so it took the eager path every time and could not have failed. The
replacement pushes the raise and the clip without awaiting between them, which
is how they arrive, and it fails against the old code by timing out on the
request that never comes.

### The toast that retired before anyone could see it

An alert arrived, appeared in the "Recent" list marked "passed", and no card
ever showed. That is a complete description of the bug, and it points straight
at it: the card was created and then immediately retired.

The stack expired a card when `now - at` passed its lifetime, and **`at` is
when the thing HAPPENED, not when the card appeared**. The hub stamps an alert
at the event and raises it sixty seconds later, after the debounce that stops a
radio blip becoming an alert — so every alert card in this product was already
older than the nine-second default before it was created. Added, retired on the
next tick, filed under Recent.

Those were one field and should never have been. A card's lifetime is measured
from when the stack received it; its label still reads the time of the thing it
is about, which is useful — a card that says "2m" is telling you the camera
stopped two minutes ago. Share cards had the same bug waiting for any share
older than nine seconds by the time the twenty-second poll found it.

A card carrying a button also gets the long lifetime rather than the default:
nine seconds is less than the time it takes to look up from a camera wall.

### Live updates paused

A feed that has stopped and a quiet night look exactly the same. Both are a
list of alerts that is not changing, and on a monitoring product one of those
is the best news on the screen and the other is the worst. Nothing else on
that surface tells them apart: the rows are still there, still true, still the
last thing the server said.

So a stream that stays down says **"Live updates paused. This list may be
behind."** — one line, in the quietest ink, below the count and above the
list, on both alert surfaces. Not red: nothing is wrong with the site, and
spending the fault colour on a browser's connection is how an operator learns
to discount it.

It waits eight seconds first. Drops are ordinary on this channel — a slow
reader is closed rather than waited for, because the publisher is the loop
watching the fleet — and a notice that blinks all day is a notice nobody
reads, which is the same failure arrived at from the other side.

### A colour the server chose

An alert's colour is a code, like its type, and it arrives in a `colours` map
with every list. Three of the five land on colours this product already spends,
and for the house reason rather than by coincidence: a tower that is **back** is
green because green means live, a camera that **stopped** is amber because amber
means degraded, a tower that is **gone** is red because red means fault.

The other two are new tokens, and they are the first extension to the colour
rule since it was written. Footage catching up after an outage is the one class
of event here that is neither a reading about a site nor a fault: it is a job
running, and then a job finished. Red or amber would paint a system recovering
correctly as broken; green would say LIVE. So `--color-recovering` (violet) and
`--color-recovered` (teal), named for the job rather than the hue, and spent
nowhere else.

**Blue is still the sharing toast's and nothing else's** — the one thing on
screen that is about people rather than about the site.

### A toast that finds you wherever you are

An alert arrives while somebody is watching a gate. The card goes in the corner
over the video, in that alert's colour as a 2px strip and not a pixel more,
with Open and Dismiss — the same card the share requests use, which was built
once for exactly this.

It is **not** hidden on a hub, unlike the share deck beside it. A share is
between two sites over the internet and a hub has neither; an alert is the
hub's own judgement about its own masts, and the kiosk in the control room is
the screen most likely to be the only one anybody is looking at.

It is transient rather than persistent, which is the opposite of a share
request. A question that fades is a question answered by whoever was looking
the other way — but an alert is not a question. It is already in the feed,
already counted on its tower's card, and durable on the hub for ninety days.
The card is the interruption, not the record.

### The hub does not have your footage

The Storage group had two rows that read as reassurance and are now false.
"Recording · At the hub", and on a mast with no disk of its own, "Footage ·
Recorded at the hub". Both were true while the hub recorded every tower's live
stream as it arrived.

It records nothing from a tower now. A tower records to its own SSD and a
pipeline moves the finished 15-minute files up to the hub, which is what makes
a radio outage stop being a hole in the record — the footage was always on the
mast, and nothing used to move it. The consequence for this panel is the
opposite of reassuring: **a tower that is not recording has no footage
anywhere** once the hub's existing archive ages out. Two rows were telling an
operator their evidence was safe somewhere it is not, which is the worst shape
a wrong reading can take here — every other row on the panel green, and
nothing being kept.

One row answers in both cases now. `mode: "tower"` is "On this tower", a hub
mast is "On this hub" (§6.4: it records its own cameras over a LAN cable, so
"the hub" is its own disk and not somewhere else), and a tower that is not
recording reads **"Not recording"**, in red, because a site keeping nothing is
a fault and not a setting. A device that has reported no recording block at
all gets no row, and the Storage group goes with it: absence of a field and a
field whose value is unknown are different things.

⚠ **It said "Not recording" and not "Not recording: no disk", and the shorter
claim was the point.** `health.recording.mode` is read off `RECORD_ENABLE` and
nothing else, so "hub" means recording is switched *off* and says nothing about
whether an SSD is fitted — and "tower" means it is switched *on*, which on a
diskless mast is the `no_recording_disk` fault rather than proof of a disk.
Naming the reason needs `footage.sync.reason`.

**It arrived, and the sentence it answers is on a different row.** SDK 0.13.0
parses the device's `footage` block, so the panel and the Towers board both
gained two readings:

| row | says |
| --- | --- |
| **Footage** | Up to date · Behind *n* h · Can't reach hub · Not recording: no disk · Recording off |
| **Waiting** | *n* files · *size*, or "Nothing waiting" |

"Behind 2 h" is measured from `oldest_unconfirmed_start`, which sentry-core
added to the projection for this row, and reads "Behind **about** 2 h" when
`oldest_unconfirmed_exact` is false — a segment whose start could not be
established is stamped when it *arrived*, so the hours are a floor and not a
measurement, and one word is the whole of the difference. "Recording off" is
deliberately **not** red: somebody turned it off, which is a decision, and
painting a decision as a fault teaches an operator to stop reading the colour.

The Recording row stands down when Footage can name the reason, so a diskless
mast reads "Not recording: no disk" once rather than twice at two levels of
confidence.

⚠ **And a tower that has said nothing gets neither row.** Two of the five
verdicts are the hub's rather than the tower's — `unreachable` needs a link
state only the hub observes, `behind` needs a clock — so a site whose hub never
reached a verdict is silent, and silence is **not** rendered as "Up to date".
That is the one direction a monitoring screen may never guess in: a site
reported as fine because it failed to answer. The Waiting row is what tells
the two apart on screen, which is why a measured backlog of nothing says
"Nothing waiting" rather than hiding.

### What is on the mast, and what has no time

Playback gained two things it could not show before, and each of them used to
read as something worse than it is.

**The last half hour is not an outage.** The tower holds the segment it is
still writing and the one or two behind it, so the newest 15 to 30 minutes of
every camera is always on the mast and not at the hub. On a timeline whose
only two states were "footage" and "the dead surface showing through", that
permanent tail drew as a gap at the right-hand edge of every lane, all day, on
a healthy site. `towerSpans` draws it as its own hatched band with a legend
that says what it is and that it cannot be played from here.

It is deliberately not green. Green on that bar means two things at once —
there is footage here, and you can scrub to it — and the second half is false
for a span the hub does not hold. A band that looks playable and is not is
worse than the gap it replaced. It is not a new hue either: the colour rule
spends green, amber and red on readings about the *site*, and "the file has
not finished uploading" is not news about a yard.

**Some footage has no time, and it still has to be reachable.** A recorder
that starts before its clock has synced writes a complete file whose beginning
nothing can work out afterwards. The pictures in it are real; the commonest
cause is a power cut, which is also when somebody most wants the tape.

There were three ways to handle that and two of them are wrong. Dropping them
deletes real footage from the only screen that can reach it. Drawing them at
the moment they *arrived* puts footage on the timeline at a time it was not
recorded — and worse, cuts the genuine segment before it short against the
intruder, so a real recording is shortened to accommodate a guess. So: a list,
under the timeline, with no clock on it. Camera, when the hub received it
(labelled **Arrived**, never left bare), size, play, download. The download
carries no time in its name at all, because a file that states a time it is
not of survives longest exactly where it does the most damage — on a disk, in
an evidence folder, long after the screen that explained it is closed.

### Picture quality is not a row

It let an operator pick which of a tower's two live streams this browser
pulled, and it is the only control on the panel that was removed for being
*inert* rather than wrong.

Live video is standard everywhere now — on a tower, on a hub, at the data
centre, on sentri.watch — and 2K travels only on the footage lane, which
nobody watches. A mast advertises one profile, so the row was a menu of one: a
label, a chevron, and a single word under it that could not be changed.

It never wrote to a server, which is why removing it takes nothing away. The
pick set one field of browser state, that field became the `profile` on a
WebRTC open, and the whole effect was which stream this tab pulled. What a site
*records* is `FOOTAGE_STREAM`, decided on the hub and applied by every tower,
and the Recording resolution row reads it — that row stays, and it is the one
a customer was looking for in that space.

The removal improved the session manager. No open names a profile as a
requirement any more, so drilling into a tower always reuses the session the
wall already holds for that camera instead of renegotiating the one the
operator has just clicked on. That was already the rule; it is now true by
construction rather than by nobody having picked anything.

And the naming bug behind it was worse than the row. `profileLabel` applied
"the smallest is Standard" only to a set of two or more, so a *sole* profile
fell through to `tierFor`, which has no tier below 1920 and answers "HD" for
everything under it. A tower advertising one 704×576 profile — which is every
tower now — had its Recording resolution row read **HD**, over footage 704
pixels wide: the same over-claim as the "4K HD" that row was written to
replace. One profile is the smallest one; the rule was simply never asked.

### What eufy got right, and what it did not

The shape follows [eufy's per-camera menu](https://smarteufy.com/how-to-set-eufy-camera/):
detection, then picture, then audio, each row carrying its current value. Their
[Motion Detection group](https://service.eufy.com/article-description/Motion-Detection-of-eufyCams)
is the most worked-through version of this in a consumer product — Activity
Zone, Detection Sensitivity, Detection Type, Motion Test Mode.

Three things differ on purpose.

**Sensitivity is named, not a 7-point slider.** eufy publishes the numeric
ranges behind each of their levels, which is the tell that "level 4 of 7" means
nothing on its own. Every option here says what it costs instead — *"High —
catches more, and raises more false alerts."*

**Rows expand in place rather than pushing a sub-screen.** On a 417px panel with
eight settings, a stack of drill-ins is four taps to change one number and the
operator loses the picture every time.

**Every change is stamped.** Sensitivity, detection type and zones decide what
reaches the alert feed, which makes them operational rather than preferences.
"Why did we stop getting alerts from the gas yard" has to have an answer, and it
is usually somebody's afternoon adjustment.

Storage, power and device info are eufy's too, adapted rather than copied:
there is no SD card, so `STORAGE` is the rolling on-tower buffer and the two
levers on it; `POWER` is a working mode, because these towers are off-grid and
the panel is the only thing refilling the battery; `DEVICE INFO` is read-only
and exists because when a camera misbehaves the first two questions are which
box it is and what it is running.

### Layout

Six groups and fifteen rows in a 417px column, so the shape is doing most of
the work. One card per group with hairlines inside it, not a stack of tiles —
[alias](https://mobbin.com/screens/59ae5210-ba18-4656-9d77-44492499e263),
[Apple Fitness](https://mobbin.com/screens/552d43ea-2598-4822-aef2-52e767f5da79)
and [Character AI](https://mobbin.com/screens/0a65f4fd-71b8-4fdd-9572-b088b0568e5e)
all do this, and it is what makes a group heading mean anything at 12px muted.
Group headers get a rule and real air above them for the same reason.

A group with exactly one number to report carries it on its own header line —
`STORAGE … 41 GB of 128 GB`, `POWER … 100%`. That halves the height and drops a
label the heading already carried. `DEVICE INFO` has four and keeps them as
rows.

Those rows are `Reading`s: same card, same shape as a control row, and **no
chevron** — which is the whole signal. They were styled the other way for a
while (no card, inverted label and value, sitting on the panel ground) so they
could not be mistaken for something pressable, which was right while readings
sat *among* controls. Once the two single readings moved onto their headers,
`DEVICE INFO` was the only group holding any — and a group with no card was the
one group that looked broken.

The scope line rides the panel title rather than the content flow. As a
paragraph it sat immediately above the first group header and read as that
group's introduction rather than the panel's. It reads `Both cameras on
TWR-1042` and stops there — listing the two camera names after it made the line
truncate at this width, and "both cameras" already carries the count. An
operator who wants to know which two is looking at the wall they are named on.

It is 12px, not the 11 it started at. That was the smallest type in the product
and it carries the panel's most consequential fact; 12/15 is the scale the tower
card's status line already uses.

**No leading icons, and that is a gap rather than a decision.** Every reference
in the corpus uses one per row, and the asset set has honest glyphs for maybe
seven of the ten — nothing for sensitivity, night vision or stream quality.
Seven icons and three blanks is a worse column than none. Commission those three
and the rest follows.

Changes are still stamped with `changedBy` / `changedAt`, but the panel does not
print them: a settings screen is where you change something, and a provenance
line at the bottom of one is read by nobody at the moment it matters. It belongs
in an audit view.

### Zones are the exception

Everything else is tower-wide. A zone cannot be: it is a shape drawn on one
camera's own view, and the second camera points somewhere else entirely, so the
same rectangle over its frame would fence off a piece of ground nobody chose. So
the editor asks which camera you are drawing for, and stores zones keyed by feed.

They are drawn on the frame rather than described — the one eufy pattern worth
copying whole, because "ignore the road, watch the gate" cannot be said in a
form field. Coordinates are normalised 0–1, never pixels: the same zone has to
hold at 380px on the fleet wall and 1280px in a takeover. Three is the cap, as
eufy has it; a fourth region is usually the whole frame drawn the long way
round. Anything under 5% of the frame is discarded rather than left as a speck
to find and delete.

**The draft rectangle lives in a ref as well as in state.** `pointerup` reads
it, and React batches state across a fast gesture — so the `draft` closed over
by the up handler can still be the value from before the drag began, with the
rectangle visibly on screen and the handler seeing `null`. Pointer capture is
taken on the frame rather than `e.target` (the target is usually the `<img>`)
and is wrapped in a try: capture keeps a drag alive past the frame's edge, and
if it is unavailable the drawing still has to work.

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

## Bar micro-interactions

Three controls in the tower bar, and only two of them are hovers.

**The gear turns one notch.** Sixty degrees over 240ms, not three hundred and
sixty — this is a control an operator passes over constantly, and a full turn is
a performance the second time. One notch says *mechanism* and stops. 240ms
rather than `ENTER`'s 200 because rotation reads slower than translation at the
same duration. Hover only: when the panel is open the gear is already white, and
holding it turned would be two signals for one state.

**The bell swings from its crown.** `0 → −8° → +6° → −3° → 0` over 450ms with
`transform-origin: 50% 15%`, because a bell hangs and pivots from the top rather
than the middle.

It is on **every bell that is a live control**: the tower bar, the fleet
header, and the rail's `Alerts` entry. Withholding the `group/bell` class is how
each one opts out, and two do — the tower bar's when an alert is unread, because
it already carries a ring for that and the rail carries the pulse, and a swing
on top of those is three things saying one thing; and the fleet header's when
there is nothing unclaimed to open, because a disabled control that animates
under the pointer is offering something it will not do.

Two bells deliberately do **not** take it. The one in the add-tower header is a
decorative `MaskIcon` rather than a button — a swing on something that does
nothing is worse than a still glyph. And `MobileViewBar`'s alerts tab is
`lg:hidden`, so it lives where there is no hover to respond to.

**The view toggle animates the change, not the hover.** The wall already reflows
on `ENTER` when layout switches — `layoutKey` carries `layout`, so every tile
runs a layout animation — and the glyph used to cut instantly while the thing it
describes took 200ms to move. It now rotates a quarter turn on the wall's own
tween so the icon and the wall are one gesture, with the label crossfading on
`FADE` beneath it.

The rotation carries the motion and a crossfade covers the rest, because **the
two exports are not rotations of each other**: `view-landscape.svg` is a single
rounded rect, `view-portrait.svg` a decomposed frame. Rotating one does not land
on the other. Both glyph and label sit in fixed-size boxes so nothing in the row
shifts as one replaces the other.

Hover on this control stays colour-only. It has a text label doing the
explaining, and a hover animation on top of that is noise.

All three are in the `prefers-reduced-motion` block. The view toggle matters
most there: it degrades to an instant swap with no rotation and no crossfade,
because a crossfade with no motion budget is worse than a cut.

The two hovers live in `index.css` with the other standing keyframes; the view
toggle is JS state, so it borrows `ENTER` and `FADE` from `motion.ts` rather
than inventing sibling tokens.

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
