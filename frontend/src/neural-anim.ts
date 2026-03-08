// Neural connection formation animation popup — 3D Three.js version
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import {
  estimateNeuralPopulation,
  formatNeuronCount,
  CONDUCTIVITY,
  type NeuralEstimate,
} from './neuro-model.ts';

/* ─── Constants ─── */

const REGION_LABELS: Record<string, string> = {
  F3: 'Left Frontal', F4: 'Right Frontal',
  C3: 'Left Central', C4: 'Right Central',
  T3: 'Left Temporal', T4: 'Right Temporal',
  P3: 'Left Parietal', P4: 'Right Parietal',
  A1: 'Left Reference', A2: 'Right Reference',
};

const REGION_INFO: Record<string, string> = {
  F3: 'Frontal Lobe — Crucial for high-level cognitive processing, planning, decision-making, and working memory. The left frontal region (F3) is particularly active during learning, language production, and logical reasoning.',
  F4: 'Frontal Lobe — Crucial for high-level cognitive processing, planning, decision-making, and working memory. The right frontal region (F4) is associated with creativity, emotional regulation, and spatial reasoning.',
  C3: 'Central Region — Associated with motor planning, sensorimotor integration, and motor learning. C3 covers the left motor/sensory cortex, governing right-side body movement and tactile processing.',
  C4: 'Central Region — Associated with motor planning, sensorimotor integration, and motor learning. C4 covers the right motor/sensory cortex, governing left-side body movement and tactile processing.',
  T3: 'Temporal Lobe — Involved in memory encoding, auditory processing, and language comprehension. The left temporal region (T3) plays a key role in verbal memory and speech understanding.',
  T4: 'Temporal Lobe — Involved in memory encoding, auditory processing, and language comprehension. The right temporal region (T4) is important for musical perception and non-verbal memory.',
  P3: 'Parietal Lobe — Responsible for integrating sensory information, spatial awareness, and attention. The left parietal region (P3) is involved in mathematical reasoning and reading.',
  P4: 'Parietal Lobe — Responsible for integrating sensory information, spatial awareness, and attention. The right parietal region (P4) is important for spatial navigation and visuospatial processing.',
  A1: 'Ear Reference (A1) — The left earlobe electrode serves as an electrically neutral reference point for measuring voltage differences across scalp electrodes.',
  A2: 'Ear Reference (A2) — The right earlobe electrode serves as an electrically neutral reference point for measuring voltage differences across scalp electrodes.',
};

/* ─── Data structures ─── */

interface NeuronNode3D {
  pos: THREE.Vector3;
  radius: number;
  phase: number;
  appearAt: number;
  lastFire: number;
  core: THREE.Mesh;
  glow: THREE.Sprite;
  baseScale: number;
}

interface DendriteSeg3D {
  line: THREE.Line;
  totalPoints: number;
  growStart: number;
  growRate: number; // points per second
}

interface Conn3D {
  a: number;
  b: number;
  curve: THREE.QuadraticBezierCurve3;
  tube: THREE.Mesh;
  formAt: number;
  flashSprite: THREE.Sprite;
  particles: { t: number; speed: number; sprite: THREE.Sprite; size: number }[];
}

interface Label3D {
  text: string;
  targetPos: THREE.Vector3;
  object: CSS2DObject;
  connector: THREE.Line;
  appearAt: number;
}

/* ─── Helpers ─── */

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.6)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.15)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

/* ─── Main class ─── */

export class NeuralAnimPopup {
  private overlay: HTMLDivElement;
  private threeContainer: HTMLDivElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private w: number;
  private h: number;
  private animId = 0;
  private t0 = 0;
  private hue: number;
  private regionColor: THREE.Color;

  private neurons: NeuronNode3D[] = [];
  private dendrites: DendriteSeg3D[] = [];
  private conns: Conn3D[] = [];
  private ambientParticles: THREE.Points | null = null;

  private escHandler: (e: KeyboardEvent) => void;
  private onCloseCallback: (() => void) | null;
  private intensity = 0.5;
  private regionName: string;
  private estimate: NeuralEstimate;
  private liveVoltage = 0;
  private biophysPanel: HTMLDivElement | null = null;
  private labelRenderer!: CSS2DRenderer;
  private labels: Label3D[] = [];
  private populationCloud: THREE.Points | null = null;
  private populationCount = 0;
  private scaleLabel: CSS2DObject | null = null;
  private popSlider: HTMLInputElement | null = null;
  private popSliderValueEl: HTMLSpanElement | null = null;

