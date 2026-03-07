import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── International 10-20 electrode positions (unit sphere) ───────────────
const ELECTRODE_POSITIONS: Record<string, [number, number, number]> = {
  F3:  [-0.42,  0.74,  0.52],   // theta≈42°, phi≈-39°  (left frontal)
  F4:  [ 0.42,  0.74,  0.52],   // theta≈42°, phi≈+39°  (right frontal)
  C3:  [-0.71,  0.71,  0.00],   // theta≈45°, phi≈-90°  (left central)
  C4:  [ 0.71,  0.71,  0.00],   // theta≈45°, phi≈+90°  (right central)
  T5:  [-0.90,  0.31, -0.29],   // theta≈72°, phi≈-108° (left post-temporal)
  T6:  [ 0.90,  0.31, -0.29],   // theta≈72°, phi≈+108° (right post-temporal)
  O1:  [-0.29,  0.31, -0.90],   // theta≈72°, phi≈-162° (left occipital)
  O2:  [ 0.29,  0.31, -0.90],   // theta≈72°, phi≈+162° (right occipital)
  A1:  [-0.95, -0.10,  0.00],   // left earlobe reference
  A2:  [ 0.95, -0.10,  0.00],   // right earlobe reference
};

// Per-region colors
const REGION_COLORS: Record<string, THREE.Color> = {
  F3: new THREE.Color(0x42a5f5),  // Frontal — electric blue
  F4: new THREE.Color(0x42a5f5),
  C3: new THREE.Color(0x66bb6a),  // Central — green
  C4: new THREE.Color(0x66bb6a),
  T5: new THREE.Color(0xffa726),  // Temporal — amber
  T6: new THREE.Color(0xffa726),
  O1: new THREE.Color(0xef5350),  // Occipital — red/coral
  O2: new THREE.Color(0xef5350),
  A1: new THREE.Color(0xb0bec5),  // Ear references — cool grey
  A2: new THREE.Color(0xb0bec5),
};

interface ElectrodeNode {
  surfaceDot: THREE.Mesh;
  light: THREE.PointLight;
  name: string;
  label: THREE.Sprite;
  intensity: number;
}

export class BrainScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private brainGroup: THREE.Group;
  private electrodes: Map<string, ElectrodeNode> = new Map();
  private animId = 0;

  private targetRotX = 0;
  private targetRotZ = 0;
  private currentRotX = 0;
  private currentRotZ = 0;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.3;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 3.5);
    this.camera.lookAt(0, 0.35, 0);

    // Low ambient so the brain stays dark where there's no electrode activity
    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    // Soft directional so you can still see the brain shape
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.4);
    keyLight.position.set(3, 4, 5);
    this.scene.add(keyLight);

    this.brainGroup = new THREE.Group();
    this.scene.add(this.brainGroup);

    this.loadBrain();
    this.handleResize(container);
    this.animate();
  }

  private loadBrain(): void {
    const loader = new GLTFLoader();
    loader.load('/brain.glb', (gltf) => {
      const model = gltf.scene;

      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.6 / maxDim;

      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));

      // Fully opaque brain — point lights above the surface paint colored patches
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xd4b5b0,
            roughness: 0.7,
            metalness: 0.0,
            side: THREE.FrontSide,
          });
        }
      });

      this.brainGroup.add(model);
      this.createElectrodes(scale);
    });
  }

  private createElectrodes(brainScale: number): void {
    const surfaceRadius = 0.85 * brainScale;

    for (const [name, pos] of Object.entries(ELECTRODE_POSITIONS)) {
      const dir = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      const surfacePos = dir.clone().multiplyScalar(surfaceRadius);
      const color = REGION_COLORS[name];

      // Small colored dot sitting on the surface
      const dotGeo = new THREE.SphereGeometry(0.03, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({ color });
      const surfaceDot = new THREE.Mesh(dotGeo, dotMat);
      surfaceDot.position.copy(surfacePos);

      // Point light just above the surface — shines down onto the brain,
      // painting a colored patch on the opaque surface
      const light = new THREE.PointLight(color, 0, 0.6);
      const lightPos = dir.clone().multiplyScalar(surfaceRadius + 0.08);
      light.position.copy(lightPos);

      // Label
      const label = this.createLabel(name, color);
      label.position.copy(dir.clone().multiplyScalar(surfaceRadius + 0.12));

      this.brainGroup.add(surfaceDot);
      this.brainGroup.add(light);
      this.brainGroup.add(label);

      this.electrodes.set(name, { surfaceDot, light, name, label, intensity: 0 });
    }
  }

  private createLabel(text: string, color: THREE.Color): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.15, 0.075, 1);
    return sprite;
  }

  updateActivity(channelNames: string[], channelData: number[][]): void {
    for (let i = 0; i < channelNames.length; i++) {
      const name = channelNames[i];
      const node = this.electrodes.get(name);
      if (!node) continue;

      const samples = channelData[i];
      if (!samples || samples.length === 0) continue;

      let sumSq = 0;
      for (const v of samples) sumSq += v * v;
      const rms = Math.sqrt(sumSq / samples.length);

      const normalized = Math.min(rms / 100, 1.0);
      node.intensity += (normalized - node.intensity) * 0.25;
    }

    for (const node of this.electrodes.values()) {
      const t = node.intensity;
      const color = REGION_COLORS[node.name];

      // Point light paints the brain surface in the region's color
      node.light.intensity = t * 10.0;
      node.light.distance = 0.3 + t * 0.8;

      // Dot brightens toward white when active
      const dotMat = node.surfaceDot.material as THREE.MeshBasicMaterial;
      dotMat.color.copy(color).lerp(new THREE.Color(0xffffff), t * 0.5);
    }
  }

  updateAccel(accel: number[]): void {
    if (accel.length < 3) return;
    const [ax, ay, az] = accel;
    this.targetRotX = -Math.atan2(ay, az);
    this.targetRotZ = Math.atan2(ax, az);
  }

  private handleResize(container: HTMLElement): void {
    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      this.renderer.setSize(w, h);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    new ResizeObserver(resize).observe(container);
  }

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    this.currentRotX += (this.targetRotX - this.currentRotX) * 0.08;
    this.currentRotZ += (this.targetRotZ - this.currentRotZ) * 0.08;
    this.brainGroup.rotation.x = this.currentRotX;
    this.brainGroup.rotation.z = this.currentRotZ;
    this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}
