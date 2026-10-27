# The .kenshape format

Notes from reading Kenney Shape 1.5's files and assets, for compatibility.

## Container

A `.kenshape` file is UTF-8 JSON (Unity `JsonUtility`) compressed with gzip. There is no other header.

## Project

| Key | Type | Notes |
| --- | --- | --- |
| `title` | string | |
| `author` | string | added in later versions |
| `version` | string | app version that saved it, e.g. `1.5.0` |
| `size` | `{x, y}` | grid size in tiles; samples use 16, 24 and 32 |
| `depthMultiplier` | float | 3D extrusion scale, default `100` |
| `alignment` | int | 0 front, 1 middle, 2 back (how tile depth is anchored) |
| `tiles` | Tile[] | `size.x * size.y` entries, **column-major**: `tiles[x * size.y + y]`, `y = 0` is the top row |
| `colors` | string[] | palette as `#RRGGBB`, normally 16 entries |

Some older samples also carry `depthAlignment`. Unknown keys are kept when this editor saves.

## Tile

| Key | Type | Notes |
| --- | --- | --- |
| `shape` | int | index into the shape table below |
| `angle` | int | 0–3, quarter turns |
| `color` | int | palette index, `-1` = empty tile |
| `depth` | int | extrusion depth in steps |
| `colorBack` | int | optional colour for the back face, `-1` = same as front |
| `depthBack` | int | optional back depth |
| `enabled`, `visited` | bool | runtime flags that some versions write out; ignored |

## Shapes

Each tile is 32×32 units in SVG export. Kenney Shape writes a tile as
`M {x*32} {y*32} {path[angle]}`, where `path` is one of these relative paths
(the full four-angle table is in [`src/shapes.ts`](../src/shapes.ts)):

| # | Name | # | Name |
| --- | --- | --- | --- |
| 0 | square | 11 | triangle |
| 1 | corner (half-square triangle) | 12 | slantLeftTop |
| 2 | cornerRounded | 13 | slantRightTop |
| 3 | cornerRoundedInner | 14 | slantLeftBottom |
| 4 | cornerRoundedInnerSmall | 15 | slantRightBottom |
| 5 | cornerSmall | 16 | circleLeftBottom |
| 6 | endEdge | 17 | circleRightBottom |
| 7 | endRounded | 18 | circleTop |
| 8 | half | 19 | quarter |
| 9 | halfCornerInner | 20 | edgeOuter |
| 10 | spike | 21 | edgeInner |

The `slant*` and `circle*Bottom` shapes come in mirrored pairs; Kenney Shape uses the
pair to mirror a drawing.

## 3D model

Kenney Shape builds its model from one extruded prism per tile:

- One tile is 1 unit and the grid is centred on the origin, with +Y up.
- A tile reaches `depth / 2` towards the front and `depthBack / 2` towards the back. If
  `depthBack` is 0 it uses `depth`; if both are 0, both become 1.
- The whole depth axis is scaled by `depthMultiplier / 100`.
- The back face uses `colorBack` when it is set.
- `alignment` only affects its voxel (.vox) export, not the mesh.

This editor follows the same rules in `src/mesh.ts`. It uses glTF's convention of +Z towards
the viewer; Unity's is the opposite.

## SVG export

Kenney Shape's SVG has `viewBox="0 0 {size.x*32} {size.y*32}"` and one `<path>` per
tile (or one per colour, made by joining the tile paths). Because the tile paths are
fixed strings, these SVGs can be turned back into tiles exactly, which is what this
editor's SVG import does first.

## 3dpixel extension: `autoExport`

3dpixel can store an extra top-level key with the project's export-on-save targets:

```json
"autoExport": {
  "enabled": true,
  "targets": [
    { "format": "glb", "path": "../game/assets/sword.glb", "scale": "tile", "pivot": "bottom" },
    { "format": "png", "path": "../game/assets/sword.png", "size": 64, "crisp": true }
  ]
}
```

