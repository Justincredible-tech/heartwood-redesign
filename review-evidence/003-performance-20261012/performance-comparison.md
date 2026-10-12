CAUTION: raw initial before/after idle rates below were taken at different times with sharply different browser rendering load. They do not demonstrate a runtime regression or gain. Use paired-performance.json and QUALITY-REPORT.md for current-environment desktop runtime comparison. Startup three-sample medians are exploratory, local-only.

| Device | Metric | Before | After | Change |
|---|---|---:|---:|---:|
| desktop | DOMContentLoaded median ms | 424.10 | 221.10 | -47.9% |
| desktop | load event median ms | 426.00 | 224.70 | -47.3% |
| desktop | cold TaskDuration median ms | 364.24 | 229.56 | -37.0% |
| desktop | cold ScriptDuration median ms | 31.00 | 16.35 | -47.2% |
| desktop | cold LayoutDuration median ms | 32.69 | 26.10 | -20.1% |
| desktop | cold RecalcStyleDuration median ms | 90.53 | 76.80 | -15.2% |
| desktop | top taskMsPerSecond | 13.25 | 538.75 | +3967.3% |
| desktop | top styleMsPerSecond | 0.90 | 1.92 | +113.2% |
| desktop | top scriptMsPerSecond | 0.30 | 0.54 | +83.0% |
| desktop | top animations | 126.00 | 122.00 | -3.2% |
| desktop | about taskMsPerSecond | 27.82 | 284.43 | +922.5% |
| desktop | about styleMsPerSecond | 1.53 | 38.39 | +2406.1% |
| desktop | about scriptMsPerSecond | 0.34 | 3.07 | +815.1% |
| desktop | about animations | 127.00 | 126.00 | -0.8% |
| desktop | network taskMsPerSecond | 16.67 | 245.29 | +1371.1% |
| desktop | network styleMsPerSecond | 0.68 | 10.18 | +1390.3% |
| desktop | network scriptMsPerSecond | 0.22 | 3.09 | +1300.8% |
| desktop | network animations | 126.00 | 0.00 | -100.0% |
| mobile | DOMContentLoaded median ms | 332.90 | 230.20 | -30.9% |
| mobile | load event median ms | 376.20 | 238.70 | -36.5% |
| mobile | cold TaskDuration median ms | 297.40 | 242.26 | -18.5% |
| mobile | cold ScriptDuration median ms | 32.22 | 20.37 | -36.8% |
| mobile | cold LayoutDuration median ms | 38.28 | 26.61 | -30.5% |
| mobile | cold RecalcStyleDuration median ms | 84.43 | 75.76 | -10.3% |
| mobile | about taskMsPerSecond | 0.37 | 56.41 | +15104.9% |
| mobile | about styleMsPerSecond | 0.00 | 8.68 | n/a |
| mobile | about scriptMsPerSecond | 0.15 | 0.56 | +271.8% |
| mobile | about animations | 119.00 | 115.00 | -3.4% |
| mobile | network taskMsPerSecond | 15.82 | 150.39 | +850.5% |
| mobile | network styleMsPerSecond | 0.65 | 21.62 | +3205.2% |
| mobile | network scriptMsPerSecond | 0.23 | 3.00 | +1228.3% |
| mobile | network animations | 326.00 | 0.00 | -100.0% |
