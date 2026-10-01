# Terra Sentinel — Design System

A dark, technical, instrument-panel UI for operators watching a fleet of camera
towers. This document is the complete visual language: every token, convention
and rule needed to reproduce the look in another codebase, in any framework.

It is written to stand alone. File citations (`src/index.css`, etc.) are there
so anyone holding the original repo can verify a value, but nothing here
requires it.

**Source stack, for context:** React 19 + TypeScript, Vite, **Tailwind CSS v4**,
`motion` v12 (`motion/react`) for JS animation. There is **no `tailwind.config.js`** —
Tailwind v4 declares its theme in CSS, so the entire token set lives in an
`@theme { }` block in `src/index.css`. If you are porting to a different stack,
that block *is* the design system; everything else is convention.

---

## 0. Quick start — 80% of the look in one block

Drop these in and the aesthetic is already recognisable.

```css
/* ── The 12 colours that carry the design ─────────────────────────── */
--color-ink:         #000000;  /* app background — pure black, not a dark grey */
--color-panel:       #1b1b1d;  /* panels, popovers, secondary buttons */
--color-card:        #161618;  /* cards, inputs */
--color-card-hover:  #1b1b1d;  /* fleet card at rest */
--color-card-lift:   #232325;  /* fleet card under the pointer */
--color-line:        #1f1f1f;  /* the hairline between surfaces */
--color-stroke:      #383838;  /* the one visible-ish stroke */

--color-muted:       #8d8d8d;  /* secondary text */
--color-sub:         #c1c1c1;  /* text that must stay readable at 12px */
/* primary text is plain #ffffff */

--color-terra:       #66e28e;  /* GREEN  = live / healthy */
--color-warn:        #ffdd70;  /* AMBER  = degraded */
--color-critical:    #ff5b53;  /* RED    = fault */

/* ── Type ──────────────────────────────────────────────────────────── */
--font-display: Quantico, ui-monospace, monospace;      /* 400, 700 */
--font-sans:    Sora, ui-sans-serif, system-ui, sans-serif; /* 300,400,500,600 */
```

```html
<!-- Both from Google Fonts -->
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Quantico:wght@400;700&family=Sora:wght@300;400;500;600&display=swap" rel="stylesheet" />
```

| Thing | Value |
|---|---|
| Base radius | **8px** (buttons, inputs, nav). 12px cards/popovers, 4px chips, `full` dots |
| Base gap | **8px**, then 6px and 4px. 4px grid, 2px steps at small sizes |
| Body text | **12–14px**, line-height **20px**, weight 400/500 |
| Elevation | **Almost no shadows.** Depth = surface lightness + 1px hairline |
| Icons | **No library.** Custom SVGs painted through a CSS `mask` so they take `currentColor` |
| Motion | Tweens only, never springs. 0.2s in / 0.16s out / 0.12s fade |
| Theme | **Dark only.** There is no light mode and no `dark:` variant anywhere |

**The one rule that matters most:** colour is reserved. Green, amber and red mean
*live*, *degraded*, *fault* — and nothing else in the UI gets a hue. Selection
and primary actions are **white on black**. A green "primary" button would read
as a status signal on a monitoring screen.

---

## 1. Colour system

### 1.1 Where colour lives

All of it is in one `@theme { }` block at the top of `src/index.css`. Tailwind v4
turns each `--color-x` into a utility automatically (`bg-x`, `text-x`,
`border-x`). To port: copy the custom properties into `:root` and map them to
whatever your framework uses.

### 1.2 Light vs dark

**Dark is the only mode.** `index.html` carries `class="dark"`,
`<meta name="color-scheme" content="dark">` and `<meta name="theme-color" content="#000000">`,
but this is decorative — there are **zero `dark:` variants** in the codebase and
no light palette exists. Do not build one expecting tokens to flip; the greys are
tuned against pure black and a light inversion would need a fresh palette.

### 1.3 Surfaces

The scale is deliberately tight — seven near-blacks within 0x23 of each other.
Depth is communicated by *small* steps plus a hairline, never by shadow.

| Token | Hex | Used for |
|---|---|---|
| `--color-ink` | `#000000` | App background, the nav rail. Pure black |
| `--color-panel` | `#1b1b1d` | Panels, popovers, secondary buttons |
| `--color-tile` | `#1a1a1a` | Video tile background |
| `--color-tile-dead` | `#141416` | **Every** dead tile — offline, connecting, error share one value so a reconnecting feed never flashes brightness as it changes state |
| `--color-card` | `#161618` | Cards, input fills |
| `--color-card-hover` | `#1b1b1d` | Settings rows / clip cards on hover; also the fleet card's **rest** state |
| `--color-card-lift` | `#232325` | The fleet card's hover state |
| `--color-card-line` | `#2c2c30` | Edge of a card containing a **photograph** — lighter, because it separates an image from black rather than one dark surface from another |
| `--color-pill` | `#262626` | Pill fill |
| `--color-pill-line` | `#333333` | Pill border |
| `--color-row-line` | `#252528` | Hairline *inside* a card (settings rows) |
| `--color-stage` | `#1b1b1d` | The surround a clip is reviewed against |

> Three tokens share `#1b1b1d` (`panel`, `card-hover`, `stage`) on purpose. They
> are different jobs that happen to agree today; keeping them separate means one
> can move without dragging the others.