  // Shared textures
  private glowTex: THREE.Texture;

  constructor(
    name: string,
    color: { r: number; g: number; b: number },
    onClose?: () => void,
    initialVoltage_uV = 30,
  ) {
    this.hue = this.rgbToHue(color.r, color.g, color.b);
    this.regionColor = new THREE.Color(color.r, color.g, color.b);
    this.onCloseCallback = onClose ?? null;
    this.regionName = name;
    this.liveVoltage = initialVoltage_uV;
    this.estimate = estimateNeuralPopulation(initialVoltage_uV, name);
    this.glowTex = createGlowTexture();

    /* ── DOM ── */
    this.overlay = document.createElement('div');
    this.overlay.className = 'neural-overlay';

    const popup = document.createElement('div');
    popup.className = 'neural-popup';

    const title = document.createElement('div');
    title.className = 'neural-title';
    const label = REGION_LABELS[name] ?? name;
    const cStr = `rgb(${(color.r * 255) | 0},${(color.g * 255) | 0},${(color.b * 255) | 0})`;
    title.innerHTML = `<span style="color:${cStr}">${name}</span> &mdash; ${label}`;
    popup.appendChild(title);

    // 3D container replaces 2D canvas
    this.threeContainer = document.createElement('div');
    this.threeContainer.className = 'neural-canvas';
    this.threeContainer.style.overflow = 'hidden';
    popup.appendChild(this.threeContainer);

    // Population density slider
    const sliderRow = document.createElement('div');
    sliderRow.className = 'neural-slider-row';
    const sliderLabel = document.createElement('span');
    sliderLabel.className = 'neural-slider-label';
    sliderLabel.textContent = 'Population scale';
    this.popSlider = document.createElement('input');
    this.popSlider.type = 'range';
    this.popSlider.className = 'neural-slider';
    this.popSlider.min = '50';
    this.popSlider.max = String(NeuralAnimPopup.MAX_POP_PARTICLES);
    this.popSlider.step = '10';
    this.popSlider.value = '500';
    this.popSliderValueEl = document.createElement('span');
    this.popSliderValueEl.className = 'neural-slider-value';
    this.popSlider.addEventListener('input', () => {
      this.populationCount = parseInt(this.popSlider!.value);
      this.applyPopulationSlider();
    });
    sliderRow.appendChild(sliderLabel);
    sliderRow.appendChild(this.popSlider);
    sliderRow.appendChild(this.popSliderValueEl);
    popup.appendChild(sliderRow);

    // Legend
    const legend = document.createElement('div');
    legend.className = 'neural-legend';
    legend.innerHTML = [
      `<span class="neural-legend-item"><span class="neural-legend-dot" style="background:${this.col(55)}"></span>Neuron (soma)</span>`,
      `<span class="neural-legend-item"><span class="neural-legend-line" style="background:${this.col(35)}"></span>Dendrite</span>`,
      `<span class="neural-legend-item"><span class="neural-legend-line" style="background:${this.col(45)}"></span>Axon</span>`,
      `<span class="neural-legend-item"><span class="neural-legend-dot neural-legend-dot-bright" style="background:${this.col(80)}"></span>Action potential</span>`,
      `<span class="neural-legend-item"><span class="neural-legend-dot neural-legend-dot-flash" style="background:${this.col(85)}"></span>Synapse</span>`,
    ].join('');
    popup.appendChild(legend);

    // Biophysical model readout
    this.biophysPanel = document.createElement('div');
    this.biophysPanel.className = 'neural-biophys';
    this.updateBiophysPanel();
    popup.appendChild(this.biophysPanel);

    // Region info
    const regionInfo = REGION_INFO[name];
    if (regionInfo) {
      const info = document.createElement('div');
      info.className = 'neural-region-info';
      const dashIdx = regionInfo.indexOf(' — ');
      if (dashIdx >= 0) {
        info.innerHTML = `<strong>${regionInfo.slice(0, dashIdx)}</strong><br>${regionInfo.slice(dashIdx + 3)}`;
      } else {
        info.textContent = regionInfo;
      }
      popup.appendChild(info);
    }

    const hint = document.createElement('div');
    hint.className = 'neural-hint';
    hint.textContent = 'Drag to rotate · Scroll to zoom · Click outside or Esc to close';
    popup.appendChild(hint);

    this.overlay.appendChild(popup);
    document.body.appendChild(this.overlay);

    /* ── Sizing ── */
    this.w = Math.min(780, window.innerWidth - 64);
    this.h = Math.min(420, window.innerHeight - 160);
    this.threeContainer.style.width = this.w + 'px';
    this.threeContainer.style.height = this.h + 'px';

    /* ── Three.js setup ── */
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(this.w, this.h);
    this.renderer.setClearColor(0x08081a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.threeContainer.appendChild(this.renderer.domElement);

    // CSS2D label renderer (overlays on top of WebGL)
    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(this.w, this.h);
    this.labelRenderer.domElement.style.position = 'absolute';
    this.labelRenderer.domElement.style.top = '0';
    this.labelRenderer.domElement.style.left = '0';
    this.labelRenderer.domElement.style.pointerEvents = 'none';
    this.threeContainer.style.position = 'relative';
    this.threeContainer.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x08081a, 0.06);

    this.camera = new THREE.PerspectiveCamera(42, this.w / this.h, 0.1, 100);
    this.camera.position.set(0, 1.5, 7);
    this.camera.lookAt(0, 0, 0);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.enablePan = false;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 14;

    // Lighting
    this.scene.add(new THREE.AmbientLight(0x1a3a5a, 0.4));
    const key = new THREE.DirectionalLight(0x6699cc, 0.6);
    key.position.set(5, 8, 5);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x334488, 0.25);
    fill.position.set(-4, 2, -3);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0x00aaff, 0.2);
    rim.position.set(0, -3, -5);
    this.scene.add(rim);

    /* ── Generate 3D scene ── */
    this.generateNeurons();
    this.generateDendrites();
    this.generateConnections();
    this.createAmbientParticles();
    this.createPopulationCloud();
    this.generateLabels();

    /* ── Events ── */
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.escHandler = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.escHandler);

    requestAnimationFrame(() => this.overlay.classList.add('neural-overlay-visible'));
    this.t0 = performance.now();
    this.tick();
  }

  /* ─── Public API ─── */

  updateVoltage(rms_uV: number): void {
    this.liveVoltage = rms_uV;
    this.intensity = Math.min(rms_uV / 80, 1.0);
    this.estimate = estimateNeuralPopulation(rms_uV, this.regionName);
    this.updateBiophysPanel();
    this.updateScaleLabel();
  }

  updateIntensity(v: number): void {
    this.intensity = v;
  }

  /* ─── Biophysics panel ─── */

  private updateBiophysPanel(): void {
    if (!this.biophysPanel) return;
    const e = this.estimate;
    const pctSync = (e.syncFraction * 100).toFixed(1);
    this.biophysPanel.innerHTML = `
      <div class="neural-biophys-title">4-Sphere Volume Conductor Model</div>
      <div class="neural-biophys-diagram">
        <svg viewBox="0 0 180 100" class="neural-biophys-svg">
          <ellipse cx="90" cy="50" rx="85" ry="45" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.2"/>
          <text x="178" y="52" fill="rgba(255,255,255,0.35)" font-size="5" text-anchor="end">scalp ${CONDUCTIVITY.scalp}</text>
          <ellipse cx="90" cy="50" rx="76" ry="40" fill="none" stroke="rgba(255,200,100,0.25)" stroke-width="2" stroke-dasharray="3,2"/>
          <text x="168" y="42" fill="rgba(255,200,100,0.4)" font-size="5" text-anchor="end">skull ${CONDUCTIVITY.skull}</text>
          <ellipse cx="90" cy="50" rx="70" ry="36" fill="none" stroke="rgba(100,200,255,0.2)" stroke-width="0.8"/>
          <text x="162" y="34" fill="rgba(100,200,255,0.35)" font-size="5" text-anchor="end">CSF ${CONDUCTIVITY.csf}</text>
          <ellipse cx="90" cy="50" rx="65" ry="33" fill="rgba(100,180,255,0.06)" stroke="rgba(100,180,255,0.25)" stroke-width="1"/>
          <text x="156" y="26" fill="rgba(100,180,255,0.4)" font-size="5" text-anchor="end">brain ${CONDUCTIVITY.brain}</text>
          <line x1="62" y1="30" x2="62" y2="20" stroke="${this.col(70)}" stroke-width="1.5" marker-end="url(#ah-${this.hue})"/>
          <text x="62" y="38" fill="${this.col(60)}" font-size="5" text-anchor="middle">dipole</text>
          <circle cx="62" cy="7" r="3" fill="${this.col(70, 0.8)}"/>
          <text x="62" y="4" fill="${this.col(55)}" font-size="5" text-anchor="middle" dy="-3">${this.regionName}</text>
          <line x1="70" y1="20" x2="70" y2="9" stroke="rgba(255,255,255,0.15)" stroke-width="0.5" stroke-dasharray="2,2"/>
          <text x="74" y="15" fill="rgba(255,255,255,0.3)" font-size="4.5">G = ${e.leadField} V/(A·m)</text>
          <defs><marker id="ah-${this.hue}" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="${this.col(70)}"/>
          </marker></defs>
        </svg>
      </div>
      <div class="neural-biophys-grid">
        <div class="neural-biophys-row">
          <span class="neural-biophys-label">Scalp voltage (RMS)</span>
          <span class="neural-biophys-value">${this.liveVoltage.toFixed(1)} µV</span>
        </div>
        <div class="neural-biophys-row">
          <span class="neural-biophys-label">Lead field G</span>
          <span class="neural-biophys-value">${e.leadField} V/(A·m)</span>
        </div>
        <div class="neural-biophys-row">
          <span class="neural-biophys-label">Cortical density</span>
          <span class="neural-biophys-value">${(e.density / 1000).toFixed(0)}K neurons/mm²</span>
        </div>
        <div class="neural-biophys-row">
          <span class="neural-biophys-label">Soma diameter</span>
          <span class="neural-biophys-value">${e.somaDiameter} µm${e.somaDiameter >= 30 ? ' (Betz cells)' : ''}</span>
        </div>
        <div class="neural-biophys-row neural-biophys-highlight">
          <span class="neural-biophys-label">Total neurons (patch)</span>
          <span class="neural-biophys-value">${formatNeuronCount(e.totalNeurons)}</span>
        </div>
        <div class="neural-biophys-row neural-biophys-highlight">
          <span class="neural-biophys-label">Synchronous neurons</span>
          <span class="neural-biophys-value">${formatNeuronCount(e.activeNeurons)} (${pctSync}%)</span>
        </div>
      </div>
      <div class="neural-biophys-eq">V<sub>scalp</sub> = G × n × q &nbsp;→&nbsp; n = V / (G × q) = ${this.liveVoltage.toFixed(1)} µV / (${e.leadField} × 1 pAm)</div>
    `;
  }

  /* ─── Helpers ─── */

  private rgbToHue(r: number, g: number, b: number): number {
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx === mn) return 200;
    const d = mx - mn;
    let h = 0;
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
    return h * 360;
  }

  private col(l: number, a = 1): string {
    return `hsla(${this.hue},70%,${l}%,${a})`;
  }

  private hslColor(l: number, s = 70): THREE.Color {
    return new THREE.Color().setHSL(this.hue / 360, s / 100, l / 100);
  }

  /* ─── 3D Scene generation ─── */

  private generateNeurons(): void {
    const n = this.estimate.renderCount;
    const somaScale = this.estimate.renderSomaScale;
    const spread = 2.8;
    const minSpacing = Math.max(0.7, 1.4 - (n - 10) * 0.04);

    // Shared geometry & textures
    const sphereGeo = new THREE.SphereGeometry(1, 20, 20);

    for (let i = 0; i < n; i++) {
      let pos: THREE.Vector3;
      let ok: boolean;
      let tries = 0;
      do {
        const rx = (Math.random() + Math.random()) / 2 - 0.5;
        const ry = (Math.random() + Math.random()) / 2 - 0.5;
        const rz = (Math.random() + Math.random()) / 2 - 0.5;
        pos = new THREE.Vector3(rx * spread * 2, ry * spread * 2, rz * spread * 2);
        ok = this.neurons.every(q => q.pos.distanceTo(pos) > minSpacing);
        tries++;
      } while (!ok && tries < 100);

      const baseRadius = (0.12 + Math.random() * 0.08) * somaScale;

      // Core sphere
      const coreMat = new THREE.MeshStandardMaterial({
        color: this.hslColor(55),
        emissive: this.hslColor(50),
        emissiveIntensity: 0.6,
        roughness: 0.4,
        metalness: 0.1,
      });
      const core = new THREE.Mesh(sphereGeo, coreMat);
      core.position.copy(pos);
      core.scale.setScalar(0); // starts invisible
      core.visible = false;
      this.scene.add(core);

      // Glow sprite
      const glowMat = new THREE.SpriteMaterial({
        map: this.glowTex,
        color: this.hslColor(55),
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const glow = new THREE.Sprite(glowMat);
      glow.position.copy(pos);
      glow.scale.setScalar(0);
      glow.visible = false;
      this.scene.add(glow);

      this.neurons.push({
        pos,
        radius: baseRadius,
        phase: Math.random() * Math.PI * 2,
        appearAt: i * 0.14,
        lastFire: -10,
        core,
        glow,
        baseScale: baseRadius,
      });
    }
  }

  private generateDendrites(): void {
    const lineMat = new THREE.LineBasicMaterial({
      color: this.hslColor(40),
      transparent: true,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    for (const neuron of this.neurons) {
      const arms = 3 + ((Math.random() * 3) | 0);
      for (let a = 0; a < arms; a++) {
        // Random walk in 3D to generate dendrite path
        const dir = new THREE.Vector3(
          Math.random() - 0.5,
          Math.random() - 0.5,
          Math.random() - 0.5,
        ).normalize();

        const segLen = 0.12;
        const totalLen = 0.6 + Math.random() * 1.0;
        const controlPts: THREE.Vector3[] = [neuron.pos.clone()];
        let len = 0;
        const curDir = dir.clone();

        while (len < totalLen) {
          curDir.x += (Math.random() - 0.5) * 0.6;
          curDir.y += (Math.random() - 0.5) * 0.6;
          curDir.z += (Math.random() - 0.5) * 0.6;
          curDir.normalize();
          const prev = controlPts[controlPts.length - 1];
          controlPts.push(prev.clone().addScaledVector(curDir, segLen));
          len += segLen;

          // Sub-branch
          if (len > 0.3 && Math.random() < 0.2) {
            const subDir = curDir.clone();
            subDir.x += (Math.random() < 0.5 ? 1 : -1) * (0.4 + Math.random() * 0.4);
            subDir.normalize();
            const subPts: THREE.Vector3[] = [controlPts[controlPts.length - 1].clone()];
            const subLen = 0.3 + Math.random() * 0.5;
            let sLen = 0;
            while (sLen < subLen) {
              subDir.x += (Math.random() - 0.5) * 0.7;
              subDir.y += (Math.random() - 0.5) * 0.7;
              subDir.z += (Math.random() - 0.5) * 0.7;
              subDir.normalize();
              const sp = subPts[subPts.length - 1];
              subPts.push(sp.clone().addScaledVector(subDir, segLen));
              sLen += segLen;
            }
            this.createDendriteLine(subPts, lineMat, neuron.appearAt + 0.4 + Math.random() * 0.6);
          }
        }

        // Smooth the path using CatmullRomCurve3
        if (controlPts.length >= 2) {
          const curve = new THREE.CatmullRomCurve3(controlPts);
          const smoothPts = curve.getPoints(controlPts.length * 3);
          this.createDendriteLine(smoothPts, lineMat, neuron.appearAt + 0.2 + Math.random() * 0.3);
        }
      }
    }
  }

  private createDendriteLine(pts: THREE.Vector3[], mat: THREE.LineBasicMaterial, growStart: number): void {
    const positions = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      positions[i * 3] = pts[i].x;
      positions[i * 3 + 1] = pts[i].y;
      positions[i * 3 + 2] = pts[i].z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setDrawRange(0, 0); // initially invisible

    const line = new THREE.Line(geom, mat);
    this.scene.add(line);
    this.dendrites.push({
      line,
      totalPoints: pts.length,
      growStart,
      growRate: 12 + Math.random() * 8,
    });
  }

  private generateConnections(): void {
    for (let i = 0; i < this.neurons.length; i++) {
      for (let j = i + 1; j < this.neurons.length; j++) {
        const d = this.neurons[i].pos.distanceTo(this.neurons[j].pos);
        if (d < 3.5 && Math.random() < 0.45) {
          const pa = this.neurons[i].pos;
          const pb = this.neurons[j].pos;
          const mid = pa.clone().add(pb).multiplyScalar(0.5);
          // Perpendicular offset for the control point
          const tangent = pb.clone().sub(pa).normalize();
          const up = new THREE.Vector3(0, 1, 0);
          const perp = new THREE.Vector3().crossVectors(tangent, up).normalize();
          if (perp.length() < 0.1) perp.set(1, 0, 0);
          const offset = (Math.random() - 0.5) * d * 0.4;
          const ctrl = mid.clone().addScaledVector(perp, offset);

          const curve = new THREE.QuadraticBezierCurve3(pa, ctrl, pb);
          const tubeGeo = new THREE.TubeGeometry(curve, 24, 0.025, 6, false);
          const tubeMat = new THREE.MeshBasicMaterial({
            color: this.hslColor(45),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const tube = new THREE.Mesh(tubeGeo, tubeMat);
          tube.visible = false;
          this.scene.add(tube);

          // Synapse flash sprite at midpoint
          const flashMat = new THREE.SpriteMaterial({
            map: this.glowTex,
            color: this.hslColor(80),
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          });
          const flashSprite = new THREE.Sprite(flashMat);
          flashSprite.position.copy(curve.getPoint(0.5));
          flashSprite.scale.setScalar(0);
          flashSprite.visible = false;
          this.scene.add(flashSprite);

          // Action potential particles
          const particles = Array.from({ length: 3 + ((Math.random() * 2) | 0) }, () => {
            const pMat = new THREE.SpriteMaterial({
              map: this.glowTex,
              color: this.hslColor(80),
              transparent: true,
              opacity: 0.9,
              blending: THREE.AdditiveBlending,
              depthWrite: false,
            });
            const sprite = new THREE.Sprite(pMat);
            sprite.scale.setScalar(0.12 + Math.random() * 0.08);
            sprite.visible = false;
            this.scene.add(sprite);
            return {
              t: Math.random(),
              speed: 0.5 + Math.random() * 0.4,
              sprite,
              size: 0.12 + Math.random() * 0.08,
            };
          });

          const formAt = Math.max(this.neurons[i].appearAt, this.neurons[j].appearAt) + 1.2 + Math.random();
          this.conns.push({ a: i, b: j, curve, tube, formAt, flashSprite, particles });
        }
      }
    }
  }

  private createAmbientParticles(): void {
    const count = 250;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 14;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 14;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: this.regionColor,
      size: 0.04,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.ambientParticles = new THREE.Points(geom, mat);
    this.scene.add(this.ambientParticles);
  }

  /* ─── Population Cloud ─── */

  private static readonly MAX_POP_PARTICLES = 2000;

  private createPopulationCloud(): void {
    const MAX = NeuralAnimPopup.MAX_POP_PARTICLES;
    const positions = new Float32Array(MAX * 3);
    for (let i = 0; i < MAX; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      // sqrt bias pushes more particles toward outer shell for visual density
      const r = 0.6 + Math.pow(Math.random(), 0.5) * 5;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: this.hslColor(50),
      size: 0.07,
      transparent: true,
      opacity: 0.45,
      sizeAttenuation: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      map: this.glowTex,
    });

    this.populationCloud = new THREE.Points(geom, mat);
    this.scene.add(this.populationCloud);

    // Scale indicator label (floats below the neuron cluster)
    const div = document.createElement('div');
    div.className = 'neural-3d-label neural-3d-scale';
    this.scaleLabel = new CSS2DObject(div);
    this.scaleLabel.position.set(0, -3.8, 0);
    this.scene.add(this.scaleLabel);

    this.updatePopulationCount();
  }

  /** Called once on init to set the model-derived default count + slider position. */
  private updatePopulationCount(): void {
    const active = this.estimate.activeNeurons;
    const MAX = NeuralAnimPopup.MAX_POP_PARTICLES;
    // sqrt scale: 100K→~224, 1M→~707, 5M→~1581, 10M→2000 (capped)
    this.populationCount = Math.round(
      Math.max(50, Math.min(MAX, Math.sqrt(active / 2))),
    );
    if (this.popSlider) this.popSlider.value = String(this.populationCount);
    this.applyPopulationSlider();
  }

  /** Apply current populationCount to the cloud draw range + labels. */
  private applyPopulationSlider(): void {
    if (this.populationCloud) {
      this.populationCloud.geometry.setDrawRange(0, this.populationCount);
    }
    this.updateScaleLabel();
  }

  /** Refresh the in-scene scale label and slider value display. */
  private updateScaleLabel(): void {
    const active = this.estimate.activeNeurons;
    if (this.scaleLabel) {
      const ratio = active > 0 && this.populationCount > 0
        ? Math.round(active / this.populationCount) : 0;
      this.scaleLabel.element.innerHTML =
        `<span style="color:rgba(100,200,255,0.9);font-weight:700">~${formatNeuronCount(active)}</span> ` +
        `neurons firing synchronously` +
        `<br><span style="opacity:0.5">each dot ≈ ${formatNeuronCount(ratio)} neurons</span>`;
    }
    if (this.popSliderValueEl) {
      this.popSliderValueEl.textContent = `${this.populationCount} dots`;
    }
  }

  /* ─── 3D Labels ─── */

  private generateLabels(): void {
    const connectorMat = new THREE.LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthTest: false,
    });

    const labelDefs: { text: string; target: THREE.Vector3; offset: THREE.Vector3; delay: number }[] = [];

    // 1. Neuron (soma) — label the second neuron for better visibility
    if (this.neurons.length > 1) {
      const n = this.neurons[1];
      labelDefs.push({
        text: 'Neuron (soma)',
        target: n.pos.clone(),
        offset: new THREE.Vector3(0.9, 0.7, 0),
        delay: n.appearAt + 0.3,
      });
    }

    // 2. Dendrite — pick a midpoint on a dendrite
    if (this.dendrites.length > 2) {
      const seg = this.dendrites[2];
      const posAttr = seg.line.geometry.getAttribute('position') as THREE.BufferAttribute;
      const midIdx = Math.floor(seg.totalPoints * 0.6);
      const midPos = new THREE.Vector3(
        posAttr.getX(midIdx),
        posAttr.getY(midIdx),
        posAttr.getZ(midIdx),
      );
      labelDefs.push({
        text: 'Dendrite',
        target: midPos,
        offset: new THREE.Vector3(-0.7, 0.5, 0),
        delay: seg.growStart + 0.6,
      });
    }

    // 3. Axon — label the first connection's midpoint
    if (this.conns.length > 0) {
      const c = this.conns[0];
      const mid = c.curve.getPoint(0.5);
      labelDefs.push({
        text: 'Axon',
        target: mid,
        offset: new THREE.Vector3(0.7, -0.5, 0),
        delay: c.formAt + 0.2,
      });
    }

    // 4. Action potential — near a particle path on the second connection
    if (this.conns.length > 1) {
      const c = this.conns[1];
      const pt = c.curve.getPoint(0.35);
      labelDefs.push({
        text: 'Action potential',
        target: pt,
        offset: new THREE.Vector3(-0.8, -0.6, 0),
        delay: c.formAt + 1.0,
      });
    }

    // 5. Synapse — at a connection junction
    if (this.conns.length > 2) {
      const c = this.conns[2];
      const targetNeuron = this.neurons[c.b];
      labelDefs.push({
        text: 'Synapse',
        target: targetNeuron.pos.clone(),
        offset: new THREE.Vector3(0.6, 0.8, 0),
        delay: c.formAt + 0.1,
      });
    }

    for (const def of labelDefs) {
      const labelPos = def.target.clone().add(def.offset);

      // CSS2D label element
      const div = document.createElement('div');
      div.className = 'neural-3d-label';
      div.textContent = def.text;
      div.style.opacity = '0';
      const cssObj = new CSS2DObject(div);
      cssObj.position.copy(labelPos);
      this.scene.add(cssObj);

      // Thin connector line from target to label
      const lineGeo = new THREE.BufferGeometry().setFromPoints([def.target, labelPos]);
      const line = new THREE.Line(lineGeo, connectorMat.clone());
      line.visible = false;
      line.renderOrder = 999;
      this.scene.add(line);

      this.labels.push({
        text: def.text,
        targetPos: def.target,
        object: cssObj,
        connector: line,
        appearAt: def.delay,
      });
    }
  }

  /* ─── Render loop ─── */

  private tick = (): void => {
    this.animId = requestAnimationFrame(this.tick);
    const t = (performance.now() - this.t0) / 1000;

    this.controls.update();

    // Ambient particles rotation
    if (this.ambientParticles) {
      this.ambientParticles.rotation.y += 0.0008;
      this.ambientParticles.rotation.x += 0.0003;
    }

    // ── Dendrite growth ──
    for (const seg of this.dendrites) {
      const age = t - seg.growStart;
      if (age <= 0) continue;
      const count = Math.min(Math.floor(age * seg.growRate) + 1, seg.totalPoints);
      seg.line.geometry.setDrawRange(0, count);
    }

    // ── Connections ──
    for (const c of this.conns) {
      const age = t - c.formAt;
      if (age < 0) {
        c.tube.visible = false;
        c.flashSprite.visible = false;
        for (const p of c.particles) p.sprite.visible = false;
        continue;
      }

      // Fade in tube
      c.tube.visible = true;
      const alpha = Math.min(age / 0.8, 1);
      (c.tube.material as THREE.MeshBasicMaterial).opacity = alpha * 0.3;

      // Synapse flash on formation
      if (age < 0.6) {
        c.flashSprite.visible = true;
        const fProgress = age / 0.6;
        (c.flashSprite.material as THREE.SpriteMaterial).opacity = (1 - fProgress) * 0.3;
        c.flashSprite.scale.setScalar(0.5 * (1 - fProgress));
      } else {
        c.flashSprite.visible = false;
      }

      // Action potential particles
      const speedMul = 0.15 + this.intensity * 1.85;
      if (age > 0.3) {
        for (const p of c.particles) {
          p.sprite.visible = true;
          const prevT = p.t;
          p.t = (p.t + (p.speed * speedMul) / 60) % 1;
          if (p.t < prevT) {
            this.neurons[c.b].lastFire = t;
          }
          const pt = c.curve.getPoint(p.t);
          p.sprite.position.copy(pt);
          p.sprite.scale.setScalar(p.size * (1 + this.intensity * 0.5));
        }
      }
    }

    // ── Spontaneous firing ──
    const fireChance = this.intensity * 0.08;
    for (const n of this.neurons) {
      const age = t - n.appearAt;
      if (age < 0) continue;
      const sinceLastFire = t - n.lastFire;
      if (sinceLastFire > 0.4 && Math.random() < fireChance) {
        n.lastFire = t;
      }
    }

    // ── Neurons ──
    for (const n of this.neurons) {
      const age = t - n.appearAt;
      if (age < 0) {
        n.core.visible = false;
        n.glow.visible = false;
        continue;
      }

      n.core.visible = true;
      n.glow.visible = true;

      const s = easeOutCubic(Math.min(age / 0.4, 1));
      const pulseRate = 2.5 + this.intensity * 4;
      const pulse = 1 + 0.12 * Math.sin(t * pulseRate + n.phase);

      const fireDt = t - n.lastFire;
      const fireScale = fireDt < 0.3 ? 1 + 0.35 * (1 - fireDt / 0.3) : 1;
      const fireBright = fireDt < 0.3 ? 1 - fireDt / 0.3 : 0;

      const scale = n.baseScale * s * pulse * fireScale;
      n.core.scale.setScalar(scale);

      // Update core emissive
      const coreMat = n.core.material as THREE.MeshStandardMaterial;
      coreMat.emissiveIntensity = 0.6 + fireBright * 1.2;
      if (fireBright > 0) {
        coreMat.emissive.copy(this.hslColor(55 + fireBright * 30));
      }

      // Glow sprite
      const glowScale = scale * 3.5 * (1 + fireBright * 0.6);
      n.glow.scale.setScalar(glowScale);
      const glowMat = n.glow.material as THREE.SpriteMaterial;
      glowMat.opacity = Math.min(age / 0.5, 1) * (0.4 + fireBright * 0.5);

      // Appear flash
      if (age < 0.5) {
        n.glow.scale.setScalar(glowScale + n.baseScale * 3 * (1 - easeOutCubic(age / 0.5)));
        glowMat.opacity = Math.max(glowMat.opacity, (1 - age / 0.5) * 0.25);
      }
    }

    // ── Population cloud animation ──
    if (this.populationCloud) {
      this.populationCloud.rotation.y += 0.0006;
      this.populationCloud.rotation.x += 0.0002;
      // Gentle opacity pulse with intensity
      const popMat = this.populationCloud.material as THREE.PointsMaterial;
      popMat.opacity = 0.3 + this.intensity * 0.25 + 0.05 * Math.sin(t * 1.5);
    }

    // ── Labels ──
    for (const lbl of this.labels) {
      const age = t - lbl.appearAt;
      if (age < 0) {
        lbl.object.element.style.opacity = '0';
        lbl.connector.visible = false;
        continue;
      }
      const alpha = Math.min(age / 0.8, 1);
      lbl.object.element.style.opacity = String(alpha);
      lbl.connector.visible = true;
      (lbl.connector.material as THREE.LineBasicMaterial).opacity = alpha * 0.25;
    }

    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };

  /* ─── Cleanup ─── */

  close(): void {
    cancelAnimationFrame(this.animId);
    document.removeEventListener('keydown', this.escHandler);

    this.controls.dispose();
    this.glowTex.dispose();

    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.Line || obj instanceof THREE.Points) {
        obj.geometry.dispose();
        const mat = obj.material;
        if (Array.isArray(mat)) mat.forEach(m => m.dispose());
        else if (mat) (mat as THREE.Material).dispose();
      }
      if (obj instanceof THREE.Sprite) {
        (obj.material as THREE.SpriteMaterial).dispose();
      }
    });

    this.renderer.dispose();
    this.labelRenderer.domElement.remove();

    this.overlay.classList.remove('neural-overlay-visible');
    setTimeout(() => {
      this.overlay.remove();
      this.onCloseCallback?.();
    }, 300);
  }
}
