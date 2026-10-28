# 3dpixel

A local web editor for tile-shape game assets, compatible with Kenney Shape's `.kenshape` files.
Draw with tiles, extrude to 3D, rig, animate, and export GLB models with their animations, sprite
sheets or GIFs.

## Examples

Each model below was drawn as tiles, split into parts and animated with a preset. The GIFs come
from 3dpixel's own GIF export. The projects are in [`examples/`](examples): open one, pick a clip
on the play bar, and press Space.

| ![A blocky person walking](docs/images/human-walk.gif) | ![The same person running, leaning forward](docs/images/human-run.gif) | ![A turtle pulling its head, legs and tail into its shell, then peeking out](docs/images/turtle-hide.gif) |
| :---: | :---: | :---: |
| **Walk**: Biped template, Walk preset | **Run**: Run preset, with a bigger swing and a forward lean | **Hide**: Shell creature template, Hide preset (hide, then peek) |
| ![A turtle walking slowly](docs/images/turtle-walk.gif) | ![A wheel spinning on its axle](docs/images/wheel-spin.gif) | ![The walk as a flat 2D sprite](docs/images/human-walk-sprite.gif) |
| **Walk**: a slow four-beat walk | **Spin**: one part imported from an SVG, Spin preset | **Sprite**: the walk exported with the flat front view, for 2D games |

How they were made:
- **Human** ([`examples/human.kenshape`](examples/human.kenshape)):
  1. Draw a side-on figure.
  2. Select the head, arm and leg in turn and press Ctrl+J to make each a part.
  3. Use **Far copy** for the far arm and leg.
  4. Pick the **Biped** template, which guesses each part's role.
  5. Click **Walk**, **Run** or **Idle**.
- **Turtle** ([`examples/turtle.kenshape`](examples/turtle.kenshape)): the same steps, with the
  **Shell creature** template and the **Hide** and **Walk** presets.
- **Wheel** ([`examples/wheel.kenshape`](examples/wheel.kenshape)): import an SVG of a wheel, then
  click **Spin**. The pivot is already at the hub.

The flat view also exports sprite sheets with a JSON of frames and clip tags. This is the turtle
hiding at 8 fps:

![The turtle hiding, as a strip of sprite frames](docs/images/turtle-hide-sheet.png)

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
- **Export on save** (desktop app): give a project a list of export targets (GLB, OBJ, PNG, SVG, sprite sheet or GIF), such as
  `../game/assets/sword.glb` and a 64×64 PNG, and every Ctrl+S rewrites them. Each target keeps its
  own options (PNG size, SVG grouping, model scale and origin), and missing folders are created.
  Paths are stored in the `.kenshape` relative to it, so the project can move along with your game.
  Kenney Shape ignores this list, but drops it if Kenney Shape saves the file. **Export now** writes
  the targets without saving.
- **Parts for rigging**, the first step towards animation (see `docs/animation-design.md`):
  - A drawing can be split into parts, such as head, arm and leg, each on its own layer with a
    pivot, a parent and a Z offset. Your tools edit the selected part, and the other parts fade so
    you can tell which one that is.
  - **From selection (Ctrl+J)** cuts the selected tiles into a new part, parented to the part they
    came from. Its pivot is placed automatically where it joins the parent: a shoulder at the top
    of an arm, a hip at the top of a leg, a neck under a head.
  - **Far copy** duplicates a part one step behind with darker colours, for the far arm or leg in
    a side view.
  - The **Pivot tool (P)** places a pivot by clicking or dragging, snapped to half tiles. While it's
    active, lines show each part's parent.
  - **Test joint** swings the part about its pivot in the 3D view.
  - GLB export becomes a node tree: one node per part, at its pivot, with children under their
    parent. Rotating a node in Godot, Unity, Blender or Three.js swings that part about its joint.
    OBJ gets one object per part.
  - The `.kenshape` still holds the flattened drawing, so Kenney Shape opens it. The parts are kept
    under an extra key.