### 1.4 Lines

Four distinct near-black strokes, all **1px**.

| Token | Hex | Used for |
|---|---|---|
| `--color-line-rail` | `#161616` | The nav rail's right edge — the darkest, barely there |
| `--color-line` | `#1f1f1f` | **The default.** Between surfaces, under headers |
| `--color-line-panel` | `#1e1e20` | Panel-internal divisions |
| `--color-stroke` | `#383838` | The one stroke meant to be seen |

Beyond these, translucent white borders are common for chrome over video:
`border-white/10`, `border-white/8`.

### 1.5 Text

| Token | Value | Used for |
|---|---|---|
| *(none — literal)* | `#ffffff` | Primary text. Set on `body` |
| `--color-sub` | `#c1c1c1` | One step above muted; a status word that must hold at 12px |
| `--color-muted` | `#8d8d8d` | Secondary text, labels, inactive nav |
| `--color-dim` | `rgba(207,207,207,0.63)` | Dimmed readouts |

Below that the design switches from tokens to **white with alpha**, which is the
dominant idiom for hierarchy over dark surfaces. Measured frequency:

```
text-white/85   emphasis on a coloured banner
text-white/75   tile fallback headline
text-white/70   secondary on a tile          ← most common
text-white/50
text-white/45   dead-state dot
text-white/40
text-white/35   supporting prose on a tile   ← most common
text-white/30   placeholder
text-white/25   an ABSENT value (see §5.9)
text-white/20   an absent value's glyph
```

Background alphas follow the same idea: `bg-white/5` (nav hover), `bg-white/6`,
`bg-white/8` (active nav), `bg-white/12` (secondary button hover),
`bg-white/20` (active tile control), `bg-white/25` (disabled fill).

### 1.6 Status colours — the reserved palette

This is the heart of the design. **Colour is never decorative.**

| Token | Hex | Meaning |
|---|---|---|
| `--color-terra` | `#66e28e` | **Green — live / healthy / good.** The brand colour *is* the "everything is fine" colour |
| `--color-warn` | `#ffdd70` | **Amber — degraded.** A reading that needs attention |
| `--color-detect` | `#f3cf58` | **Amber — a detection.** Slightly deeper than `warn`; used for detection boxes and "setup unfinished" |
| `--color-critical` | `#ff5b53` | **Red — a fault, or live transmission** (recording/siren) |

Supporting members of the same families, each with a stated reason to exist:

| Token | Hex | Why it is not one of the four above |
|---|---|---|
| `--color-detect-bg` | `#181509` | The near-black wash behind detect amber |
| `--color-alert-banner` | `#cd4f47` | A full-width banner sits over live video; `critical` at that width glares and pulls the eye off the feeds |
| `--color-alert-ink` | `#ffaea9` | `critical` at 13px on a 15% wash of banner-red is under 3:1 contrast; this clears it |
| `--color-advice-banner` | `#f5cc45` | A full-width amber bar carrying **near-black** text needs a deeper amber than `warn`, which is tuned as a reading on a dark surface |
| `--color-advice-ink` | `#110d00` | The near-black that sits on `advice-banner` |
| `--color-unseen` | `#e26666` | The one red that is *not* a fault: "this face has never been seen". Built as terra's mirror — same construction, channels swapped |

**The single blue:**

| Token | Hex | Rule |
|---|---|---|
| `--color-drag` | `#0f263f` | The fill a row takes **while being dragged**. Allowed precisely *because* it is outside the status set — it can say "you are holding this" without seeming to report on the site. It exists for the length of a gesture. Never spend it on anything that persists |

**Clip-player specifics** (a scrubber with detection bands):

| Token | Hex |
|---|---|
| `--color-track` | `rgba(217,217,217,0.74)` — the unplayed clip |
| `--color-mark-line` | `#275536` — darker edge so a 6px band reads as a band |
| `--color-mark-key` | `#d0eb76` — the moment the alert was raised |
| `--color-mark-key-line` | `#4a5527` |

### 1.7 State → colour conventions (copy these mappings)

**Feed / camera state** — a dot plus a display-font label:

| State | Dot | Animated |
|---|---|---|
| `live` | `--color-terra` | yes (`pulse-dot`) |
| `recording` | `--color-critical` | yes (`pulse-dot`) |
| `delayed` | `--color-warn` | no |
| `frozen` | `--color-warn` | no |
| `connecting` | `white/45` | no |
| `offline` | `white/45` | no |
| `unknown` | `white/45` | no |

> Note the reasoning worth copying: `unknown` is **grey, not amber**. Amber is a
> *reading* (degraded); an unreported camera is the *absence* of a reading. Grey
> and amber are different claims.

**Threshold tiers** — battery, disk and signal all use one vocabulary, so a
healthy disk is the same green as a healthy radio:

| Reading | Green (`terra`) | Amber (`warn`) | Red (`critical`) |
|---|---|---|---|
| Battery charge | ≥ 40% | 20–39% | < 20% |
| Disk **free** space | > 20% | 10–20% | < 10% |
| Link latency | < 80ms (rendered **white**, not green) | 80–249ms | ≥ 250ms |

**Online/offline** — a tower's row edge is `critical` and breathes when offline.