`format` is `glb`, `obj` (writes a `.mtl` beside it), `png` or `svg` (`grouping`: `shape` or
`color`). `path` is relative to the `.kenshape` file, with forward slashes, or absolute if it's on
another drive. Unity's JsonUtility ignores unknown keys, so Kenney Shape still opens the file, but
it doesn't keep the key when it saves.

## 3dpixel extension: `rig`

A drawing split into parts keeps them under an extra top-level key. The normal `tiles` hold the
flattened drawing, with the front-most part winning each cell, so Kenney Shape opens the file
unchanged. As with `autoExport`, Kenney Shape drops the key if it saves the file.

```json
"rig": {
  "version": 1,
  "active": 4,
  "parts": [
    { "id": "body", "name": "Body", "pivot": [8, 8], "z": 0, "parent": null, "visible": true,
      "tiles": [[101, { "shape": 0, "angle": 0, "color": 11, "depth": 2, "colorBack": -1, "depthBack": 0 }]] },
    { "id": "p1a2b3", "name": "Arm", "pivot": [10.5, 5], "z": 0, "parent": "body", "visible": true, "tiles": [] }
  ]
}
```

- `tiles` is sparse: pairs of `[index, tile]`, using the same column-major index as the main grid.
- `pivot` is in tile units from the top-left, with y pointing down.
- `z` is in tiles, scaled by `depthMultiplier` like depth. Negative means behind.
- `visible` only affects the editor. Hidden parts are still exported.
- In GLB export, each part is a node placed at its pivot, relative to its parent's pivot, with its
  meshes offset so they rotate about it.

### Clips

`rig.clips` holds the animation clips. The rig key is also written for a single-part drawing once
it has a clip.

```json
"clips": [{
  "id": "c1", "name": "walk", "duration": 1, "loop": true,
  "tracks": [
    { "part": "p1a2b3", "prop": "rotation", "keys": [
      { "t": 0, "v": [0, 0, 25], "ease": "sine.inOut" },
      { "t": 0.5, "v": [0, 0, -25], "ease": "sine.inOut" } ] }
  ]
}]
```

- `prop` is `rotation` (Euler degrees, XYZ order), `position` (an offset in tiles, +Y up) or
  `scale`.
- `ease` applies from that key to the next. It's `linear`, `step`, `<family>.<in|out|inOut>`
  with sine, quad, cubic, quart, quint, expo, circ, back, elastic or bounce, or a custom curve
  `bezier:x1,y1,x2,y2`, the same as CSS `cubic-bezier()`, with x1 and x2 in 0–1.
- Before the first key a track holds that key's value. After the last key it also holds, except in
  a looping clip, where it eases back into the first key at the loop point.
- On GLB export each clip is sampled at 30 fps plus every key time, and just before a step key's
  jump. Rotations become quaternions kept on one hemisphere, and scales never reach exactly 0.
  Looping clips are named with a `-loop` suffix.

A clip can also list live presets. Their generated tracks carry `"preset": "<use id>"`, and
3dpixel rebuilds those tracks from the parameters whenever a slider or the clip length changes.
Other tools can ignore `presets` and just play the tracks.

```json
"presets": [{ "id": "c3", "preset": "spin", "part": "body", "params": { "axis": "z", "turns": 2, "direction": "cw", "ease": "linear" } }]
```

`preset` is one of `spin`, `bob`, `swing`, `hinge`, `pulse` or `pop`. The parameters are listed in
`src/presets.ts`.

### Templates and roles

`rig.template` is `{ "kind": "biped" | "quadruped" | "shell", "facing": "right" | "left" | "front" }`
("front" is for a biped facing the viewer: its limbs swing about X instead of Z), and a
part can have a `"role"`, such as `body`, `head`, `arm.near`, `arm.far`, `leg.near`, `leg.far`,
`leg.front.near`, `leg.front.far`, `leg.back.near`, `leg.back.far` or `tail`. Creature presets
(`biped.walk`, `quad.trot`, `shell.retract`, ...) are applied to the body part and generate tracks for
the parts holding each role.
