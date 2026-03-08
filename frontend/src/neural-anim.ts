// Neural connection formation animation popup
import {
  estimateNeuralPopulation,
  formatNeuronCount,
  CONDUCTIVITY,
  type NeuralEstimate,
} from './neuro-model.ts';

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

interface Vec2 { x: number; y: number }

interface NeuronNode {
  pos: Vec2;
  radius: number;
  phase: number;
  appearAt: number;
  lastFire: number; // time of last action-potential arrival
}

interface DendriteSeg {
  points: Vec2[];
  totalLen: number;
  growStart: number;
  growRate: number;
}

interface Conn {
  a: number;
  b: number;
  ctrl: Vec2;
  formAt: number;
  particles: { t: number; speed: number; size: number }[];
}

interface FloatingDot {
  x: number; y: number;
  vx: number; vy: number;
  r: number;
  alpha: number;
  life: number;
  maxLife: number;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

function bezier(a: Vec2, ctrl: Vec2, b: Vec2, t: number): Vec2 {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x,
    y: u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y,
  };
}

export class NeuralAnimPopup {
  private overlay: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w: number;
  private h: number;
  private animId = 0;
  private t0 = 0;
  private hue: number;
  private neurons: NeuronNode[] = [];
  private dendrites: DendriteSeg[] = [];
  private conns: Conn[] = [];
  private dots: FloatingDot[] = [];
  private escHandler: (e: KeyboardEvent) => void;
  private onCloseCallback: (() => void) | null;
  private intensity = 0.5; // live EEG signal intensity (0-1)
  private regionName: string;
  private estimate: NeuralEstimate;
  private liveVoltage = 0; // current RMS voltage in µV
  private biophysPanel: HTMLDivElement | null = null;

  constructor(
    name: string,
    color: { r: number; g: number; b: number },
    onClose?: () => void,
    initialVoltage_uV = 30,
  ) {
    this.hue = this.rgbToHue(color.r, color.g, color.b);
    this.onCloseCallback = onClose ?? null;
    this.regionName = name;
    this.liveVoltage = initialVoltage_uV;
    this.estimate = estimateNeuralPopulation(initialVoltage_uV, name);

    // Build DOM
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

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'neural-canvas';
    popup.appendChild(this.canvas);

    // Legend row
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

    // Biophysical model readout panel
    this.biophysPanel = document.createElement('div');
    this.biophysPanel.className = 'neural-biophys';
    this.updateBiophysPanel();
    popup.appendChild(this.biophysPanel);

    // Region info
    const regionInfo = REGION_INFO[name];
    if (regionInfo) {
      const info = document.createElement('div');
      info.className = 'neural-region-info';
      // Split at " — " to separate region name from description
      const dashIdx = regionInfo.indexOf(' — ');
      if (dashIdx >= 0) {
        const heading = regionInfo.slice(0, dashIdx);
        const body = regionInfo.slice(dashIdx + 3);
        info.innerHTML = `<strong>${heading}</strong><br>${body}`;
      } else {
        info.textContent = regionInfo;
      }
      popup.appendChild(info);
    }

    const hint = document.createElement('div');
    hint.className = 'neural-hint';
    hint.textContent = 'Click outside or press Esc to close';
    popup.appendChild(hint);

    this.overlay.appendChild(popup);
    document.body.appendChild(this.overlay);

    // Sizing — cap width so neurons stay dense and text wraps
    this.w = Math.min(780, window.innerWidth - 64);
    this.h = Math.min(420, window.innerHeight - 160);
    const dpr = window.devicePixelRatio;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);

    // Generate scene — neuron count and soma size driven by cortical density
    this.placeNeurons();
    this.growDendrites();
    this.buildConnections();
    this.spawnDots();

