# Project tracks

## Active
- [ ] 001-extract-assets: extraction implemented; independent byte/syntax review and HTTP desktop/mobile checks PASS. Final direct-file and Astelier Projects launch checks NOT RUN; launch gate pending. See tracks/001-extract-assets/plan.md.

## Next: Living Tree v2 rebuild (plan: ../../docs/ROADMAP.md; branch `v2`; baseline tag `v1.0-iterative`)
- [ ] 008-foundation-spike: move the measuring tools into ../../tools/quality/, write docs/ARCHITECTURE.md, and run an SVG-art spike on one hero layer group and one stratum against v1 (fidelity and performance). Spec: tracks/008-foundation-spike/spec.md (DRAFT, awaiting approval).
- [ ] 009-art-migration: all artwork to source/art/*.svg with class names and palette tokens; day mode equivalent to v1 and no slower.
- [ ] 010-stylesheet-architecture: cascade-layer CSS files and color tokens; no inline styles in source except per-instance data.
- [ ] 011-phases: sun-driven dawn/day/dusk/night with an Auto/Day/Night toggle; dusk and night palettes for scenery and UI; contrast checks.
- [ ] 012-night-design-sheet: draft fireflies, bats, barred owl, jack-o'-lantern mushrooms, foxfire and a moon; approval before building.
- [ ] 013-night-creatures: build the approved creatures with baked glows; night no slower than day.
- [ ] 014-release: previews, share images, landing-page copy, package, approved deploy, tag v2.0, case study.
- Production-readiness slices still to scope after v2: accessibility review, content and remote image/link review, security/hosting and release checks. Exclude development metadata and internal review artifacts from the deployed site.

## Done
- [x] 007-grain-and-delivery (recorded after the fact, 2026-10-12):
  - Paper grain's fine layers pre-drawn into density-matched tiles (tools/render-grain.py) and bee wings drawn with border-radius. Measured: desktop first paint 1,612→1,008 ms, low-end blocked time 795→394 ms, GPU while animating −23%, renderer memory about −33 MB. Evidence: ../../review-evidence/007-grain-and-motion-20261012/.
  - Showcase packaging with the landing page as index.html (tools/package-upload.py).
  - Tree favicon and link-preview images (tools/render-meta-images.py).
  - Refreshed landing previews (tools/render-previews.py).
  - FTPS deploy script with a desktop confirmation dialog (tools/deploy-ftp.py).
  - Deployed to https://justincredible.tech/heartwood/ with owner approval; live delivery and browser checks PASS.
  - GitHub PRs #1 and #2.
- [x] 006-upload-package: created upload-ready with index.html and exactly 16 public files (1,374,547 bytes). Source/hash, asset references, compression roundtrips, local HTTP availability and independent package review PASS. Upload instructions in ../../tools/README.md; evidence in ../../review-evidence/006-upload-package-20261012/. No deployment performed; target-host behavior remains unverified.
- [x] 005-decoration-density: bees9→4, moving soil critters26→13, fossils2→1, physical rocks509→254; independent source/delivery/browser scoped PASS. Counts and screenshots in ../review-evidence/005-decoration-density-20261012/.
- [x] 004-final-logos: final supplied vectors integrated and originals preserved; independent source/delivery review PASS plus recovered desktop/mobile browser acceptance during005. Evidence in004 QUALITY-REPORT.md and005 screenshots; release/launch gates separate.
- [x] 003-performance: local load/runtime optimization and lossless delivery implemented; independent review and scoped browser QA PASS. Limits in ../review-evidence/003-performance-20261012/QUALITY-REPORT.md; later logo acceptance completed in004/005.
- [x] 002-about-spacing: reduced Roots-to-introduction gap; desktop/mobile independent QA PASS, 2026-10-12. Evidence: ../review-evidence/002-about-spacing-20261012/.
