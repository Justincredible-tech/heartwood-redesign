# Heartwood wordmark

Deliverables: Heartwood-Young-Serif-oak-wordmark.png (4000 x 1338) and Heartwood-Young-Serif-oak-wordmark.svg.

Text: Heartwood, with the t replaced by hardwood-T-11-oak-curved-forks.png.

Font: actual Young Serif Regular, downloaded from https://raw.githubusercontent.com/google/fonts/main/ofl/youngserif/YoungSerif-Regular.ttf. Font license is in wordmark-assets/YoungSerif-OFL.txt. Font source project: https://github.com/noirblancrouge/YoungSerif.

Foreground: #20241f. Background: #f3f0e9. The tree and letters share the same foreground fill. The text baseline matches the base of the tree icon. The crown extends above the lettering.

The SVG contains outlined Young Serif letterforms and an embedded raster icon, with an alpha mask applying the common ink color. It does not require an installed font. It is not an entirely vector-traced icon.

The built-in imagegen tool prepared the selected icon's transparent background. The native SVG wordmark was assembled with exact font outlines, then rendered to PNG with resvg. The reproducible assembly script is wordmark-assets/build-wordmark.py.

## Imagegen cleanup prompt

Edit target: the provided oak capital T icon. Prepare the EXACT SAME chosen logo mark for wordmark use. Remove the neutral background and make it genuinely transparent, including all branch-shaped negative space and openings under the crown. Preserve the precise silhouette, proportions, number and shape of canopy lobes, curved forks, crossbar, vertical stem, and serif foot. Use one uniform solid pure black ink color for all foreground shapes. No redesign, no text, no added marks, no shadows, gradients or texture. Keep the whole mark centered with margin on a square transparent canvas.

