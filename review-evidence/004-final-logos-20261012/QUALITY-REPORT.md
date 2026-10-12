# Track004 independent browser QA

Current result: PASS for scoped logo rendering, responsive legibility and preserved menu/anchor/gap checks. Browser connection recovered during005; details and evidence below. This is not whole-site production release approval.

Historical initial result: NOT RUN during the connection outage described below.

CUA previously selected Chrome browser1 became unavailable after track003 ended. Fresh inventory reported apps[] and browsers[]; one retry15seconds later returned the same empty inventory. No tab could be opened. No alternative UI technology or browser security workaround was used. Parent informed immediately.

Planned acceptance checks: all9 internal SVG references to inline symbols defined once visible with supplied transparent paths and theme colors; header/footer1440/390/320px overflow and legibility; footer800/801px breakpoint; sticky5rem header anchor clearance; About gap32/20px; keyboard home links and mobile menu; current build screenshot evidence. Every listed browser check is NOT RUN. Postlogo startup sample NOT RUN. No screenshots or browser overrides were created in this task.

Final candidate uses inline symbols defined once and9 internal references, preserving the standalone HTML entry. Authoring originals and sprite remain outside publish. No external sprite request is expected. Parent reports9 delivery tests PASS, including supplied geometry and embedded exactness; compressed HTML145774B, CSS10190B, JS12550B. The final <=360px CSS guard sets header logo3.5rem; default4rem, top-h5rem and footer4.8rem remain. Independent source review is in progress. Those are not independent browser rendering evidence and do not replace this NOT RUN result. Track003 performance measurements were captured before logo integration.

The new <=360px header guard is statically present but its actual320px layout is unverified. No release approval, deployment certification or acceptance of unchecked320px/header/footer geometry. Source/build evidence can be reviewed while browser connection is restored.


## Recovered browser follow-up during005 baseline

Chrome2 connection restored. Current final-inline004 build viewed before density publishing. PASS for all9 inline use elements resolving nonzero artwork BBoxes; two wordmarks and seven oak marks (six section labels plus network hub). Desktop1440 and mobile390 screenshots show legible header/footer and section/network logos with appropriate dark ink on light themes and pale ink on dark themes. Work/Gatherings/News supplemental screenshots plus005 desktop/mobile top/About/Network and footer captures provide rendering evidence. No external logo request is expected.

PASS320px header geometry: brandright209.17, Menu225.17-300.81 within305px usable pagewidth; clear logo-header-320-viewport.png shows fit. Footer800 uses two columns and801 four. At801 brand elementright291.23 intrudes9.5px into next navcolumnleft281.73, but supplied ink ends earlier: screenshot shows a clear gap and no text collision. This bounding-box nuance remains recorded; no page overflow demonstrated. Mobile footer390/320 and desktopfooter1440 inspected. Headerbottom80px, About gap32/20px. Mobile menu and semantic section anchor navigation operated; keyboard footer Tab focus appeared visibly. Production/direct-file UI launch and full accessibility audit remain NOT RUN. Initial NOT RUN above is historical; these specific recovered browser checks now PASS.

Evidence: ../005-decoration-density-20261012/baseline.json and logo-*.png; before-desktop/mobile-top/about/network.png. Cropped logo-header-320.png returned wrong region and is invalid; use logo-header-320-viewport.png. No blanket pixel identity or field-performance claim.

Final005 browser checks preserve menu/keyboard anchor navigation, About32/20px gap and9inline logo references. Scoped004logo visual gate is closed with actual recovered browser evidence; unrelated direct-file/Astelier/full-site release gates remain separate.
