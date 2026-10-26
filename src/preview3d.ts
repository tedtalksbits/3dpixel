import {
  WebGLRenderer, Scene, PerspectiveCamera, HemisphereLight, DirectionalLight, Group, Mesh, MeshStandardMaterial, Vector3, Color, GridHelper, LineBasicMaterial,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Project } from './kenshape';
import { buildGroup } from './modelExport';

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

  update(p: Project) {
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose();
          (o.material as MeshStandardMaterial).dispose();
        }
      });
    }
    this.model = buildGroup(p);
    this.scene.add(this.model);
    // only reframe when the grid size changes, so editing doesn't move the camera
    const sizeKey = `${p.size.x}x${p.size.y}`;
    if (sizeKey !== this.framedSize) {
      this.framedSize = sizeKey;
      this.placeGrid();
      this.resetView();
    }
    this.requestRender();
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
      if (this.controls.update()) this.requestRender();
      this.renderer.render(this.scene, this.camera);
    });
  }
}
