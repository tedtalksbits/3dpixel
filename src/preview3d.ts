import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Group, Mesh, MeshBasicMaterial, SphereGeometry, Object3D, Vector3, Vector2, Color, GridHelper, LineBasicMaterial,
  Raycaster, Plane, LessDepth,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Project } from './kenshape';
import { buildGroup, disposeGroup } from './modelExport';
import { Part } from './rig';
import { Pose } from './anim';

/** A part being posed by dragging it in the 3D view. */
export interface PoseDrag {
  partId: string;
  kind: 'rotate' | 'move';
  phase: 'start' | 'move' | 'end';
  /** rotate: degrees about Z since the drag started (counter-clockwise as seen from the front). */
  angle: number;
  /** move: offset in tiles (parent space, +Y up) since the drag started. */
  delta: [number, number];
}

export class Preview3D {
  /** When on, dragging a part rotates it about its pivot (Shift-drag moves it); empty space still orbits. */
  poseMode = false;
  onPick?: (partId: string) => void;
  onPoseDrag?: (d: PoseDrag) => void;

  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.1, 1000);
  private controls: OrbitControls;
  private model: Group | null = null;
  private framedSize = '';
  private frame = 0;

  constructor(private host: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    host.appendChild(this.renderer.domElement);

    this.scene.add(new HemisphereLight(0xffffff, 0x8090a0, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.6);
    sun.position.set(3, 5, 8);
    this.scene.add(sun);
    const rim = new DirectionalLight(0xffffff, 0.5);
    rim.position.set(-4, -2, -6);
    this.scene.add(rim);

    // registered before OrbitControls, so a drag that grabs a part can switch orbiting off first
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.poseDown(e));
    this.renderer.domElement.addEventListener('pointermove', (e) => this.poseHover(e));
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener('change', () => this.requestRender());

    new ResizeObserver(() => this.resize()).observe(host);
    this.resize();
  }

  /** null = transparent, so the CSS gradient behind the canvas shows through. */
  setBackground(color: string | null) {
    this.scene.background = color ? new Color(color) : null;
    this.requestRender();
  }

  setFloorGrid(on: boolean) {
    this.floorGrid = on;
    this.placeGrid();
    this.requestRender();
  }

  private floorGrid = true;
  private grid: GridHelper | null = null;
  private gridSize = '';

  private placeGrid() {
    if (this.grid && (!this.floorGrid || this.gridSize !== this.framedSize)) {
      this.scene.remove(this.grid);
      this.grid.dispose();
      this.grid = null;
    }
    if (!this.floorGrid || !this.framedSize) return;
    if (!this.grid) {
      const [x, y] = this.framedSize.split('x').map(Number);
      const n = Math.max(x, y) * 2;
      this.grid = new GridHelper(n, n / 2, 0x000000, 0x000000);
      const mat = this.grid.material as LineBasicMaterial;
      mat.transparent = true;
      mat.opacity = 0.18;
      this.grid.position.y = -y / 2 - 0.01;
      this.gridSize = this.framedSize;
      this.scene.add(this.grid);
    }
  }

  /** Rebuild the model. With rig parts, `active` gets a pivot marker and hidden parts are left out. */
  update(p: Project, rig?: Part[], active?: string) {
    this.clearGhosts(); // they share the old model's geometry
    if (this.model) {
      this.scene.remove(this.model);
      disposeGroup(this.model);
    }
    this.model = buildGroup(p, {}, rig, true);
    this.model.traverse((o) => {
      const part = rig?.find((r) => r.id === o.userData.partId);
      if (!part) return;
      o.visible = part.visible;
      if (part.id === active) o.add(this.pivotMarker());
    });
    this.scene.add(this.model);
    this.applyPose();
    this.buildGhosts();
    // only reframe when the grid size changes, so editing doesn't move the camera
    const sizeKey = `${p.size.x}x${p.size.y}`;
    if (sizeKey !== this.framedSize) {
      this.framedSize = sizeKey;
      this.placeGrid();
      this.resetView();
    }
    this.requestRender();
  }

  private pivotMarker() {
    const mat = new MeshBasicMaterial({ color: 0xff3b6b, depthTest: false, transparent: true });
    const dot = new Mesh(new SphereGeometry(0.18, 16, 8), mat);
    dot.renderOrder = 10;
    dot.userData.editorOnly = true;
    return dot;
  }

  private pose: Map<string, Pose> | null = null;

  /** Pose parts from an animation (null = rest pose). Kept across rebuilds. */
  setPose(pose: Map<string, Pose> | null) {
    this.pose = pose;
    this.applyPose();
    this.requestRender();
  }

  private applyPose() {
    if (this.model) this.poseNodes(this.model, this.pose);
  }

  private poseNodes(root: Object3D, pose: Map<string, Pose> | null) {
    root.traverse((o) => {
      const id = o.userData.partId;
      if (!id) return;
      const base = o.userData.base;
      const ps = pose?.get(id);
      if (!ps) {
        o.position.copy(base);
        o.rotation.set(0, 0, 0);
        o.scale.set(1, 1, 1);
        return;
      }
      const d = Math.PI / 180;
      o.position.set(base.x + ps.position[0], base.y + ps.position[1], base.z + ps.position[2]);
      o.rotation.set(ps.rotation[0] * d, ps.rotation[1] * d, ps.rotation[2] * d);
      o.scale.set(...ps.scale);
    });
  }

  // ---------- onion skin ----------

  private onion: Map<string, Pose>[] | null = null;
  private ghosts: Group[] = [];
  // pushed back in depth and failing equal depth, so a ghost that overlaps the model (a part that
  // hardly moved) hides behind it instead of tinting it
  private ghostMats = [0xff5a6e, 0x46c2ff].map(
    (c) =>
      new MeshBasicMaterial({
        color: c, transparent: true, opacity: 0.3, depthWrite: false, depthFunc: LessDepth,
        polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 8,
      }),
  );

  /** Ghosts of the model posed a little earlier and later (red before, blue after); null hides them. */
  setOnion(poses: Map<string, Pose>[] | null) {
    this.onion = poses;
    this.buildGhosts();
    this.requestRender();
  }

  private clearGhosts() {
    for (const g of this.ghosts) this.scene.remove(g);
    this.ghosts = [];
  }

  private buildGhosts() {
    this.clearGhosts();
    if (!this.onion || !this.model) return;
    this.onion.forEach((pose, i) => {
      // clones share the model's geometry; only the materials differ
      const g = this.model!.clone(true);
      const markers: Object3D[] = [];
      g.traverse((o) => {
        if (o.userData.editorOnly) markers.push(o);
        else if (o instanceof Mesh) {
          o.material = this.ghostMats[i % this.ghostMats.length];
          o.renderOrder = 1;
        }
      });
      for (const m of markers) m.removeFromParent();
      g.userData.ghost = true;
      this.poseNodes(g, pose);
      this.scene.add(g);
      this.ghosts.push(g);
    });
  }

  // ---------- posing by dragging ----------

  private ray = new Raycaster();

  private ndc(e: PointerEvent) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return new Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  }

  /** The part node under the pointer, if any. */
  private partAt(e: PointerEvent): Object3D | null {
    if (!this.model) return null;
    this.ray.setFromCamera(this.ndc(e), this.camera);
    for (const hit of this.ray.intersectObject(this.model, true)) {
      if (hit.object.userData.editorOnly) continue;
      // raycasting ignores visibility, so skip parts hidden in the editor
      let shown = true;
      for (let o: Object3D | null = hit.object; o; o = o.parent) shown &&= o.visible;
      if (!shown) continue;
      for (let o: Object3D | null = hit.object; o; o = o.parent) if (o.userData.partId) return o;
    }
    return null;
  }

  private poseHover(e: PointerEvent) {
    if (!this.poseMode || e.buttons) return;
    this.renderer.domElement.style.cursor = this.partAt(e) ? 'grab' : '';
  }

  private poseDown(e: PointerEvent) {
    if (!this.poseMode || e.button !== 0) return;
    const node = this.partAt(e);
    if (!node) return;
    // this drag poses the part instead of orbiting
    this.controls.enabled = false;
    const el = this.renderer.domElement;
    el.setPointerCapture(e.pointerId);
    el.style.cursor = 'grabbing';
    const partId = node.userData.partId as string;
    const kind: PoseDrag['kind'] = e.shiftKey ? 'move' : 'rotate';
    // rotation: the pointer's angle around the pivot on screen
    const pivot = node.getWorldPosition(new Vector3());
    const r = el.getBoundingClientRect();
    const p = pivot.clone().project(this.camera);
    const cx = r.left + ((p.x + 1) / 2) * r.width;
    const cy = r.top + ((1 - p.y) / 2) * r.height;
    const angleOf = (ev: PointerEvent) => Math.atan2(-(ev.clientY - cy), ev.clientX - cx);
    // seen from behind, turning counter-clockwise on screen is clockwise about +Z
    const facingFront = this.camera.getWorldDirection(new Vector3()).z < 0 ? 1 : -1;
    let last = angleOf(e);
    let total = 0;
    // move: where the pointer meets the plane through the pivot, facing Z
    const plane = new Plane(new Vector3(0, 0, 1), -pivot.z);
    const parent = node.parent!;
    const hitAt = (ev: PointerEvent) => {
      this.ray.setFromCamera(this.ndc(ev), this.camera);
      const out = new Vector3();
      return this.ray.ray.intersectPlane(plane, out) ? parent.worldToLocal(out) : null;
    };
    const h0 = hitAt(e);
    let moved = false;
    const emit = (phase: PoseDrag['phase'], ev: PointerEvent) => {
      let delta: [number, number] = [0, 0];
      if (kind === 'move' && h0) {
        const h = hitAt(ev);
        if (h) delta = [h.x - h0.x, h.y - h0.y];
      }
      this.onPoseDrag?.({ partId, kind, phase, angle: ((total * 180) / Math.PI) * facingFront, delta });
    };
    emit('start', e);
    const move = (ev: PointerEvent) => {
      const a = angleOf(ev);
      let d = a - last;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      total += d; // unwrapped, so dragging round more than once keeps counting
      last = a;
      moved ||= Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 2;
      if (moved) emit('move', ev);
    };
    const up = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      this.controls.enabled = true;
      el.style.cursor = '';
      if (moved) emit('end', ev);
      else {
        this.onPoseDrag?.({ partId, kind, phase: 'end', angle: 0, delta: [0, 0] });
        this.onPick?.(partId);
      }
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  private wiggling: { id: string; start: number } | null = null;

  /** Swing a part back and forth about its pivot (around Z, the side-view axis) to check the joint. */
  wiggle(partId: string) {
    this.wiggling = { id: partId, start: performance.now() };
    this.requestRender();
  }

  private applyWiggle(): boolean {
    const w = this.wiggling;
    if (!w || !this.model) return false;
    let node: Object3D | undefined;
    this.model.traverse((o) => {
      if (o.userData.partId === w.id) node = o;
    });
    const t = (performance.now() - w.start) / 1000;
    const done = t > 1.6 || !node;
    if (done) {
      this.wiggling = null;
      this.applyPose();
    } else if (node) {
      const restZ = ((this.pose?.get(w.id)?.rotation[2] ?? 0) * Math.PI) / 180;
      node.rotation.z = restZ + Math.sin(t * Math.PI * 2.5) * 0.5 * (1 - t / 1.6);
    }
    return !done;
  }

  /** The current camera, for rendering frames from the same view. */
  cameraInfo() {
    return { position: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov };
  }

  resetView() {
    const [x, y] = this.framedSize.split('x').map(Number);
    const r = Math.max(x || 16, y || 16) * 0.75;
    const dist = r / Math.tan((this.camera.fov * Math.PI) / 360);
    this.camera.position.copy(new Vector3(0.45, 0.3, 1).normalize().multiplyScalar(dist));
    this.controls.target.set(0, 0, 0);
    this.camera.near = dist / 100;
    this.camera.far = dist * 10;
    this.camera.updateProjectionMatrix();
    this.controls.update();
    this.requestRender();
  }

  private resize() {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  private requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      // damping keeps the camera moving for a few frames after input
      const moving = this.controls.update();
      if (this.applyWiggle() || moving) this.requestRender();
      this.renderer.render(this.scene, this.camera);
    });
  }
}
