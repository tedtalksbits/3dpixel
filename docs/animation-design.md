# Animation and rigging: research and design

Goal: draw a turtle, a human or a wheel, rig it in a minute, and get a walking human, a turtle
that hides in its shell, or a spinning wheel. Use presets for the common cases and keyframes for
everything else. Export as glTF clips that game engines play directly.

This note collects the research (timing, easing, gaits, export formats, what other tools do) and
turns it into a design for 3dpixel. Sources are at the end. Numbers marked *starting value* are
defaults to tune by eye, not standards.

---

## 1. What kind of rig fits these models

3dpixel models are rigid extruded tiles. They can't bend like a skinned character mesh, so the
right model is the one Minecraft, Blockbench, Crossy Road and most voxel games use:

- **Rigid parts.** A model is split into parts: head, torso, arm, leg, wheel, shell. Each part
  moves as a solid piece.
- **Pivot per part.** Each part rotates about one point, placed at its joint: hip, shoulder, neck
  or axle. Blockbench guides stress this. A pivot in the middle of a limb makes it spin in place
  instead of swinging.
- **Hierarchy.** Parts are parented outwards from the torso (torso → upper arm → forearm), so
  children follow their parent.
- **Animate node transforms, not bones.** Each part is a glTF node with its own mesh. Clips
  animate each node's rotation, translation and scale. glTF supports this without skinning, and
  every engine imports it. No weight painting, no skin matrices.

What this can't do: a limb can't bend smoothly. Bending needs a second part, for example upper and
lower leg. Presets treat those extra parts as optional.

### The two problems specific to drawn sprites

**1. Which way does the drawing face?** A 3dpixel drawing lies in the XY plane and is extruded
along Z. The facing decides which axis a limb swings around:

