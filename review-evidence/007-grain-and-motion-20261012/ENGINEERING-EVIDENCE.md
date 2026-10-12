# Track 007: paper grain tile and bee-wing shape

Result: two changes, both measured A/B against the frozen pre-change build, both visually checked. No production deployment or human release approval is implied.

## What changed

1. **Paper grain.** The eight fleck and fibre gradient layers (`--grain-fine`, unchanged recipe) are drawn once by Chrome into a 256px lossless WebP tile per screen density (`tools/render-grain.py`). The paper uses the tile plus the three live mottling layers: 4 background layers per piece instead of 11. The build preloads only the tile for the device's density.
2. **Bee wings.** `clip-path: ellipse(50% 50%)` became `border-radius: 50%`, which is the same inscribed ellipse but drawn into the wing's own layer, so the 9 Hz wing beat no longer needs a mask pass on every frame.

Nothing was removed, rasterised beyond the grain tile, slowed or reduced. Every critter, shadow, animation and shape is as authored.

## How it was found (ablations, desktop, unthrottled, single runs)

| Disabled for diagnosis only | First paint | Idle GPU |
|---|---:|---:|
| nothing | 1,480 ms | 715 ms/s |
| grain (all 11 layers) | 848 ms | 694 ms/s |
| drop-shadow filters | 1,232 ms | 392 ms/s |
| clip-paths | 1,312 ms | 527 ms/s |
| mycelium (12k-point shape) | 1,500 ms | 711 ms/s |

Grain dominated first paint and main-thread paint (low-end: Paint 1,252 to 336 ms with no grain). Mottle-only grain cost about 0, so it stayed live. Bees alone were about 300 ms/s of idle GPU. The wing mask accounted for about 90 ms/s, their shadows for most of the rest (kept: part of the look). Static-shadow groups showed no individual idle effect beyond noise.

## A/B results (medians of 3 cold loads, real HTTP via tools/preview.py, Brotli, cache disabled)

Desktop: 1440x900, DPR 1, no throttling. Low-end: 390x844, DPR 2, mobile, CPU 6x slower, 150 ms RTT / 1.6 Mbps.

| Metric | Desktop before | Desktop after | Low-end before | Low-end after |
|---|---:|---:|---:|---:|
| First contentful paint | 1,612 ms | 1,008 ms (-37%) | 1,768 ms | 1,384 ms (-22%) |
| Total blocking time | 0 | 0 | 795 ms | 394 ms (-50%) |
| Main-thread Paint during load | 108 ms | 42 ms | 1,279 ms | 687 ms (-46%) |
| GPU process busy during load | 4,908 ms | 4,124 ms | 5,948 ms | 4,363 ms |
| Idle GPU (animations running) | 878 ms/s | 678 ms/s (-23%) | 360 ms/s | 274 ms/s (-24%) |
| Idle main thread | 4.3 ms/s | 4.6 ms/s | 56 ms/s | 38 ms/s |
| Composited layers | 145 | 137 | 131 | 123 |

Raw per-run data: `desktop-old.json`, `desktop-new.json`, `lowend-old.json`, `lowend-new.json` (produced by `prof.py`).

Load-window main-thread total rose on desktop (about 690 to 1,580 ms) with Layerize and style. A fixed 5 s window from navigation explains it: the old build drew 284 frames with 7 main-thread frames, while the new build drew 526 frames with 99 main-thread frames. The old build was stalled behind grain raster and skipped most of the leaf entrance. Low-end over the same window: main thread +6% (2,764 to 2,923 ms) for 342 to 514 frames, with Paint 1,290 to 839 ms.

Memory after settling (memory-infra dump, renderer of the page; `mem.py`):

| | Desktop before | Desktop after | Phone before | Phone after |
|---|---:|---:|---:|---:|
| Renderer malloc | 85.5 MB | 51.1 MB | ~85.7 MB | 52.2 MB |
| Partition alloc | 12.7 MB | 8.9 MB | ~13.0 MB | 9.2 MB |
| Blink GC heap | 54.1 MB | 59.3 MB | ~57.3 MB | 54.9 MB |
| Renderer tile memory | 50.8 MB | 51.1 MB | ~21.2 MB | 21.3 MB |
| GPU process | 63.6 MB | 63.7 MB | ~27.7 MB | 28.5 MB |

Two dumps that caught an idle spare renderer (Blink GC 0.9 MB) are excluded.

## Visual fidelity

- Grain panels (`compare.py`), 8 paper colours, sizes 120 to 1400px, DPR 1 and 2: mean colour equal within 0.04/255; texture energy (high-pass std) 8.737 vs 8.757 at 1x, 8.863 vs 8.880 at 2x; per-pixel mean difference 2.4/255, max 34, which is pattern phase: fibres are anchored to each piece's centre live and to its corner in the tile. Tile seams: column-to-column change at seams 1.4 to 3.0, within the texture's own range everywhere else. See `grain-zoom-6x-old-left-new-right.png`.
- Whole page, animations frozen at the same time (`ab.py`): desktop 1440x8119 mean difference 3.09/255, p99 15, mean colour equal within 0.04; 0.002% of pixels over 40, all of them a centipede and a beetle a few pixels apart (animation phase, drawn identically; `fullpage-largest-diffs-old-left-new-right.png`). Phone 780x28842: max 34, none over 40.
- Each density fetched exactly one tile and used that same tile (DPR 1, 1.25, 1.5, 2, 3 checked).
- Bee wing: `border-radius: 50%` and `ellipse(50% 50%)` both give the ellipse inscribed in the border box.

## Delivery

`test-delivery.py`: 10/10 pass against this checkout's preview (`HEARTWOOD_PREVIEW=http://127.0.0.1:8003/`). New test fails when `--grain-fine` changes without rerunning `render-grain.py` (seen red by editing one alpha, green after restoring). It caught the preview still running pre-change code (tiles served `no-cache`); restarting fixed it.

## Limits

NOT RUN: real low-end hardware (emulation throttles CPU, not GPU; GPU figures are this machine's GPU), Safari and Firefox rendering of the tiles, Apache staging of the new `.htaccess` lines (`AddType image/webp`, immutable `.webp`), field CWV. The pre-existing layer promotion from full-scene animated critter wrappers ("Overlap", 53 layers) was investigated, not changed: a rectangular clip in place of the bird/bee clip-path did not reduce it, and Chrome's layer names were not obtainable here.
