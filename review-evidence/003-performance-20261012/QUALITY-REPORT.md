# Track 003 independent QA

Result: PASS for tested optimized delivery and primary behavior, with explicit NOT RUN limits. This is not production release approval. The later track004 logo build occurred after measurements; this report certifies the frozen track003 loaded document and recorded fingerprints only.

## Measured performance

Installed Chrome via CUA; desktop1440x900, mobile390x844, DPR1, no CPU/network throttling, HTTPcache disabled. Local baseline8000 uncompressed plus remote fonts; final8001 Brotli plus identical self-hosted fonts. Three cold loads each width. OS/DNS/TLS caches and unrelated workstation/browser load uncontrolled.

- Actual browser encoded HTML158979B (earlier desktop sample158942B before authored viewport-space restoration), CSS10187B, JS12550B; loaded font WOFF2 bodies30092/26992B. No Google-font network request in final resource list. All font faces loaded.
- Exploratory DOMContentLoaded median desktop424.1 to221.1ms (-47.9%), mobile332.9 to230.2ms (-30.9%); cold browser TaskDuration medians364.24 to229.56ms desktop,297.40 to242.26ms mobile. Local three samples do not predict field latency.
- Initial idle samples varied drastically with browser rendering load; excluded from causal CPU conclusions. Exact preserved baseline8002 and optimized8001 were subsequently paired in the same current browser environment, one3-second window per desktop section. Top TaskDuration187.56 to62.27ms/s (-66.8%); Network272.98 to235.36ms/s (-13.8%), style30.94 to10.91ms/s (-64.7%). About286.79 to292.68ms/s (+2.1%): no About task gain demonstrated. Broad stage observer retains motion when its tall bounds intersect the viewport margin.
- Normal visible top motion retained122 versus126 active animations; final Network0 versus126. Reduced-motion settled samples0 running loops both widths, versus baseline residual11/10. Immediate navigation/filter animation readings were transient and excluded.
- Mobile paired-current runtime improvement NOT RUN; mobile startup and final runtime measurements retained without a mobile CPU gain claim. No claim that performance is maximally optimized or that lag is eliminated.

## Behavior and appearance

PASS: desktop navigation; offscreen footer ForestWatch populated dialog, keyboard focus trap, Escape and focus restoration. Mobile visible menu/About/OurWork/Network navigation; tree Heartbeat dialog; ForestWatch content-card dialog; filtered Sierra member list opens Bluegrass Group SierraClub; settled empty search0 of106 and reset106. Canopy OurWork filter pressed state true. Startup document URL#leaf-forest-watch opens ForestWatch after reload. Same-document hash-only navigation does not open a dialog; source has startup-only hash handling, unchanged by this track.

PASS: About bounding gap32px desktop,20px mobile. Desktop mark alignment error<=0.047px; responsive desktop-mobile-desktop shifts return exactly. Mobile negative correction clamp remains0 for five headings, resulting1.45-4.55px offset; Gathering0.047px, preserved clamp behavior. Immediate postresize reads precede queued frame; settled readings used. Search stone checks show no changes outside member stratum; no clearance change happened in this query, so affected-stone completeness is NOT RUN. Deferred-font-load drift and offscreen direct leaf action beyond tested footer path NOT RUN.

Desktop top/About visual pairs preserve artwork, layout, typography and content; animation poses differ. Network screenshots use differing scroll phases, so exact anchoring comparison is NOT RUN. Mobile captures were inconsistently scaled/padded and one baseline Network capture actually shows About: mobile matched screenshot comparison NOT RUN. DOM width, gap, computed geometry and functional checks are independent of screenshot scaling. Normal/reduced screenshots preserved; no pixel-identity claim.

Console warning/error log empty at final inspection. Remote Heartbeat image remains a preexisting blocked resource from baseline; no claim of remote content availability repair. Fonts are local and loaded. Existing outgoing URLs retained; no external forms submitted.

## Limits

Actual hidden-tab document visibility could not be established through available CUA controls: NOT RUN, no simulated hidden flag. Long-task observer, field CWV/LCP/CLS, full accessibility audit, deferred font throttling, low-end hardware/network emulation, direct-file UI, Astelier launch, human production approval and production deployment NOT RUN. Browser cache, reduced-motion and viewport overrides restored. No product/state files edited by QA.

## Evidence

baseline-performance.json; final-performance.json; paired-performance.json; performance-comparison.json/md (raw unpaired idle rates explicitly unsuitable for CPU conclusion); before/after-desktop/mobile-top/about/network PNGs plus reduced variants; after-desktop-offscreen-dialog.png. All in this directory outside publish. Primary measured runtime result is paired-performance.json.
