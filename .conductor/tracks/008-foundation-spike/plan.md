# Plan: Foundation and SVG-art spike

Status: DRAFT

Spec: `spec.md` (approved). Branch: `track/008-foundation-spike` from `v2`, with PRs into `v2`. The spike itself
lives on a throwaway branch `spike/008-svg` and is never merged.
Ports: claim free ones in `D:/projects/PORTS.md` before starting any preview (8003 is the registered Heartwood
preview).

## Phase 1: Set up
- [ ] 1.1 Build any git ref into a scratch worktree and serve it on a registered port, check: `python tools/quality/refs.py --ref v1.0-iterative --dry-run` — tools/quality/refs.py [platform]
- [ ] 1.2 Promote the performance harness (from review-evidence/007 prof.py and mem.py): desktop and low-end profiles, three runs, medians, comparison table, check: `python tools/quality/perf.py --help` — tools/quality/perf.py [engineer]
- [ ] 1.3 Promote the visual harness (from review-evidence/007 ab.py and compare.py): frozen full-page captures at three sizes, per-section mean color, grain-insensitive structural diff, amplified diff images, check: `python tools/quality/visual.py --help` — tools/quality/visual.py [engineer]
- [ ] 1.4 Measure the noise floor (v1 against v1) and save it as the thresholds both tools use, check: `python tools/quality/visual.py --base v1.0-iterative --head v1.0-iterative` — tools/quality/thresholds.json [quality]

## Phase 2: Build
- [ ] 2.1 Write the architecture document from the roadmap (source layout, art pipeline, cascade layers, tokens, phases, build steps) — docs/ARCHITECTURE.md [tech-lead]
- [ ] 2.2 Spike converter: hero hills, meadow band and flowers plus one deep stratum, from clip-path pieces to inline SVG paths with class names, using the exact coordinate transform; output only to the spike branch — tools/spike/svgify.py [engineer]
- [ ] 2.3 Spike stylesheet: paint the SVG classes from the existing colors and apply the grain as one overlay over static scenery — source/css/heartwood-site.css (spike branch only) [engineer]
- [ ] 2.4 Build the spike and capture v1 against spike side-by-sides at the three sizes, check: `python tools/quality/visual.py --base v1.0-iterative --head spike/008-svg` — review-evidence/008-foundation-spike-20261012/ [quality]

## Phase 3: Check
- [ ] 3.1 Performance comparison of v1 against the spike, three runs per profile, check: `python tools/quality/perf.py --base v1.0-iterative --head spike/008-svg` — review-evidence/008-foundation-spike-20261012/perf.md [quality]
- [ ] 3.2 Decision record: adopt, adjust or reject SVG, with the evidence and any grain or fidelity trade-offs stated plainly — docs/decisions/0001-svg-art.md [tech-lead]
- [ ] 3.3 Justin reviews the side-by-sides, the numbers and the decision; record his answer in the decision record — docs/decisions/0001-svg-art.md [pm]
- [ ] 3.4 Delivery tests still pass on v2 with the new tools present, check: `python tools/test-delivery.py` — tools/test-delivery.py [quality]
