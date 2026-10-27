// Renders animation clips to image frames, for sprite sheets, PNG sequences and GIFs.
//
// Views: 'front' is orthographic and unlit, so tiles keep their exact palette colours and the
// frames line up with the 2D drawing (best for 2D games, and small GIF palettes). 'angle' is a lit
// three-quarter perspective like the preview's default camera, and 'camera' uses whatever view the
// preview currently has. Framing is fitted once over every frame, so the sprite doesn't jitter.

import {
  WebGLRenderer, Scene, PerspectiveCamera, OrthographicCamera, HemisphereLight, DirectionalLight, Box3, Vector3, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, Object3D, Color,
} from 'three';
import { Project } from './kenshape';
import { Part } from './rig';
import { Clip, Pose, evalClip } from './anim';
import { buildGroup, disposeGroup } from './modelExport';

export type FrameView = 'front' | 'angle' | 'camera';

export interface FrameOptions {
  size: number; // square frames, px
  fps: number;
  view: FrameView;
  smooth: boolean; // anti-aliased edges; off gives hard pixel edges
  background: string | null; // null = transparent
  /** The preview camera, for view 'camera'. */
  camera?: { position: Vector3; target: Vector3; fov: number };
}

export interface ClipFrames {
  clip: Clip;
  frames: HTMLCanvasElement[];
  /** Per-frame duration in ms. */
  durations: number[];
}

/**
 * Frame times, evenly spaced so the frames add up to exactly the clip's length (the frame rate
 * gives a little, rather than the timing drifting). A looping clip leaves out its last frame, which
 * equals the first; a one-shot keeps it.
 */
export function frameTimes(clip: Clip, fps: number): number[] {
  const n = Math.max(1, Math.round(clip.duration * fps));
  const count = clip.loop ? n : n + 1;
  return Array.from({ length: count }, (_, i) => (clip.duration * i) / n);
}

/** Pose a group's part nodes (built with nodes: true) from an evaluated clip. */
export function poseGroup(root: Object3D, pose: Map<string, Pose> | null) {
  const d = Math.PI / 180;
  root.traverse((o) => {
    const id = o.userData.partId;
    if (!id) return;
    const base = o.userData.base;
    const ps = pose?.get(id);
    o.position.set(base.x + (ps?.position[0] ?? 0), base.y + (ps?.position[1] ?? 0), base.z + (ps?.position[2] ?? 0));
    o.rotation.set((ps?.rotation[0] ?? 0) * d, (ps?.rotation[1] ?? 0) * d, (ps?.rotation[2] ?? 0) * d);
    o.scale.set(...(ps?.scale ?? [1, 1, 1]));
  });
}

export function renderClips(p: Project, parts: Part[], clips: Clip[], opts: FrameOptions): ClipFrames[] {
  const size = Math.max(8, Math.min(2048, Math.round(opts.size)));
  const renderer = new WebGLRenderer({ antialias: opts.smooth, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const scene = new Scene();
  if (opts.background) scene.background = new Color(opts.background);
  const group = buildGroup(p, {}, parts, true);
  if (opts.view === 'front') {
    // unlit: every tile keeps its exact palette colour
    group.traverse((o) => {
      if (o instanceof Mesh) {
        const lit = o.material as MeshStandardMaterial;
        o.material = new MeshBasicMaterial({ color: lit.color.clone() });
        lit.dispose();
      }
    });
  } else {
    scene.add(new HemisphereLight(0xffffff, 0x8090a0, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 8);
    scene.add(sun);
    const rim = new DirectionalLight(0xffffff, 0.5);
    rim.position.set(-4, -2, -6);
    scene.add(rim);
  }
  scene.add(group);

  // fit the camera once to the model's extent over every frame of every clip, from its actual
  // vertices: boxes around rotated parts are much looser (a spinning wheel's grows by ~40%)
  const plan = clips.map((clip) => ({ clip, times: frameTimes(clip, opts.fps) }));
  const eachPose = (fn: () => void) => {
    for (const { clip, times } of plan)
      for (const t of times) {
        poseGroup(group, evalClip(clip, t));
        group.updateMatrixWorld(true);
        fn();
      }
  };
  const v = new Vector3();
  const eachVertex = (fn: (p: Vector3) => void) =>
    group.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) fn(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
    });
  const box = new Box3();
  eachPose(() => eachVertex((p) => box.expandByPoint(p)));
  if (box.isEmpty()) box.set(new Vector3(-1, -1, -1), new Vector3(1, 1, 1));
  const centre = box.getCenter(new Vector3());

  let camera: PerspectiveCamera | OrthographicCamera;
  if (opts.view === 'front') {
    const half = (Math.max(box.max.x - box.min.x, box.max.y - box.min.y) / 2) * 1.06;
    camera = new OrthographicCamera(-half, half, half, -half, 0.1, 1000);
    camera.position.set(centre.x, centre.y, box.max.z + 50);
    camera.lookAt(centre.x, centre.y, 0);
  } else if (opts.view === 'camera' && opts.camera) {
    camera = new PerspectiveCamera(opts.camera.fov, 1, 0.1, 5000);
    camera.position.copy(opts.camera.position);
    camera.lookAt(opts.camera.target);
  } else {
    // start from a sphere that surely fits, then move in until the model's projection fills the frame
    let radius = 0;
    eachPose(() => eachVertex((p) => (radius = Math.max(radius, p.distanceTo(centre)))));
    const cam = new PerspectiveCamera(35, 1, 0.1, 5000);
    const dir = new Vector3(0.45, 0.3, 1).normalize();
    let dist = (Math.max(radius, 0.5) / Math.sin((cam.fov * Math.PI) / 360)) * 1.02;
    for (let pass = 0; pass < 3; pass++) {
      cam.position.copy(dir).multiplyScalar(dist).add(centre);
      cam.lookAt(centre);
      cam.updateMatrixWorld(true);
      cam.updateProjectionMatrix();
      let extent = 0;
      eachPose(() => eachVertex((p) => {
        const q = p.clone().project(cam);
        extent = Math.max(extent, Math.abs(q.x), Math.abs(q.y));
      }));
      if (extent <= 0) break;
      dist *= extent / 0.92;
    }
    cam.position.copy(dir).multiplyScalar(dist).add(centre);
    cam.lookAt(centre);
    camera = cam;
  }
  camera.updateProjectionMatrix();

  const out: ClipFrames[] = [];
  for (const { clip, times } of plan) {
    const frames: HTMLCanvasElement[] = [];
    for (const t of times) {
      poseGroup(group, evalClip(clip, t));
      renderer.render(scene, camera);
      const c = document.createElement('canvas');
      c.width = c.height = size;
      c.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
      frames.push(c);
    }
    // whole-millisecond durations that add up to the clip length
    const step = (clip.duration * 1000) / Math.max(1, Math.round(clip.duration * opts.fps));
    const ms = (i: number) => Math.round(i * step);
    out.push({ clip, frames, durations: frames.map((_, i) => ms(i + 1) - ms(i)) });
  }
  disposeGroup(group);
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

export const canvasBlob = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('could not encode PNG'))), 'image/png'));
