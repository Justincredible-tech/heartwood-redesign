# Independent technical review: Track 003

Decision: PASS for the local optimization candidate. Browser quality evidence and Apache staging/release approval remain separate gates. No production access, deployment or merge approval occurred.

## Source behavior and fidelity

- Readable source HTML remains byte-identical to the baseline.
- Parsed optimized document matches original element attributes and nonblank text, except the intentional font and fingerprinted CSS/JavaScript references. The authored viewport value is preserved.
- All 3,343 inline artwork style values, every SVG path, and all 3,909 body elements remain unchanged. No artwork rasterization, vertex reduction or content removal occurred.
- Baseline, readable source and minified JavaScript independently evaluate to the same ORIGIN/KINDS/SITE content model (26,147 JSON bytes).
- Geometry code caches static selector collections, reads collision rectangles before writing visibility, and coalesces dirty-region updates with requestAnimationFrame. Member search affects its own stratum; later strata move together. Font/resize invalidate all strata.
- Heading alignment keeps the same clamp and rounding. One-time local zero-shift overrides the inherited artwork crop offset; subsequent old-shift-plus-delta placement is algebraically equivalent and batches reads/writes.
- Offscreen/hidden-tab CSS selectors pause only ornamental infinite animation families. Visible motion paths, speeds and shadows remain authored; leaf highlights/entrances and dialog flights remain independent. Reduced-motion specificity also covers species overrides.
- No blanket content-visibility or containment was added. The inert absolute scene might be a future experiment, but this review found no measured reason to add its containment risks now.

## Build and delivery

- Installed build tools are pinned Terser 5.51.2, clean-css 5.3.3 and html-minifier-terser 7.2.0; no browser runtime dependency was added.
- Classic-script mode and preserved top-level names retain the public window.leafLift API and content-model binding semantics. Source JavaScript, minified JavaScript and build script pass node --check.
- Build cleanup targets only previously manifested, fingerprinted CSS/JavaScript paths inside publish. Source and tooling stay outside publish.
- gzip9/Brotli11 sidecars round-trip exactly. Actual HTTP identity/gzip/Brotli requests decode to the published originals; q preferences/rejections and 406 behavior pass in the local preview.
- Actual local MIME types, Vary: Accept-Encoding, no-cache HTML, immutable fingerprinted assets/fonts, and representation-specific ETag/304 behavior pass. Manifest allowlisting rejects agent documents, Conductor state, directory listings and traversal requests.
- Four local WOFF2 files match the recorded original Google source hashes and source copies. Latin/Latin-ext coverage and swap remain defined. A review finding of generic font MIME was corrected; all four now return font/woff2.

| Published artifact | Raw bytes | gzip bytes | Brotli bytes |
| --- | ---: | ---: | ---: |
| HTML | 969,687 | 220,491 | 158,979 |
| CSS | 51,910 | 11,978 | 10,187 |
| JavaScript | 41,397 | 14,853 | 12,550 |
| Total, excluding font files | 1,062,994 | 247,322 | 181,716 |

## Limits and remaining gates

- Browser timing, screenshots and interaction acceptance belong to independent quality evidence. Source invariants do not alone prove pixel equality or measured responsiveness.
- Apache .htaccess is a staging candidate, not a verified live server configuration. Its rewrites are guarded by mod_mime and mod_rewrite, with explicit WOFF2 MIME and precompressed media types. Real Apache module availability, encoding negotiation, no-double-compression and cache behavior were NOT RUN.
- Apache rules prefer Brotli whenever it is accepted and available, even when gzip has a higher positive q value. Python preview honors relative q weights. Preserve this distinction in staging verification.
- Human release/merge approval and existing end-user launch acceptance remain pending; this optimization review does not certify the whole site production ready.

Detailed independently collected evidence: independent-technical-review.json in this directory.
