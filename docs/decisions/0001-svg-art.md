# 0001: SVG for the artwork

Status: **Proposed**, waiting for Justin's answer (track 008, task 3.3).
Date: 2026-10-13.
Evidence: `review-evidence/008-foundation-spike-20261013/`. The spike itself is on the throwaway branch `spike/008-svg`
(final commit `ea6daeb`), produced by `tools/spike/svgify.py` there.

## Question

The roadmap plans to move the v1 artwork (2,697 inline styles, 1,599 `clip-path` polygons, 165 hard-coded colours)
into SVG layers painted by classes and tokens, with the paper grain as one overlay. That is what makes dusk and night
possible. Before migrating everything (track 009), does SVG keep the look, and is it no slower?

## What the spike converted

| Part | v1 | Spike |
|---|---|---|
| Hero hills, meadow grass and flowers | 40 `.cut` sheets, 365 `<i>` pieces with percentage `clip-path` polygons | 40 inline `<svg viewBox="0 0 1508 1047">`, one `<path class="piece">` per piece, using the roadmap's exact transform |
| Gravel stratum stones | 24 `<i>` pieces in three stacked sheets (blurred bed, dark inner, shifted face via `::after`) | 24 HTML boxes, each holding an SVG path; the shifted face is a second path clipped to the stone |
| Grain on static scenery | on every piece (about 600 grain backgrounds in these areas) | one `.grain-sheet` over the hero scenery, one over the gravel stratum clipped along its torn edge |

Nothing else changed. The birds moved above the hero grain sheet so their texture stays their own; they fly at 4–14%
of the sheet height and the meadow starts at 37%, so no visible stacking changed.

## Findings

### Looks (`visual.py`, against the v2 commit the spike branched from)

| Size | Section colour shift (limit 0.5/255) | Structural difference (floor 0%) | Large-difference spots |
|---|---:|---:|---:|
| Desktop 1440x900@1x | 0.054/255 | 0.025% | 0 |
| Tablet 768x1024@2x | 0.170/255 | 0.054% | 0 |
| Phone 390x844@2x | 0.081/255 | 0.016% | 3 (grass-blade edges, a few px each) |

- The hero geometry converts exactly. What differs is the grain: one sheet runs continuously across pieces, where v1
  restarted the pattern at each piece's corner. The sky is identical because its grain origin did not move.
  (`side-by-side/meadow-desk-zoom.jpg`: v1, spike, difference x4.)
- SVG and `clip-path` anti-alias edges slightly differently. That is the phone's three spots.
- Gravel stones match, with one visible trace at 4x zoom: a slightly crisper dark rim on the upper-left edge of a stone
  (`side-by-side/gravel-stone-desk-x4.png`).
- The structural floor is zero, so the tool fails any change on purpose. **These differences need your eye**, and the
  grain-alignment change in particular is a design call (the roadmap names it as yours).

### Bytes and elements

| | v2 before spike | Spike |
|---|---:|---:|
| Elements | 3,274 | 3,352 |
| Inline style attributes | 2,697 | 2,333 |
| `clip-path` styles | 1,599 | 1,211 |
| Page HTML, Brotli | 141,323 B | 136,372 B (−3.5%) |

Path data with three decimals and absolute coordinates made the page **15% bigger** compressed. One decimal place with
relative moves (at most 0.05 artwork units off, about 0.05 px across a 1440 px stage) makes it 3.5% smaller. Track 009
should use that encoding.

### Performance (`perf.py`, against the v2 commit the spike branched from)

Two separate sessions, five interleaved runs per side per profile, medians. Session A measured the idle GPU window
inside the load trace; session B, after a fix to `perf.py`, measured it as its own trace after the page settles.