| Drawing | Example | Legs swing around | Wheel spins around |
| --- | --- | --- | --- |
| Side view | most Kenney creatures, a side-on bike | **Z** (in the drawing's plane) | **Z** |
| Front view | a character facing the camera | **X** (out of the plane) | n/a |
| Top view | a top-down car or spaceship | **Y** | **X** |

Side-view walks look best, because the motion happens in the plane you drew. So rig templates ask
for the facing first, and presets pick their axes from it.

**2. Parts overlap.** In a side view the far leg is behind the near leg, and in the drawing they
share cells. A single grid can't hold both. The fix is **layers**, the same idea as Photoshop:

- Each part is a layer with its own tile grid and a Z offset (near or far).
- The 2D canvas shows all layers composited. You edit the selected layer.
- **Selection → New part (Ctrl+J)** moves the selected tiles onto a new part, like Photoshop's
  "Layer via Cut". Draw the whole creature, then cut it into parts.
- **Make far copy:** duplicate a near limb as a far limb, push it behind the body and darken its
  colours one palette step. Kenney-style art does this, so you draw one leg and get two.
- For Kenney Shape compatibility, saving flattens the layers into the normal `tiles`, front-most
  tile wins. The layers and rig are stored under an extra key, the same way `autoExport` already
  is.

---

## 2. Timing

Animators count in frames at 24 fps, and engines think in seconds. We store seconds, preview at
24, 30 or 60 fps, and show both.

### Bipeds (side view)

From *The Animator's Survival Kit* timing chart (via a course adaptation) and animator forums:

| Motion | Full cycle (2 steps) | @24 fps | Notes |
| --- | --- | --- | --- |
| Stroll | ~1.33 s | 32 f | relaxed |
| Natural walk | **1.0 s** | 24 f | "brisk, business-like"; the default |
| Cartoon walk / jog | ~0.67 s | 16 f | |
| Run | **0.5 s** | 12 f | feet leave the ground |
| Sprint (cartoon) | ~0.33 s | 8 f | |

Key poses per step: **contact → down → passing → up → contact**. Williams puts contacts on frames
1, 13 and 25. Frame 25 repeats frame 1, so a loop must not play both or it hitches.

Walk preset parameters (*starting values*):
- **Leg swing:** ±25° for a walk, ±45–60° for a run.
- **Arms:** swing in the opposite phase to the legs, ±15–20° for a walk, ±40° for a run.
- **Body bob:** twice per cycle, lowest just after contact (the "down" pose) and highest at
  passing. Amplitude is about 3% of height for a walk and more for a run.
- **Lean:** about 10–15° forward for a run.
- **Head:** lags the body by about 0.05–0.1 of a cycle (follow-through). It's what stops a walk
  looking robotic.

### Quadrupeds (side view)

Footfall order, using the Muybridge-derived gait references and an animation guide on four-legged
creatures. The phase is when each foot lands, as a fraction of the cycle:

| Gait | Feel | LH | LF | RH | RF | Cycle (*starting value*) |
| --- | --- | --- | --- | --- | --- | --- |
| Walk (lateral 4-beat) | always 2–3 feet down | 0 | 0.25 | 0.5 | 0.75 | 1.0–1.2 s |
| Trot (diagonal pairs) | bouncy | 0 | 0.5 | 0.5 | 0 | 0.6 s |
| Pace (same-side pairs) | camels, some dogs | 0 | 0 | 0.5 | 0.5 | 0.6 s |
| Canter (3-beat) | rough rocking | 0 | ~0.3 | ~0.3 | ~0.55 | 0.6 s |
| Rotary gallop | squash → stretch leap | 0 | ~0.5 | ~0.1 | ~0.4 | 0.4–0.5 s |

L/R = left/right, H/F = hind/fore. In a side view you'd draw only the near legs and use "far copy"
for the other two.

Tips from the guide:
- Treat the hips and the chest as two bouncing balls, offset from each other, with the head as a
  third ball lagging behind.
- A gallop is a gathering squash followed by a stretch. The more the spine flexes, the faster it
  looks.
- Elephants and kangaroos don't follow these patterns. Hoppers need their own preset.

### Objects

| Motion | Default | Notes |
| --- | --- | --- |
| Spin (wheel, coin, pickup) | 1 rev/s, linear | for a rolling wheel, angular speed = travel speed ÷ radius |
| Idle bob / float | 1.5–2 s, sine | |
| Breathing idle | 2–3 s, sine | scale Y about 2–3% at the torso pivot |
| Pulse | 0.6–1 s | |
| Pop in (spawn) | 0.25–0.35 s | ease out back (overshoot) |
| Squash on land | 2–3 frames | then stretch for longer; squashes are sharp, stretches slower |

---

## 3. Timing functions (easing)

**Cyclic motion** like walking, bobbing or swaying should use **sine waves**. A sine already eases
in and out at the extremes and loops seamlessly. Procedural walks are mostly sine waves with phase
offsets per limb, and that's what presets will generate.

**One-shot motion** like retracting into a shell, opening a lid or popping in uses keyframes with
an easing curve per segment. Offer the standard Robert Penner set:

| Family | In / Out / In-out | Use it for |
| --- | --- | --- |
| Linear | – | constant spin, conveyor belts |
| Sine | ✓ | gentle sway, breathing |
| Quad / Cubic / Quart / Quint | ✓ | general motion; cubic in-out is the safe default |
| Expo / Circ | ✓ | snappy UI-like moves, fast retracts |
| **Back** | ✓ | anticipation (in) and overshoot (out); pop in, peek out |
| **Elastic** | ✓ | springy settle, jelly |
| **Bounce** | ✓ | landing, a shell dropping to the ground |
| Step | – | hold, then snap (blinks, mechanical ticks) |
| Custom cubic-bezier | – | the four-number curve CSS uses, with a draggable curve editor |

Back and Elastic deliberately overshoot past the target. That's the point, but it means a value
can briefly go past its keyframe.

**Principles worth building in** (the classic 12 principles, simplified for presets):
- **Anticipation:** a small opposite move before a big one, like crouching before a jump.
- **Follow-through and overlap:** child parts lag their parent, for example head, tail and ears.
  This could be a per-part "lag" slider that delays inherited motion.
- **Squash and stretch with the volume kept the same:** scale one axis by `k` and the other two
  by `1/√k`, or by `1/k` for a single perpendicular axis.
- **Arcs:** for translations, swing on a rotation instead of moving in a straight line.

---

## 4. How this exports

glTF 2.0 animation (Khronos tutorial):
- A clip has **channels**. Each channel targets one node's `translation`, `rotation` (a
  quaternion), `scale` or morph `weights`, and reads from a **sampler** of keyframe times and
  values.
