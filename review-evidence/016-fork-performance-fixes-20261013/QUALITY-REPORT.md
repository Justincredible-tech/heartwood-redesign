# Quality report: track 016, performance fixes from the fork review

Date 2026-10-13. Branch `justin/fork-perf-fixes` against `main` 798df87 (the live site). Chrome on Windows 11 with GPU
rasterization, 144 Hz display, Playwright headless; Playwright WebKit 26 for a Safari-engine smoke check.

## What changed

| Change | Files |
|---|---|
| Leaf layers: the 149 canopy leaves sit in unrotated `.leaf-layer` boxes, promoted on mouse devices while the tree is on screen | `source/js/heartwood-site.js` (top IIFE), `source/css/heartwood-site.css` |
| Home link: `id="top"` moved from the sticky header to `<body>`; header looked up by `.top` | `source/heartwood-site.html`, `source/js/heartwood-site.js` |
| Smooth scrolling turned on after load, so `#links` from outside jump | `source/css/heartwood-site.css`, `source/js/heartwood-site.js` |
| Self-hosted photos: 360/720/1080 px WebP of the Heartbeat cover and Forest Council poster, `srcset` + `sizes` | `tools/import-photos.py`, `source/assets/photos/`, `source/js/heartwood-site.js`, `tools/build-site.mjs`, `tools/package-upload.py`, `tools/test-delivery.py` |

## Method

`check016.py` runs the same session against each build served on 8003: settled screenshots at 1x and 2x (idle,
leaf hover, topic filter, keyboard focus, open dialog, after close, Forest Council poster, Heartbeat cover, News),
navigation, phone emulation, reduced motion, 7 cold loads, 3 x 100 random leaf hovers and Network hovers per density,
and WebKit. **All animations are frozen at the same time point before each screenshot**, so the same build twice gives
identical pixels (control: max difference 0–8/255, 0.0% of pixels). `compare016.py` diffs base against new.
`perf016.py` repeats load and hover in a fresh browser. The full session was run twice for each build.

## Results

### Looks

| View | Pixels changed | Largest change | Where |
|---|---:|---:|---|
| Desktop idle / hover / filter / focus (1x) | 0.24–0.59% | 38–66 of 255 | leaf outlines only, inside the crown |
| Same, 2x | 0.14–0.33% | 46–52 | leaf outlines only |
| Dialog open (leaf turned over) | 0.0003–0.0008% | 10–14 | invisible |
| Phone (390x844, 3x, touch) | 0 | 0 | identical |
| WebKit idle and hover | 0 | 0 | identical |
| Heartbeat cover | 40–47% of the cover | 252 | same picture, crop and size; text reads cleaner |
| Forest Council poster | 11–15% of the poster | 77 | same picture, crop and size |

The leaf-outline differences are anti-aliasing from each layer snapping to whole pixels. At 3x zoom the focused
leaf and its ring look the same (`screens/zoom-d1-focus.png`; the amplified diff is the right panel). Nothing outside
the tree crown and the two photos changes. Both runs gave the same numbers.

The photos differ because the old page made Chrome shrink a 3,075 px JPEG to 275 px on the fly, which leaves jagged
text; the new copies are resized properly beforehand (`screens/side-d1-cover.png`, `side-d2-cover-top.png`,
`side-d1-poster.png`: old left, new right). Displayed size is identical (275.06 x 354.36 and 246.7 x 326.9 CSS px).

### Speed

| Measure | Old | New |
|---|---|---|
| Tree hover p95, 1x (fresh browser) | 62.4 ms, ~276 late frames per 100 hovers | 7.0–7.1 ms, 0–7 late |
| Tree hover p95, 2x (fresh browser) | 62.6 ms, ~362 late | 7.0–7.1 ms, 0–2 late |
| Tree hover p95, full session runs 1 and 2 | 55.6 / 120–173 ms | 20.9 / 7.0 ms |
| First paint, fresh browser (warm runs) | 364–404 ms | 376–476 ms |
| First paint, full session runs 1 and 2 (medians) | 368 / 540 ms | 572 / 396 ms |
| Network hover p95, fresh browser | 13.8 ms | 13.6–13.8 ms |
| Bytes for the two photos | 7,206,426 (hot-linked) | 52–393 KB per file, e.g. 381 KB at 2x |

The machine had slow spells that hit whichever build was running at the time: run 1 slowed the new build, run 2 the
old one, by the same amount. Across four sessions there is no consistent first-paint or Network cost. The tree-hover
gain held in every session. Layer count at the top of the page rises from ~100 to ~270 (estimated +10 MB of layer
area at 1x, ~+40 MB at 2x); the extra layers are dropped when the tree scrolls out of view (`will-change` reads
`auto` with the Network on screen, `transform` again back at the top) and never exist on touch devices.

### Behaviour

| Check | Old | New |
|---|---|---|
| Header logo from 4,000 px | 3,470–3,588 | **0** |
| Footer "back to the top" logo | 7,257 (moved down) | **0** |
| Reduced motion, header logo | 3,470 | **0** |
| WebKit, header logo | 3,920 | **0** |
| Opening `#support` / `#network` / `#news` | glides through 81–134 positions | **2–3** (jump), lands 80 px under the header |
| Menu link after load | smooth | smooth |
| Header stuck shadow at 4,000 / clear at 0 | yes / yes | yes / yes |
| Leaf tag on hover, filter, dialog, Escape returns focus, member search, phone tap, reduced motion | pass | pass |
| WebKit hover tag and dialog | pass | pass |
| Page errors, console errors, failed requests | none | none |
| Requests to other sites | 2 (heartwood.org photos) | **none** |
| `source/heartwood-site.html` opened from `file://` | | 149 leaves wrapped, local cover loads, no errors |

`test-delivery.py`: 12/12 pass, including the new photo test, which was seen failing with a photo removed.

Found on the way: heartwood.org refuses the HeadlessChrome user agent, so the old page's photos depend on that host's
bot filter. The checks used a normal Chrome user agent so the old build's photos loaded.

## Not checked

Real Safari, Firefox, physical phones and tablets, the live Apache host (checked after deploy), GPU memory by a real
memory dump (the figure above is layer area). WebKit's Escape focus return failed in both builds (headless WebKit),
so it is not a regression. The skip-link probe hit the same test artefact in both builds.