| Measure | Desktop A | Desktop B | Low-end A | Low-end B | Reading |
|---|---:|---:|---:|---:|---|
| First paint | +2.2% | −6.3% | −9.8% | −14.1% | **Better on the low-end phone** (both sessions); desktop same or better |
| Blocked time | 0 → 0 | 0 → 0 | −11.7% | +11.1% | Inconclusive: flips between sessions |
| Main-thread paint (load) | +4.7% | −2.0% | −2.3% | +4.7% | Same |
| GPU work while animating | −3.2% | +14.6% | +26.3% | −10.0% | Inconclusive: flips between sessions |
| Layers | 276 → 274 | 276 → 274 | 88 → 88 | 88 → 88 | Same |
| Renderer memory | −8.4% | −9.1% | −6.2% | −5.8% | **Better** (both sessions) |
| GPU memory | +5.4% | +5.4% | +0.7% | +0.7% | **Desktop +3.6 MB** (both sessions) |

Low-end GPU work is noisy by nature: even v1 against itself ranged from 199 to 329 ms/s per run, depending on what is
animating on screen in the five seconds measured. A per-thread breakdown of a settled page (three runs each) showed the
spike and its base doing the same work: GPU main thread 84–91 vs 84–85 ms/s, compositor about 30 in both. The likely
sources of the consistent results, not measured separately: fewer grain backgrounds to paint at first paint (about
600 fewer), and the grain sheet's own tiles for the GPU memory.

Measured while doing this: the leaf layers now live on `main` (track 016) cost **+29 MB of GPU memory** on desktop
against v1 (37.8 → 66.6 MB, every run) and probably more idle GPU work (+45%, noisy). That is about three times the
estimate in track 016's report, and it is a separate question from this decision (see the PR).

### Things the roadmap got wrong

1. **The strata do not fit one stretched SVG.** Stones are placed at a percentage of their stratum minus an offset in
   artwork units, and keep their own size; torn edges are full width but a fixed artwork height. A single
   `preserveAspectRatio="none"` SVG per stratum would distort every stone.
2. **Chrome ignores CSS `x`/`y`/`width`/`height` on a nested `<svg>`.** It computes them and lays the element out
   at full size anyway. The first spike attempt stretched all 24 stones over the whole stratum, and the stone-clearing
   script then hid them all. `visual.py` caught it as large-difference regions. Each stone therefore keeps an HTML box:
   two elements per stone instead of one.
3. **v1 stones are layered effects, not flat shapes.** The inner stone's lit face is a pseudo-element shifted by
   (1.3, 1.7) artwork units and clipped by the stone's `clip-path`. In SVG that needs a `<clipPath>` per stone, which
   duplicates its geometry.
4. **Soil sheets use a gradient sized to the artwork width**, not the element (`calc(50% + var(--shift))` over
   `--sheet-w`). SVG gradients cannot take that CSS length, so soil sheets were left as HTML.
5. **heartwood.org refuses the HeadlessChrome user agent.** Measuring v1 without a normal user agent drops its
   hot-linked photos and makes the page shorter. The quality tools now send a plain Chrome user agent.

## Recommendation: adjust

- **Adopt SVG for the hero scenery.** Tested here on the hills, meadow and flowers: exact geometry, no slower on any
  measure that two sessions agree on, smaller page, less renderer memory. Track 009 extends it to the clouds, forest
  rows and tree sheets under the same checks: flat fills, one viewBox, one-decimal relative paths, colours from tokens.
- **Do not convert the strata to SVG.** Keep their positioned HTML pieces and `clip-path`, and replace their hard-coded
  colours with tokens (`--c: var(--stone-4)`). Theming needs tokens, not SVG. SVG there costs elements and duplicate
  geometry and gains nothing that tokens do not already give.
- **Grain sheet: your call.** One element instead of about 600 grain backgrounds, and probably part of the first-paint
  gain. It changes how the grain sits on each piece: continuous across the scene instead of restarting at every
  piece. SVG has no cheap way to restart the grain at every piece, so if you prefer the v1 look, the hero needs a
  different grain approach, which I have not tested; that would be worked out before track 009.
- Update the roadmap and `docs/ARCHITECTURE.md` (strata section) to match whichever answer you give.

## Answer

*Waiting for Justin.*
