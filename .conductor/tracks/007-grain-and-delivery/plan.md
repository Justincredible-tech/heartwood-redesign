# Plan: Grain, delivery and the client showcase

Status: APPROVED 2026-10-12 (recorded after the fact)

All tasks were done and verified on 2026-10-12. Commits are on `main` (the import commit b979ab1 holds the work
done before the repository existed).

## Phase 1: Speed without visual change
- [x] 1.1 Draw the grain's fine layers once into density-matched lossless tiles; preload the matching tile, check: `python tools/test-delivery.py` — tools/render-grain.py [engineer] `b979ab1`
- [x] 1.2 Draw bee wings with border-radius instead of a clip-path mask, to remove the per-frame mask passes — source/css/heartwood-site.css [engineer] `b979ab1`
- [x] 1.3 Measure A/B against the previous build: desktop first paint 1,612 to 1,008 ms, low-end blocked time 795 to 394 ms, GPU while animating down 23%, renderer memory down about 33 MB; visual diff at grain level only — review-evidence/007-grain-and-motion-20261012/ENGINEERING-EVIDENCE.md [quality] `b979ab1`

## Phase 2: Showcase and previews
- [x] 2.1 Package the landing page as index.html with Living Tree, the mockups and the previews, and check every landing-page link resolves inside the package — tools/package-upload.py [platform] `b979ab1`
- [x] 2.2 Tree favicon and 1200x630 link-preview images with Open Graph and Twitter tags — tools/render-meta-images.py [designer] `293081f`
- [x] 2.3 Retake the Living Tree previews after the leaf-and-wordmark spacing fix — tools/render-previews.py [designer] `84faa9f`

## Phase 3: Deploy safely
- [x] 3.1 FTPS deploy confined to public_html/heartwood/, with a backup first, temporary-name uploads and the landing page last — tools/deploy-ftp.py [platform] `8a40c90`
- [x] 3.2 Desktop confirmation dialog before any upload (default No, five-minute timeout, fails closed) — tools/deploy-ftp.py [security] `0d90990`
- [x] 3.3 Live checks after the approved deploys: every file type byte-exact, br/gzip/identity, correct types and caching; browser pass on desktop and phone — tools/deploy-ftp.py [quality] `798df87`