- Interpolation modes: `STEP`, `LINEAR` (rotations interpolate along the shortest arc) and
  `CUBICSPLINE` (each key carries tangents).

Consequences:
- **Easing must be baked.** glTF has no easing curves, so we sample each clip at 30 or 60 fps into
  LINEAR keys. Three.js's `GLTFExporter` already takes an `animations` list, so this is a small
  change to `modelExport.ts`.
- **Full spins need several keys.** Rotation takes the shortest arc between two keys, so a key at
  0° and a key at 360° produce *no* rotation. Spins need at least three keys per turn, and baking
  at 30 fps handles that automatically.
- **Hiding a part with scale 0** makes a degenerate matrix that some engines warn about. Use a
  tiny scale like 0.001, or move the part inside a solid one: a turtle's head inside its shell
  vanishes on its own if it's thinner than the shell.
- **Loops:** the last sample must equal the first, and it shouldn't be played twice.
- **Godot** turns glTF clips into an AnimationPlayer and loops a clip whose name starts or ends
  with `loop` or `cycle`. So we name looping clips `walk-loop`, and one-shots `retract`.
- **Unity:** I couldn't confirm how the glTFast package imports clips. That needs a test import.
- **OBJ has no animation.** Animated export is GLB only.

Worth adding later: a **sprite sheet / PNG sequence** export that renders each frame from a fixed
camera, or as flat 2D art. That covers 2D games, and gives a quick GIF to share.

---

## 5. Preset catalogue

Presets target **roles**, not part names. A role is a named slot like `leg.near.front` or `wheel`.
Rigging means assigning parts to roles, and then every preset for that template works. Missing
roles are skipped: a biped with no arms still walks. Every preset is a set of parameters with
sliders and a live preview. **Customise** turns it into ordinary keyframes you can edit.

**Biped** (side or front view). Roles: torso, head, arm ×2, leg ×2, plus optional forearm, shin,
hand, foot and tail.
- **Idle:** breathing, an occasional blink.
- **Walk, Run, Sneak.**
- **Jump:** anticipation squash, launch stretch, airborne, land squash.
- **Wave, Attack swing, Hit flinch, Fall/death, Sit, Climb, Push.**

**Quadruped** (side view). Roles: body (or chest + hips), head, neck, leg ×4, tail, ears.
- **Idle:** breathing, tail wag, head look.
- **Walk, Trot, Pace, Canter, Gallop:** each uses its phase table from §2.
- **Sit, Lie down, Sleep:** breathing plus slow head drop.
- **Eat:** head down and up. **Shake off** and **Pounce**.

**Shell creature** (turtle, snail, armadillo). Roles: shell, head, leg ×2–4, tail.
- **Retract**, step by step:
  1. Anticipation, about 0.1 s: the head lifts and the shell squashes 5%.
  2. The parts slide into the shell, 0.25 s, ease in back.
  3. The shell drops and settles, 0.15 s, ease out bounce.
- **Peek out:** the reverse, with the head last and ease out back.
- **Walk (slow):** a quadruped walk at 1.5–2 s with a small body bob.
- **Hidden wobble:** the shell rocks.

**Wheel and vehicle.** Roles: body, wheel ×n, optional steering part.
- **Spin:** linear, with a speed or "travel speed" setting.
- **Drive:** the wheels spin and the body bobs and rocks slightly.
- **Brake:** the body pitches forward, then settles with an elastic ease.

**Flyer** (bird, bat, bug). Roles: body, wing ×2, head, tail, legs.
- **Flap:** wings down fast, up slow. **Glide.** **Hover:** fast flap plus bob.

**Chain** (snake, fish, tail, tentacle). Roles: segment 1…n.
- **Wave:** each segment rotates on a sine with a phase lag per segment, so a wave travels down
  the chain. **Slither, Swim.**