### 1.8 Other fixed colours

```css
/* Scrollbars — 6px, so a stray scrollbar never shifts the video wall */
::-webkit-scrollbar        { width: 6px; height: 6px; }
::-webkit-scrollbar-track  { background: transparent; }
::-webkit-scrollbar-thumb  { background: #2a2a2a; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #3a3a3a; }

/* Focus — green, 1px, offset 1px. The only global use of terra as chrome. */
:focus-visible { outline: 1px solid var(--color-terra); outline-offset: 1px; }

/* The siren overlay's red is its own literal, brighter than --color-critical */
rgba(255, 59, 48, 0.9)
```

One inconsistency worth knowing: the nav rail hardcodes `#cccccc` (as
`text-[#cccccc]/55` etc.) rather than using a token. If you are rebuilding,
promote it — it behaves as a fourth text tier between `sub` and `muted`.

---

## 2. Typography

### 2.1 Families

Two faces, both from Google Fonts, both load-bearing.

```css
--font-display: Quantico, ui-monospace, monospace;
--font-sans:    Sora, ui-sans-serif, system-ui, sans-serif;
```

- **Quantico** (400, 700) — a squared, technical, quasi-military face. Used for
  anything that should read as an **instrument**: status chips, labels,
  breadcrumbs, numeric readouts, nav text, badges. Note the fallback chain drops
  to `ui-monospace` — it is treated as the "machine" voice.
- **Sora** (300, 400, 500, 600) — a geometric sans. The **prose** voice: body
  copy, descriptions, error messages, form labels. Set on `body`, so it is the
  default and Quantico is applied deliberately.

`body` also sets `-webkit-font-smoothing: antialiased`.

`html` sets `-webkit-text-size-adjust: 100%` — without it iOS inflates text on
rotation, and on a monitoring surface that reads as *the data changing* rather
than the device turning.

### 2.2 The type scale

Sizes are written in `rem` (16px base). Ordered by real frequency in the app:

| rem | px | Frequency | Role |
|---|---|---|---|
| `0.75rem` | **12px** | 97 | The workhorse: labels, captions, secondary rows |
| `0.875rem` | **14px** | 75 | Status chips, breadcrumbs, headings in panels |
| `0.8125rem` | **13px** | 64 | Body prose, list rows, error text |
| `0.6875rem` | **11px** | 27 | Small caps labels, badges, fine print |
| `1rem` | **16px** | 11 | Primary buttons, input text |
| `1.125rem` | **18px** | 4 | Screen titles |
| `0.625rem` | **10px** | 4 | Micro-labels on video overlays |
| `1.25rem` | **20px** | 2 | The largest text in the app |

**There is no h1/h2/h3 scale.** This is a dense operator UI: the biggest text is
20px and appears twice. Hierarchy is carried by *weight, colour and font choice*,
not size. A "heading" is typically `font-display text-[0.875rem] tracking-[0.14px] text-white`
against `text-muted` siblings.

### 2.3 Line heights

Line-height is set in **px**, not ratios.

| Value | Frequency | Pairs with |
|---|---|---|
| `20px` | 96 | Almost everything — 12px, 13px, 14px and 16px text all use it |
| `16px` | 25 | 11px and 12px fine print |
| `18px` | 8 | 13px banner detail |
| `15px` | 9 | tight 12px rows |
| `14px` | 5 | 10px overlay labels |
| `24px` | 2 | the 18–20px titles |

**Rule of thumb: use 20px line-height unless the text is ≤ 12px and dense, then 16px.**
A handful of prose blocks use the ratio `leading-[1.5]`.

### 2.4 Letter-spacing — the signature convention

Tracking is **always positive, always tiny, and derived from the font size**:

> **tracking = font-size × 0.01** (i.e. 0.01em, written out in px)

| Font size | Tracking | Frequency |
|---|---|---|
| 14px | `0.14px` | 56 |
| 12px | `0.12px` | 31 |
| 13px | `0.13px` | 12 |
| 11px | `0.11px` | 13 |
| 16px | `0.16px` | 5 |
| 18px | `0.18px` | 4 |
| 20px | `0.20px` | 1 |
| 10px | `0.10px` | 3 |

This is applied almost exclusively to **`font-display` (Quantico)** text. Sora
prose is untracked. The effect is subtle but it is what makes the technical
labels feel engraved rather than typed.

**One deliberate exception:** the login organisation field uses
`text-[1.25rem] tracking-[0.2em] uppercase` — wide-tracked caps, the only place
`em` tracking appears, for a field where exactness is the point.

### 2.5 Weights, case and numerals

- `font-medium` (500) — dominant, 52 uses. The default for anything emphasised.
- `font-bold` (700) — 9 uses, all Quantico numerics (clocks, counters).
- `font-semibold` (600) — 3 uses. Effectively unused; prefer medium.
- Regular (400) is the unstated default for prose.

**`uppercase`** is applied to display-font labels and status words
(`LIVE: CAM 1`, `RECORDING 02:14`). Combined with Quantico + positive tracking,
this is the app's "instrument label" recipe:

```
font-display text-[0.6875rem] uppercase tracking-[0.11px] text-muted
```

**`tabular-nums` on every number that changes.** Clocks, latency figures,
counters, elapsed timers. Non-negotiable — a jittering timer in a control room is
unacceptable.

