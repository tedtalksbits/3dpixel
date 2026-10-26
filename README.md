# 3dpixel

A local web editor for tile-shape game assets, compatible with Kenney Shape's `.kenshape` files.

## Run

There are two ways to run it from the same code: a desktop app (Tauri v2) and a web page.

### Desktop app

Needs [Rust](https://rustup.rs) and the Visual Studio C++ build tools. WebView2 ships with Windows 11.

```bash
npm install
npm run desktop
```

`npm run desktop:build` makes the release app and the Windows installers in
`src-tauri/target/release/bundle/`. The installer registers `.kenshape` files, so double-clicking
one opens it in 3dpixel.

### Web

```bash
npm install
npm run dev
```

Then open http://localhost:5178. Chrome and Edge can save straight back to the file you opened;
other browsers download a copy instead.

## What it does

- **Open and save `.kenshape`** files from Kenney Shape, including its samples. Fields it doesn't
  use are kept on save.
- **Draw** with all 22 Kenney shapes in 4 rotations. Choose whether painting over a tile changes
  its shape, colour, depth, or any mix of the three.
- **Depth editing:**
  - The Depth tool sets tiles to the brush depth, or raises or lowers them by 1, without touching
    shape or colour.
  - A depth-map view shades tiles by thickness and shows their numbers.
  - `[` and `]` change the depth of the selection, or of the brush when nothing is selected.
- **Selections, Photoshop-style:**
  - Select with a rectangle or the magic wand.
  - Move by dragging or with the arrow keys. With nothing selected, Move shifts the whole drawing.
  - Copy, cut, paste and delete.
  - Recolour, reshape, change depth, rotate or flip selected tiles in bulk. Rotating and flipping
    swap in the correctly mirrored shapes.
  - Moved tiles stay "floating" until dropped, so nudging them past the edge doesn't lose them.
- **Colour:**
  - A full colour picker with hex and RGB fields, recent colours and a screen eyedropper.
  - A palette you can add to and remove from. Removing a colour moves its tiles to the closest
    remaining colour.
- **Settings** (gear icon) for the 3D background and floor grid, canvas checker and grid lines,
  selection and accent colours, text size, and default sizes. They're saved in the browser.
- **Export SVG**, either one path per tile (identical to Kenney Shape's export) or merged per colour,
  which leaves no hairline seams.
- **Export PNG** at any size, e.g. 64×64, with optional no-anti-aliasing.
- **3D preview and export:** tiles are extruded by their depth, the same way Kenney Shape does it.
  Walls hidden between neighbouring tiles are removed. Export as glTF binary (`.glb`) or OBJ + MTL,
  with one material per palette colour. You can choose 1 tile = 1 unit or fit the model in 1 unit,
  and put the origin at the centre or the bottom centre.
- **Export on save** (desktop app): give a project a list of export targets, such as
  `../game/assets/sword.glb` and a 64×64 PNG, and every Ctrl+S rewrites them. Each target keeps its
  own options (PNG size, SVG grouping, model scale and origin), and missing folders are created.
  Paths are stored in the `.kenshape` relative to it, so the project can move along with your game.
  Kenney Shape ignores this list, but drops it if Kenney Shape saves the file. **Export now** writes
  the targets without saving.
- **Import SVG without blurring:**
  - SVGs exported by Kenney Shape or by this editor are decoded tile for tile, so nothing changes.
  - Any other SVG is rendered and fitted to the grid, picking the shape, rotation and colour with
    the smallest pixel error for each tile. Colours come from the SVG's own fills, not from blurred
    pixels.

## Controls

| Input | Action |
| --- | --- |
| V / M / W | Move / Select / Magic wand |
| B / E / G / D / I | Draw / Erase / Fill / Depth / Pick |
| Left drag | Use the current tool |
| Right drag | Erase (Draw), opposite direction (Depth), sample depth (Depth in Set mode) |
| Alt + click | Pick shape, angle, colour and depth from a tile |
| Shift / Alt while selecting | Add to / subtract from the selection |
| Ctrl + drag | Move the selection with any tool |
| Arrow keys / Shift+arrows | Nudge selection, or the whole drawing with Move, by 1 / 4 tiles |
| Enter | Drop floating tiles |
| Esc | Drop and deselect |
| Delete / Backspace | Delete selected tiles |
| Ctrl+A / Ctrl+D / Ctrl+Shift+I | Select all / Deselect / Invert |
| Ctrl+C / Ctrl+X / Ctrl+V | Copy / Cut / Paste |
| [ / ] | Lower / raise depth of the selection, or of the brush |
| 1–9, 0 | Brush depth 1–10 |
| R / Shift+R | Rotate the brush shape |
| ` | Cycle 2D / Split / 3D view |
| Drag / right-drag / scroll in 3D | Orbit / pan / zoom |
| Ctrl+Z / Ctrl+Y | Undo / Redo |
| Ctrl+S / Ctrl+Shift+S | Save / Save as |
| Ctrl+O | Open |
| Click current colour, or double-click a swatch | Edit colour |

You can also drop a `.kenshape` or `.svg` file onto the canvas. In the desktop app a dropped
`.kenshape` keeps its path, so Save writes back to it.

## Layout

- `src/kenshape.ts`: project model and `.kenshape` read/write
- `src/shapes.ts`: shape table (SVG path per shape and angle)
- `src/svgExport.ts`: SVG and PNG export
- `src/svgImport.ts`: exact and fitted SVG import
- `src/mesh.ts`: extrudes tiles into a mesh, one part per colour
- `src/modelExport.ts`: GLB and OBJ export
- `src/preview3d.ts`: Three.js viewport
- `src/transform.ts`: which shape and rotation a tile becomes when flipped or rotated
- `src/colorPicker.ts`: colour picker popover
- `src/settings.ts`: preferences and the settings dialog
- `src/platform.ts`: file dialogs, reading and writing, and window integration, for both the browser and the desktop app
- `src/autoExport.ts`: export-on-save targets
- `src/main.ts`: editor UI, tools and selection
- `src-tauri/`: the desktop app (Rust): file read/write commands, launch-file handling, config and icons
- `docs/kenshape-format.md`: file format notes