**Object** (anything; the whole model is one part, or pick a part).
- **Spin:** around any axis. **Bob / float.** **Hover:** bob plus a slow sway.
- **Pulse, Wobble/jelly:** squash and stretch with the volume kept.
- **Shake.**
- **Swing / pendulum:** signs and lanterns, with the pivot at the top.
- **Hinge open/close:** doors, lids, chests, with the pivot on the hinge edge.
- **Bounce.** **Pop in / pop out:** scale with ease out back.
- **Collect:** rise, spin and shrink.
- **Blink:** step scale on an eye part. **Flicker.**

---

## 6. UX: from drawing to animated model

A **Paint | Rig | Animate** switch sits beside the 2D/Split/3D view switch.

**1. Rig: pick a template.**
- Choose Biped, Quadruped, Shell creature, Wheel/vehicle, Flyer, Chain, Object or Custom, plus a
  facing (side, front or top).
- A small diagram lists the template's roles as a checklist.

**2. Assign parts.**
- Click a role, then mark its tiles with the tools you already know: marquee, magic wand by colour
  (one click often grabs a whole leg), or brush.
- **Auto-split** suggests parts from connected regions and colours. Then you only confirm or fix.
- Each part shows as a tinted overlay in its own colour.
- **Make far copy** handles hidden limbs.

**3. Pivots.**
- Each part's pivot is auto-placed where it touches its parent: the top of a leg, the base of the
  neck, the centre of a wheel.
- Pivots show as draggable dots on the 2D canvas, snapping to half-tiles. The 3D view shows them
  too.
- Hovering a pivot previews a ±30° wiggle, so you can see the joint is right before animating.

**4. Animate.**
- A preset library, filtered by the template, with a live preview in the 3D view.
- Each preset has a few sliders: speed, amount, bounce and lag.
- Clips stack in a list with a name, a loop toggle and a duration.

**5. Customise.**
- Turns a preset clip into keyframes on a **dope sheet**: one row per part, columns in time.
- Keyframing works by changing a pose: rotate or move the part, and a key is set.
- Easing is chosen per key. There's onion skinning in the 2D canvas, a scrubber, and play/pause.
- Mirror pose, plus copy and paste of poses.

**6. Export:** GLB with all clips, or a sprite sheet.

This should make the three examples one-minute jobs:
- **Wheel:** template Object or Wheel, the whole model is the wheel, pivot auto-centred, preset
  Spin.
- **Turtle:** template Shell creature, wand-click the shell, head and legs, preset Retract.
- **Human:** template Biped, side view. Wand or marquee the head, torso, arm and leg, use Make far
  copy for the other arm and leg, then preset Walk or Run.

---

## 7. Data model sketch

Stored in the `.kenshape` under an extra key, like `autoExport`. Kenney Shape ignores it, and the
flattened `tiles` still hold the art.

```ts
interface Rig {
  template: 'biped' | 'quadruped' | 'shell' | 'wheel' | 'flyer' | 'chain' | 'object' | 'custom';
  facing: 'side' | 'front' | 'top';
  parts: Part[];          // ordered back-to-front
  clips: Clip[];
}
interface Part {
  id: string; name: string; role?: string;   // e.g. 'leg.near.hind'
  parent?: string;                           // part id
  tiles: Record<number, Tile>;               // sparse layer: index -> tile
  pivot: [number, number];                   // tile units, half-tile snap
  z: number;                                 // offset in tile units (far limbs < 0)
}
interface Clip {
  name: string; duration: number; loop: boolean;
  preset?: { id: string; params: Record<string, number> };  // live, editable preset
  tracks?: Track[];                                         // after "Customise"
}
interface Track {
  part: string; prop: 'rotation' | 'position' | 'scale';
  keys: { t: number; value: number[]; ease: Ease }[];       // rotation as Euler degrees in the editor
}
```

Presets are functions `(rig, params) → Track[]`, written in TypeScript and easy to add.
Rotations are edited as Euler degrees, which are easy to understand and allow spins past 360°, and
converted to quaternions when baked.

Code impact:
- `mesh.ts`: `buildModel` already takes a `Project`, so it can run once per part on a sub-project
  of that part's tiles. Hidden-wall culling then happens within each part, which is correct
  because parts move apart.
- `modelExport.ts`: builds a node tree, one node per part at its pivot with the mesh offset,
  instead of one mesh per colour, and passes the baked `AnimationClip`s to `GLTFExporter`.