---

## 3. Spacing, radius, elevation

### 3.1 Spacing scale

Everything is written as explicit pixels in arbitrary-value syntax
(`gap-[8px]`), not a t-shirt scale. The underlying rhythm is a **4px grid with
2px half-steps** at small sizes.

**Gaps**, by frequency:

```
8px  (58) ← the default gap
6px  (41) ← tight groups: icon + label
4px  (22)
10px (17)
12px (15)
2px   (9)  ← inside a chip
20px  (6)
24px  (4)  ← nav stack rhythm
16px  (4)
```

**Horizontal padding**: `16px` and `14px` lead (23 each), then `8px`/`10px` (16),
`12px` (11), `6px` (12), `24px` (10).

**Vertical padding**: `6px` (12), `8px` (9), `12px` (9), `3px` (6), `4px`/`5px`
(5), `2px` (3).

Canonical combinations:

| Element | Padding |
|---|---|
| Panel / header | `px-[16px]` |
| Card interior | `px-[14px] py-[12px]` |
| Button (small) | `px-[10px] py-[3px]` or `px-[12px] py-[5px]` |
| Chip over video | `px-[8px] py-[4px]` |
| Micro badge | `px-[6px] py-[2px]` |

### 3.2 Border radius

```
8px   (53) ← THE DEFAULT. Buttons, inputs, nav buttons, small panels
full  (30) ← dots, pills, avatars
6px   (25) ← small buttons, compact badges
4px   (23) ← chips, tags over video
12px  (13) ← cards, popovers, the logo tile
3px    (7) ← micro labels
2px    (7) ← the smallest tags
10px   (3)
```

Rule:

| Size of thing | Radius |
|---|---|
| Card, popover, modal-ish surface | **12px** |
| Button, input, nav item | **8px** |
| Compact button / inline badge | **6px** |
| Chip over video | **4px** |
| Micro tag | **2–3px** |
| Status dot, pill | **`full`** |

> Stray values `5.818px`, `4.364px`, `17.62px`, `57px`, `60px`, `132px` are
> unconverted Figma exports on individual elements (the tile control buttons use
> `5.818px`). **Do not propagate them** — the canonical scale is above.

### 3.3 Elevation — the signature absence

**There is exactly one box-shadow in the entire application:**

```css
shadow-[0_16px_40px_rgba(0,0,0,0.7)]   /* the date-filter popover, only */
```

Everything else expresses depth with **surface lightness + a 1px hairline**.
This is a defining property of the look. If you add shadows, it stops being this
design.

The elevation ladder, lowest to highest:

```
#000000  ink        the ground
#141416  tile-dead
#161618  card
#1a1a1a  tile
#1b1b1d  panel / card-hover / stage
#232325  card-lift  (hover only)
```

Plus, for chrome floating over live video, a **backdrop blur** instead of a
shadow:

```css
@utility chip-blur { backdrop-filter: blur(5px); }
/* used with bg-black/45 … bg-black/55 … bg-black/50 */
```

### 3.4 Borders

All borders are **1px**. Colour by context:

| Context | Border |
|---|---|
| Between major surfaces | `--color-line` `#1f1f1f` |
| The nav rail's edge | `--color-line-rail` `#161616` |
| Inside a panel | `--color-line-panel` `#1e1e20` |
| Rows inside a card | `--color-row-line` `#252528` |
| Around a photograph | `--color-card-line` `#2c2c30` |
| Chrome over video | `border-white/10`, `border-white/8` |
| A fault | `border-critical`, or `border-critical/40` for a quieter outline |
| A detection box | `border-detect` with `bg-detect/20` |

---

## 4. Icons

### 4.1 No icon library

There is **no lucide, no heroicons, no font icons**. Every glyph is a
hand-exported SVG living in `public/icons/`, rendered one of two ways.

### 4.2 The MaskIcon system (monochrome glyphs)

Monochrome glyphs are painted as a **CSS mask** so they inherit `currentColor`.
This is the core icon primitive — port it verbatim:

```tsx
export function MaskIcon({ src, size = 24, className, background }) {
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "block",
        width: size,
        height: size,
        backgroundColor: background ? undefined : "currentColor",
        backgroundImage: background,
        maskImage: `url(${src})`,
        WebkitMaskImage: `url(${src})`,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        maskPosition: "center",
        WebkitMaskPosition: "center",
      }}
    />
  );
}
```

Two consequences worth understanding:

1. **Colour comes from the parent's text colour.** An icon inside
   `text-critical` is red; inside `text-white/20` it is a ghost. This is why the
   status palette applies to glyphs and text identically — you never colour an
   icon directly.
2. **`background` paints *through* the glyph.** Because the icon is a hole, a
   hard-stop `linear-gradient` passed as `background` turns a plain battery
   outline into a battery with a **level** — no second asset, no hand-drawn SVG.
   This is how the charge gauge works.

### 4.3 Multi-colour glyphs

Alert badges and link-quality icons keep their exported fills, so they render as
plain `<img width={16} height={16} alt="" />`. Rule: **if the glyph has more
than one colour, do not mask it.**

### 4.4 Sizes

