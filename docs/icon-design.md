# Research Workbench Icon

The user selected the large R design generated with the built-in imagegen tool on October 9, 2026. The icon uses graphite (#202126), ivory (#F8F3EC) and violet (#9273D4). The diagonal leg carries a violet terminal segment.

The SVG follows the selected image silhouette. Its three paths represent the tile, the letter and the accent. The conversion removes raster texture and color noise while preserving the letter proportions, rounded corners and spacing. It contains no embedded raster image.

## Assets

- `build/icon-imagegen.png`: selected original imagegen output.
- `build/icon.svg`: vector master (three paths, about 12 KB).
- `src/assets/research-icon.svg`: application brand asset, identical to the master.
- `build/icon.png`: 1024-pixel render of the vector master.
- `build/icon-preview.png`: 256-pixel preview.
- `build/icon.icns`: Mac icon with 16–1024-pixel PNG-backed chunks.
- `output/icon-concepts/prompts.json`: prompt set for the three concept previews.

## Conversion

Three binary masks extracted the tile (alpha above 200), letter (all RGB channels above 150, alpha above 200) and lavender accent (blue minus green above 23, red above 150, alpha above 200). Each mask received a 1.5-pixel Gaussian smoothing pass followed by a threshold at 128.

VTracer 0.6.15 traced these masks into spline paths: filter speckle 25, corner threshold 70, length threshold 5, max iterations 10, splice threshold 45 and path precision 2. The SVG fills those paths with the three solid colors above. Sharp rendered the PNGs; `npm run icons` regenerates the ICNS from `build/icon.png`.

## Imagegen Prompt

Use case: logo-brand. Asset: one finished macOS app icon for Research Workbench, an academic's local app for networked AI systems, network security, code and research papers. User rejected green node logos and a bulky blue/silver 3D interwoven triangular knot. Make a totally different design, visually sophisticated, memorable, extremely simple, with calm generous negative space and precise optical balance. Flat vector logo rendering, broad smooth geometry, maximum three solid colors, no gradients on the symbol, no bevel, emboss, metallic sheen, 3D sculpture, shiny plastic, texture, noise, shadows, interlocking ribbons, knots, multicolor dots, generic AI brain, shield, atom, chemistry flask, tiny circuits, spaghetti wires, extra decorative details, words or watermark. No green, teal, turquoise, mint or olive anywhere. One centered icon only, not a mockup or presentation board. Outside the rounded-square tile must be transparent. Tile approximately 88% of the square image; symbol approximately 55% of tile width, very legible at 32 pixels. Output a crisp production-ready square icon. Direction: a restrained research monogram. A near-black rounded-square tile (#202126). One extraordinary ivory capital R monogram, with soft geometric corners and carefully designed negative space; its diagonal leg splits from the stem like a routed computational path. Broad beautifully proportioned strokes. Add exactly one short pale violet terminal segment at the diagonal leg endpoint. It must read unmistakably as R. A premium desktop research tool, with the finesse of a professionally drawn typographic identity. Use graphite, ivory and pale lavender only. No dotted node decoration and no outline badge.
