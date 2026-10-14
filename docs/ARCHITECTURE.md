# Living Tree architecture

How the site is put together now (v1), and the structure the v2 rebuild moves it to. The plan, its reasons and
the order of work are in [`ROADMAP.md`](ROADMAP.md); this document is the reference for what goes where.
Sections marked **Target** describe v2 and do not exist yet; everything else describes the code as it is.

## One page, built from source

Living Tree is one static page. Everything visitors receive is generated from `source/` by
`tools/build-site.mjs` (`npm run build` in `tools/`) into `publish/`:

| Source | Becomes |
|---|---|
| `source/heartwood-site.html` | `publish/heartwood-site.html`, minified; inline styles and scripts left alone |
| `source/css/fonts.css` + `source/css/heartwood-site.css` | `publish/css/heartwood-site.<hash>.css` |
| `source/js/heartwood-site.js` | `publish/js/heartwood-site.<hash>.js` |
| `source/assets/{fonts,grain,meta,photos}/` | copied to `publish/assets/…`, every file named by its content hash |

`tools/compress-site.py` then writes verified `.br` and `.gz` twins, and `tools/build-manifest.json` records the
outputs so the next build deletes only its own stale files. `publish/.htaccess` (tracked source) serves the
twins and gives hashed files a one-year immutable cache while HTML revalidates. `tools/package-upload.py` copies
an allowlisted snapshot for upload; `tools/deploy-ftp.py` sends it, behind a desktop confirmation.

The build works by exact string contracts and throws when one breaks: the stylesheet, script and Google Fonts
links in the source HTML, the `--grain-tile` declarations and their density media queries, hash-named meta
images, and photos the script names.

The script is one classic `<script>`, not ES modules, so the page opens straight from disk (`file://`), where
browsers refuse modules. **This stays true in v2.**

## v1: what the page is made of

- **Artwork** is about 3,600 elements in the HTML, most of them `<i>` pieces cut out with an inline
  `clip-path: polygon(…)`, positioned in percent of their layer and coloured inline: 2,697 inline style
  attributes, 165 distinct colours. The tracing generator that made them is gone; the HTML is the only copy of
  the geometry. Never run a formatter over it.
- **Paper grain** is a background stack on every piece: the fine half as pre-rendered tiles
  (`source/assets/grain/`, drawn by `tools/render-grain.py` from the `--grain-fine` recipe), the coarse half as
  live gradients.
- **The canopy** is 149 `<button class="leaf">` plus decorative leaves. The script sets each button in an
  unrotated `.leaf-layer` box, promoted to its own layer on mouse devices while the tree is in view, so a hover
  repaints one leaf (track 016).
- **Behaviour** (`source/js/heartwood-site.js`, top to bottom): leaf layers; leaf lift (the flight to the
  dialog, events `leaf:pick` / `leaf:open` / `leaf:close`); the `SITE` content model (words, links, cards,
  106 member groups, keyed by kebab-case ids and joined to leaves by `data-leaf`); panels, cards, canopy key,
  Network spores, header, smooth scrolling. Decorative loops pause off screen (`is-motion-paused` from an
  IntersectionObserver) and in hidden tabs (`is-motion-hidden`), and respect `prefers-reduced-motion`.

## Target: source layout

```
source/
  heartwood-site.html     semantic markup only; artwork included by placeholders such as <!-- @art meadow -->
  art/
    *.svg                 one file per layer: sky, hills, meadow, flowers, forest rows, tree, crown backing,
                          soil, mycelium, strata, stones, critter symbols
    leaves.json           leaf placements (data only)
  css/
    fonts.css             unchanged
    tokens.css            @layer tokens      palette tokens for every artwork colour + UI tokens
    base.css              @layer base        element defaults, type
    layout.css            @layer layout      page grid, sections, header, footer
    components.css        @layer components  cards, chips, dialogs, buttons
    scene.css             @layer scene       painting the art classes from tokens, grain overlay
    creatures.css         @layer creatures   birds, bees, soil animals; later fireflies, bats, owl
    phases.css            @layer phases      [data-phase=dawn|day|dusk|night] token overrides, nothing else
    motion.css            @layer motion      keyframes, pausing, reduced motion
  js/                     classic scripts, concatenated by the build in this order:
    sky.js                inlined in <head>: picks the phase before first paint
    leaf-lift.js
    content.js            the SITE model
    behaviors.js
  assets/                 fonts, grain tiles, meta images, photos (unchanged)
```

The cascade order is declared once, first: `@layer tokens, base, layout, components, scene, creatures, phases,
motion;`. Phases sit above scene so a phase can only change what tokens feed into; motion sits last so reduced
motion always wins.

## Target: the art pipeline