- `preview3d.ts`: plays clips with Three's `AnimationMixer`.

---

## 8. Suggested build order

1. **Parts and pivots** (done):
   - Layers, "New part from selection", pivots, a per-part mesh and a GLB node tree.
   - Static export first, so a rigged model imports into an engine with movable parts.
2. **Clip engine** (done):
   - Tracks, easing, baking, playback in the 3D preview, a play bar, and glTF animation export.
3. **Object presets** (done): spin, bob, swing, hinge, pulse and pop. They need one part and no template,
   so **the wheel works here**.
4. **Templates and creature presets** (done):
   - Role checklist, auto-split and auto-pivots.
   - Biped walk, run and idle, quadruped gaits, and shell retract. **The human and the turtle work
     here.**
5. **Custom keyframing** (done): dope sheet, pose-to-key, per-key easing, curve editor, onion skin.
6. **Extras:** sprite sheet and GIF export, more templates (flyer, chain), clip blending previews.

---

## 9. Decisions to make

1. **Layers.** Should we introduce real layers, needed for far limbs and for parts that overlap at
   rest, or start with parts as a split of the single grid and add layers later? I recommend
   layers from the start, because the side-view walk needs them.
2. **Facing.** Should side view come first, with front and top view later? Side view gives the
   best-looking walks.
3. **Target engines.** Which engines must import the clips cleanly: Godot, Unity, Three.js or
   Blender? That decides what we test against.
4. **2D output.** Do sprite sheets matter for your games, or is GLB enough?

---

## Sources

- Walk timing chart adapted from *The Animator's Survival Kit*: [Monmouth University — Movement: Walk Cycle](https://animation.monmouth.edu/instruct/?p=351)
- Per-step run timing (forum): [AWN discussion](https://www.awn.com/comment/1008092)
- Gait footfall patterns: [University of Minnesota Gaits courseware via NORECOPA](https://norecopa.no/norina/gaits-gait-foot-fall-patterns), [UCSD CSE169 locomotion slides](https://cseweb.ucsd.edu/classes/wi17/cse169-a/slides/CSE169_13.pdf)
- Quadruped animation tips: [Game Developer — Animating Four-Legged Beasts](https://www.gamedeveloper.com/art/animating-four-legged-beasts), [Game Developer — A quick guide to animating animals](https://www.gamedeveloper.com/art/a-quick-guide-to-animating-animals)
- glTF animation: [Khronos glTF Tutorial — Animations](https://github.khronos.org/glTF-Tutorials/gltfTutorial/gltfTutorial_007_Animations.html), [Vulkan docs — Interpolation & Blending](https://docs.vulkan.org/tutorial/latest/Advanced_glTF/Skeletal_Compute_Skinning/05_interpolation_blending.html)
- Rigid rigs and pivots: [AzureLib — Rigging in Blockbench](https://moddedmc.wiki/en/project/azurelib/latest/docs/blockbench/rigging_in_bb), [ModelEngine — Creating a model](https://wiki.mythiccraft.io/modelengine/Modeling/Creating-a-Model), [Defold forum — Blockbench animation guide](https://forum.defold.com/t/blockbench-animation-guide/82193)
- Easing: [easings.net](https://easings.net), [rpeasings (Penner functions)](https://pypi.org/project/rpeasings/0.0.3), [jMonkeyEngine Easing](https://javadoc.jmonkeyengine.org/v3.6.0-beta2/com/jme3/math/Easing.html)
- Procedural sine-based walks: [Wayline — Procedural animation techniques](https://www.wayline.io/blog/procedural-animation-techniques)
- Squash and stretch, keeping volume: [Velocity Skinning (arXiv 2104.04934)](https://arxiv.org/pdf/2104.04934), [Pixune — Squash and stretch](https://pixune.com/blog/squash-and-stretch/)
- Godot glTF loop naming: [Godot docs — node type customization](https://docs.godotengine.org/pt-br/4.x/tutorials/assets_pipeline/importing_3d_scenes/node_type_customization.html), [Godot forum report](https://forum.godotengine.org/t/blender-import-integration-not-respecting-nla-action-track-loop-suffix/113928)