| Size | Use |
|---|---|
| **24px** | Nav rail glyphs (dominant, 14 uses of `size-[24px]`) |
| **20px** | Header and toolbar icons (16 uses) |
| **16px** | Inline, beside text (9 uses) |
| 12–15px | Dense instrument cells |
| 32px | Rare, feature glyph |

There is **no stroke-width convention** — the glyphs are filled shapes, not
stroked outlines. The lone hand-drawn inline SVG (sign-out) uses
`strokeWidth="1.6"` with round caps and joins, which is the value to match if
you draw new ones in that style.

### 4.5 Custom glyph motifs

These are the recurring "instrument" shapes. Rebuild them as data-driven SVGs:

- **Status dot** — `size-[8px] rounded-full` (or `size-[6px]` in dense rows),
  filled with the state colour, `pulse-dot` when live or recording.
- **Signal bars** — a 3-bar ladder driven by a `data-bars="0..3"` attribute;
  unlit bars stay drawn but dark. An unmeasured radio shows an *empty* meter,
  never a hidden one.
- **Storage tank** — a vessel filled to `data-level="0..100"`, tinted by tier.
  A tower reporting no disk shows the tank at 0 and dark.
- **Battery** — a masked outline with a gradient `background` running from
  `4.17%` to `85.42%` of the icon width (the body, excluding the terminal nub),
  so the fill maps to the *cell*, not the bounding box.
- **Cabinet / door glyph** — two assets swapped by state (open vs shut).

> **Trap, if you export from Figma:** a mask keys on **alpha**, and Figma and
> browsers disagree about subpath winding. A subpath Figma renders as *filled*
> can render as a *hole* in the browser, punching a slot through the glyph.
> Always render a new mask asset at ~120px on a plain page before trusting it.

---

## 5. Component rules

Described as visual rules so they can be rebuilt in any stack.

### 5.1 The nav rail (sidebar)

```
width            71px, fixed, never collapses
background       --color-ink (#000000)
right border     1px --color-line-rail (#161616)

logo             39px box, rounded-[12px], centred, 6px from top
                 hover: bg-white/5
items            vertical stack, gap 24px, each button 34px square,
                 rounded-[8px], glyph 24px
```

States:

| State | Style |
|---|---|
| Active | `text-white` (+ `aria-current="page"`) |
| Rest | `text-[#cccccc]/55` |
| Hover | `bg-white/5 text-[#cccccc]` |
| Disabled / not built | `text-[#cccccc]/20`, `cursor: not-allowed`, still drawn |

> Convention worth stealing: a destination that exists in the design but has no
> screen yet is **drawn and dimmed, not removed** — a nav item removed is a
> feature nobody remembers to build.

### 5.2 Header / top bar

```
height    46px, fixed
border    1px bottom, --color-line
padding   pl-[16px] pr-[9px]   (asymmetric, per the design)
content   breadcrumb (left) · controls (right)
```

Breadcrumb links: `font-display text-[0.875rem] leading-[20px] tracking-[0.14px]
text-muted transition-colors hover:text-white`.

### 5.3 Buttons

**Primary — white on black.** Never coloured.

```
bg-white text-black rounded-[8px] font-medium
hover:bg-white/90
disabled:bg-white/25 disabled:text-black/40 (cursor: not-allowed)
heights: 57px (full-width form submit) · 39px (inline action)
text: 1rem / 0.8125rem, tracking 0.13–0.16px
```

**Secondary / ghost:**

```
bg-panel text-white rounded-[8px] transition-colors hover:bg-white/12
```

**Selected (in a segmented group):** `bg-white text-black`; unselected siblings
are ghost. Selection is *always* white-on-black — never green.

**Destructive / outline:**

```
rounded-[6px] border border-critical/40 px-[10px] py-[3px]
text-[0.75rem] font-medium text-critical
hover:border-critical hover:bg-critical/10
```

**Icon button:** `size-[34px]` (nav) or `size-[32px]` (tile control), square,
`rounded-[8px]`, glyph inherits colour, `hover:bg-white/5`.

All buttons carry `transition-colors` (150ms).

### 5.4 Inputs

```
rounded-[8px]
background   --color-card, or bg-black/25 when over a busier surface
padding      px-[14px] (px-[12px] when 36px tall)
text         #ffffff
placeholder  text-white/25 … text-white/30
focus        outline-none; focus-visible:outline-1 focus-visible:outline-terra
invalid      ring-1 ring-critical
disabled     text-white/40
heights      52px (login) · 48px (prominent) · 36px (compact)
```

Green is used for focus here and nowhere else as chrome — it is the one place
the brand colour is allowed to mean "you are here" rather than "this is live".

### 5.5 Cards and panels

```
rounded-[12px]
overflow-hidden
background    --color-card-hover (#1b1b1d) at rest
hover         --color-card-lift  (#232325)
transition    transition-colors
border        usually NONE — the surface step is the separation.
              A card holding a photograph gets 1px --color-card-line
```

Cards are **flat**: an unacknowledged alert does *not* raise the card. It gets a
coloured strip along the bottom edge instead. One signal, one vocabulary.

Content panels: `bg-panel`, `rounded-[12px]`, internal rows divided by 1px
`--color-row-line`.

### 5.6 Chips, badges and pills

**Feed chip** — the status chip over live video, the app's most recognisable
component:

