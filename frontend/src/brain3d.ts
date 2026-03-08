import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ── International 10-20 electrode positions (unit sphere directions) ────
const ELECTRODE_POSITIONS: Record<string, [number, number, number]> = {
  F3:  [-0.42,  0.74,  0.52],   // left frontal
  F4:  [ 0.42,  0.74,  0.52],   // right frontal
  C3:  [-0.71,  0.71,  0.00],   // left central
  C4:  [ 0.71,  0.71,  0.00],   // right central
  T3:  [-0.95,  0.31,  0.00],   // left temporal
  T4:  [ 0.95,  0.31,  0.00],   // right temporal
  P3:  [-0.39,  0.55, -0.59],   // left parietal
  P4:  [ 0.39,  0.55, -0.59],   // right parietal
  A1:  [-0.95, -0.10,  0.00],   // left earlobe reference
  A2:  [ 0.95, -0.10,  0.00],   // right earlobe reference
};

const REGION_COLORS: Record<string, THREE.Color> = {
  F3: new THREE.Color(0x42a5f5),  // Frontal — blue
  F4: new THREE.Color(0x42a5f5),
  C3: new THREE.Color(0x66bb6a),  // Central — green
  C4: new THREE.Color(0x66bb6a),
  T3: new THREE.Color(0xffa726),  // Temporal — orange
  T4: new THREE.Color(0xfdd835),  // Temporal — yellow
  P3: new THREE.Color(0x8d6e63),  // Parietal — brown
  P4: new THREE.Color(0xef5350),  // Parietal — red
  A1: new THREE.Color(0xb0bec5),  // Ear references — grey
  A2: new THREE.Color(0xb0bec5),
};

const NUM_ELECTRODES = 10;
const ELECTRODE_NAMES = Object.keys(ELECTRODE_POSITIONS);

export class BrainScene {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private brainGroup: THREE.Group;
  private animId = 0;

  private targetRotX = 0;
  private targetRotZ = 0;
  private currentRotX = 0;
  private currentRotZ = 0;
  private spinAngle = 0;

