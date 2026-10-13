# Performance: ea6daeb against track/008-foundation-spike

5 runs per side per profile, medians. Chrome, fresh browser per run, cache disabled.

## desktop (1440x900@1x, CPU 1x)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1068 | 1092 | +2.2% | 53.4 | same |
| blocked_ms | 0 | 0 | +0.0% | 10 | same |
| main_paint_ms | 402 | 421 | +4.7% | 20.1 | same |
| gpu_ms_per_s | 717.7 | 694.4 | -3.2% | 35.9 | same |
| layers | 276 | 274 | -0.7% | 13.8 | same |
| renderer_mb | 117.1 | 107.3 | -8.4% | 5.9 | better |
| gpu_mb | 66.6 | 70.2 | +5.4% | 3.3 | REGRESSION |

## lowend (390x844@2x, CPU 6x, slow 4G)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1476 | 1332 | -9.8% | 73.8 | better |
| blocked_ms | 676 | 597 | -11.7% | 33.8 | better |
| main_paint_ms | 2098 | 2050 | -2.3% | 314.7 | same |
| gpu_ms_per_s | 201.9 | 255.0 | +26.3% | 10.1 | REGRESSION |
| layers | 88 | 88 | +0.0% | 4.4 | same |
| renderer_mb | 110.8 | 103.9 | -6.2% | 5.5 | better |
| gpu_mb | 14.1 | 14.2 | +0.7% | 1 | same |