```
chip-blur (backdrop-filter: blur(5px))
rounded-[4px] bg-black/50 px-[8px] py-[4px] opacity-80
gap-[6px] … gap-[8px]
  · 8px round dot in the state colour (pulse-dot when live/recording)
  · font-display text-[0.875rem] tracking-[0.14px] text-white tabular-nums
    UPPERCASE label: "LIVE: CAM 1" / "RECORDING 02:14: CAM 1"
  · 3px separator dot, bg-white/40
  · latency figure, coloured by threshold, + a 16px quality glyph
```

**Tinted badge** — a wash of the status colour with matching ink:

```
rounded-[4px] bg-terra/10  text-terra    py-[3px] pl-[8px] pr-[4px] text-[0.75rem]
rounded-[2px] bg-terra/15  text-terra    px-[6px] py-px  font-display uppercase
              bg-detect/20 text-detect                    (a "seeded / not real" badge)
              bg-critical/12                              (an error block, rounded-[12px] p-[14px])
```

The pattern: **`bg-<status>/10–20` + `text-<status>`**, never a solid fill except
for an active alarm.

**Micro label over video:**

```
chip-blur rounded-[3px] bg-black/55 px-[6px] py-[2px]
font-display text-[0.625rem] uppercase leading-[14px] tracking-[0.1px] text-white/85
```

**Status dot:** `size-[8px] rounded-full` (or `size-[6px]`), state colour,
`pulse-dot` only when live or recording. A notification dot over an icon adds
`ring-2 ring-ink` to punch it out of the glyph behind it.

### 5.7 Popovers and overlays

There is no conventional modal. The one floating surface:

```
absolute, z-50, w-[320px] max-w-[calc(100vw-30px)]
rounded-[12px] border border-white/10 bg-panel
shadow-[0_16px_40px_rgba(0,0,0,0.7)]     ← the only shadow in the app
```

Hover panels (e.g. the battery detail) use a different recipe — no shadow, a
blurred dark fill, and a scale-in:

```
rounded-[8px] bg-black/60 backdrop-blur-[4px]
opacity-0 scale-95 → group-hover:opacity-100 group-hover:scale-100
transition-[opacity,transform] duration-150 ease-out
```

### 5.8 The video tile and its controls

```
tile background   --color-tile (#1a1a1a); dead states --color-tile-dead (#141416)
overlay chips     top-left, 8–16px inset, max-w-[calc(100%-73px)] then truncate
controls          32px square, rounded-[5.818px], chip-blur

  rest     bg-black/45 text-white       hover:bg-black/65
  active   bg-white/20 text-white
  danger   bg-black/45 text-critical    hover:bg-black/65
  alarm    bg-critical text-white       (saturated fill, keeps its pulse)
```

Controls are **hidden until hover** (only an expand button persists) and reveal
in a downward cascade — see §6.4.

### 5.9 Absence — the most important content rule

Empty fields **stay visible and say why**. Never blank a row, never substitute
a zero, never hide an instrument because it has no reading.

```
value   an em dash "—" in text-white/25
glyph   still drawn, at text-white/20 (an empty tank, unlit bars)
label   still present
hint    a sentence on hover explaining WHY the value is missing
```

Visually this matters: the panel always has the same number of instruments, and
darkness is a legible state rather than a hole.

### 5.10 Signature motif — the "living instrument panel"

A fleet board where each tower is a row and each column is an instrument
(cameras, uplink, link, door, cover, temperature, storage, power, alerts).

```
cell        flex items-center gap-[7px] px-[10px], min-w-0
            data-cell / data-pending / data-alarm attributes drive styling
glyph       inherits the cell's tone
value       truncated text, tone-coloured, tabular-nums
row edge    a coloured left edge; breathes when the tower is offline
```

**The motion rule that makes it work:**

> **Red breathes, and nothing else does.**

`pulse-dot` (the same 2s heartbeat as the live dot) is applied *only* to cells in
`text-critical`. Amber deliberately stays still — on a fleet of twenty towers,
several degraded sites pulsing at once is a screen that fidgets, and the thing
the pulse exists for (one site in real trouble, seen from across a room) stops
working the moment everything moves.

---

## 6. Motion

### 6.1 The JS vocabulary — three tweens, no springs

All animated transitions come from one module. **Everything is a tween.**

```ts
/** Near-instant acceleration, long deceleration, hard terminal stop. */
export const ENTER = { duration: 0.2,  ease: [0.2, 0, 0, 1] };

/** Exits beat entries — the destination is already known. */
export const EXIT  = { duration: 0.16, ease: [0.3, 0, 0, 1] };

/** Opacity and in-place swaps. Linear, because eased opacity reads as lag. */
export const FADE  = { duration: 0.12, ease: "linear" };
```

In plain CSS: `cubic-bezier(0.2, 0, 0, 1)` at `200ms` in,
`cubic-bezier(0.3, 0, 0, 1)` at `160ms` out, `linear 120ms` for fades.

**Why no springs:** a spring overshoots its own bounds and settles back, which on
a wall of camera tiles reads as *the stream glitching* — the exact wrong reflex
to train in an operator. Deterministic durations are also load-bearing: a
fullscreen exit holds its z-index for the length of the animation, and a spring
has no length to hold for.

### 6.2 The CSS transition convention

