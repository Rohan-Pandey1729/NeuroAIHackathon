// Neural connection formation animation popup

const REGION_LABELS: Record<string, string> = {
  F3: 'Left Frontal', F4: 'Right Frontal',
  C3: 'Left Central', C4: 'Right Central',
  T3: 'Left Temporal', T4: 'Right Temporal',
  P3: 'Left Parietal', P4: 'Right Parietal',
  A1: 'Left Reference', A2: 'Right Reference',
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

  constructor(
    name: string,
    color: { r: number; g: number; b: number },
    onClose?: () => void,
  ) {
    this.hue = this.rgbToHue(color.r, color.g, color.b);
    this.onCloseCallback = onClose ?? null;

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

    const hint = document.createElement('div');
    hint.className = 'neural-hint';
    hint.textContent = 'Click outside or press Esc to close';
    popup.appendChild(hint);

    this.overlay.appendChild(popup);
    document.body.appendChild(this.overlay);

    // Sizing
    this.w = Math.min(720, window.innerWidth - 64);
    this.h = Math.min(420, window.innerHeight - 180);
    const dpr = window.devicePixelRatio;
    this.canvas.width = this.w * dpr;
    this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx = this.canvas.getContext('2d')!;
    this.ctx.scale(dpr, dpr);

    // Generate scene
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

  /** Update with live EEG intensity (0–1) to drive firing rate. */
  updateIntensity(v: number): void {
    this.intensity = v;
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
    const n = 10 + ((Math.random() * 4) | 0);
    const margin = 55;
    for (let i = 0; i < n; i++) {
      let pos: Vec2, ok: boolean, tries = 0;
      do {
        pos = {
          x: margin + Math.random() * (this.w - 2 * margin),
          y: margin + Math.random() * (this.h - 2 * margin),
        };
        ok = this.neurons.every(
          (q) => Math.hypot(q.pos.x - pos.x, q.pos.y - pos.y) > 75,
        );
        tries++;
      } while (!ok && tries < 80);
      this.neurons.push({
        pos,
        radius: 5 + Math.random() * 4,
        phase: Math.random() * Math.PI * 2,
        appearAt: i * 0.18,
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
        const totalLen = 35 + Math.random() * 55;
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
            const subLen = 15 + Math.random() * 25;
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
        if (d < 200 && Math.random() < 0.45) {
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
