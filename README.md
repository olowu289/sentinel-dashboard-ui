# Sentinel — Tower View

Operator view for a single Sentinel tower: a stacked camera wall with live feed
chrome, and a real-time alerts rail. Built from the Figma frame
[`Terra Sentinel / Sentinel Tower View`](https://www.figma.com/design/a57qfGEtTBzzNj5R9DIJ8x/Terra--Sentinel?node-id=39-2626)
(node `39:2626`).

```bash
npm install
npm run dev     # vite, http://localhost:5173
npm run build   # tsc --noEmit && vite build
```

Vite 7 · React 19 · TypeScript · Tailwind v4 · Quantico (technical labels) +
Sora (content), loaded from Google Fonts in `index.html`.

## Layout

Matches the 1920×1024 frame exactly: 71px icon rail, 46px breadcrumb bar,
1417×481 tiles with a 6px gutter, 417px alerts panel. Below ~1600px the wall
flexes and the rail and panel hold their widths.

Two places the design contradicted itself and were normalised:

- Alert rows used a 36px badge gap on plain rows and 40px on rows with a clip.
  Everything is 40px, so text and clip cards share one left edge.
- Feed chips sat at `left 16 / top 8` on tile one and `left 9 / top 10` on tile
  two. Both are `left 16 / top 10`.

## States beyond the design

The Figma covers one moment: both cameras healthy, alerts flowing. The rest was
designed against the state grammar in `../SentinelTerra/UI-RESEARCH.md` plus
fresh Mobbin research. **Open them from the `⋯` button at the bottom of the icon
rail, or press `Shift+S`** — it toggles a feed-state simulator. That panel is a
review affordance, not product chrome.

**Feed states** — `state • duration`, one chip per tile, and the chip is the
only thing that asserts liveness. A tile with no chip reads as dead, which is
the safe failure mode for the frozen-frame trap.

| State | Chip | Body |
|---|---|---|
| Recording | red pulse + `RECORDING mm:ss` | video |
| Live | green pulse + `LIVE` | video |
| Delayed / Frozen | amber + elapsed | video |
| Connecting | grey `CONNECTING` | spinner, `Establishing secure stream` |
| Signal lost | amber | `Reconnecting… attempt 3 of 5` |
| Offline | grey `OFFLINE` | `Camera offline`, `Last seen 14:02` |
| Stream error | red `ERROR` | raw transport error + `Retry` |

Offline, connecting and error share one surface (`--color-tile-dead`) so a feed
recovering through them never flashes brightness. Only the terminal error tier
gets a button — the other two resolve themselves.

Latency is a live random walk pulled back toward each camera's baseline, held
inside one digit count (10–99, or 100–999) so the number never changes width
mid-tick. A `delayed` or `frozen` feed raises the floor, so the number can never
contradict the word beside it.

## Tile chrome is hover-revealed

Only the fullscreen button is permanent. PTZ and the action controls appear when
the pointer enters a tile — pointing a real camera head or opening a talk-down
channel should not be one stray click away. This is a deliberate exception to
the "never auto-hide controls on a monitoring wall" rule: feed identity, state,
latency and link quality all stay rendered at all times, so nothing diagnostic
is ever hidden — only the actuators are.

Hidden controls use `visibility`, not `opacity`, so they leave the tab order
rather than sitting invisible and clickable. The permanent fullscreen button
keeps the tile reachable by keyboard; focusing it fires `:focus-within` on the
tile and reveals the rest.

Top to bottom: fullscreen (permanent) · record · talk-down · sound alarm ·
capture still · zoom in · zoom out · camera overlays. Record, talk and alarm are
toggles and take a saturated fill when engaged; capture still is momentary and
answers with a shutter flash, because a capture that gives no feedback gets
taken twice.

## Alarm

Arming the siren lights the tile as a beacon: two layers of corner glows pulsing
in antiphase, so opposite corners trade intensity and it reads as a rotating
light rather than a flashing rectangle. The overlay never takes pointer events —
the operator must always be able to reach Silence.

The sound is synthesised in `useSiren`, not loaded from a file: nothing to ship
or license. A sawtooth carrier at 660 Hz is swung by a 0.55 Hz sine LFO (±300 Hz)
and rolled off through a lowpass, so it wails rather than beeps and carries
without being painful. Gain ramps in over 250 ms and out over 180 ms — stopping
an oscillator at full amplitude produces an audible click. Browsers refuse audio
outside a user gesture, which the arm click supplies.

A dead feed cannot be sounding an alarm at the site, so both the beacon and the
audio are gated on the feed being alive. Under `prefers-reduced-motion` the
beacon holds steady instead of pulsing — still unmistakable, just not moving.

## PTZ and zoom

The feed renders at `BASE_SCALE` 1.15 at rest so the head has somewhere to
travel — at exactly 1× a pan would just drag black in from the edge. Pan and
zoom are one CSS transform on the media element:

```
scale(BASE_SCALE * zoom) translate(x%, y%)
```

Pan is clamped to `(scale - 1) / (2 * scale)`, the point at which the media's
own edge would enter the frame. Zooming out re-clamps the pan rather than
leaving the frame parked outside its new envelope. Zoom runs 1×–3× and the
buttons disable at each end; the `1.4×` chip only appears once you leave 1×,
since a permanent `1.0×` on every tile is noise. Recentre resets both axes and
the zoom together.

Because this is a transform on the media element, it works unchanged on a
`<video>`. `CameraFeed.video` renders a looping muted clip in place of the
still whenever one is supplied — no other code changes needed.

**Alerts panel** — a quiet feed is a good state, so the empty state is
achromatic with no CTA. The *filtered* empty state is a different thing and does
get `Clear filters`, because there the operator caused the emptiness.

**Alert detail** — drills in over the panel so the video wall is never lost.
The triggering frame sits above all metadata. Empty fields stay visible
(`Not acknowledged`) because absence is diagnostic. The lifecycle lives on the
primary button — `Acknowledge` becomes `Resolve`, so you cannot resolve what you
have not acknowledged. `↑`/`↓` step between alerts without closing; `Esc` closes.

**Colour is reserved, not decorative.** Green = live. Amber = degraded or a
detection. Red = fault or live transmission. Nothing else gets a hue.

## Assets

All icons and stills are the exported Figma assets in `public/`. Monochrome
glyphs render through `MaskIcon` so they can take `currentColor` for hover and
active states; the multi-colour alert badges and link-quality icons render as
`<img>` to keep their exported fills. Stills were re-encoded from 12.2 MB of PNG
to 372 KB of JPEG.
