# Spec: Foundation and SVG-art spike

**Status: DRAFT.** Awaiting Justin's approval. `plan.md` is written only after a yes, per `conductor.md`.
Part of the Living Tree v2 rebuild: `../../../../docs/ROADMAP.md`. Work lands on branch `v2` via its own PR.

## Goal
Make the v2 rebuild measurable, then prove or disprove the SVG-art approach on a small slice before migrating
the whole scene. Two outcomes: repeatable quality tools, and a recorded decision backed by side-by-side images
and numbers.

## Requirements
- [ ] `tools/quality/perf.py` measures first paint, blocked time, main-thread paint, GPU work while animating,
      layer count and renderer memory. It runs desktop and emulated low-end profiles, three runs each, and
      compares a branch against the `v1.0-iterative` tag. It is promoted from
      `review-evidence/007-grain-and-motion-20261012/prof.py` and `mem.py`.
- [ ] `tools/quality/visual.py` captures full-page screenshots with animations frozen, at 1440×900@1x,
      768×1024@2x and 390×844@2x, and reports:
      - mean-color difference per section
      - a grain-insensitive structural difference
      - amplified diff images

      It is promoted from `ab.py` and `compare.py`.
- [ ] The noise floor of both tools is measured by comparing v1 with itself, and written into the tools as
      their thresholds.
- [ ] `docs/ARCHITECTURE.md` describes the target structure from the roadmap: source layout, art pipeline,
      cascade layers, tokens, phases and build steps.
- [ ] Spike, on a throwaway branch off `v2`:
      - convert the hero hills, meadow band and flowers, plus one deep stratum, from inline `clip-path`
        pieces to inline SVG paths with class names, using the exact coordinate transform in the roadmap
      - apply the grain as one overlay over static scenery
      - keep everything else unchanged
- [ ] The spike's side-by-sides (v1 against spike, at the three sizes) and its performance comparison are
      attached to the PR.
- [ ] `docs/decisions/0001-svg-art.md` records the decision (adopt, adjust or reject SVG), with the evidence
      and any grain or fidelity trade-offs stated plainly.

## Out of scope
- Migrating the rest of the artwork (track 009), splitting the stylesheet (010), phases and dark palettes
  (011), and new creatures (012–013).
- Any change to `main`, the live site, the showcase landing page or the mockups.
- New npm or Python dependencies beyond those already in `tools/package.json` and `tools/requirements.txt`.

## Risks / data touched
- **Grain look.** One overlay replaces per-piece grain, so the texture sits continuously across pieces.
  This is visible only up close, but it is the design, so Justin judges it.
- **Performance.** SVG paths with layer shadows could rasterize differently from clipped elements. The spike
  measures this before anything is committed to.
- **No sensitive data.** The tools run locally against `127.0.0.1` previews on ports registered in
  `D:/projects/PORTS.md`.

## Done-check
- `python tools/quality/visual.py --base v1.0-iterative --head v1.0-iterative` reports differences within
  the recorded noise floor (the tool agrees with itself).
- `python tools/quality/perf.py --base v1.0-iterative --head <spike branch>` produces the comparison table
  in the PR.
- The decision record is merged into `v2`, and Justin has said yes to its conclusion.

**Authorization:** Justin asked for the v2 rebuild plan and for it to be recorded before any work starts
(2026-10-12). This spec authorizes nothing until he approves it.
