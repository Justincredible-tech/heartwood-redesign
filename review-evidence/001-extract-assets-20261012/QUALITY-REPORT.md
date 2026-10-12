# Quality verification: extraction slice 001

Status: HTTP regression checks PASS; broader production acceptance remains pending.

Inputs: agents/quality-engineer.md, AGENTS.md, _core.md and the revised extraction spec. Outputs: baseline-results.json, final-browser-results.json, remote-resource-check.json and screenshots in this evidence directory. No application files or Conductor state were edited by Quality.

## Evidence and checks

- PASS: prechange baseline on installed headless Chrome at desktop 1440x1000 and mobile 390x844. Files baseline-desktop.png, baseline-mobile.png and baseline-*-dialog.png. Python browser script was run before CUA documentation restricted UI automation; no subsequent Python browser UI tests were run.
- PASS: final HTTP Chrome CUA checks at requested desktop/mobile sizes. One CSS reference css/heartwood-site.css and one classic script reference js/heartwood-site.js. Counts remain 20 cards, 149 assigned canopy leaves, 106 member groups and 7 canopy chips.
- PASS: desktop navigation to Our work; mobile visible Menu opens, Our work navigates to #work and menu aria-expanded becomes false. Baseline Python mobile hidden-navigation probe did not navigate and is NOT RUN as valid navigation evidence; baseline CUA separately verified Menu opening.
- PASS: keyboard Enter opens Forest Watch card and Heartbeat Spring 2026 canopy leaf; correct content, Close focus, Escape dismissal and focus restoration on desktop and mobile. Desktop Shift+Tab stays inside the dialog. Actual inert attributes were observed on both background page elements. The CUA read-only e.inert property was unreliable and was excluded from the verdict.
- PASS: desktop canopy Our work filter selects 7 leaves. Sierra search finds the same 6 of 106 names and lights 6 spores on desktop/mobile. Keyboard opens Bluegrass Group Sierra Club, Escape restores the group's button. Empty query results return 0 of 106; clearing restores 106.
- PASS, limited: reduced-motion emulation suppresses leaf entrance animation (animation-name none), and mobile leaf/group dialogs still open and close. The leaf's transition durations remain 0.28s in the existing stylesheet, so this does not certify complete reduced-motion conformance.
- PASS, limited: Forest Watch outgoing link retains https destination, target=_blank and rel=noopener. Remote destination availability could not be accepted: direct public GET returns HTTP 403 in this environment.
- PASS: final CUA captured console reports no error/warning entries; baseline reported no JavaScript page errors or console errors. CUA CDP network history was truncated and retained no events, so final browser network-event proof is NOT RUN.
- PASS: Google Fonts CSS direct GET returns 200. Baseline browser font CSS and both font files returned 200.
- Existing remote asset issue: Fall-2026.jpg was blocked by ORB in prechange baseline; direct final public GET returns 403. It is not an extraction regression.
- Independent tech review reported PASS: exact CSS bytes, both script bodies concatenated unchanged in original order, exact HTML outside replacements, baseline reconstruction and JavaScript syntax. This is source preservation evidence, not a substitute for unavailable launch tests.

## Screenshots and limits

Final CUA viewport and dialog screenshots are cua-after-desktop.png, cua-after-mobile.png, cua-after-desktop-dialog.png and cua-after-mobile-dialog.png. Existing baseline CUA screenshots are also preserved. Screenshot captures around viewport changes and animations had varying dimensions (the initial baseline mobile capture was cropped), so automated exact pixel comparison is NOT RUN. Settled screenshots support manual visual inspection; byte preservation provides the stronger design-preservation evidence. Full-page final CUA screenshots were NOT RUN after capture timed out; prechange Python full-page screenshots remain available.

## NOT RUN / pending

- Direct-file final browser UI: CUA automatic browser security policy rejected file:// navigation, permits only http/https and prohibited alternate-surface/CDP workarounds. No bypass attempted. Prechange direct-file baseline worked; final relative-file integrity is separately covered by static review.
- Astelier Projects Launch: no available app/tab surface. Launch mapping may be valid on disk but launch acceptance remains pending an operator check.
- Full accessibility audit, screen-reader test, Core Web Vitals budget, all external destinations/public claims and full production release acceptance are outside this mechanical extraction slice and were not certified.
- Browser viewport override and reduced-motion emulation were restored after testing.

No human approval, production deployment or release sign-off is claimed.
Screenshot clarification: cua-after-desktop.png was captured during entrance animation and shows the crown before leaf entrance completed; use it only as a loading-state artifact. cua-after-mobile.png was visually inspected after settling and matches the prechange mobile design. Dialog screenshots demonstrate correct final rendered content. No final exact desktop visual comparison is claimed.
