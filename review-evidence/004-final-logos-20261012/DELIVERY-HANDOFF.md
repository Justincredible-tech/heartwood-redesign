# Heartwood performance and final-logo handoff

Follow-up during track005: browser connection recovered and scoped desktop/mobile logo rendering,320px header fit,800/801 footer appearance, themes and navigation/gap acceptance passed. Current results are in QUALITY-REPORT.md, with screenshots under ../005-decoration-density-20261012/. Earlier outage and byte sizes below describe the pre-density candidate; current density build details are in track005 package-results.json. Launch/Apache/whole-site release gates remain pending.

Final local candidate: generated publish/heartwood-site.html, css/heartwood-site.3dba10bf8924.css and js/heartwood-site.246de01217fe.js. Edit readable files in ../source and regenerate using ../tools/README.md; never hand-edit generated assets. No production deployment or release approval occurred.

## Final delivery

| Asset | Raw bytes | gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| HTML including final logo symbols | 921865 | 205927 | 145774 |
| CSS including local font faces | 51965 | 11993 | 10190 |
| JavaScript | 41397 | 14853 | 12550 |
| Core total | 1015227 | 232773 | 168514 |

Original core raw was1109255B; final Brotli core is84.8% smaller than that uncompressed baseline. Fonts and selected remote images are excluded from core totals. Compared with offline Brotli compression of the original core (190726B), the final core is11.6% smaller. The original production host's compression is not assumed. Actual local8001 HTTP negotiation is verified; ordinary Python8000 preview sends identity. Final Apache .htaccess is a staging candidate only, not a live hosting claim.

Nine local delivery/fidelity tests pass: original/source/minified HTML semantics, exact supplied logo geometry and original copies, font bytes/MIME, compression roundtrips, real identity/gzip/Brotli responses, encoding rejection/weights, cache/ETag, HEAD and public allowlist. Fifteen generated/compressed/font outputs are byte-identical on repeat builds (build-reproducibility.json). No new browser application dependency was added.

## Logos

The supplied finalLogos files remain intact. Clear names are source/assets/logos/heartwood-wordmark-original.svg and heartwood-oak-original.svg. The authoring heartwood-logos.svg and tools/import-logos.py retain exact paths, transforms, fill rules and viewBoxes. Only supplied monochrome fill becomes currentColor to retain theme contrast; header charcoal is#20241f. Two symbols embed once in HTML and all nine references remain internal; no new external SVG file-origin dependency. All other HTML artwork remains unchanged.

The new aspect ratio is2706/905. Header logo4rem/sticky header5rem, footer4.8rem; at<=360px header logo3.5rem accommodates the narrow layout constraints. Actual final responsive appearance and navigation acceptance are NOT RUN: CUA browser inventory lost its connection before logo QA, and root attempts to open Chrome/IAB also returned unavailable. QUALITY-REPORT.md explicitly retains the visual gate. Mathematical constraints and source checks do not substitute for screenshots.

## Performance evidence and limits

Before final logo integration, independent Chrome QA measured three local cold-load samples per width: median DOMContentLoaded424.1→221.1ms desktop,332.9→230.2ms mobile. These are exploratory local results, not field latency predictions. JavaScript fingerprint is unchanged by final logos; logo-era timings were not measured.

Paired current-environment desktop3s windows showed top TaskDuration187.56→62.27ms/s (-66.8%), Network272.98→235.36ms/s (-13.8%) and Network style30.94→10.91ms/s (-64.7%). About286.79→292.68ms/s (+2.1%) showed no task improvement. One window per section gives directional evidence. Historical idle samples were non-comparable and excluded from CPU conclusions; mobile paired CPU and actual hidden-tab state remain unverified.

Runtime code caches/batches geometry reads and class writes, merges dirty layout into requestAnimationFrame, debounces resize, and pauses decorative motion outside region bounds/in hidden documents. Normal visible artwork, leaf flight and dialogs remain. Settled reduced-motion loops fell to0 on desktop/mobile; Network loops126→0. Primary navigation, dialogs, focus trap/Escape/restoration, member search/reset and approved Roots32/20px gap passed track003 QA. Full results/limits and screenshots live in ../003-performance-20261012/QUALITY-REPORT.md. New-logo browser geometry still needs acceptance.

Launch mapping remains {"file":"heartwood-site.html"}. Direct-file browser acceptance, Astelier launch, Apache/staging delivery, remote blocked image repair, field CWV/low-end hardware tests and human release approval remain separate pending work. Browser preview for compressed delivery is http://127.0.0.1:8001/heartwood-site.html. Development metadata, source, tools and review evidence must stay out of the deployed release.