`transition-colors` is used **97 times** and is effectively the default hover
treatment (Tailwind's default duration, **150ms**). Explicit durations appear as
`duration-150` (4), `duration-300` (6), `duration-0` (2); `ease-out` (6).

> **Trap worth carrying over:** two `transition-*` utilities on one element are
> **one** `transition-property` list, not two — the later one wins and the
> earlier animation silently never runs. Where an element needs several
> properties, declare them in a single list:
> `transition-[opacity,visibility,color,background-color] duration-150`.
> The same trap applies to colour: two colour utilities are one `color`
> declaration.

### 6.3 Standing keyframe animations

All defined in CSS, all independent of the JS layer.

| Name | Class | Timing | What it does |
|---|---|---|---|
| `sentinel-pulse` | `.pulse-dot` | `2s ease-in-out infinite` | opacity `1 → 0.35 → 1`. **The heartbeat.** Live dots, recording dots, red instrument cells. Held at 2s so it reads as a pulse, not an animation — operators stare at it for hours |
| `sentinel-sweep` | `.sweep` | `1.6s ease-in-out infinite` | `translateX(-100% → 100%)`. Loading shimmer |
| `sentinel-qr-scan` | `.qr-scan` | `2.4s ease-in-out infinite **alternate**` | `translateY(-100% → 250%)`. A beam travelling a QR code. `alternate` on purpose — a beam that jumps home reads as a progress bar restarting |
| `sentinel-siren-a` / `-b` | `.siren-a` / `.siren-b` | `900ms ease-in-out infinite` | opacity `0.12 ↔ 1`, the two layers **in antiphase**, each a pair of corner `radial-gradient(circle, rgba(255,59,48,0.9), transparent 42%)`. Opposite corners trade intensity so it reads as a *rotating* light, not a flashing rectangle |
| `sentinel-charge` | `.battery-charge` | `4s ease-in-out infinite` | `translateY(0 → var(--charge-gap) → 0)`, holding the peak from 55–70%. The cell fills from the true level to full, rests, and settles back. Ends where it started, so the real reading is where the cycle sits for most of its length |
| `sentinel-solar` | `.solar-charging` | `2s ease-in-out infinite` | `scale(1 → 1.12)` + opacity `1 → 0.7`. A sun brightening and swelling. It does **not** rotate — a rotating sun reads as a spinner, which would say "working on it" about a thing that is simply happening |
| `sentinel-bell-swing` | `.bell-swing` (hover) | `450ms ease-out` | `rotate(0 → -8° → 6° → -3° → 0)`, `transform-origin: 50% 15%` — a bell pivots from its crown |
| — | `.gear-turn` (hover) | `transform 240ms cubic-bezier(0.2,0,0,1)` | `rotate(60deg)`. **One notch, not a full turn** — a full rotation is a performance the second time |
| — | `.battery-fill` | `transition: fill 1.4s ease-out` | Colour crossing a threshold arrives as a fade, not a second tick |

### 6.4 The reveal cascade

Tile controls unpack **downward** rather than appearing as a block:

```css
.group:hover .tile-reveal,
.group:focus-within .tile-reveal {
  /* positional, against transition-[opacity,visibility,color,background-color]:
     opacity and visibility take the offset, colour and background take none */
  transition-delay: var(--reveal-delay, 0ms), var(--reveal-delay, 0ms), 0ms, 0ms;
}
```

`--reveal-delay` is set per button in **24ms** steps; with seven controls the
cascade runs 144ms front to back and has settled inside 300ms.

Two details that make it work:

- The delay lives on the **hover state**, not the element, so it applies on the
  way *in* only. Drop hover and the stack clears as one block — a staggered exit
  reads as chrome that cannot get out of the way.
- `transition-delay` takes a **comma**-separated list. Spaces make it invalid and
  the whole declaration is dropped silently.

### 6.5 Reduced motion

`@media (prefers-reduced-motion: reduce)` switches off every standing animation:
`pulse-dot`, `sweep`, `battery-charge`, `solar-charging`, `gear-turn`,
`bell-swing`, and the reveal cascade's delays.

Two considered exceptions:

- **The siren holds both layers lit at `opacity: 0.55`** rather than stopping —
  an alarm must still be unmistakable when *motion itself* is what the viewer
  cannot tolerate.
- **`.qr-scan` sets `opacity: 0`** rather than merely stopping — a frozen beam is
  noise, and a status line below the code already says the same thing in words.

---

## 7. Layout and density

### 7.1 The shell

```
<div class="flex h-[100dvh] w-full flex-col overflow-hidden bg-ink">
  <banner slot>                      ← takes space in the column, never floats
  <div class="min-h-0 flex-1">       ← the screen
    <nav rail 71px> <main flex-1>
```

The **shell owns the viewport height** and every screen inside is `h-full`. This
inverted once and is worth getting right: if both the shell and each screen claim
`100dvh`, a 43px banner pushes the bottom of every screen under the fold.

`overflow-hidden` at the root is deliberate — **the app does not scroll as a
page.** Individual panels scroll; the video wall never does.

`100dvh` (not `100vh`) for mobile browser chrome, and
`viewport-fit=cover` in the viewport meta.

### 7.2 Breakpoints

Effectively **one breakpoint**. Measured usage: `lg:` 87 times, `md:` once,
`2xl:` once.

| Prefix | Min-width | Meaning here |
|---|---|---|
| `lg:` | **1024px** | Desktop / operator workstation |
| (base) | — | Phone |

This is a two-mode design: a phone layout and a desktop layout, with nothing
between. On phone the rail is replaced by a bottom bar.

### 7.3 Density

**Compact, deliberately.** Reference measurements:

```
header height        46px
nav button           34px
nav stack rhythm     24px
body text            12–14px
line-height          20px
default gap          8px
card padding         14px × 12px
status dot           8px
```

For comparison to a typical web app: this is roughly one density step tighter —
a 46px header where most designs use 56–64px, 12px body text where most use 14–16px.

### 7.4 Max widths and grids

There is **no page-level max-width container** — screens fill the viewport, which
is correct for a wall of video.

Prose gets capped instead, at the point of use:

```
max-w-[240px]  supporting text on a tile
max-w-[280px]  empty-state copy
max-w-[360px]  error / explanatory paragraphs
max-w-[520px]  form columns
w-[320px]      popover
```

Grid conventions — the three real grids in the app:

```css
/* The camera wall. Capped at 2 columns because a tower has exactly 2 cameras
   and a row IS one site's pair. auto-rows-fr so every cell shares height. */
grid min-h-0 flex-1 auto-rows-fr grid-cols-2 gap-[8px]

/* The fleet board: a row per tower, a column per instrument. Built from
   role="row" / role="cell" divs rather than a <table>. The name column is
   elastic, the nine instruments share the rest, the last is fixed. */
grid grid-cols-[minmax(232px,1.7fr)_repeat(9,minmax(96px,1fr))_124px]

/* A card gallery — the ONLY place the other breakpoints appear. */
grid grid-cols-2 gap-[8px] md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5
```

That last line accounts for the single `md:` and single `2xl:` in the codebase —
they exist for one gallery, not as a general system.

---

## 8. The aesthetic, in words

**Dark, technical, instrument-panel. Calm until alarm.**

The ground is pure black — not a soft charcoal — and the surfaces above it are
seven near-blacks within a hair of each other, separated by 1px hairlines rather
than shadows. Nothing floats; there is one box-shadow in the whole application.
Depth is a half-shade and a line, which is what makes the UI feel like a
machine's front panel rather than a stack of cards.

Type does the talking. Quantico — squared, technical, faintly military — is the
machine's voice: every label, status word, counter and readout, uppercase, with
a whisper of positive tracking that makes it read as engraved. Sora carries the
prose. Text is small (12–14px) and tight (20px line-height) because the screen is
an instrument, not an article, and hierarchy comes from weight and colour rather
than size — the largest text in the app is 20px and appears twice.

Colour is rationed to the point of austerity. Green means live, amber means
degraded, red means fault, and *nothing else in the interface gets a hue* —
selection is white-on-black, primary actions are white-on-black, and the single
blue in the system exists only for the length of a drag gesture. On a wall of
twenty camera feeds, every extra colour costs scannability, so a coloured pixel
is always a reading.

And it holds still. The only standing motion is a two-second heartbeat — slow
enough to read as a pulse rather than an animation — applied to live dots and, on
the fleet board, to red cells and nothing else. Amber deliberately does not move,
because a screen where several degraded sites all breathe at once is a screen
that fidgets, and the one site in real trouble stops being visible from across
the room. Absence is drawn rather than hidden: an unmeasured instrument stays on
the panel, dark, with a dash beside it and a sentence on hover saying why. The
result is a surface that is almost entirely still and almost entirely
monochrome, so that when something does move or take on colour, it means it.

---

## Appendix — where each value lives (source repo)

| What | File |
|---|---|
| Every colour, font and keyframe token | `src/index.css` (`@theme` block) |
| Base layer, scrollbars, focus ring, cursors | `src/index.css` (`@layer base`) |
| Keyframes + reduced-motion overrides | `src/index.css` (bottom half) |
| JS motion vocabulary (`ENTER`/`EXIT`/`FADE`) | `src/lib/motion.ts` |
| Font loading + CSP + viewport | `index.html` |
| Icon mask primitive | `src/components/Icon.tsx` (`MaskIcon`) |
| Nav rail | `src/components/IconRail.tsx` |
| Header | `src/components/TopBar.tsx` |
| Status chip + feed-state colour map | `src/components/FeedChip.tsx` |
| Threshold tiers and tone helpers | `src/lib/battery.ts`, `src/lib/storage.ts` |
| Instrument-panel board | `src/components/TowersView.tsx` |
| Fleet card | `src/components/TowerCard.tsx` |
| Tile controls + reveal cascade | `src/components/ControlStack.tsx` |
| Absence / fallback states | `src/components/TileFallback.tsx` |
| Buttons + inputs (representative) | `src/components/LoginView.tsx`, `PeopleView.tsx` |
| Shell layout | `src/App.tsx` (~line 1439) |
| The design record and its reasoning | `README.md`, `CLAUDE.md` |

There is **no `tailwind.config.js`** — Tailwind v4 reads the `@theme` block
directly. Arbitrary-value utilities (`text-[0.8125rem]`, `gap-[8px]`) are used
throughout rather than a named scale, so the CSS values above are literally what
ships.
