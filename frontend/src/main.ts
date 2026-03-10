import './style.css'
import { onEegData, onModeChange, connectCyton, isSerialSupported, getMode, useSynthetic } from './socket.ts'
import type { EegMessage } from './socket.ts'
import { BrainScene } from './brain3d.ts'
import { RecorderUI } from './recorder-ui.ts'
import { NeuralAnimPopup } from './neural-anim.ts'

// Channel colors matching brain region colors from brain3d.ts
const CHANNEL_COLOR_MAP: Record<string, string> = {
  F3: '#5a9fd4',  // Frontal — muted blue
  F4: '#5a9fd4',
  C3: '#5cb87a',  // Central — muted green
  C4: '#5cb87a',
  T3: '#d4954a',  // Temporal — muted orange
  T4: '#c9b854',  // Temporal — muted gold
  P3: '#a8845e',  // Parietal — muted brown
  P4: '#c96a6a',  // Parietal — muted red
  A1: '#7fb3c9',  // Ear references — muted cyan
  A2: '#7fb3c9',
};
const FALLBACK_COLORS = [
  '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0',
  '#9966ff', '#ff9f40', '#c9cbcf', '#7bc043',
  '#e6194b', '#3cb44b',
];

function channelColor(index: number): string {
  const name = currentChannelNames[index];
  return CHANNEL_COLOR_MAP[name] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length];
}

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="topbar">
    <div id="topbar-left">
      <h1>NeuralTrace</h1>
      <span id="status-pill">
        <span id="status-dot"></span>
        <span id="status">Starting...</span>
      </span>
      <span id="info"></span>
    </div>
    <div id="topbar-right">
      ${isSerialSupported() ? '<button id="connect-cyton-btn" class="rec-btn rec-btn-secondary">Connect Cyton</button>' : ''}
      <button id="use-synthetic-btn" class="rec-btn rec-btn-ghost">Use Synthetic</button>
      <button id="record-session-btn" class="rec-btn rec-btn-primary rec-btn-record">Record Session</button>
    </div>
  </div>
  <div id="recorder-mount"></div>
  <div id="dashboard">
    <div id="brain-section">
      <div id="brain-container"></div>
    </div>
    <div id="right-panel">
      <div id="channels-section">
        <div id="channels-header">EEG Channels</div>
        <div id="channels"></div>
      </div>
    </div>
  </div>