- **Animation clips**:
  - A clip is one animation, like walk or spin, with a length and a loop setting. The play bar
    under the views plays, scrubs and switches clips. Diamonds mark keys: blue for the selected
    part, grey for the others.
  - To animate, pick a part, move the playhead, and change its rotation (degrees), position (tiles)
    or scale in the Animation panel. Each change becomes a keyframe at that frame, snapped to
    24 fps.
  - Each key has an ease for the stretch up to the next key. You can pick linear, step, or the full
    set from sine through quint, plus expo, circ, back, elastic and bounce, each as in, out or
    in-out.
  - Looping clips are seamless without a closing key: after the last key, the pose eases back into
    the first.
  - Clips export inside the GLB, sampled at 30 fps plus every key time, so the easing survives.
    Rotations are kept on a continuous path, so full spins work. Looping clips get a `-loop` suffix,
    which Godot turns into a looping animation (it removes the suffix from the clip name).
- **Animation presets**: one click animates the selected part, starts playing, and gives you
  sliders that update live:
  - **Spin** (wheels, coins, fans): axis, turns per loop, direction, steady or wind-up.
  - **Bob** (floating pickups, boats): height, bobs per loop, float or bouncy.
  - **Swing** (signs, lanterns, tails): angle, swings per loop, axis.
  - **Hinge** (doors, lids, chests): angle; open, hold and close, or open once, or close once;
    smooth, snappy or slam.
  - **Pulse** (hearts, power-ups): size, pulses per loop, even or stretched with the volume kept.
  - **Pop** (spawning): in or out, with overshoot, springy or smooth.
  - Presets on different properties stack. Spin plus Bob makes a floating, spinning pickup.
  - Counts are whole numbers per clip, so every loop is seamless. Changing the clip length
    stretches the presets to fit.
  - Each preset card has pivot buttons (centre or an edge), with the usual spot for that motion
    highlighted.
  - **Customise**, or editing a preset's values by hand, turns the preset into plain keys.
- **Creature templates and presets** (side view, plus a front view for bipeds):
  - In Parts, pick a **rig template**: Biped, Four-legged or Shell creature. It lists the template's
    roles (body, head, near and far arms and legs, tail), and "Guess roles" fills them in from part
    names ("head", "arm", "far"...), Z and pivots. It also sets which way the creature faces from
    where its head is. Fix any role with its menu.
  - A biped can also face **front**, towards you: then legs and arms swing about X, so the
    feet step towards the camera, instead of about Z as in a side view.
  - **Biped:** Walk, Run, Idle. Legs and arms swing in opposition, the body bobs twice per cycle,
    and the head lags. Run adds a forward lean.
  - **Four-legged:** Walk, Trot, Pace, Canter, Gallop, Idle. Each gait uses the real footfall order:
    a walk goes back, front, back, front, a quarter cycle apart; a trot moves diagonal pairs
    together; a gallop gathers and stretches.
  - **Shell creature:** Hide (head, legs and tail slide into the shell and shrink, then the shell
    drops and bounces), Peek back out, or Hide then peek as a loop. Plus a slow Walk.
  - Legs plant forward, sweep back steadily while on the ground, then swing forward, so feet
    don't skate. Every motion is a slider: leg and arm swing, bounce, lean, head bob, tail sway,
    body rock.
  - Presets drive parts by role, so any model rigged with the template works, and roles with no
    part are skipped. They follow the rig live: change a role, the facing or a pivot and the
    animation updates.
