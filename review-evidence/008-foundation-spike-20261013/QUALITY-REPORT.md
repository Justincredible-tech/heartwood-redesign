# Quality report: track 008, foundation and SVG-art spike

Date 2026-10-13. Track branch `track/008-foundation-spike`; spike on the throwaway branch `spike/008-svg` (`ea6daeb`).
Chrome on Windows 11, GPU rasterization, Playwright headless. The decision and its reasoning are in
`docs/decisions/0001-svg-art.md`; this folder is the evidence behind it.

## Tools built (phase 1)

| Tool | Proven by |
|---|---|
| `tools/quality/refs.py` | builds and serves any ref; refused an occupied port; checks the served page is the build |
| `tools/quality/visual.py` | v1 against itself: zero on every bar, twice. v1 against `main`: flagged exactly the re-encoded Heartbeat cover and nothing else. Spike, first attempt: caught all 24 gravel stones missing |
| `tools/quality/perf.py` | v1 against itself, two sessions of 10 runs per profile; limits in `tools/quality/thresholds.json` |

Defects found in the tools while proving them, and fixed: nested RunTask events counted twice (GPU time doubled);
heartwood.org refuses the HeadlessChrome user agent (v1 pages captured 118 px short); the idle GPU window could catch
the tail of a slow load (now its own trace). Still a limitation: GPU work while animating and blocked time drift between
sessions by more than their limits, so a verdict on them counts only when two sessions agree.

## Files

| File | What |
|---|---|
| `side-by-side/scene-{desk,tablet,phone}.jpg` | the hero scene: v2 before the spike, spike, difference x4 |
| `side-by-side/meadow-desk-zoom.jpg` | the meadow up close: the only change is where the grain sits |
| `side-by-side/gravel-stone-desk-x4.png` | a gravel stone at 4x |
| `visual-v2-vs-spike.json` | the spike's own change, per size and section |
| `visual-v1-vs-spike.json` | against `v1.0-iterative`, which also includes PR #8's photos and leaf layers |
| `perf/session-a.*`, `perf/session-b.*` | spike performance, two sessions |
| `perf/noise-floor-v1-vs-v1.md` | the second noise-floor session |
| `perf/v1-vs-main-desktop.md` | what the live leaf layers cost against v1 (GPU memory +29 MB) |
| `gpuprobe.py`, `evidence008.py` | the per-thread GPU breakdown and the image cutter used here |

Full-page captures are not kept (tens of MB); rerun `visual.py` to regenerate them.

## Not checked

Safari, Firefox and physical devices; GPU memory on a phone-class GPU; the spike's other layers (clouds, forest rows,
tree), which track 009 would convert under the same checks.