  private electrodeIntensity = new Float32Array(NUM_ELECTRODES);
  private electrodeColors = new Float32Array(NUM_ELECTRODES * 3);
  private electrodeDirs = new Float32Array(NUM_ELECTRODES * 3);
  private intensities: number[] = new Array(NUM_ELECTRODES).fill(0);
  private labels: THREE.Sprite[] = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x0a0a1a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.5;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.5, 4.0);
    this.camera.lookAt(0, 0.25, 0);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
    keyLight.position.set(3, 5, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x8899bb, 0.2);
    fillLight.position.set(-4, 2, -3);
    this.scene.add(fillLight);

    this.brainGroup = new THREE.Group();
    this.scene.add(this.brainGroup);

    // Pre-fill color and direction arrays
    for (let i = 0; i < NUM_ELECTRODES; i++) {
      const name = ELECTRODE_NAMES[i];
      const c = REGION_COLORS[name];
      this.electrodeColors[i * 3 + 0] = c.r;
      this.electrodeColors[i * 3 + 1] = c.g;
      this.electrodeColors[i * 3 + 2] = c.b;

      const p = ELECTRODE_POSITIONS[name];
      const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      this.electrodeDirs[i * 3 + 0] = p[0] / len;
      this.electrodeDirs[i * 3 + 1] = p[1] / len;
      this.electrodeDirs[i * 3 + 2] = p[2] / len;
    }

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

      this.brainGroup.add(model);
      this.brainGroup.updateMatrixWorld(true);

      const colArr = this.electrodeColors;
      const intArr = this.electrodeIntensity;
      const dirArr = this.electrodeDirs;

      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;

        const geo = mesh.geometry;
        geo.computeBoundingSphere();
        const meshCenter = geo.boundingSphere!.center;

        const uniforms = {
          uElectrodeDir: { value: dirArr },
          uElectrodeColor: { value: colArr },
          uElectrodeIntensity: { value: intArr },
          uMeshCenter: { value: new THREE.Vector3().copy(meshCenter) },
          // Controls how tight the glow cone is (higher = tighter)
          uGlowSharpness: { value: 10.0 },
        };

        const mat = new THREE.MeshPhysicalMaterial({
          color: 0xc8c8c8,
          roughness: 0.3,
          metalness: 0.0,
          transmission: 0.6,
          thickness: 1.0,
          ior: 1.2,
          transparent: true,
          side: THREE.DoubleSide,
        });

        mat.onBeforeCompile = (shader) => {
          shader.uniforms.uElectrodeDir = uniforms.uElectrodeDir;
          shader.uniforms.uElectrodeColor = uniforms.uElectrodeColor;
          shader.uniforms.uElectrodeIntensity = uniforms.uElectrodeIntensity;
          shader.uniforms.uMeshCenter = uniforms.uMeshCenter;
          shader.uniforms.uGlowSharpness = uniforms.uGlowSharpness;

          shader.vertexShader = shader.vertexShader.replace(
            '#include <common>',
            `#include <common>
varying vec3 vObjPos;`
          );
          shader.vertexShader = shader.vertexShader.replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
vObjPos = transformed;`
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <common>',
            `#include <common>
uniform vec3 uElectrodeDir[${NUM_ELECTRODES}];
uniform vec3 uElectrodeColor[${NUM_ELECTRODES}];
uniform float uElectrodeIntensity[${NUM_ELECTRODES}];
uniform vec3 uMeshCenter;
uniform float uGlowSharpness;
varying vec3 vObjPos;`
          );

          shader.fragmentShader = shader.fragmentShader.replace(
            '#include <emissivemap_fragment>',
            `#include <emissivemap_fragment>
vec3 vertDir = normalize(vObjPos - uMeshCenter);
vec3 glow = vec3(0.0);
float totalWeight = 0.0;
for (int i = 0; i < ${NUM_ELECTRODES}; i++) {
  float alignment = dot(vertDir, uElectrodeDir[i]);
  float falloff = smoothstep(0.55, 0.75, alignment);
  float w = uElectrodeIntensity[i] * falloff;
  glow += uElectrodeColor[i] * w;
  totalWeight += w;
}
// Normalize overlapping regions so they blend colors instead of washing to white
if (totalWeight > 1.0) glow /= totalWeight;
totalEmissiveRadiance += glow * min(totalWeight, 1.0) * 0.4;`
          );
        };

        mesh.material = mat;
      });

      const labelRadius = 0.85 * scale;
      this.createLabels(labelRadius);
    });
  }

  private createLabels(surfaceRadius: number): void {
    for (let i = 0; i < NUM_ELECTRODES; i++) {
      const name = ELECTRODE_NAMES[i];
      const p = ELECTRODE_POSITIONS[name];
      const dir = new THREE.Vector3(p[0], p[1], p[2]).normalize();
      const color = REGION_COLORS[name];

      const label = this.createLabel(name, color);
      label.position.copy(dir.clone().multiplyScalar(surfaceRadius + 0.12));
      this.brainGroup.add(label);
      this.labels.push(label);
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
      const idx = ELECTRODE_NAMES.indexOf(channelNames[i]);
      if (idx === -1) continue;

      const samples = channelData[i];
      if (!samples || samples.length === 0) continue;

      let sumSq = 0;
      for (const v of samples) sumSq += v * v;
      const rms = Math.sqrt(sumSq / samples.length);

      const normalized = Math.min(rms / 80, 1.0);
      this.intensities[idx] += (normalized - this.intensities[idx]) * 0.25;
      this.electrodeIntensity[idx] = this.intensities[idx];
    }
  }

  updateAccel(accel: number[]): void {
    if (accel.length < 3) return;
    const [ax, ay, az] = accel;
    // // Reject synthetic data: real accel has gravity dominant on one axis,
    // // synthetic board outputs ~equal values on all axes
    // const max = Math.max(Math.abs(ax), Math.abs(ay), Math.abs(az));
    // const min = Math.min(Math.abs(ax), Math.abs(ay), Math.abs(az));
    // if (max - min < 0.3) return;
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
    this.spinAngle += 0.003;
    this.brainGroup.rotation.set(this.currentRotX, this.spinAngle, this.currentRotZ);
    this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}
