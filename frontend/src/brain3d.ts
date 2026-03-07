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

// Per-region colors for each brain area
const REGION_COLORS: Record<string, { low: THREE.Color; high: THREE.Color }> = {
  // Frontal — blue/electric blue
  F3: { low: new THREE.Color(0x1a237e), high: new THREE.Color(0x42a5f5) },
  F4: { low: new THREE.Color(0x1a237e), high: new THREE.Color(0x42a5f5) },
  // Central — green/lime
  C3: { low: new THREE.Color(0x1b5e20), high: new THREE.Color(0x66bb6a) },
  C4: { low: new THREE.Color(0x1b5e20), high: new THREE.Color(0x66bb6a) },
  // Temporal — orange/amber
  T5: { low: new THREE.Color(0x4e342e), high: new THREE.Color(0xffa726) },
  T6: { low: new THREE.Color(0x4e342e), high: new THREE.Color(0xffa726) },
  // Occipital — red/magenta
  O1: { low: new THREE.Color(0x4a148c), high: new THREE.Color(0xef5350) },
  O2: { low: new THREE.Color(0x4a148c), high: new THREE.Color(0xef5350) },
  // Ear references — cool grey
  A1: { low: new THREE.Color(0x263238), high: new THREE.Color(0xb0bec5) },
  A2: { low: new THREE.Color(0x263238), high: new THREE.Color(0xb0bec5) },
};

interface ElectrodeNode {
  mesh: THREE.Mesh;
  glowMesh: THREE.Mesh;
  name: string;
  label: THREE.Sprite;
  intensity: number;   // 0..1 smoothed
}

export class BrainScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private brainGroup: THREE.Group;
  private electrodes: Map<string, ElectrodeNode> = new Map();
  private animId = 0;
  private idleYRotation = 0;

  // Smoothed accelerometer orientation
  private targetRotX = 0;
  private targetRotZ = 0;
  private currentRotX = 0;
  private currentRotZ = 0;

  constructor(container: HTMLElement) {
    // Renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.6, 3.5);
    this.camera.lookAt(0, 0.35, 0);

    // Lighting — brighter and more balanced to make brain visible
    const ambient = new THREE.AmbientLight(0xffffff, 1.2);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.8);
    keyLight.position.set(3, 4, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8899cc, 0.8);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xaaaaff, 0.6);
    rimLight.position.set(0, -1, -4);
    this.scene.add(rimLight);

    // Subtle hemisphere light for natural fill
    const hemiLight = new THREE.HemisphereLight(0xccccff, 0x444444, 0.5);
    this.scene.add(hemiLight);

    // Group that holds brain + electrodes (rotated by accelerometer)
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

      // Compute bounding box to normalize size and center
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.6 / maxDim;

      model.scale.setScalar(scale);
      model.position.sub(center.multiplyScalar(scale));

      // Make brain semi-transparent but still visible
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.transparent = true;
            mat.opacity = 0.7;
            mat.depthWrite = false;
            mat.side = THREE.DoubleSide;
            mat.roughness = 0.6;
            mat.metalness = 0.1;
            // Slight pink/flesh emissive so it isn't pitch black
            mat.emissive = new THREE.Color(0x331122);
            mat.emissiveIntensity = 0.3;
          }
        }
      });

      this.brainGroup.add(model);

      // Place electrodes relative to the brain bounding box
      this.createElectrodes(scale);
    });
  }

  private createElectrodes(brainScale: number): void {
    const radius = 0.85 * brainScale;

    for (const [name, pos] of Object.entries(ELECTRODE_POSITIONS)) {
      const position = new THREE.Vector3(pos[0], pos[1], pos[2]).multiplyScalar(radius);
      const colors = REGION_COLORS[name];

      // Solid electrode dot
      const dotGeo = new THREE.SphereGeometry(0.04, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: colors.low,
        emissiveIntensity: 0.8,
        roughness: 0.3,
        metalness: 0.2,
      });
      const dotMesh = new THREE.Mesh(dotGeo, dotMat);
      dotMesh.position.copy(position);

      // Glow sphere (larger, additive)
      const glowGeo = new THREE.SphereGeometry(0.10, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({
        color: colors.low,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.copy(position);

      // Text label sprite
      const label = this.createLabel(name, colors.high);
      label.position.copy(position);
      label.position.y += 0.09;

      this.brainGroup.add(dotMesh);
      this.brainGroup.add(glowMesh);
      this.brainGroup.add(label);

      this.electrodes.set(name, { mesh: dotMesh, glowMesh, name, label, intensity: 0 });
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

  /** Update electrode glow from live EEG amplitudes */
  updateActivity(channelNames: string[], channelData: number[][]): void {
    for (let i = 0; i < channelNames.length; i++) {
      const name = channelNames[i];
      const node = this.electrodes.get(name);
      if (!node) continue;

      const samples = channelData[i];
      if (!samples || samples.length === 0) continue;

      // RMS of latest chunk
      let sumSq = 0;
      for (const v of samples) sumSq += v * v;
      const rms = Math.sqrt(sumSq / samples.length);

      // Normalize — adjust for your signal range (uV after filtering)
      const normalized = Math.min(rms / 100, 1.0);

      // Smooth toward target
      node.intensity += (normalized - node.intensity) * 0.25;
    }

    // Apply visual updates per electrode with region-specific colors
    for (const node of this.electrodes.values()) {
      const t = node.intensity;
      const colors = REGION_COLORS[node.name];

      const color = colors.low.clone().lerp(colors.high, t);

      // Electrode dot
      const dotMat = node.mesh.material as THREE.MeshStandardMaterial;
      dotMat.emissive.copy(color);
      dotMat.emissiveIntensity = 0.8 + t * 3.0;

      // Glow sphere
      const glowMat = node.glowMesh.material as THREE.MeshBasicMaterial;
      glowMat.color.copy(color);
      glowMat.opacity = 0.15 + t * 0.7;
      const glowScale = 1.0 + t * 2.0;
      node.glowMesh.scale.setScalar(glowScale);
    }
  }

  /** Update head orientation from Cyton accelerometer [x, y, z].
   *  Cyton on Ultracortex: X=left/right, Y=front/back, Z=up (~1g at rest). */
  updateAccel(accel: number[]): void {
    if (accel.length < 3) return;
    const [ax, ay, az] = accel;

    // Forward/back tilt: Y-axis accel vs Z-axis gravity
    // Tilting forward → ay increases → rotate model forward (negative X rotation)
    this.targetRotX = -Math.atan2(ay, az);

    // Left/right tilt: X-axis accel vs Z-axis gravity
    // Tilting right → ax increases → rotate model right (positive Z rotation)
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

    // Smooth interpolation toward target rotation
    this.currentRotX += (this.targetRotX - this.currentRotX) * 0.08;
    this.currentRotZ += (this.targetRotZ - this.currentRotZ) * 0.08;

    this.brainGroup.rotation.x = this.currentRotX;
    this.brainGroup.rotation.z = this.currentRotZ;

    // Slow idle Y rotation so you can see all sides
    this.idleYRotation += 0.003;
    this.brainGroup.rotation.y = this.idleYRotation;

    this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}
