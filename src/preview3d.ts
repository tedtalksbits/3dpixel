import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Group, Mesh, MeshBasicMaterial, SphereGeometry, Object3D, Vector3, Color, GridHelper, LineBasicMaterial,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Project } from './kenshape';
import { buildGroup, disposeGroup } from './modelExport';
import { Part } from './rig';
import { Pose } from './anim';

export class Preview3D {
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
    this.model?.traverse((o) => {
      const id = o.userData.partId;
      if (!id) return;
      const base = o.userData.base;
      const ps = this.pose?.get(id);
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
