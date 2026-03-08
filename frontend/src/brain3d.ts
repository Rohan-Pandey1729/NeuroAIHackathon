import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ── International 10-20 electrode positions (unit sphere directions) ────
// Derived from standard 10-20 spherical coordinates:
//   θ = polar angle from vertex (Cz), φ = azimuth from front (+Z)
//   C3/C4: θ=36°, φ=±90°  |  T3/T4: θ=72°, φ=±90°
//   F3/F4: θ=46°, φ=±50°  |  P3/P4: θ=46°, φ=±130°
//   A1/A2: θ=100°, φ=±90° (below ear)
const ELECTRODE_POSITIONS: Record<string, [number, number, number]> = {
  F3:  [-0.551,  0.695,  0.462],   // left frontal
  F4:  [ 0.551,  0.695,  0.462],   // right frontal
  C3:  [-0.588,  0.809,  0.000],   // left central
  C4:  [ 0.588,  0.809,  0.000],   // right central
  T3:  [-0.951,  0.309,  0.000],   // left temporal
  T4:  [ 0.951,  0.309,  0.000],   // right temporal
  P3:  [-0.551,  0.695, -0.462],   // left parietal
  P4:  [ 0.551,  0.695, -0.462],   // right parietal
  A1:  [-0.985, -0.174,  0.000],   // left earlobe reference
  A2:  [ 0.985, -0.174,  0.000],   // right earlobe reference
};

