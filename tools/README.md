# Heartwood optimized static build

Edit the readable files under `../source/`, not generated assets in publish:
- `source/heartwood-site.html`: markup and artwork.
- `source/css/heartwood-site.css`: site/artwork styles.
- `source/css/fonts.css` and `source/assets/fonts/`: exact self-hosted font subsets and their licenses.
- `source/js/heartwood-site.js`: content and interactions.
- `source/assets/logos/heartwood-logos.svg`: theme-aware vector symbols made from the final supplied logos. Exact renamed originals remain alongside it for provenance. Symbols are embedded once in the HTML so the page keeps its standalone entry behavior.

From this tools directory:

```powershell
npm ci --ignore-scripts --no-fund
npm run build
python preview.py --port 8001
```

With the preview running, `python test-delivery.py` checks artwork/content preservation, compression round trips and real HTTP delivery. It targets `http://127.0.0.1:8001/` unless `HEARTWOOD_PREVIEW` names another preview; check `D:/projects/PORTS.md` first, because another copy of this project may hold 8001 and the tests would then quietly check that copy instead. `python preview-baseline.py` optionally exposes only the three preserved original site assets on loopback8002 for paired performance comparisons; it never serves the evidence directory.

Build needs Node and Python with Brotli. Build-only package versions and integrity hashes are locked in package-lock.json; no npm package is used in the browser. Builds are offline after dependencies and fonts are provisioned. Existing Python Brotli is used only for offline compression, not for runtime browser code.

Build emits content-fingerprinted minified CSS/JS, an optimized HTML entry point, unchanged WOFF2 fonts and licenses, and verified lossless `.br` / `.gz` text variants. It preserves inline artwork styles, geometry and event handlers. The preview serves only generated public assets, listens only on loopback, refuses occupied ports, negotiates compression, sends representation-specific ETags and never lists directories.

Use the compressed preview at http://127.0.0.1:8001/heartwood-site.html (or the port you started it on) for delivery measurements. The old `python -m http.server` preview does not negotiate compressed files. Local tests do not prove the production host enables Apache rewrite, headers or MIME overrides.

The publish `.htaccess` follows Apache's [precompressed delivery guidance](https://httpd.apache.org/docs/2.4/mod/mod_deflate.html#precompressed). Apache must permit these directives; test HTTP status, Content-Type, Content-Encoding, Vary, cache invalidation and decoded content on staging before deploying. Content-fingerprinted assets may be cached for a year; HTML revalidates so rebuilds select the new fingerprints. Do not copy agents, Conductor metadata, internal review evidence, tools, node_modules or source into the public release directory.

Do not run `vendor-fonts.py` for ordinary rebuilds. It is an explicit asset-import step: downloads the original Google font CSS/WOFF2 files and SIL licenses, preserves Latin and Latin-ext coverage, and records exact URLs/hashes in font-provenance.json. Reimporting later could change a font version and requires visual review.

Browser visual/performance/regression evidence and before-sources live under `../review-evidence/003-performance-20261012/`. No production deployment or human release approval is implied.

Final logo evidence lives under `../review-evidence/004-final-logos-20261012/`. `python import-logos.py` regenerates the symbols from the two supplied files in `../finalLogos/`, verifies path geometry/transforms against the originals, and changes only the monochrome fill to currentColor for theme contrast. It updates the two inline logo symbols in the readable source HTML without changing other artwork. Final supplied files remain intact. Scoped desktop/mobile logo visual acceptance passed after the browser connection recovered during track005.

Paper grain: `--grain-fine` in the stylesheet is the recipe for the flecks and fibres. `python render-grain.py` has Chrome draw exactly that recipe into a 256px lossless WebP tile for each common screen density, saves them to `source/assets/grain/` with content hashes and a provenance file, and points the stylesheet's `--grain-tile` declarations at them. The build copies the tiles and preloads only the one each screen density uses. Rerun it after editing the recipe; `test-delivery.py` fails while the tiles are older than the recipe. It needs Python Playwright with installed Chrome, and Pillow. Measurements and the visual comparison are in `../review-evidence/007-grain-and-motion-20261012/`.

Decoration density evidence is in `../review-evidence/005-decoration-density-20261012/`: exact populations/removals, source review, delivery results and settled browser screenshots. Whole decorative nodes were removed from source; remaining shapes and motion are unchanged. Stable `stone--tablet-hidden` / `stone--phone-hidden` classes preserve each retained rock's original responsive visibility instead of relying on its new ordinal. The one-shot helper in the evidence folder is archival, not part of normal builds.

For a clean server upload snapshot, run `npm run build` then `python package-upload.py`. The default output is `../publish/upload-ready/`; upload its contents, including hidden `.htaccess`, into the server's site directory. By default it packages the client showcase: the homepage `index.html` is the design-concepts landing page from `../showcase/index.html`, the built site is `living-tree.html` (copied byte-for-byte from the generated entry along with its compression variants), the alternative designs from `../mockups/` go to `mockups/`, and the landing page's preview images from `../showcase/previews/` go to `assets/previews/`. The landing page and mockups get verified `.br` / `.gz` variants, and packaging stops if any link or image on the landing page points outside the package. Once the client has chosen, `python package-upload.py --site-only` packages the built site alone as `index.html`. Only allowlisted public CSS/JS/fonts/grain tiles/licenses, the showcase files and configuration are copied. Instructions, source, tools and evidence stay outside the upload folder.

Packaging never overwrites an existing snapshot; use `python package-upload.py --name upload-ready-v2` for a new one after later edits. The generated file/hash manifest stays in tools/upload-package-manifest.json. Server-specific Apache/compression and existing remote-content availability still require host verification; creating this folder performs no deployment.
