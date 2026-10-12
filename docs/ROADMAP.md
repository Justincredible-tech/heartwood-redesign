# Living Tree v2: a proper rebuild with a day, dusk and night forest

Status: **planned**. Work happens on the `v2` branch. Each track below lands through its own pull request
into `v2`, and `v2` merges into `main` at release. `main` keeps matching the live site until then. The
starting point is tagged **`v1.0-iterative`**.

## Why

Living Tree is Justin Sparks's original design for Heartwood, drawn from his reference picture
([`docs/design/reference-day.png`](design/reference-day.png), 1508×1047; that width is the "1508 design px"
the code scales from). It was built in iterative steps, so the artwork ended up as inline styles on the page
itself:

| Measure (v1) | Value |
|---|---|
| Inline `style` attributes in `source/heartwood-site.html` | 2,697, on 3,672 elements |
| Size of those styles | 649 KB, of which 550 KB is `clip-path` polygon geometry |
| Distinct shapes | 1,014 |
| Distinct hard-coded colors in the artwork | 165 (the thing that blocks theming) |

The geometry exists only in that HTML; the tracing generator that produced it is gone.

Now that the final look is known, v2 rebuilds the site the way it would have been built with the design in
hand:

- the artwork as real vector files
- everything visual (color, texture, shadow, motion, theme) driven by stylesheet classes and design tokens
- day, dusk and night designed in from the start
- the forest following the real sun over Heartwood country
- at night: fireflies, bats, a barred owl, glowing jack-o'-lantern mushrooms and foxfire in the mycelium,
  all native to the region

## Decisions

- **Art format: SVG layers.** Every layer is a vector file you can open in Figma, Inkscape or Illustrator,
  with every piece carrying a class name that the stylesheet paints.
- **Time of day: Heartwood's sky plus a toggle.** By default the scene follows the real sun over Heartwood
  country (sunrise, sunset and twilight calculated in the browser; no location prompt). Visitors can choose
  Auto, Day or Night, and the choice is remembered.
- **Night creatures: drafted in the paper-cut style, approved before building.** Claude draws them as a design
  sheet in the style of the existing birds and bugs, and Justin approves it before anything goes into the scene.

## Target architecture

```
source/
  heartwood-site.html     semantic markup only; art included by placeholders  <!-- @art meadow -->
  art/*.svg               one file per layer (sky, hills, meadow, flowers, forest rows, tree, crown backing,
                          soil, mycelium, strata, stones, critter symbols); every piece a <path class="paper …">
  art/leaves.json         leaf placements (data). The build emits the 206 leaf <button>s, which stay HTML for
                          keyboard, ARIA and the leaf-flight animation
  css/                    split by concern, assembled under cascade layers:
                          @layer tokens, base, layout, components, scene, creatures, phases, motion
                          tokens.css   palette tokens for every artwork color (day values exact) + UI tokens
                          phases.css   [data-phase=dawn|day|dusk|night] token overrides, nothing else
  js/                     classic scripts concatenated by the build (no ES modules: the page must still open
                          straight from disk, and browsers block modules there)
                          sky.js (inlined in <head>: sets the phase before first paint), leaf-lift.js,
                          content.js (the SITE model), behaviors.js
```

### Key mechanics

- **Geometry conversion is exact.** A piece at `left/top/width/height %` with `polygon(px% py%)` becomes path
  points `x = (left + px·width/100)·W/100`, `y = (top + py·height/100)·H/100`, with `fill-rule: evenodd` kept
  where used.
  - Hero layers use the design viewBox `0 0 1508 1047`. The stage keeps its aspect ratio, so scaling is uniform.
  - Deep-strata layers use `preserveAspectRatio="none"`. They stretch with their text exactly as today's
    percentage polygons do.
- **SVG is inlined by the build.** Page CSS has to reach the paths, and `<img>` or external `<use>` would
  isolate them or break opening the file from disk.
- **The paper grain becomes one overlay** over static scenery (one element instead of about 1,600), reusing
  the tiles from `tools/render-grain.py`. Moving critters keep their own grain so the texture doesn't appear
  to slide over them. The spike (track 008) measures this choice.
- **Glows are baked, never animated filters.** Fireflies, foxfire and the mushrooms use glow images
  pre-rendered at build time and animate only `opacity`/`transform`. Track 007 showed that animated filter
  and clip work is where the GPU cost goes.
- **Phases switch in one step.** Phases are discrete: dawn, day, dusk, night. On a switch, `sky.js` changes
  `data-phase` inside `document.startViewTransition()` (an instant switch where unsupported), so the
  cross-fade runs on the GPU and the scene repaints once. A continuous color blend would repaint 1,600+ pieces
  every frame, about 1.2 s per repaint on a low-end phone.
- **Sun calculation.** NOAA sunrise/sunset and civil twilight are computed for fixed Heartwood-country
  coordinates (Paoli, Indiana) with the visitor's clock.
  - Toggle: Auto / Day / Night, saved in `localStorage` (Auto when storage is unavailable).
  - `?phase=night` (or `dawn`, `day`, `dusk`) forces a phase for demos, screenshots and share images.
  - The next boundary is scheduled with a timer, and recomputed when the tab becomes visible.
- **Creatures belong to phases.**
  - Birds and bees by day.
  - At dusk, fewer birds and the first fireflies.
  - At night, fireflies flash in the synchronous rhythm the Great Smoky Mountains are known for, bats replace
    the birds, a barred owl blinks and turns its head now and then, jack-o'-lantern mushroom clusters
    (*Omphalotus illudens*) glow faintly green, and foxfire (*Armillaria*) breathes through the mycelium.
  - Soil animals stay in every phase.
  - Hidden groups use `display: none`, so they cost nothing.
