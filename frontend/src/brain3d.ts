import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── International 10-20 electrode positions (unit sphere) ───────────────
// Computed from standard 10-20 spherical coordinates:
//   theta = polar angle from vertex (Cz), phi = azimuth (0°=front, +90°=right)
//   x = sin(theta)*sin(phi), y = cos(theta), z = sin(theta)*cos(phi)
// Coordinate system: x=right, y=up, z=forward (toward nose)
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
  innerGlow: THREE.Mesh;
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

  // Smoothed accelerometer orientation
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

    // Subtle ambient — most light comes from electrode point lights
    const ambient = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.5);
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

      // Semi-transparent brain — you can see internal glow through the surface
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          mesh.material = new THREE.MeshStandardMaterial({
            color: 0xd4b5b0,
            roughness: 0.65,
            metalness: 0.05,
            transparent: true,
            opacity: 0.45,
            side: THREE.DoubleSide,
            depthWrite: false,
          });
        }
      });

      // Render brain last so internal glow shows through
      model.renderOrder = 1;

      this.brainGroup.add(model);
      this.createElectrodes(scale);
    });
  }

  private createElectrodes(brainScale: number): void {
    const surfaceRadius = 0.85 * brainScale;
    // Place lights and glow deeper inside the brain
    const innerRadius = 0.55 * brainScale;

    for (const [name, pos] of Object.entries(ELECTRODE_POSITIONS)) {
      const dir = new THREE.Vector3(pos[0], pos[1], pos[2]).normalize();
      const surfacePos = dir.clone().multiplyScalar(surfaceRadius);
      const innerPos = dir.clone().multiplyScalar(innerRadius);
      const color = REGION_COLORS[name];

      // Small dot on the brain surface to mark electrode location
      const dotGeo = new THREE.SphereGeometry(0.025, 12, 12);
      const dotMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 });
      const surfaceDot = new THREE.Mesh(dotGeo, dotMat);
      surfaceDot.position.copy(surfacePos);
      surfaceDot.renderOrder = 0;

      // Inner glow sphere — sits inside the brain, visible through transparent shell
      const glowGeo = new THREE.SphereGeometry(0.12, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const innerGlow = new THREE.Mesh(glowGeo, glowMat);
      innerGlow.position.copy(innerPos);
      innerGlow.renderOrder = 0;

      // Point light inside the brain — illuminates the brain shell from within
      const light = new THREE.PointLight(color, 0, 1.2);
      light.position.copy(innerPos);

      // Label just outside the surface
      const label = this.createLabel(name, color);
      label.position.copy(surfacePos);
      label.position.addScaledVector(dir, 0.1);
      label.renderOrder = 2;

      this.brainGroup.add(surfaceDot);
      this.brainGroup.add(innerGlow);
      this.brainGroup.add(light);
      this.brainGroup.add(label);

      this.electrodes.set(name, { surfaceDot, innerGlow, light, name, label, intensity: 0 });
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

      // Inner glow sphere — grows and brightens with activity
      const glowMat = node.innerGlow.material as THREE.MeshBasicMaterial;
      glowMat.opacity = t * 0.8;
      const glowScale = 0.8 + t * 2.5;
      node.innerGlow.scale.setScalar(glowScale);

      // Point light inside brain — illuminates surrounding brain tissue
      node.light.intensity = t * 6.0;
      node.light.distance = 0.5 + t * 1.0;

      // Surface dot brightness
      const dotMat = node.surfaceDot.material as THREE.MeshBasicMaterial;
      dotMat.color.copy(color).lerp(new THREE.Color(0xffffff), t * 0.6);
      dotMat.opacity = 0.4 + t * 0.6;
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
