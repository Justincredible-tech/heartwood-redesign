# Plan: About heading spacing

## Set up
- [x] Record the user's request and locate the shared .layer__head margin [conductor]. Current clamp: 1.75rem, 4vw, 3rem.
- [x] Capture desktop/mobile About baseline [quality]. Heading-to-intro gap and header margin: 48px at 1440px, 28px at 390px; #work control matches. Before screenshots and measurements.json saved outside publish in ../review-evidence/002-about-spacing-20261012/.

## Build
- [x] Add About-only heading margin override in css/heartwood-site.css [engineer]. #about .layer__head uses clamp(1.25rem, 2.5vw, 2rem); shared rule unchanged. Expected gap: 32px desktop, 20px mobile.

## Check
- [x] Verify smaller gap and unchanged other-section margins at desktop/mobile; save screenshots [quality]. PASS: About gap 48px to 32px at 1440px, 28px to 20px at 390px; #work control remains 48px/28px. Measurements and four before/after screenshots saved outside publish in ../review-evidence/002-about-spacing-20261012/.
- [x] Record evidence and handoff [conductor]. One About-only CSS rule added at css/heartwood-site.css:659; no HTML/JS changes. Independent QUALITY-REPORT.md records PASS, stale stylesheet refresh and mobile screenshot scaling/padding limits (no exact pixel comparison). Browser cache and viewport settings restored. Existing Launch mapping is unchanged; no new entry-point validation required by this spacing change. No deployment performed.