1. **One-time migration** (track 009, `tools/migrate-art.py`, kept for provenance) reads the v1 HTML and writes
   each layer as an SVG. A v1 piece at `left/top/width/height` percent with `polygon(px% py%)` becomes path points

   ```
   x = (left + px * width / 100) * W / 100
   y = (top  + py * height / 100) * H / 100
   ```

   with `fill-rule: evenodd` kept where the piece used it. Hero layers use the design viewBox `0 0 1508 1047`
   (the reference picture, `docs/design/reference-day.png`); the stage keeps its aspect ratio, so the scale is
   uniform. Deep-strata layers use `preserveAspectRatio="none"` and stretch with their text exactly as today's
   percentage polygons do.
2. **Every piece is a classed path**: `<path class="paper meadow__grass t3" d="…"/>`. No colour, shadow or
   texture lives in the SVG; the stylesheet paints classes from tokens. Each file opens in Figma, Inkscape or
   Illustrator.
3. **The build inlines the SVG** at its placeholder. Inline, so the page's CSS reaches the paths;
   `<img>` or an external `<use>` would isolate them and break opening from disk.
4. **Leaves stay HTML.** The build emits the leaf `<button>`s from `leaves.json`, because keyboard focus, ARIA,
   the leaf lift and the leaf layers depend on real elements.

## Target: tokens and phases

- `tokens.css` names every artwork colour (for example `--meadow-3`, `--soil-deep`) with today's value exactly,
  plus the UI colours. Day mode is defined as "these tokens", so day parity is a check, not an opinion.
- Dusk and night are token overrides in `phases.css`, derived by `tools/derive-palette.py` (OKLCH: lower
  lightness, cooler hue, less chroma) and corrected by a reviewed overrides file. Nothing else changes per phase:
  no per-phase selectors in other layers.
- `sky.js` computes sunrise, sunset and civil twilight (NOAA method) for Paoli, Indiana, with the visitor's clock,
  and sets `data-phase` on `<html>` before first paint. The visitor can choose Auto, Day or Night (saved in
  `localStorage`, Auto when storage is unavailable); `?phase=dawn|day|dusk|night` forces a phase for demos and
  screenshots. A timer moves to the next phase at its boundary and is recomputed when the tab becomes visible.
- A switch is one step: `data-phase` changes inside `document.startViewTransition()` (instantly where that is
  unsupported), so the cross-fade runs on the GPU and the scene repaints once. A continuous colour blend would
  repaint every piece every frame.
- **Creatures belong to phases**: birds and bees by day; fewer birds and the first fireflies at dusk; at night
  fireflies, bats, a barred owl, glowing jack-o'-lantern mushrooms and foxfire. Soil animals stay in every phase.
  Hidden groups are `display: none`, so they cost nothing.
- **Glows are baked**: glow images rendered at build time, animated only by `opacity` and `transform`. Animated
  filters and clip paths are where track 007 found the GPU cost.

## Target: grain

The paper grain becomes one overlay over the static scenery (one element instead of about 1,600), reusing the
tiles from `tools/render-grain.py`. Moving critters keep their own grain so the texture does not appear to slide
over them. Track 008's spike measures whether the overlay looks right and costs less.

## Contracts the rebuild keeps

- Data attributes `data-leaf`, `data-item`, `data-kind`, `data-filter`, `data-open`, `data-path`.
- State classes `is-lit`, `is-open`, `is-cleared`, `is-motion-paused`, `is-motion-hidden`, `is-stuck`,
  `is-smooth-scroll`.
- Ids `top` (on `<body>`), `stage`, `scrim`, `lift`, `dialog`, `hy-*`, and every section id.
- The leaf events and `window.leafLift.open()`.
- Selectors aimed at today's `<i>` pieces move to the SVG classes; `getBoundingClientRect` works on SVG paths,
  so the stone-clearing collision logic carries over.

## Measuring

`tools/quality/` measures the rebuild against v1 (the tag `v1.0-iterative`):

| Tool | What it does |
|---|---|
| `refs.py` | Builds any git ref in its own temporary worktree and serves it (base on 8004, head on 8005, registered in `D:/projects/PORTS.md`), after checking the served page is that build |
| `visual.py` | Frozen full-page screenshots at 1440x900@1x, 768x1024@2x, 390x844@2x; per-section mean colour, blurred structural difference, connected large-difference areas outside moving creatures; amplified diff images |
| `perf.py` | Desktop and low-end phone (CPU 6x, slow 4G), fresh Chrome per run, interleaved runs; first paint, blocked time, main-thread paint, GPU work while animating, layers, memory |
| `thresholds.json` | The noise floor of each measure (v1 against itself), which both tools use as their limits |

A change passes when `visual.py` and `perf.py` both pass against `v1.0-iterative`, `tools/test-delivery.py`
passes against a preview of the branch, and Justin approves the side-by-sides.
