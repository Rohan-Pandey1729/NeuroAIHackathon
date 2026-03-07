import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── 10-20 electrode positions on a unit sphere ──────────────────────────
// Approximate (theta, phi) mapped to 3D coords on a sphere of radius R.
// Theta = polar angle from top (Cz), Phi = azimuthal from front (Fpz).
// These positions follow the standard International 10-20 layout.
const ELECTRODE_POSITIONS: Record<string, [number, number, number]> = {
  // Frontal
  F3:  [-0.31,  0.59,  0.55],
  F4:  [ 0.31,  0.59,  0.55],
  // Central
  C3:  [-0.55,  0.59,  0.00],
  C4:  [ 0.55,  0.59,  0.00],
  // Temporal
  T5:  [-0.67,  0.25, -0.45],
  T6:  [ 0.67,  0.25, -0.45],
  // Occipital
  O1:  [-0.31,  0.40, -0.70],
  O2:  [ 0.31,  0.40, -0.70],
  // Ear references (below and lateral)
  A1:  [-0.78,  0.10,  0.00],
  A2:  [ 0.78,  0.10,  0.00],
};

const GLOW_COLOR_LOW  = new THREE.Color(0x1a1a4e);  // dark indigo (quiet)
const GLOW_COLOR_HIGH = new THREE.Color(0x00ffff);   // cyan (active)

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
    container.appendChild(this.renderer.domElement);

    // Scene
    this.scene = new THREE.Scene();

    // Camera
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.5, 3.2);
    this.camera.lookAt(0, 0.4, 0);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
    dirLight.position.set(2, 3, 4);
    this.scene.add(dirLight);

    const backLight = new THREE.DirectionalLight(0x8888ff, 0.4);
    backLight.position.set(-2, 1, -3);
    this.scene.add(backLight);

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

      // Make brain semi-transparent so electrodes are visible
      model.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          if (mat) {
            mat.transparent = true;
            mat.opacity = 0.55;
            mat.depthWrite = false;
            mat.side = THREE.DoubleSide;
          }
        }
      });

      this.brainGroup.add(model);

      // Place electrodes relative to the brain bounding box
      this.createElectrodes(scale);
    });
  }

  private createElectrodes(brainScale: number): void {
    const radius = 0.82 * brainScale;

    for (const [name, pos] of Object.entries(ELECTRODE_POSITIONS)) {
      // Scale position to sit on the brain surface
      const position = new THREE.Vector3(pos[0], pos[1], pos[2]).multiplyScalar(radius / 0.78);

      // Solid electrode dot
      const dotGeo = new THREE.SphereGeometry(0.035, 16, 16);
      const dotMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: GLOW_COLOR_LOW,
        emissiveIntensity: 0.5,
      });
      const dotMesh = new THREE.Mesh(dotGeo, dotMat);
      dotMesh.position.copy(position);

      // Glow sphere (larger, additive)
      const glowGeo = new THREE.SphereGeometry(0.08, 16, 16);
      const glowMat = new THREE.MeshBasicMaterial({
        color: GLOW_COLOR_LOW,
        transparent: true,
        opacity: 0.25,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glowMesh = new THREE.Mesh(glowGeo, glowMat);
      glowMesh.position.copy(position);

      // Text label sprite
      const label = this.createLabel(name);
      label.position.copy(position);
      label.position.y += 0.07;

      this.brainGroup.add(dotMesh);
      this.brainGroup.add(glowMesh);
      this.brainGroup.add(label);

      this.electrodes.set(name, { mesh: dotMesh, glowMesh, name, label, intensity: 0 });
    }
  }

  private createLabel(text: string): THREE.Sprite {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.85 });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(0.15, 0.075, 1);
    return sprite;
  }

  /** Update electrode glow from live EEG amplitudes */
  updateActivity(channelNames: string[], channelData: number[][]): void {
    // Compute RMS amplitude per channel from the latest samples
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

      // Normalize: typical EEG is ~10-100 uV. Map to 0..1 range.
      // Adjust these thresholds if needed for your signal range.
      const normalized = Math.min(rms / 150, 1.0);

      // Smooth toward target
      node.intensity += (normalized - node.intensity) * 0.3;
    }

    // Apply visual updates
    for (const node of this.electrodes.values()) {
      const t = node.intensity;
      const color = GLOW_COLOR_LOW.clone().lerp(GLOW_COLOR_HIGH, t);

      // Electrode dot
      const dotMat = node.mesh.material as THREE.MeshStandardMaterial;
      dotMat.emissive.copy(color);
      dotMat.emissiveIntensity = 0.5 + t * 2.0;

      // Glow sphere
      const glowMat = node.glowMesh.material as THREE.MeshBasicMaterial;
      glowMat.color.copy(color);
      glowMat.opacity = 0.15 + t * 0.6;
      const glowScale = 1 + t * 1.5;
      node.glowMesh.scale.setScalar(glowScale);
    }
  }

  /** Update head orientation from Cyton accelerometer [x, y, z] */
  updateAccel(accel: number[]): void {
    if (accel.length < 3) return;
    const [ax, ay, az] = accel;

    // Convert accelerometer gravity vector to tilt angles
    // Cyton accel is in g's (~1g down at rest)
    const pitch = Math.atan2(ax, Math.sqrt(ay * ay + az * az));
    const roll  = Math.atan2(ay, Math.sqrt(ax * ax + az * az));

    this.targetRotX = pitch;
    this.targetRotZ = -roll;
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
    this.brainGroup.rotation.y += 0.003;

    this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}
