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
fault or live transmission. Nothing else gets a hue. Do not reach for `terra` to
mean "selected", "primary" or "success" — selection and primary actions are
white-on-black. A green pill on a monitoring screen reads as a signal, not a
setting. The one extension is `PendingTowerCard`, which the design washes in
20% detect amber for a tower whose setup is unfinished — not a reading, but the
same claim amber always makes: *this needs you*. `--color-drag` is the one blue,
and it is allowed *because* it is outside that set: a held band has to say "you have this" without also seeming to
report on the site. It exists for the length of a gesture. Do not spend it on
anything that persists.

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

**Motion lives in `src/lib/motion.ts`.** `ENTER` / `EXIT` / `FADE`, all tweens.
Springs overshoot, which on a wall of cameras reads as the stream glitching.
There are deliberately no CSS motion tokens — the standing keyframes in
`index.css` own their own timings.

**A tower has exactly two cameras.** `CAMERAS_PER_TOWER` in `types.ts`. It is
the hardware, and the fleet wall is built on it — a band is one site's header
over one row of two tiles, which is what the design draws and why the wall caps
its columns at two. Seed a third camera and the wall stops being a row per site.

**The wall's bands are derived, never stored.** `DashboardView` groups the flat
`order` by `towerId` — a tower sits where its first camera does. Adding a second
piece of state for band order gives you two arrangements that drift apart the
first time a tile is dragged across a band boundary.

**Camera, alert and tower state belong to `App.tsx`, not to a screen.** Both screens
render the same feeds, and the recording tick and latency walk are live — give
either one a copy and the two walls disagree about the same camera within a
second. The wall arrangement is up there too, because `DashboardView` unmounts
on every drill-in and would otherwise hand the operator back a reset wall.
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

**Tokens live in the `@theme` block of `src/index.css`.** Use `bg-panel`,
`text-muted`, `border-line`, `text-critical` and friends. A raw hex in a
component is a bug unless it is a one-off scrim or overlay alpha.

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
wall order — a band reorder reflows every sibling. Anything else you add there
that changes a tile's box goes in that key or the wall snaps instead of
animating.

**Two `transition-*` utilities on one element is one property list, not two.**
`ControlStack`'s buttons carried `transition-colors` for the hover chip and
`transition-[opacity,visibility]` for the hover reveal. Both set
`transition-property`; the colours won, and the controls had been appearing with
no fade at all since they were written. There is now a single `TRANSITION`
constant listing all four properties, and `index.css` delays only the first two
positionally so the stagger belongs to the reveal and a button's own hover
colour still answers at once. `transition-delay` takes a **comma**-separated
list — spaces make it invalid and the whole declaration is dropped silently.

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
`dataTransfer`. The band `<section>` in `DashboardView` carries them and is
deliberately not a motion element; `MonitorTile`'s own plain wrapper is what
holds the grid cell open during a takeover.

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