- **Keyframing by hand**:
  - **Dope sheet** ("Keys" on the play bar): each part has a row of its keys over time, and ▸
    opens rows for Rotate, Move and Scale. Click a key to select it (Shift adds), drag to move
    keys in time (snapped to frames), double-click empty space to key that part's pose there,
    click empty space to move the playhead, and press Delete to remove the selected keys. A held
    (step) stretch shows as a dashed line.
  - **Pose mode** (the Pose button in the 3D view): drag a part to rotate it about its pivot, or
    Shift-drag to move it. Each drag keys the pose at the playhead, and clicking a part selects
    it. Dragging empty space still orbits the camera.
  - **Curve editor** (Animation panel): shows how the value moves from a key to the next. Pick a
    named ease, or drag the two handles for a custom cubic Bézier, the same as CSS
    `cubic-bezier()`, with overshoot. Dragging a handle on a named ease starts from that ease's
    own curve. It edits the selected keys, or the selected part's keys at the playhead.
  - **Onion skin** ("Onion" on the play bar): ghosts of the model 3 frames before (red) and after
    (blue) the playhead, so you can judge spacing while you pose.
  - Editing a key that a live preset made turns that preset into plain keys first. Everything is
    covered by undo.
- **Animation export** (right panel): render clips to 2D images.
  - **View:** **Flat front** is orthographic and unlit, so it keeps exact palette colours and
    matches the 2D drawing. It's best for 2D games and gives small GIFs. There's also a lit
    **Three-quarter** view, and **Current 3D view** uses whatever angle you've framed in the
    preview.
  - **Settings:** frame size, frame rate, smooth or hard edges, and a transparent or solid
    background. Choose this clip or all clips.
  - **Sprite sheet:** one PNG with a row per clip (or a packed grid), plus a JSON of frame
    positions, durations and one tag per clip, in Aseprite's format. Phaser loads it directly,
    and Godot and other engines have importers.
  - **PNG frames:** one PNG per frame, named `name_clip_000.png`. In the browser they come as a
    ZIP.
  - **GIF:** an animated GIF per clip, looping. Sprites with 255 colours or fewer keep exact
    colours, and transparency is kept.
  - Frames are spaced evenly across the clip, so a sheet or GIF lasts exactly as long as the 3D
    clip. Framing is fitted once over every frame, so the sprite doesn't jitter.
  - Export on save can also write sprite sheets and GIFs, so your game's sprites update every
    time you save.
