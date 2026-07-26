# Sentinel — working notes

Operator monitoring portal for a camera tower. React 19 + TypeScript + Vite +
Tailwind v4, `motion/react` for animation. No component library, no router, no
backend — `src/lib/data.ts` is the seed.

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
setting.

**Times are wall-clock, in site time, labelled.** `formatEventTime` /
`formatClock`, never the viewer's timezone and never a relative age. The new
alert banner is the single documented exception. `src/lib/time.ts` explains it.

**Timestamps are epoch ms in the data layer**, never pre-formatted strings — the
filter and the timeline deltas both need to compare them.

**Absence is diagnostic.** Empty fields stay visible and say *why* the value is
missing (`Not acknowledged`, `Not scored`, `No footage — feed was down`). Never
blank a row or substitute a zero.

**Motion lives in `src/lib/motion.ts`.** `ENTER` / `EXIT` / `FADE`, all tweens.
Springs overshoot, which on a wall of cameras reads as the stream glitching.
There are deliberately no CSS motion tokens — the standing keyframes in
`index.css` own their own timings.

**Tokens live in the `@theme` block of `src/index.css`.** Use `bg-panel`,
`text-muted`, `border-line`, `text-critical` and friends. A raw hex in a
component is a bug unless it is a one-off scrim or overlay alpha.

## Gotchas that have already bitten

**`AlertDetail` is deliberately never remounted.** `AlertsPanel` renders it
without a `key` so arrowing through the feed swaps content in place and bulk
triage stays instant. Any `useState` you add inside it therefore survives the
swap and will appear against the *next* alert. Key the subtree that owns the
state, not the panel.

**Fixed pixel widths from Figma are desktop measurements.** `ClipCard` carried
the design's `w-[346px]`, which is its width at `lg` inside a 417px panel — on a
phone that left a dead 54px strip. Let containers drive width; keep the design's
fixed values for heights and gaps only.

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