const REGION_COLORS: Record<string, THREE.Color> = {
  F3: new THREE.Color(0x1e88ff),  // Frontal — vivid blue
  F4: new THREE.Color(0x1e88ff),
  C3: new THREE.Color(0x2ee650),  // Central — vivid green
  C4: new THREE.Color(0x2ee650),
  T3: new THREE.Color(0xff8800),  // Temporal — vivid orange
  T4: new THREE.Color(0xffe600),  // Temporal — vivid yellow
  P3: new THREE.Color(0xcc6633),  // Parietal — rich brown
  P4: new THREE.Color(0xff2222),  // Parietal — vivid red
  A1: new THREE.Color(0x88ccee),  // Ear references — light cyan
  A2: new THREE.Color(0x88ccee),
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

  // Calibration: first accelerometer reading becomes the zero reference
  private accelCalibrated = false;
  private accelOffsetX = 0;  // pitch offset
  private accelOffsetZ = 0;  // roll offset

  private electrodeIntensity = new Float32Array(NUM_ELECTRODES);
  private electrodeColors = new Float32Array(NUM_ELECTRODES * 3);
  private electrodeDirs = new Float32Array(NUM_ELECTRODES * 3);       // world-space (rotated each frame)
  private electrodeRestDirs = new Float32Array(NUM_ELECTRODES * 3);   // brain-local (fixed)
  private intensities: number[] = new Array(NUM_ELECTRODES).fill(0);
  private labels: THREE.Sprite[] = [];

  // Raycasting for click detection
  private raycaster = new THREE.Raycaster();
  private mouse = new THREE.Vector2();
  private brainModel: THREE.Object3D | null = null;
  private clickCb: ((name: string, color: { r: number; g: number; b: number }) => void) | null = null;

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setClearColor(0x020810, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;
    this.renderer.clippingPlanes = [];
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    this.camera.position.set(0, 0.5, 4.0);
    this.camera.lookAt(0, 0.25, 0);
    this.camera.near = 0.001; // Allows camera to get closer [6]
    this.camera.far = 100000; // Allows camera to see further [6]
    this.camera.updateProjectionMatrix();

    const ambient = new THREE.AmbientLight(0x1a3a5a, 0.4);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0x4488cc, 0.3);
    keyLight.position.set(3, 5, 5);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0x2244aa, 0.15);
    fillLight.position.set(-4, 2, -3);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x00ccff, 0.25);
    rimLight.position.set(0, -3, -5);
    this.scene.add(rimLight);

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
      this.electrodeRestDirs[i * 3 + 0] = p[0] / len;
      this.electrodeRestDirs[i * 3 + 1] = p[1] / len;
      this.electrodeRestDirs[i * 3 + 2] = p[2] / len;
      this.electrodeDirs[i * 3 + 0] = p[0] / len;
      this.electrodeDirs[i * 3 + 1] = p[1] / len;
      this.electrodeDirs[i * 3 + 2] = p[2] / len;
    }

    this.loadBrain();
    this.handleResize(container);
    this.animate();

    // Click detection
    this.renderer.domElement.style.cursor = 'pointer';
    this.renderer.domElement.addEventListener('click', this.handleClick);
  }

  onElectrodeClick(cb: (name: string, color: { r: number; g: number; b: number }) => void): void {
    this.clickCb = cb;
  }

  private handleClick = (event: MouseEvent): void => {
    if (!this.clickCb || !this.brainModel) return;

    const rect = this.renderer.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObjects([this.brainModel], true);
    if (intersects.length === 0) return;

    // Determine direction from brain center in local space
    const localPt = this.brainGroup.worldToLocal(intersects[0].point.clone());
    const dir = localPt.normalize();

    // Find nearest electrode by dot product (use rest dirs — same local space as the click point)
    let bestIdx = -1;
    let bestDot = -1;
    for (let i = 0; i < NUM_ELECTRODES; i++) {
      const ex = this.electrodeRestDirs[i * 3];
      const ey = this.electrodeRestDirs[i * 3 + 1];
      const ez = this.electrodeRestDirs[i * 3 + 2];
      const dot = dir.x * ex + dir.y * ey + dir.z * ez;
      if (dot > bestDot) {
        bestDot = dot;
        bestIdx = i;
      }
    }

    // Only trigger if reasonably close to an electrode and it has some signal
    if (bestIdx >= 0 && bestDot > 0.65 && this.electrodeIntensity[bestIdx] > 0.01) {
      const name = ELECTRODE_NAMES[bestIdx];
      const c = REGION_COLORS[name];
      this.clickCb(name, { r: c.r, g: c.g, b: c.b });
    }
  };

  private loadBrain(): void {
    const loader = new GLTFLoader();
    loader.load('/brain.glb', (gltf) => {
      const model = gltf.scene;

      // Compute bounding box before merging
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 1.6 / maxDim;

      // Apply transforms so all geometries share one coordinate space
      model.scale.setScalar(scale);
      model.position.sub(center.clone().multiplyScalar(scale));
      model.updateMatrixWorld(true);

      // Collect all geometries, baking their world transforms
      const geometries: THREE.BufferGeometry[] = [];
      model.traverse((child) => {
        if (!(child as THREE.Mesh).isMesh) return;
        const mesh = child as THREE.Mesh;
        const geo = mesh.geometry.clone();
        geo.applyMatrix4(mesh.matrixWorld);
        geometries.push(geo);
      });

      if (geometries.length === 0) return;

      // Merge into a single geometry + mesh
      const merged = mergeGeometries(geometries, false);
      if (!merged) return;
      merged.computeVertexNormals();

      const colArr = this.electrodeColors;
      const intArr = this.electrodeIntensity;
      const dirArr = this.electrodeDirs;

      const uniforms = {
        uElectrodeDir: { value: dirArr },
        uElectrodeColor: { value: colArr },
        uElectrodeIntensity: { value: intArr },
      };

      const makeMaterial = (side: THREE.Side) => {
        const mat = new THREE.MeshPhysicalMaterial({
          color: 0x0d3050,
          roughness: 0.6,
          metalness: 0.0,
          transparent: true,
          opacity: 0.25,
          side,
          emissive: new THREE.Color(0x0a3050),
          emissiveIntensity: 0.2,
          depthWrite: true,
        });
        mat.clippingPlanes = [];
        return mat;
      };

      const applyShader = (mat: THREE.MeshPhysicalMaterial) => {
        mat.onBeforeCompile = (shader) => {
        shader.uniforms.uElectrodeDir = uniforms.uElectrodeDir;
        shader.uniforms.uElectrodeColor = uniforms.uElectrodeColor;
        shader.uniforms.uElectrodeIntensity = uniforms.uElectrodeIntensity;

        shader.vertexShader = shader.vertexShader.replace(
          '#include <common>',
          `#include <common>
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vObjPos = transformed;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          '#include <worldpos_vertex>',
          `#include <worldpos_vertex>
vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <common>',
          `#include <common>
uniform vec3 uElectrodeDir[${NUM_ELECTRODES}];
uniform vec3 uElectrodeColor[${NUM_ELECTRODES}];
uniform float uElectrodeIntensity[${NUM_ELECTRODES}];
varying vec3 vObjPos;
varying vec3 vWorldNormal;
varying vec3 vWorldPosition;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>

vec3 viewDir = normalize(cameraPosition - vWorldPosition);
float fresnel = 1.0 - abs(dot(viewDir, normalize(vWorldNormal)));
fresnel = pow(fresnel, 1.8);
vec3 edgeColor = vec3(0.15, 0.75, 0.95);
totalEmissiveRadiance += edgeColor * fresnel * 0.3;

float vertDepth = length(vWorldPosition);
float outerMask = smoothstep(0.05, 0.2, vertDepth);

vec3 vertDir = normalize(vWorldPosition);
vec3 glow = vec3(0.0);
float totalWeight = 0.0;
for (int i = 0; i < ${NUM_ELECTRODES}; i++) {
  float alignment = dot(vertDir, uElectrodeDir[i]);
  float core = smoothstep(0.82, 0.92, alignment);
  float halo = smoothstep(0.65, 0.82, alignment) * 0.15;
  float falloff = core + halo;
  float w = uElectrodeIntensity[i] * falloff * outerMask;
  glow += uElectrodeColor[i] * w;
  totalWeight += w;
}
if (totalWeight > 1.0) glow /= totalWeight;
float glowStrength = min(totalWeight, 1.0);
vec3 electrodeGlow = glow * glowStrength * 0.6;`
        );

        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
vec3 vertDir2 = normalize(vWorldPosition);
float regionAlpha = 0.0;
for (int i = 0; i < ${NUM_ELECTRODES}; i++) {
  float alignment = dot(vertDir2, uElectrodeDir[i]);
  float core = smoothstep(0.82, 0.92, alignment);
  regionAlpha = max(regionAlpha, uElectrodeIntensity[i] * core);
}
gl_FragColor.rgb += electrodeGlow;
float depth2 = length(vWorldPosition);
float outerFactor = smoothstep(0.05, 0.2, depth2);
gl_FragColor.a *= mix(0.25, 0.8, outerFactor);
gl_FragColor.a = mix(gl_FragColor.a, 0.8, regionAlpha);`
        );
      };
      };

      // Two-pass rendering: back faces first, then front faces (no sorting needed)
      const backMat = makeMaterial(THREE.BackSide);
      applyShader(backMat);
      const backMesh = new THREE.Mesh(merged, backMat);
      backMesh.renderOrder = 0;
      this.brainGroup.add(backMesh);

      const frontMat = makeMaterial(THREE.FrontSide);
      applyShader(frontMat);
      const frontMesh = new THREE.Mesh(merged, frontMat);
      frontMesh.renderOrder = 1;
      this.brainGroup.add(frontMesh);

      this.brainModel = frontMesh;

      const labelRadius = 70 * scale;
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
    ctx.font = 'bold 50px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${color.getHexString()}`;
    ctx.fillText(text, 64, 32);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, opacity: 0.9, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.renderOrder = 2;
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
    // Cyton on head: X=lateral, Y=anterior/posterior, Z=up (gravity ~1g)
    // Pitch (nodding forward/back) = tilt around X axis from Y vs Z
    // Roll  (ear to shoulder)      = tilt around Z axis from X vs Z
    const g = Math.sqrt(ax * ax + ay * ay + az * az);
    if (g < 0.3) return; // reject near-zero readings

    const rawPitch = Math.atan2(ay, az);
    const rawRoll = -Math.atan2(ax, az);

    // Calibrate on first valid reading so initial orientation = neutral
    if (!this.accelCalibrated) {
      this.accelOffsetX = rawPitch;
      this.accelOffsetZ = rawRoll;
      this.accelCalibrated = true;
    }

    this.targetRotX = rawPitch - this.accelOffsetX;
    this.targetRotZ = rawRoll - this.accelOffsetZ;
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

  private _tempVec = new THREE.Vector3();

  private animate = (): void => {
    this.animId = requestAnimationFrame(this.animate);
    this.currentRotX += (this.targetRotX - this.currentRotX) * 0.08;
    this.currentRotZ += (this.targetRotZ - this.currentRotZ) * 0.08;
    this.spinAngle += 0.003;
    this.brainGroup.rotation.set(this.currentRotX, this.spinAngle, this.currentRotZ);

    // Rotate electrode directions from brain-local to world space
    const q = this.brainGroup.quaternion;
    for (let i = 0; i < NUM_ELECTRODES; i++) {
      const off = i * 3;
      this._tempVec.set(
        this.electrodeRestDirs[off],
        this.electrodeRestDirs[off + 1],
        this.electrodeRestDirs[off + 2],
      ).applyQuaternion(q);
      this.electrodeDirs[off] = this._tempVec.x;
      this.electrodeDirs[off + 1] = this._tempVec.y;
      this.electrodeDirs[off + 2] = this._tempVec.z;
    }

    this.renderer.render(this.scene, this.camera);
  };

  destroy(): void {
    cancelAnimationFrame(this.animId);
    this.renderer.dispose();
  }
}