`;

// Record Session button
let activeRecorder: RecorderUI | null = null;
document.querySelector<HTMLButtonElement>('#record-session-btn')!.addEventListener('click', () => {
  if (activeRecorder) return;
  const mount = document.querySelector<HTMLDivElement>('#recorder-mount')!;
  activeRecorder = new RecorderUI(mount);
  // Clean up reference when panel is removed from DOM
  const observer = new MutationObserver(() => {
    if (!mount.querySelector('#recorder-panel')) {
      activeRecorder = null;
      observer.disconnect();
    }
  });
  observer.observe(mount, { childList: true });
});

// Connect Cyton button
const connectBtn = document.querySelector<HTMLButtonElement>('#connect-cyton-btn');
if (connectBtn) {
  connectBtn.addEventListener('click', async () => {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
    const ok = await connectCyton();
    if (!ok) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect Cyton';
    }
  });
}

// Use Synthetic button
const syntheticBtn = document.querySelector<HTMLButtonElement>('#use-synthetic-btn')!;
syntheticBtn.addEventListener('click', async () => {
  syntheticBtn.disabled = true;
  await useSynthetic();
  syntheticBtn.disabled = false;
});

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const infoEl = document.querySelector<HTMLDivElement>('#info')!;
const channelsEl = document.querySelector<HTMLDivElement>('#channels')!;
const brainContainer = document.querySelector<HTMLDivElement>('#brain-container')!;

// Initialize 3D brain visualization
const brainScene = new BrainScene(brainContainer);

// Neural connection animation on electrode click
let activeNeural: NeuralAnimPopup | null = null;
let activeElectrode = '';
let lastElectrodeRMS: Record<string, number> = {};
brainScene.onElectrodeClick((name, color) => {
  if (activeNeural) return;
  activeElectrode = name;
  const initialVoltage = lastElectrodeRMS[name] ?? 30;
  activeNeural = new NeuralAnimPopup(name, color, () => {
    activeNeural = null;
    activeElectrode = '';
  }, initialVoltage);
});

const DISPLAY_SAMPLES = 500;
const AXIS_WIDTH = 48; // px reserved for Y-axis labels
const channelBuffers: number[][] = [];
const pendingQueues: number[][] = []; // incoming samples waiting to be dripped in

// Smoothed Y-axis range per channel using critically-damped spring
const smoothMin: number[] = [];
const smoothMax: number[] = [];
const smoothMinVel: number[] = []; // velocity for spring
const smoothMaxVel: number[] = [];
const SPRING_FREQ = 6.0;  // natural frequency (higher = faster settle)
const SPRING_DT = 1 / 60; // assume ~60fps

// Current 10-20 channel names from the server
let currentChannelNames: string[] = [];
let numChannels = 0;
let samplesPerFrame = 1; // how many samples to shift from pending → display each frame

function renderChannels(count: number, channelNames: string[]): void {
  const namesChanged = channelNames.some((n, i) => n !== currentChannelNames[i]);
  if (channelsEl.children.length === count && !namesChanged) return;
  currentChannelNames = [...channelNames];
  numChannels = count;

  channelsEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const row = document.createElement('div');
    row.className = 'channel-row';

    const label = document.createElement('span');
    label.className = 'channel-label';
    label.style.color = channelColor(i);
    label.textContent = channelNames[i] ?? `CH${i + 1}`;

    const canvas = document.createElement('canvas');
    canvas.id = `ch-${i}`;
    canvas.width = 600;
    canvas.height = 64;

    row.appendChild(label);
    row.appendChild(canvas);
    channelsEl.appendChild(row);

    if (!channelBuffers[i]) channelBuffers[i] = [];
    if (!pendingQueues[i]) pendingQueues[i] = [];
  }
}

function niceTickStep(range: number, maxTicks: number): number {
  const rough = range / maxTicks;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const res = rough / mag;
  if (res <= 1) return mag;
  if (res <= 2) return 2 * mag;
  if (res <= 5) return 5 * mag;
  return 10 * mag;
}

function drawChannel(index: number, samples: number[]): void {
  const canvas = document.querySelector<HTMLCanvasElement>(`#ch-${index}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;

  // Sync canvas attribute size to actual CSS display size each frame
  const cssW = Math.round(canvas.getBoundingClientRect().width);
  const cssH = Math.round(canvas.getBoundingClientRect().height) || 64;
  if (cssW > 0 && (canvas.width !== cssW || canvas.height !== cssH)) {
    canvas.width = cssW;
    canvas.height = cssH;
  }

  const width = canvas.width;
  const height = canvas.height;
  const plotLeft = AXIS_WIDTH;
  const plotWidth = width - plotLeft;

  ctx.clearRect(0, 0, width, height);
  if (samples.length < 2) return;

  // Compute data range
  let dataMin = samples[0];
  let dataMax = samples[0];
  for (const v of samples) {
    if (v < dataMin) dataMin = v;
    if (v > dataMax) dataMax = v;
  }
  const dataRange = dataMax - dataMin || 1;
  const pad = dataRange * 0.1;
  const targetMin = dataMin - pad;
  const targetMax = dataMax + pad;

  // Critically-damped spring for axis range (smooth ease-out settle)
  if (smoothMin[index] === undefined) {
    smoothMin[index] = targetMin;
    smoothMax[index] = targetMax;
    smoothMinVel[index] = 0;
    smoothMaxVel[index] = 0;
  } else {
    const omega = 2 * Math.PI * SPRING_FREQ;
    // Critically-damped: zeta = 1, so damping = 2 * omega
    const damp = 2 * omega;

    // Min spring
    const errMin = targetMin - smoothMin[index];
    smoothMinVel[index] += (omega * omega * errMin - damp * smoothMinVel[index]) * SPRING_DT;
    smoothMin[index] += smoothMinVel[index] * SPRING_DT;

    // Max spring
    const errMax = targetMax - smoothMax[index];
    smoothMaxVel[index] += (omega * omega * errMax - damp * smoothMaxVel[index]) * SPRING_DT;
    smoothMax[index] += smoothMaxVel[index] * SPRING_DT;
  }
  const sMin = smoothMin[index];
  const sMax = smoothMax[index];
  const sRange = sMax - sMin || 1;

  // ── Y-axis ticks & labels ──
  const maxTicks = 4;
  const step = niceTickStep(sRange, maxTicks);
  const firstTick = Math.ceil(sMin / step) * step;

  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.fillStyle = 'rgba(255,255,255,0.45)';
  ctx.font = '9px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let v = firstTick; v <= sMax; v += step) {
    const y = height - ((v - sMin) / sRange) * height;
    // grid line
    ctx.beginPath();
    ctx.moveTo(plotLeft, y);
    ctx.lineTo(width, y);
    ctx.stroke();
    // label
    const label = Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k`
                : Math.abs(v) >= 1 ? v.toFixed(0)
                : v.toFixed(1);
    ctx.fillText(label, plotLeft - 4, y);
  }

  // axis unit at top
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.font = '8px monospace';
  ctx.textAlign = 'left';
  ctx.fillText('µV', 2, 8);
  ctx.restore();

  // ── Waveform (Catmull-Rom spline) ──
  ctx.strokeStyle = channelColor(index);
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  const n = samples.length;
  const toX = (i: number) => plotLeft + (i / (n - 1)) * plotWidth;
  const toY = (i: number) => height - ((samples[i] - sMin) / sRange) * height;

  ctx.moveTo(toX(0), toY(0));

  for (let i = 0; i < n - 1; i++) {
    // Catmull-Rom uses 4 control points: p0, p1, p2, p3
    // Clamp at boundaries
    const i0 = Math.max(i - 1, 0);
    const i1 = i;
    const i2 = Math.min(i + 1, n - 1);
    const i3 = Math.min(i + 2, n - 1);

    const x1 = toX(i1), y1 = toY(i1);
    const x2 = toX(i2), y2 = toY(i2);

    // Convert Catmull-Rom to cubic bezier control points
    // Tension factor 0 = standard Catmull-Rom
    const cp1x = x1 + (toX(i2) - toX(i0)) / 6;
    const cp1y = y1 + (toY(i2) - toY(i0)) / 6;
    const cp2x = x2 - (toX(i3) - toX(i1)) / 6;
    const cp2y = y2 - (toY(i3) - toY(i1)) / 6;

    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x2, y2);
  }
  ctx.stroke();
}

// ── Connection mode status ──
function updateModeStatus(mode: 'serial' | 'synthetic' | 'idle'): void {
  if (mode === 'serial') {
    statusEl.textContent = 'Cyton Connected';
    statusEl.className = 'connected';
    if (connectBtn) { connectBtn.textContent = 'Disconnect'; connectBtn.disabled = false; }
    syntheticBtn.style.display = '';
  } else if (mode === 'synthetic') {
    statusEl.textContent = 'Synthetic Mode';
    statusEl.className = '';
    if (connectBtn) { connectBtn.textContent = 'Connect Cyton'; connectBtn.disabled = false; }
    syntheticBtn.style.display = 'none';
  } else {
    statusEl.textContent = 'Disconnected';
    statusEl.className = '';
    if (connectBtn) { connectBtn.textContent = 'Connect Cyton'; connectBtn.disabled = false; }
    syntheticBtn.style.display = '';
  }
}
onModeChange(updateModeStatus);
// Set initial status based on current mode
updateModeStatus(getMode());

// ── Incoming data handler: queue samples instead of drawing immediately ──
onEegData((data: EegMessage) => {
  infoEl.textContent = `${data.channels.length} channels @ ${data.sample_rate} Hz | ${data.num_samples} samples`;
  renderChannels(data.channels.length, data.channel_names ?? []);

  // Push incoming samples into pending queues
  for (let ch = 0; ch < data.channels.length; ch++) {
    if (!pendingQueues[ch]) pendingQueues[ch] = [];
    pendingQueues[ch].push(...data.channels[ch]);
  }

  // Compute drip rate: spread samples evenly across frames until next data push
  // Data arrives ~10x/sec, display runs ~60fps → ~6 frames per push
  const totalPending = pendingQueues[0]?.length ?? 0;
  const framesUntilNext = 6; // ~100ms / 16.6ms
  samplesPerFrame = Math.max(1, Math.ceil(totalPending / framesUntilNext));

  // Track per-electrode RMS voltage and feed to neural animation popup
  const channelNames = data.channel_names ?? [];
  for (let ci = 0; ci < channelNames.length; ci++) {
    if (data.channels[ci]) {
      const samples = data.channels[ci];
      let sumSq = 0;
      for (const v of samples) sumSq += v * v;
      lastElectrodeRMS[channelNames[ci]] = Math.sqrt(sumSq / samples.length);
    }
  }
  if (activeNeural && activeElectrode) {
    const rms = lastElectrodeRMS[activeElectrode];
    if (rms !== undefined) {
      activeNeural.updateVoltage(rms);
    }
  }

  // Update 3D brain electrode glow from EEG activity
  brainScene.updateActivity(data.channel_names ?? [], data.channels);

  // Update head orientation from accelerometer
  if (data.accel && data.accel.length >= 3) {
    brainScene.updateAccel(data.accel);
  }
});

// ── Animation loop: smoothly drip samples from pending → display ──
function animate() {
  requestAnimationFrame(animate);

  let didDraw = false;
  for (let ch = 0; ch < numChannels; ch++) {
    const q = pendingQueues[ch];
    if (!q || q.length === 0) continue;

    if (!channelBuffers[ch]) channelBuffers[ch] = [];
    const count = Math.min(samplesPerFrame, q.length);
    channelBuffers[ch].push(...q.splice(0, count));

    if (channelBuffers[ch].length > DISPLAY_SAMPLES) {
      channelBuffers[ch] = channelBuffers[ch].slice(-DISPLAY_SAMPLES);
    }
    didDraw = true;
  }

  if (didDraw) {
    for (let ch = 0; ch < numChannels; ch++) {
      drawChannel(ch, channelBuffers[ch]);
    }
  }
}
requestAnimationFrame(animate);
