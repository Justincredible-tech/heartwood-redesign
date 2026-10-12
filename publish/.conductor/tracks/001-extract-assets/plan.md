# Plan: Extract CSS and JavaScript

## Phase 1: Set up
- [x] 1.1 Read all 12 agents, AGENTS.md, _core.md and conductor.md; record team and scope [conductor].
- [x] 1.2 Preserve before.html outside publish for independent comparison [conductor]. Evidence directory: %TEMP%/heartwood-extraction-20261012.
- [x] 1.3 Capture baseline browser behavior and review scope [quality, tech-lead]. Baseline at 1440x1000 and 390x844: dialogs, Escape/focus restoration, focus containment, filtering, member search and reduced motion passed; desktop keyboard navigation passed; mobile Menu opened, baseline mobile link navigation NOT RUN (initial probe targeted hidden navigation). No JS/console errors. Evidence: baseline-results.json, baseline-*.png and cua-baseline-*.png outside publish. Google Fonts returned 200; preexisting Fall-2026.jpg request blocked by ORB. Tech review: no CSS url() rebasing or relative script-path hazards; preserve classic-script order.

## Phase 2: Build
- [x] 2.1 Extract stylesheet to css/heartwood-site.css [engineer]. Exact 72,700-byte payload preserved; independently verified.
- [x] 2.2 Combine unchanged 10,763-byte leaf-animation and 46,314-byte content/UI bodies into js/heartwood-site.js in original order [engineer]. Combined file: 57,077 bytes; superseded generated js/leaf-lift.js removed with exact-path and baseline-byte guards. Reason: independent review found a second-request gap could miss leaf:pick content initialization.
- [x] 2.3 Verify the combined script's original payload boundaries [tech-lead]. PASS: original body1 + body2 byte-for-byte; IIFE/semicolon and top-level const scope reviewed, no strict/module/TDZ behavior change. Single request removes introduced initialization gap.
- [x] 2.4 Link one classic end-body script in heartwood-site.html [engineer]. HTML 979,410 bytes; stylesheet link preserved, single script at original end-body region. Independent reconstruction review passed.
- [x] 2.5 Check exact extraction and JavaScript syntax [tech-lead]. PASS: exact CSS and JS payloads, HTML only expected replacements, reverse reconstruction matches original SHA-256 1e4beda9522e77881b272fe88d699989823c63698a89d9a9495d22c47202378c; node --check exits 0. Evidence: independent-tech-review-final.json outside publish.

## Phase 3: Check
- [x] 3.1 Map standalone entry point in .conductor/launch.json [conductor]. Mapping: {"file":"heartwood-site.html"}; JSON parsed and project-relative HTML existence verified. HTTP HTML/CSS/JS return 200 with correct content types on port 8000; mapping itself has not been launched through Astelier.
- [x] 3.2 Independently verify HTTP desktop/mobile interactions and capture screenshots outside publish [quality]. PASS: visible mobile Menu navigation, desktop navigation, keyboard card/leaf/group dialogs, Escape/focus restoration, desktop focus containment, inert background, canopy filter, member search/empty/reset, unchanged counts, reduced-motion entrance suppression. Final console error/warning logs empty. See QUALITY-REPORT.md and final-browser-results.json in archived evidence.
- [ ] 3.3 Verify final direct-file browser loading [quality]. NOT RUN: automatic browser security policy rejected file:// navigation, allows HTTP(S) only and prohibited workaround. Prechange direct-file baseline passed; final relative paths and payloads passed static review. No final direct-file UI claim.
- [ ] 3.4 Verify cold start, repeat launch and primary flow through Astelier Projects [quality]. NOT RUN: no available Astelier app/tab surface. Mapping exists; operator launch gate remains pending.
- [x] 3.5 Record review findings, verification limits and handoff [conductor]. Extraction implemented and HTTP verified; broader production readiness and the launch gate are not signed off. Evidence archived outside publish at ../review-evidence/001-extract-assets-20261012/.

## Handoff

Final application files: heartwood-site.html, css/heartwood-site.css and js/heartwood-site.js. Inline generated artwork geometry and runtime styles remain as scoped. No dependencies added, deployment performed, Git initialized, instruction files edited or production approval claimed.

Independent source evidence: independent-tech-review-final.json. Browser evidence: QUALITY-REPORT.md, baseline-results.json, final-browser-results.json and screenshot files. Original before.html and verification scripts are archived with the evidence outside publish.

Limits: exact pixel comparison and final full-page CUA screenshots NOT RUN (capture sizes varied / timeout). Desktop viewport screenshot captures entrance animation; desktop/mobile modal screenshots show rendered content; settled mobile screenshot supports visual inspection. Final browser network-event proof NOT RUN (history truncated); local HTTP resources returned 200 with correct types and fonts CSS GET returned 200.

Existing production followups: cover image blocked by ORB before extraction and direct GET returned 403; Forest Watch destination GET returned 403 in this environment. Destination availability and public claims require later review. Reduced-motion leaf transitions remain 0.28s; full accessibility/screen-reader/performance verification is not certified. Launch checks above remain pending; keep the track open for those checks.