- **The JavaScript contracts are kept.** Data attributes (`data-leaf/item/kind/filter/open/path`), state
  classes (`is-lit`, `is-open`, `is-cleared`, `is-motion-paused` …) and ids (`stage`, `scrim`, `lift`, `dialog`,
  `hy-*`) stay. Selectors that target today's `<i>` pieces are updated to the SVG classes;
  `getBoundingClientRect` works on SVG paths, so the stone-clearing collision logic carries over.

## Tracks

Each track follows `publish/conductor.md`:

- a `spec.md` approved before its `plan.md` is written
- at most three phases
- small tasks tagged by role
- proof recorded after every step
- a pull request into `v2`, with before/after screenshots in every visual PR

Merges and deploys only happen with Justin's approval.

| Track | Goal | Gate to pass |
|---|---|---|
| **007 record** | Record the work already done: grain tiles, bee wings, favicon and share images, showcase packaging, deploy script, deploy approval gate. Add the reference picture to `docs/design/`. | Done with this roadmap |
| **008 foundation and spike** | Move the measuring tools from `review-evidence/007-…/` into `tools/quality/` as repeatable commands. Write `docs/ARCHITECTURE.md`. **Spike:** convert one hero layer group (hills + meadow + flowers) and one stratum to SVG with the grain overlay, then measure fidelity and performance against v1. Record the decision in `docs/decisions/0001-svg-art.md`. | Justin approves the side-by-sides and numbers. If SVG loses on speed or looks wrong, the record says so and the approach is revisited. |
| **009 art migration** | `tools/migrate-art.py` (one-time, kept for provenance) turns every scene layer into `source/art/*.svg` with semantic class names and every color into a palette token. Leaves go to `leaves.json`. The build inlines the art. JS selectors are updated. | Day mode visually equivalent to v1 and no slower (see Verification) |
| **010 stylesheet architecture** | Split the stylesheet into the cascade-layer files. Tokens for every color (day values exact). No inline `style` left in source except per-instance data such as leaf placement. Remove dead rules. | Same gates as 009. The only inline styles left in source are data. |
| **011 phases** | `sky.js` (sun math, phase, toggle, view transition, `?phase=`). Dusk and night palettes for scenery and UI, derived by `tools/derive-palette.py` (OKLCH: lower lightness, cooler hue, less chroma) plus a reviewed overrides file. Night sky gradient and stars (a static sprite, a few slow twinkles). The UI in dark: header, chips, cards, dialogs, footer. No new creatures yet. | Text contrast ≥ 4.5:1 for every UI pairing in every phase (automated). Justin approves per-phase screenshots. Every phase is no slower than v1 day. |
| **012 night design sheet** | Draft the fireflies, bats, owl, jack-o'-lantern clusters and foxfire in the same paper-ply style as today's critters, shown on a design-sheet page at real scale on the night scene. Includes a proposal for the moon (optionally its real phase). | Justin approves the sheet, with changes iterated in the PR |
| **013 night creatures** | Build the approved designs as SVG symbols with baked glows and opacity/transform-only motion. Synchronous firefly rhythm. Owl idle behaviors. Reduced motion: fireflies glow steadily, nothing flies. | Night no slower than day on every measure. Reduced-motion check. Justin's visual approval. |
| **014 release** | Refresh the showcase previews and share images (plus a night variant), mention night mode on the landing page, package, and deploy through the approval gate. Tag **`v2.0`**. Write a short case study from this history. | Live checks as for earlier deploys. Justin approves the deploy. |

## Verification

- **Day-parity oracle** (`tools/quality/visual.py`): full-page screenshots of `v1.0-iterative` and the
  branch, at 1440×900@1x, 768×1024@2x and 390×844@2x, with animations frozen at fixed times. A change must
  meet three bars:
  - mean color within ±0.5/255 per section
  - a grain-insensitive structural difference below the noise floor measured by comparing v1 with itself
  - no connected regions of large difference outside critter positions

  Differences are attached to the PR as amplified diff images, and Justin's eye is the final gate wherever
  the grain alignment changes.
- **Performance gate** (`tools/quality/perf.py`): desktop and emulated low-end phone (CPU 6× slower, slow 4G),
  three runs each, medians against v1 for:
  - first paint
  - blocked time
  - main-thread paint
  - GPU work while animating
  - layer count
  - renderer memory

  A regression of more than 5% blocks the PR unless Justin accepts it explicitly.
- **Behavior:**
  - `tools/test-delivery.py`, updated for the new structure
  - a scripted browser pass: a leaf opens its card, Escape returns focus, the topic chips filter, member
    search finds and resets, the deep link `#leaf-forest-watch` opens, reduced motion settles everything,
    and there are no console errors
- **Phases:** the sun math is unit-tested against published NOAA times for Paoli, Indiana (solstices,
  equinoxes and a daylight-saving changeover). Every `?phase=` value renders. The toggle persists and falls
  back cleanly without storage. The contrast test runs over every UI pairing in every phase.
- **Launch:** cold start and repeat launch via `.conductor/launch.json` (opening `publish/heartwood-site.html` directly)
  once the rebuild changes the entry structure.
- **Live** (track 014 only): HTTP delivery and browser checks after the upload is approved.
