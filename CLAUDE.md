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

Port 5173 is claimed by an unrelated project on at least one machine, so
`vite.config.ts` reads `process.env.PORT` and `.claude/launch.json` sets
`autoPort`. If the preview looks like a different app, check the port.

## Non-negotiables

These are load-bearing decisions with reasons recorded in the README or in
comments at the site. Changing one is a real decision, not a cleanup.

**Colour is reserved.** Green is live, amber is degraded or a detection, red is a
fault or live transmission. Nothing else gets a hue. Do not reach for `terra` to
mean "selected", "primary" or "success" — selection and primary actions are
white-on-black. A green pill on a monitoring screen reads as a signal, not a
setting. `--color-drag` is the one blue, and it is allowed *because* it is
outside that set: a held band has to say "you have this" without also seeming to
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
both screens read a tower, and two copies of a moving number disagree.

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

**Feed state grammar has one home.** `FeedChip` owns `stateWord` and
`STATE_DOT`, and both walls render `FeedChip` itself. Add a seventh `FeedState`
and both pick it up; restate the switch locally and only one of them will.

**The two views' tiles are deliberately different components.** `CameraTile`
carries the actuators, `MonitorTile` carries a picture, a `FeedChip` and an
expand button. They wear the same chip and that is on purpose; do not go further
and "unify" the components — the split is the reason a talk-down button is not
one stray click from four yards at once on the fleet screen.

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

**The battery cell renders *under* `twr-mast.svg`, not over it.** The fill is the
first thing the export paints and all 133 mast strokes come after, so the cage
struts cross in front of the cell. Two absolutely positioned layers on the same
59×101 grid; flip the order and the struts vanish.

**Vite HMR does not always pick up `data.ts` edits.** Module-level seed data is
captured at import. If the UI shows stale copy after a data change, hard-reload
before believing it.

**A `{/* */}` comment cannot precede the root element of a `return`.** Put the
prose in a `/* */` block above `return (` instead.

## Design source

Figma: `Terra· Sentinel`, file `a57qfGEtTBzzNj5R9DIJ8x`. The alert detail is
node `72:230`. The file is iterated on between sessions — re-fetch before
assuming a frame matches what is in the repo, and expect the code to be ahead of
it in places where a static frame cannot express behaviour.

Assets in `public/` are exported Figma files. Monochrome glyphs go through
`MaskIcon` (CSS mask, takes `currentColor`); the multi-colour alert badges and
link-quality icons render as `<img>` to keep their fills. Reuse these rather than
re-exporting or hand-drawing — the timeline badges, clip controls and alert rows
are all the same set.

## Comment style

Comments explain *why*, in prose, at the decision site. They are dense and they
are the point — match the register of the surrounding file. Do not add comments
that restate the code, and do not strip existing ones while refactoring.
