# Track 005 independent technical review

**PASS for source fidelity, population reduction, build fidelity and local HTTP delivery.** No technical regression found in the reviewed change. Browser visual and interaction acceptance is handled separately by the quality reviewer; this report does not authorize release or deployment.

Reviewed the preserved before.html/CSS/JS snapshots against frozen canonical source, the engineering removal ledger, current generated release files and actual responses from the loopback preview at port 8001. Detailed independent measurements, original survivor ordinals, per-wrapper geometry checks and HTTP observations are in independent-technical-review.json.

## Population and structure

| Population | Before | After |
|---|---:|---:|
| Bees | 9 | 4 |
| Moving lower animals | 26 | 13 |
| Static fossils | 2 | 1 |
| Birds, protected | 9 | 9 |
| Physical rocks | 509 | 254 |
| Rock DOM pieces, including paired beds and faces | 729 | 359 |
| Tablet responsive-eligible physical rocks | 318 | 158 |
| Phone responsive-eligible physical rocks | 241 | 118 |
| Source HTML elements | 3,919 | 3,248 |

Whole surviving animal subtrees retain their original attributes, geometry, content and order. Surviving stone styles and geometry match the baseline; only the explicit responsive identity classes were added. All 126 rock wrappers remain, and all 42 inset bed/face pairs select identical original ordinals on both surfaces. Counting each pair once therefore measures physical rocks rather than double-counting decorative layers. Each of seven regions retains its six original rock colours.

Scene physical rocks change from 91 to 45; subsoil from 248 to 124; clay, sand, gravel, shale and bedrock from 34 to 17 each. The small additional tablet/phone rounding follows regional quotas. These responsive figures count stones eligible under breakpoint rules before the unchanged runtime text-collision clearing; they are not observed screen population measurements.

The retained deep stones' tablet-hidden classes correspond exactly to their original even ordinals, and phone-hidden classes exactly to original ordinals divisible by three. Replacing the old nth-child selectors preserves these identities after removals, with the same selector specificity and breakpoint scope. Paired bed and face identities remain aligned. There is no accidental mobile population increase caused by renumbering.

After removing only the authorized animal roots and stone children from both comparison documents, all remaining document structure, attributes and normalized nonblank text match. This covers tree/leaves, birds, flowers, structural artwork, inline final logos, content, header, footer and accessibility attributes. JavaScript, including SITE and interactions, is byte-identical to before.js.

## CSS and motion

Independent exact CSS reconstruction found only the two responsive selector replacements and deletion of unused bee-1, bee-3, bee-4, bee-6 and bee-8 keyframes. All four surviving flight keyframes are byte-identical to the baseline, and their paths remain bee-0, bee-2, bee-5 and bee-7. Other animation timing, filter, texture, shadow and reduced-motion rules are unchanged.

The final source hashes were rechecked after build and match the frozen source reviewed in the JSON evidence. No source editing was performed by this reviewer.

## Published fidelity and delivery

Parsed release HTML elements, attributes and normalized nonblank text match current source after accounting for intentional existing font preload and fingerprinted CSS/JS references. This comparison includes SVG geometry, inline logos and responsive identity classes. Source and published JavaScript both pass node --check.

| Release asset | Raw bytes | Gzip bytes | Brotli bytes |
|---|---:|---:|---:|
| HTML | 805,886 | 197,100 | 141,201 |
| CSS b665ff3c09c0 | 44,815 | 11,117 | 9,723 |
| JavaScript 246de01217fe, unchanged | 41,397 | 14,853 | 12,550 |

All six compressed artifacts independently round-trip to their raw files. All nine actual identity/gzip/Brotli responses decode exactly to current artifacts, return their correct HTML/CSS/JavaScript MIME types, carry Vary: Accept-Encoding and provide the expected HTML no-cache or fingerprinted immutable caching. Nine matching conditional requests return HTTP 304 with encoding-specific ETags.

## Limits

Browser screenshots, actual responsive rendering, motion appearance and interaction acceptance are not verified by this source/delivery review. Quality review is pending separately. No live Apache configuration, production server or deployment was tested. Reduced DOM and flight path counts are established; no new runtime performance improvement percentage is asserted here.

## Targeted follow-up on transient paint artifacts

Quality reported incomplete glyphs and absent canopy in initial captures. A targeted independent minified-CSS comparison ruled out unrelated optimizer changes: minifying the preserved before.css with the current font prefix and identical pinned clean-css settings, then applying only the two responsive stone-selector replacements and five unused bee-keyframe deletions, produces the current published CSS byte-for-byte. Therefore published font, text, clipping, stacking and leaf rules are unchanged. clearType only toggles visibility on stone children; neither it nor the responsive classes targets text or leaves. The unchanged finite leaf entrance uses backwards fill, so captures before the authored delay completes can lack canopy. No source-based text or leaf regression was identified.

Root relayed that quality's settled desktop About repaint restored complete glyphs with loaded fonts and unchanged intro DOM. Settled canopy and broader browser acceptance remain owned by quality. See targeted-paint-investigation.json for the exact minified comparison result.
