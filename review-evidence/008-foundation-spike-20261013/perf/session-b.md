# Performance: ea6daeb against track/008-foundation-spike

5 runs per side per profile, medians. Chrome, fresh browser per run, cache disabled.

## desktop (1440x900@1x, CPU 1x)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1076 | 1008 | -6.3% | 53.8 | better |
| blocked_ms | 0 | 0 | +0.0% | 10 | same |
| main_paint_ms | 399 | 391 | -2.0% | 20.0 | same |
| gpu_ms_per_s | 721.8 | 827.4 | +14.6% | 36.1 | REGRESSION |
| layers | 276 | 274 | -0.7% | 13.8 | same |
| renderer_mb | 116.6 | 106.0 | -9.1% | 5.8 | better |
| gpu_mb | 66.6 | 70.2 | +5.4% | 3.3 | REGRESSION |

## lowend (390x844@2x, CPU 6x, slow 4G)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1532 | 1316 | -14.1% | 76.6 | better |
| blocked_ms | 1149 | 1276 | +11.1% | 57.5 | REGRESSION |
| main_paint_ms | 2081 | 2179 | +4.7% | 312.1 | same |
| gpu_ms_per_s | 378.7 | 340.7 | -10.0% | 18.9 | better |
| layers | 88 | 88 | +0.0% | 4.4 | same |
| renderer_mb | 107.7 | 101.4 | -5.8% | 5.4 | better |
| gpu_mb | 14.1 | 14.2 | +0.7% | 1 | same |

