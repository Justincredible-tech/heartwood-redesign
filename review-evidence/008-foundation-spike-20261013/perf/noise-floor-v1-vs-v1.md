# Performance: v1.0-iterative against v1.0-iterative

5 runs per side per profile, medians. Chrome, fresh browser per run, cache disabled.

## desktop (1440x900@1x, CPU 1x)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1040 | 1036 | -0.4% | 52.0 | same |
| blocked_ms | 0 | 0 | +0.0% | 10 | same |
| main_paint_ms | 321 | 320 | -0.3% | 16.1 | same |
| gpu_ms_per_s | 399.4 | 398.8 | -0.2% | 20.0 | same |
| layers | 101 | 101 | +0.0% | 5.1 | same |
| renderer_mb | 116.0 | 115.9 | -0.1% | 5.8 | same |
| gpu_mb | 37.8 | 37.9 | +0.3% | 1.9 | same |

## lowend (390x844@2x, CPU 6x, slow 4G)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1440 | 1472 | +2.2% | 72.0 | same |
| blocked_ms | 459 | 481 | +4.8% | 23.0 | same |
| main_paint_ms | 1319 | 1324 | +0.4% | 197.8 | same |
| gpu_ms_per_s | 208.4 | 221.8 | +6.4% | 10.4 | REGRESSION |
| layers | 88 | 88 | +0.0% | 4.4 | same |
| renderer_mb | 102.4 | 102.9 | +0.5% | 5.1 | same |
| gpu_mb | 14.2 | 14.0 | -1.4% | 1 | same |

