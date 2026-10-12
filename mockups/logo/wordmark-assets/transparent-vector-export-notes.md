# Transparent vector exports

- Heartwood-Young-Serif-oak-wordmark-transparent.svg: approved wordmark composition, with eight Young Serif letter outlines and the traced oak mark. No font installation is needed.
- hardwood-T-11-oak-curved-forks-transparent.svg: isolated oak mark with close framing and 24 units of clear margin.

Both assets contain only vector paths for their artwork, use charcoal #20241f, and have genuinely transparent backgrounds and negative space. Neither asset embeds a raster image.

Responsive sizing: both root SVG elements now use width="100%", height="100%", and preserveAspectRatio="xMidYMid meet", with their original viewBox values. Opened directly in a browser, they fit the viewport and retain their proportions. Chrome verification at 1280x800, 640x480, and 360x800 confirmed both artwork bounds shrink to fit without clipping. The builder preserves these responsive settings when rebuilding.

For use as an HTML image, set the image element's responsive sizing as well:

```html
<img src="Heartwood-Young-Serif-oak-wordmark-transparent.svg" alt="Heartwood" style="display:block; width:100%; height:auto;">
```

The tree was traced directly from hardwood-T-11-oak-curved-forks.png with Potrace, using threshold 128, turdSize 20, alphaMax 1 and optTolerance 0.15. The original neutral-background wordmark files remain available.

Validation: the vector silhouette overlaps the original thresholded silhouette by 99.6160 percent at the original resolution. Both have one connected foreground region and one enclosed negative-space region. Both exported SVGs were rendered and visually inspected; transparent proof renders have zero alpha at the corners. The wordmark preserves the original outlined lettering and its placement.

Rebuild: first regenerate wordmark-assets/oak-T-11-vector-trace.svg with Potrace, then run wordmark-assets/build-transparent-vectors.py.