    // Events
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.close();
    });
    this.escHandler = (e) => { if (e.key === 'Escape') this.close(); };
    document.addEventListener('keydown', this.escHandler);

    // Animate in
    requestAnimationFrame(() => this.overlay.classList.add('neural-overlay-visible'));
    this.t0 = performance.now();
    this.tick();
  }

  /** Update with live EEG voltage (µV RMS) to drive firing rate and biophysics readout. */
  updateVoltage(rms_uV: number): void {
    this.liveVoltage = rms_uV;
    this.intensity = Math.min(rms_uV / 80, 1.0);
    this.estimate = estimateNeuralPopulation(rms_uV, this.regionName);
    this.updateBiophysPanel();
  }

  /** Update with live EEG intensity (0–1) to drive firing rate. */
  updateIntensity(v: number): void {
    this.intensity = v;
  }

  private updateBiophysPanel(): void {
    if (!this.biophysPanel) return;
    const e = this.estimate;
    const pctSync = (e.syncFraction * 100).toFixed(1);
    this.biophysPanel.innerHTML = `
      <div class="neural-biophys-title">4-Sphere Volume Conductor Model</div>
      <div class="neural-biophys-diagram">
        <svg viewBox="0 0 180 100" class="neural-biophys-svg">
          <!-- Scalp -->
          <ellipse cx="90" cy="50" rx="85" ry="45" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="1.2"/>
          <text x="178" y="52" fill="rgba(255,255,255,0.35)" font-size="5" text-anchor="end">scalp ${CONDUCTIVITY.scalp}</text>
          <!-- Skull -->
          <ellipse cx="90" cy="50" rx="76" ry="40" fill="none" stroke="rgba(255,200,100,0.25)" stroke-width="2" stroke-dasharray="3,2"/>
          <text x="168" y="42" fill="rgba(255,200,100,0.4)" font-size="5" text-anchor="end">skull ${CONDUCTIVITY.skull}</text>
          <!-- CSF -->
          <ellipse cx="90" cy="50" rx="70" ry="36" fill="none" stroke="rgba(100,200,255,0.2)" stroke-width="0.8"/>
          <text x="162" y="34" fill="rgba(100,200,255,0.35)" font-size="5" text-anchor="end">CSF ${CONDUCTIVITY.csf}</text>
          <!-- Brain -->
          <ellipse cx="90" cy="50" rx="65" ry="33" fill="rgba(100,180,255,0.06)" stroke="rgba(100,180,255,0.25)" stroke-width="1"/>
          <text x="156" y="26" fill="rgba(100,180,255,0.4)" font-size="5" text-anchor="end">brain ${CONDUCTIVITY.brain}</text>
          <!-- Dipole arrow (neural source) -->
          <line x1="62" y1="30" x2="62" y2="20" stroke="${this.col(70)}" stroke-width="1.5" marker-end="url(#arrowhead-${this.hue})"/>
          <text x="62" y="38" fill="${this.col(60)}" font-size="5" text-anchor="middle">dipole</text>
          <!-- Electrode dot -->
          <circle cx="62" cy="7" r="3" fill="${this.col(70, 0.8)}"/>
          <text x="62" y="4" fill="${this.col(55)}" font-size="5" text-anchor="middle" dy="-3">${this.regionName}</text>
          <!-- Lead field annotation -->
          <line x1="70" y1="20" x2="70" y2="9" stroke="rgba(255,255,255,0.15)" stroke-width="0.5" stroke-dasharray="2,2"/>
          <text x="74" y="15" fill="rgba(255,255,255,0.3)" font-size="4.5">G = ${e.leadField} V/(A·m)</text>
          <!-- Arrow marker -->
          <defs>
            <marker id="arrowhead-${this.hue}" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
              <polygon points="0 0, 6 2, 0 4" fill="${this.col(70)}"/>
            </marker>
          </defs>
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

  /* ─── helpers ─── */

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

  /* ─── scene generation ─── */

  private placeNeurons(): void {
    // Neuron count driven by cortical density for this brain region
    const n = this.estimate.renderCount;
    const somaScale = this.estimate.renderSomaScale;
    const margin = 30;
    // With more neurons, reduce minimum spacing so they all fit
    const minSpacing = Math.max(28, 50 - (n - 10) * 2);
    // Cluster neurons toward center so dendrites/connections stay in view
    for (let i = 0; i < n; i++) {
      let pos: Vec2, ok: boolean, tries = 0;
      do {
        // Gaussian-ish bias toward center
        const rx = (Math.random() + Math.random()) / 2; // triangle distribution
        const ry = (Math.random() + Math.random()) / 2;
        pos = {
          x: margin + rx * (this.w - 2 * margin),
          y: margin + ry * (this.h - 2 * margin),
        };
        ok = this.neurons.every(
          (q) => Math.hypot(q.pos.x - pos.x, q.pos.y - pos.y) > minSpacing,
        );
        tries++;
      } while (!ok && tries < 80);
      // Soma radius scaled by region-specific neuron size
      // Motor cortex Betz cells render ~2× larger than standard pyramidals
      const baseRadius = 4 + Math.random() * 3;
      this.neurons.push({
        pos,
        radius: baseRadius * somaScale,
        phase: Math.random() * Math.PI * 2,
        appearAt: i * 0.14,
        lastFire: -10,
      });
    }
  }

  private growDendrites(): void {
    for (let i = 0; i < this.neurons.length; i++) {
      const n = this.neurons[i];
      const arms = 3 + ((Math.random() * 3) | 0);
      for (let a = 0; a < arms; a++) {
        let angle = (a / arms) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
        const segLen = 4;
        const totalLen = 25 + Math.random() * 40;
        const pts: Vec2[] = [{ ...n.pos }];
        let len = 0;
        while (len < totalLen) {
          angle += (Math.random() - 0.5) * 0.7;
          const prev = pts[pts.length - 1];
          pts.push({
            x: prev.x + Math.cos(angle) * segLen,
            y: prev.y + Math.sin(angle) * segLen,
          });
          len += segLen;
          // sub-branch
          if (len > 15 && Math.random() < 0.25) {
            let subAngle =
              angle + (Math.random() < 0.5 ? 1 : -1) * (0.5 + Math.random() * 0.5);
            const subPts: Vec2[] = [{ ...pts[pts.length - 1] }];
            const subLen = 10 + Math.random() * 18;
            let sLen = 0;
            while (sLen < subLen) {
              subAngle += (Math.random() - 0.5) * 0.8;
              const sp = subPts[subPts.length - 1];
              subPts.push({
                x: sp.x + Math.cos(subAngle) * segLen,
                y: sp.y + Math.sin(subAngle) * segLen,
              });
              sLen += segLen;
            }
            this.dendrites.push({
              points: subPts,
              totalLen: this.pLen(subPts),
              growStart: n.appearAt + 0.4 + Math.random() * 0.6,
              growRate: 25 + Math.random() * 20,
            });
          }
        }
        this.dendrites.push({
          points: pts,
          totalLen: this.pLen(pts),
          growStart: n.appearAt + 0.25 + Math.random() * 0.3,
          growRate: 30 + Math.random() * 25,
        });
      }
    }
  }

  private pLen(pts: Vec2[]): number {
    let l = 0;
    for (let i = 1; i < pts.length; i++)
      l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return l;
  }

  private buildConnections(): void {
    for (let i = 0; i < this.neurons.length; i++) {
      for (let j = i + 1; j < this.neurons.length; j++) {
        const d = Math.hypot(
          this.neurons[i].pos.x - this.neurons[j].pos.x,
          this.neurons[i].pos.y - this.neurons[j].pos.y,
        );
        if (d < 160 && Math.random() < 0.5) {
          const pa = this.neurons[i].pos,
            pb = this.neurons[j].pos;
          const mx = (pa.x + pb.x) / 2,
            my = (pa.y + pb.y) / 2;
          const dx = pb.x - pa.x,
            dy = pb.y - pa.y;
          const len = Math.hypot(dx, dy);
          const nx = -dy / len,
            ny = dx / len;
          const off = (Math.random() - 0.5) * 40;
          const ctrl = { x: mx + nx * off, y: my + ny * off };

          const particles = Array.from(
            { length: 3 + ((Math.random() * 2) | 0) },
            () => ({
              t: Math.random(),
              speed: 0.6 + Math.random() * 0.5,
              size: 1.5 + Math.random() * 2,
            }),
          );

          this.conns.push({
            a: i,
            b: j,
            ctrl,
            formAt:
              Math.max(this.neurons[i].appearAt, this.neurons[j].appearAt) +
              1.2 +
              Math.random(),
            particles,
          });
        }
      }
    }
  }

  private spawnDots(): void {
    for (let i = 0; i < 35; i++) {
      this.dots.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h,
        vx: (Math.random() - 0.5) * 6,
        vy: (Math.random() - 0.5) * 6,
        r: 0.8 + Math.random() * 1.5,
        alpha: 0.1 + Math.random() * 0.2,
        life: Math.random() * 8,
        maxLife: 4 + Math.random() * 8,
      });
    }
  }

  /* ─── render loop ─── */

  private tick = (): void => {
    this.animId = requestAnimationFrame(this.tick);
    const t = (performance.now() - this.t0) / 1000;
    const ctx = this.ctx;
    const w = this.w,
      h = this.h;

    // Background
    ctx.fillStyle = '#08081a';
    ctx.fillRect(0, 0, w, h);
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.55);
    g.addColorStop(0, this.col(12, 0.35));
    g.addColorStop(1, 'transparent');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Ambient dots
    for (const d of this.dots) {
      d.life += 1 / 60;
      if (d.life > d.maxLife) {
        d.x = Math.random() * w;
        d.y = Math.random() * h;
        d.life = 0;
      }
      d.x += d.vx / 60;
      d.y += d.vy / 60;
      const fade = Math.min(d.life, 1) * Math.min(d.maxLife - d.life, 1);
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fillStyle = this.col(55, d.alpha * Math.max(fade, 0));
      ctx.fill();
    }

    // Dendrites
    ctx.lineCap = 'round';
    for (const seg of this.dendrites) {
      const age = t - seg.growStart;
      if (age <= 0) continue;
      const visLen = Math.min(age * seg.growRate, seg.totalLen);
      ctx.beginPath();
      let drawn = 0;
      for (let i = 0; i < seg.points.length; i++) {
        const p = seg.points[i];
        if (i === 0) {
          ctx.moveTo(p.x, p.y);
          continue;
        }
        const prev = seg.points[i - 1];
        const sl = Math.hypot(p.x - prev.x, p.y - prev.y);
        if (drawn + sl > visLen) {
          const f = (visLen - drawn) / sl;
          ctx.lineTo(prev.x + (p.x - prev.x) * f, prev.y + (p.y - prev.y) * f);
          break;
        }
        ctx.lineTo(p.x, p.y);
        drawn += sl;
      }
      ctx.strokeStyle = this.col(35, 0.45);
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // Connections
    for (const c of this.conns) {
      const age = t - c.formAt;
      if (age < 0) continue;
      const fa = this.neurons[c.a].pos,
        fb = this.neurons[c.b].pos;
      const alpha = Math.min(age / 0.6, 1);

      // Line
      ctx.beginPath();
      ctx.moveTo(fa.x, fa.y);
      ctx.quadraticCurveTo(c.ctrl.x, c.ctrl.y, fb.x, fb.y);
      ctx.strokeStyle = this.col(45, alpha * 0.35);
      ctx.lineWidth = 1.2;
      ctx.stroke();

      // Flash on form
      if (age < 0.5) {
        const mid = bezier(fa, c.ctrl, fb, 0.5);
        const fAlpha = (1 - age / 0.5) * 0.5;
        const rr = 12 * (1 - age / 0.5);
        const fg = ctx.createRadialGradient(mid.x, mid.y, 0, mid.x, mid.y, rr);
        fg.addColorStop(0, this.col(85, fAlpha));
        fg.addColorStop(1, this.col(60, 0));
        ctx.fillStyle = fg;
        ctx.fillRect(mid.x - rr, mid.y - rr, rr * 2, rr * 2);
      }

      // Flowing particles (action potentials) — speed scales with EEG intensity
      const speedMul = 0.15 + this.intensity * 1.85;
      if (age > 0.25) {
        for (const p of c.particles) {
          const prevT = p.t;
          p.t = (p.t + p.speed * speedMul / 60) % 1;
          // Fire destination neuron when particle arrives
          if (p.t < prevT) {
            this.neurons[c.b].lastFire = t;
          }
          const pp = bezier(fa, c.ctrl, fb, p.t);
          ctx.save();
          ctx.shadowColor = this.col(70);
          ctx.shadowBlur = 8;
          ctx.beginPath();
          ctx.arc(pp.x, pp.y, p.size, 0, Math.PI * 2);
          ctx.fillStyle = this.col(80, 0.85);
          ctx.fill();
          ctx.restore();
        }
      }
    }

    // Canvas labels — subtle annotations that fade in as elements appear
    this.drawLabels(ctx, t);

    // Spontaneous firing driven by EEG intensity — more neurons light up with stronger signal
    const fireChance = this.intensity * 0.08; // per neuron per frame (~0-8% at 60fps)
    for (const n of this.neurons) {
      const age = t - n.appearAt;
      if (age < 0) continue;
      const sinceLastFire = t - n.lastFire;
      if (sinceLastFire > 0.4 && Math.random() < fireChance) {
        n.lastFire = t;
      }
    }

    // Neurons (on top)
    for (const n of this.neurons) {
      const age = t - n.appearAt;
      if (age < 0) continue;
      const s = easeOutCubic(Math.min(age / 0.35, 1));
      const pulseRate = 2.5 + this.intensity * 4;
      const pulse = 1 + 0.12 * Math.sin(t * pulseRate + n.phase);

      // Expand on fire: fast swell that decays over 0.3s
      const fireDt = t - n.lastFire;
      const fireScale = fireDt < 0.3 ? 1 + 0.6 * (1 - fireDt / 0.3) : 1;
      const fireBright = fireDt < 0.3 ? 1 - fireDt / 0.3 : 0;

      const r = n.radius * s * pulse * fireScale;
      const a = Math.min(age / 0.4, 1);

      // Outer glow (bigger when firing)
      const glowMul = 1 + fireBright * 1.5;
      const gr = r * 3.5 * glowMul;
      const gg = ctx.createRadialGradient(
        n.pos.x, n.pos.y, r * 0.3,
        n.pos.x, n.pos.y, gr,
      );
      gg.addColorStop(0, this.col(55 + fireBright * 25, a * (0.5 + fireBright * 0.4)));
      gg.addColorStop(1, this.col(40, 0));
      ctx.fillStyle = gg;
      ctx.fillRect(n.pos.x - gr, n.pos.y - gr, gr * 2, gr * 2);

      // Core
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = this.col(55 + fireBright * 30, a * (0.7 + fireBright * 0.3));
      ctx.fill();

      // Bright center
      ctx.beginPath();
      ctx.arc(n.pos.x, n.pos.y, r * 0.4, 0, Math.PI * 2);
      ctx.fillStyle = this.col(90, a * 0.95);
      ctx.fill();

      // Appear flash
      if (age < 0.5) {
        const fA = (1 - age / 0.5) * 0.35;
        const fR = r * 4 * (1 - easeOutCubic(age / 0.5));
        const fg2 = ctx.createRadialGradient(
          n.pos.x, n.pos.y, 0,
          n.pos.x, n.pos.y, fR,
        );
        fg2.addColorStop(0, this.col(80, fA));
        fg2.addColorStop(1, this.col(60, 0));
        ctx.fillStyle = fg2;
        ctx.fillRect(n.pos.x - fR, n.pos.y - fR, fR * 2, fR * 2);
      }
    }
  };

  private drawLabels(ctx: CanvasRenderingContext2D, t: number): void {
    ctx.save();
    ctx.font = '10px monospace';
    ctx.textBaseline = 'middle';

    const labelData: { text: string; target: Vec2; offset: Vec2; appearAt: number }[] = [];

    const cx = this.w / 2;
    const cy = this.h / 2;
    // Helper: pick offset direction AWAY from canvas center, with a large magnitude
    const awayOffset = (pos: Vec2, mag: number): Vec2 => {
      const dx = pos.x - cx;
      const dy = pos.y - cy;
      const len = Math.hypot(dx, dy) || 1;
      return { x: (dx / len) * mag, y: (dy / len) * mag };
    };

    // Gather candidate points for each label type, then greedily pick the most spread-out set
    interface Candidate { text: string; target: Vec2; appearAt: number }
    const groups: Candidate[][] = [];

    // Group 0: Neuron (soma)
    const neuronCands: Candidate[] = this.neurons.map(n => ({
      text: 'Neuron (soma)', target: n.pos, appearAt: n.appearAt + 0.4,
    }));
    groups.push(neuronCands);

    // Group 1: Dendrite
    const dendCands: Candidate[] = this.dendrites.map(d => {
      const tip = d.points[Math.min(4, d.points.length - 1)];
      return { text: 'Dendrite', target: tip, appearAt: d.growStart + 0.6 };
    });
    groups.push(dendCands);

    // Group 2: Axon (midpoints of connections)
    const axonCands: Candidate[] = this.conns.map(c => {
      const mid = bezier(this.neurons[c.a].pos, c.ctrl, this.neurons[c.b].pos, 0.5);
      return { text: 'Axon', target: mid, appearAt: c.formAt + 0.3 };
    });
    groups.push(axonCands);

    // Group 3: Action potential (at 0.3 along connections)
    const apCands: Candidate[] = this.conns.map(c => {
      const pt = bezier(this.neurons[c.a].pos, c.ctrl, this.neurons[c.b].pos, 0.3);
      return { text: 'Action potential', target: pt, appearAt: c.formAt + 0.8 };
    });
    groups.push(apCands);

    // Group 4: Synapse (destination neurons of connections)
    const synCands: Candidate[] = this.conns.map(c => ({
      text: 'Synapse', target: this.neurons[c.b].pos, appearAt: c.formAt + 0.1,
    }));
    groups.push(synCands);

    // Greedy spread: for each group in order, pick the candidate furthest from all already-chosen points
    const chosen: Vec2[] = [];
    for (const cands of groups) {
      if (cands.length === 0) continue;
      let bestIdx = 0;
      let bestMinDist = -1;
      for (let i = 0; i < cands.length; i++) {
        const p = cands[i].target;
        // Minimum distance to any already-chosen label
        let minD = Infinity;
        for (const c of chosen) {
          minD = Math.min(minD, Math.hypot(p.x - c.x, p.y - c.y));
        }
        if (chosen.length === 0) minD = Math.hypot(p.x - cx, p.y - cy); // first: pick furthest from center
        if (minD > bestMinDist) {
          bestMinDist = minD;
          bestIdx = i;
        }
      }
      const pick = cands[bestIdx];
      chosen.push(pick.target);
      labelData.push({
        text: pick.text,
        target: pick.target,
        offset: awayOffset(pick.target, 45),
        appearAt: pick.appearAt,
      });
    }

    // Compute resolved label positions and push apart overlapping ones
    const visible: { text: string; target: Vec2; lx: number; ly: number; alpha: number }[] = [];
    for (const lb of labelData) {
      const age = t - lb.appearAt;
      if (age < 0) continue;
      const alpha = Math.min(age / 0.5, 0.65);
      visible.push({
        text: lb.text,
        target: lb.target,
        lx: lb.target.x + lb.offset.x,
        ly: lb.target.y + lb.offset.y,
        alpha,
      });
    }

    // Repel overlapping labels (iterate a few times for stability)
    const MIN_GAP_X = 110; // minimum horizontal distance between label anchors
    const MIN_GAP_Y = 18;  // minimum vertical distance
    for (let iter = 0; iter < 5; iter++) {
      for (let i = 0; i < visible.length; i++) {
        for (let j = i + 1; j < visible.length; j++) {
          const dx = visible[j].lx - visible[i].lx;
          const dy = visible[j].ly - visible[i].ly;
          const overlapX = Math.abs(dx) < MIN_GAP_X;
          const overlapY = Math.abs(dy) < MIN_GAP_Y;
          if (overlapX && overlapY) {
            // Push apart vertically
            const push = (MIN_GAP_Y - Math.abs(dy)) / 2 + 1;
            if (dy >= 0) {
              visible[i].ly -= push;
              visible[j].ly += push;
            } else {
              visible[i].ly += push;
              visible[j].ly -= push;
            }
          }
        }
      }
    }

    // Clamp labels to stay within canvas bounds
    const PAD = 4;          // padding from canvas edge
    const LABEL_GAP = 4;    // gap between connector line end and text
    const CHAR_W = 6.2;     // approximate width per character at 10px monospace
    const HALF_H = 6;       // half the text height

    for (const lb of visible) {
      const textW = lb.text.length * CHAR_W;
      const leftOfTarget = lb.lx < lb.target.x;

      if (leftOfTarget) {
        // Text is drawn right-aligned at (lx - LABEL_GAP), so left edge is at lx - LABEL_GAP - textW
        const leftEdge = lb.lx - LABEL_GAP - textW;
        if (leftEdge < PAD) {
          lb.lx = PAD + textW + LABEL_GAP;
        }
        // Also check right edge (the connector point)
        if (lb.lx > this.w - PAD) {
          lb.lx = this.w - PAD;
        }
      } else {
        // Text is drawn left-aligned at (lx + LABEL_GAP), so right edge is at lx + LABEL_GAP + textW
        const rightEdge = lb.lx + LABEL_GAP + textW;
        if (rightEdge > this.w - PAD) {
          lb.lx = this.w - PAD - textW - LABEL_GAP;
        }
        // Also check left edge
        if (lb.lx < PAD) {
          lb.lx = PAD;
        }
      }

      // Clamp vertical
      if (lb.ly - HALF_H < PAD) lb.ly = PAD + HALF_H;
      if (lb.ly + HALF_H > this.h - PAD) lb.ly = this.h - PAD - HALF_H;
    }

    for (const lb of visible) {
      // Connector line
      ctx.beginPath();
      ctx.moveTo(lb.target.x, lb.target.y);
      ctx.lineTo(lb.lx, lb.ly);
      ctx.strokeStyle = `rgba(255,255,255,${lb.alpha * 0.3})`;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Text
      const leftOfTarget = lb.lx < lb.target.x;
      ctx.textAlign = leftOfTarget ? 'right' : 'left';
      ctx.fillStyle = `rgba(255,255,255,${lb.alpha})`;
      ctx.fillText(lb.text, lb.lx + (leftOfTarget ? -LABEL_GAP : LABEL_GAP), lb.ly);
    }

    ctx.restore();
  }

  close(): void {
    cancelAnimationFrame(this.animId);
    document.removeEventListener('keydown', this.escHandler);
    this.overlay.classList.remove('neural-overlay-visible');
    setTimeout(() => {
      this.overlay.remove();
      this.onCloseCallback?.();
    }, 300);
  }
}
