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