- **Generate sprites and auto-rig them with [PixelLab](https://www.pixellab.ai)** (needs a PixelLab
  API key, added in Settings):
  - **Generate:** describe a sprite, choose the model (Pixen, or Pixflux, which can match your
    palette), size, facing, view, outline and detail. The sprite comes back on a transparent
    background and goes through PNG import, so it arrives as a 3D model with rounded depth.
  - **Auto-rig a two-legged character** (Parts, under Rig template, or a checkbox when
    generating): PixelLab finds the character's 18 joints (0.1 generations). The drawing is split
    into body, head, two arms and two legs: each tile goes to the nearest bone, shoulder pads go
    with the arm, and stray bits join the part they touch most. Pivots go on the neck, shoulders
    and hips. The Biped template is set up with roles and facing (front for a character facing
    you, near and far limbs from the joints' draw order for a side view), so Walk, Run and Idle
    work straight away. It works on any drawing, not only generated ones, and Undo reverts it.
  - **The key** is kept in the system keychain in the desktop app (Windows Credential Manager,
    macOS Keychain), and in this browser's local storage on the web. It is only sent to
    api.pixellab.ai. Settings shows the masked key and your remaining balance.
- **Import SVG without blurring:**
  - SVGs exported by Kenney Shape or by this editor are decoded tile for tile, so nothing changes.
  - Any other SVG is rendered and fitted to the grid, picking the shape, rotation and colour with
    the smallest pixel error for each tile. Colours come from the SVG's own fills, not from blurred
    pixels.
- **Turn pixel art into a 3D model with PNG import:**
  - Each pixel becomes a square tile. Pixels under half opacity are left empty, and transparent
    margins are trimmed.
  - Sprites that were shared scaled up (each pixel drawn as a 4×4 block, say) are detected and
    sampled back down to their real pixels.
  - Colours are kept exactly, up to 64. You can also reduce them to 32 or 16 by median cut, or
    snap them to the current palette.
  - Rounded depth makes the middle of the shape thicker than its outline. By default the thickest
    part is about as deep as the body is wide, so a character reads as a solid figure rather than a
    cut-out. Flat depth gives every tile the same depth.
  - Use the PNG import panel, Open, or drag an image onto the window. GIF, WebP and BMP work too.
- **Give models a back and real depth** (Back and depth panel): by default the back mirrors the
  front, which suits flat things like tools. For characters and objects:
  - **Back:** colour it from a back-view image (mirrored, since left and right swap from behind),
    have PixelLab turn the drawing around (1 generation), or Simplify it, which keeps the big
    colour areas and drops details like faces and logos. Same as front puts the mirror back.
  - **Depth from the side:** a side-view image, or PixelLab turning the drawing to the side
    (1 generation), sets how far each row reaches forwards and backwards, rounding off across the
    row. A cap gets a deep brim and a shallow crown instead of a lens shape. The depth multiplier
    goes up to 150% for deep subjects; deeper ones are squashed front to back so the depth steps stay small. Each tile's side walls take its back colour on the back half, so the front colours don't streak all the way round.
  - **Paint the back by hand:** set Canvas shows to Back colours, and Draw, Fill and Pick work on
    the back of tiles.
  - When generating, tick "Also make the back and side" to do both in one go (2 more generations).
    Turning works on drawings that face you, up to 128×128.

## Controls

| Input | Action |
| --- | --- |
| V / M / W | Move / Select / Magic wand |
| B / E / G / D / I | Draw / Erase / Fill / Depth / Pick |
| P | Pivot (place the selected part's pivot) |
| Ctrl+J | Make a part from the selection |
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
| Space | Play / pause the clip |
| Delete (dope sheet open) | Delete the selected keys |
| , / . | Step one frame back / forward |
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
- `src/pngImport.ts`: pixel art to tiles, with scale detection, colour reduction and rounded depth
- `src/mesh.ts`: extrudes tiles into a mesh, one part per colour
- `src/modelExport.ts`: GLB and OBJ export
- `src/preview3d.ts`: Three.js viewport
- `src/transform.ts`: which shape and rotation a tile becomes when flipped or rotated
- `src/colorPicker.ts`: colour picker popover
- `src/settings.ts`: preferences and the settings dialog
- `src/platform.ts`: file dialogs, reading and writing, and window integration, for both the browser and the desktop app
- `src/autoExport.ts`: export-on-save targets
- `src/rig.ts`: parts, pivots, flattening and the `rig` file key
- `src/anim.ts`: clips, keyframes, sampling and bake times
- `src/easing.ts`: easing functions
- `src/presets.ts`: animation presets that generate keyframe tracks
- `src/templates.ts`: rig templates, roles and role guessing
- `src/creatures.ts`: biped, four-legged and shell creature presets
- `src/pixellab.ts`: PixelLab API client: image generation, rotation, skeleton estimation, balance
- `src/autoRig.ts`: splits a drawing into biped parts from a skeleton
- `src/views.ts`: back colours and side-view depth from extra views of the subject
- `src/secrets.ts`: API key storage (system keychain on desktop, localStorage on the web)
- `src/dopesheet.ts`: the dope sheet
- `src/curveEditor.ts`: the ease curve editor
- `src/frames.ts`: renders clips to image frames
- `src/animExport.ts`: sprite sheets with JSON, PNG frames and GIFs from rendered frames
- `src/gif.ts`: animated GIF encoder
- `src/zip.ts`: ZIP writer for PNG frames
- `src/main.ts`: editor UI, tools and selection
- `src-tauri/`: the desktop app (Rust): file read/write commands, launch-file handling, keychain access, config and icons
- `docs/kenshape-format.md`: file format notes
