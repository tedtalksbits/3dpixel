# 3dpixel

A local web editor for tile-shape game assets, compatible with Kenney Shape's `.kenshape` files.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5178. Chrome and Edge can save straight back to the file you opened;
other browsers download a copy instead.

## What it does

- **Open and save `.kenshape`** files from Kenney Shape, including its samples. Fields it doesn't
  use are kept on save.
- **Draw** with all 22 Kenney shapes in 4 rotations, using a 16-colour palette and per-tile depth.
- **Export SVG**, either one path per tile (identical to Kenney Shape's export) or merged per colour,
  which leaves no hairline seams.
- **Export PNG** at any size, e.g. 64×64, with optional no-anti-aliasing.
- **Import SVG without blurring:**
  - SVGs exported by Kenney Shape or by this editor are decoded tile for tile, so nothing changes.
  - Any other SVG is rendered and fitted to the grid, picking the shape, rotation and colour with
    the smallest pixel error for each tile. Colours come from the SVG's own fills, not from blurred
    pixels.

## Controls

| Input | Action |
| --- | --- |
| Left drag | Paint with the current tool |
| Right drag | Erase |
| Alt + click | Pick shape, angle, colour and depth from a tile |
| B / E / G / I | Draw / Erase / Fill / Pick |
| R / Shift+R | Rotate shape |
| 1–9, 0 | Brush depth 1–10 |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S / Ctrl+Shift+S | Save / Save as |
| Ctrl+O | Open |
| Double-click swatch | Edit colour |

You can also drop a `.kenshape` or `.svg` file onto the canvas.

## Layout

- `src/kenshape.ts`: project model and `.kenshape` read/write
- `src/shapes.ts`: shape table (SVG path per shape and angle)
- `src/svgExport.ts`: SVG and PNG export
- `src/svgImport.ts`: exact and fitted SVG import
- `src/main.ts`: editor UI
- `docs/kenshape-format.md`: file format notes
