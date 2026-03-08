import './style.css'
import { onEegData } from './socket.ts'
import type { EegMessage } from './socket.ts'
import { BrainScene } from './brain3d.ts'
import { RecorderUI } from './recorder-ui.ts'
import { NeuralAnimPopup } from './neural-anim.ts'

const CHANNEL_COLORS = [
  '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0',
  '#9966ff', '#ff9f40', '#c9cbcf', '#7bc043',
  '#e6194b', '#3cb44b',
];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <div id="header">
    <h1>EEG Live Stream</h1>
    <button id="record-session-btn" class="rec-btn rec-btn-primary">Record Session</button>
  </div>
  <div id="status">Connecting...</div>
  <div id="info"></div>
  <div id="recorder-mount"></div>
  <div id="main-layout">
    <div id="brain-container"></div>
    <div id="channels"></div>
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

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const infoEl = document.querySelector<HTMLDivElement>('#info')!;
const channelsEl = document.querySelector<HTMLDivElement>('#channels')!;
const brainContainer = document.querySelector<HTMLDivElement>('#brain-container')!;

// Initialize 3D brain visualization
const brainScene = new BrainScene(brainContainer);

// Neural connection animation on electrode click
let activeNeural: NeuralAnimPopup | null = null;
let activeElectrode = '';
brainScene.onElectrodeClick((name, color) => {
  if (activeNeural) return;
  activeElectrode = name;
  activeNeural = new NeuralAnimPopup(name, color, () => {
    activeNeural = null;
    activeElectrode = '';
  });
});

const DISPLAY_SAMPLES = 500;
const AXIS_WIDTH = 48; // px reserved for Y-axis labels
const channelBuffers: number[][] = [];
const pendingQueues: number[][] = []; // incoming samples waiting to be dripped in

// Smoothed Y-axis range per channel (avoids jumpy rescaling)
const smoothMin: number[] = [];
const smoothMax: number[] = [];
const RANGE_SMOOTH = 0.15; // lerp factor per frame toward target range

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
    label.style.color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
    label.textContent = channelNames[i] ?? `CH${i + 1}`;

    const canvas = document.createElement('canvas');
    canvas.id = `ch-${i}`;
    canvas.width = 800;
    canvas.height = 80;

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
  const { width, height } = canvas;
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

  // Smoothly interpolate axis range
  if (smoothMin[index] === undefined) {
    smoothMin[index] = targetMin;
    smoothMax[index] = targetMax;
  } else {
    smoothMin[index] += (targetMin - smoothMin[index]) * RANGE_SMOOTH;
    smoothMax[index] += (targetMax - smoothMax[index]) * RANGE_SMOOTH;
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

  // ── Waveform ──
  ctx.strokeStyle = CHANNEL_COLORS[index % CHANNEL_COLORS.length];
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = plotLeft + (i / (samples.length - 1)) * plotWidth;
    const y = height - ((samples[i] - sMin) / sRange) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
}

// ── Incoming data handler: queue samples instead of drawing immediately ──
onEegData((data: EegMessage) => {
  statusEl.textContent = 'Connected — streaming';
  statusEl.className = 'connected';
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

  // Feed live intensity to neural animation popup
  if (activeNeural && activeElectrode) {
    const chIdx = (data.channel_names ?? []).indexOf(activeElectrode);
    if (chIdx >= 0 && data.channels[chIdx]) {
      const samples = data.channels[chIdx];
      let sumSq = 0;
      for (const v of samples) sumSq += v * v;
      const rms = Math.sqrt(sumSq / samples.length);
      activeNeural.updateIntensity(Math.min(rms / 80, 1.0));
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
