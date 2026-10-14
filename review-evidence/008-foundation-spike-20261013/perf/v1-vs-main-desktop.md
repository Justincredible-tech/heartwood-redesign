# Performance: origin/main against v1.0-iterative

3 runs per side per profile, medians. Chrome, fresh browser per run, cache disabled.

## desktop (1440x900@1x, CPU 1x)

| Measure | Base | Head | Change | Allowed | Verdict |
|---|---:|---:|---:|---:|---|
| first_paint_ms | 1304 | 1128 | -13.5% | 65.2 | better |
| blocked_ms | 0 | 0 | +0.0% | 10 | same |
| main_paint_ms | 193 | 340 | +76.2% | 9.7 | REGRESSION |
| gpu_ms_per_s | 497.8 | 724.2 | +45.5% | 24.9 | REGRESSION |
| layers | 101 | 276 | +173.3% | 5.1 | REGRESSION |
| renderer_mb | 105.7 | 115.5 | +9.3% | 5.3 | REGRESSION |
| gpu_mb | 37.8 | 66.6 | +76.2% | 1.9 | REGRESSION |

