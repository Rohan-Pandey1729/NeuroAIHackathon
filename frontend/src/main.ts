import './style.css'
import { onEegData } from './socket.ts'
import type { EegMessage } from './socket.ts'
import { BrainScene } from './brain3d.ts'

const CHANNEL_COLORS = [
  '#ff6384', '#36a2eb', '#ffce56', '#4bc0c0',
  '#9966ff', '#ff9f40', '#c9cbcf', '#7bc043',
  '#e6194b', '#3cb44b',
];

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
  <h1>EEG Live Stream</h1>
  <div id="status">Connecting...</div>
  <div id="info"></div>
  <div id="main-layout">
    <div id="brain-container"></div>
    <div id="channels"></div>
  </div>
`;

const statusEl = document.querySelector<HTMLDivElement>('#status')!;
const infoEl = document.querySelector<HTMLDivElement>('#info')!;
const channelsEl = document.querySelector<HTMLDivElement>('#channels')!;
const brainContainer = document.querySelector<HTMLDivElement>('#brain-container')!;

// Initialize 3D brain visualization
const brainScene = new BrainScene(brainContainer);

const DISPLAY_SAMPLES = 500;
const channelBuffers: number[][] = [];

// Current 10-20 channel names from the server
let currentChannelNames: string[] = [];

function renderChannels(numChannels: number, channelNames: string[]): void {
  // Re-render if channel count or names changed
  const namesChanged = channelNames.some((n, i) => n !== currentChannelNames[i]);
  if (channelsEl.children.length === numChannels && !namesChanged) return;
  currentChannelNames = [...channelNames];

  channelsEl.innerHTML = '';
  for (let i = 0; i < numChannels; i++) {
    const row = document.createElement('div');
    row.className = 'channel-row';

    const label = document.createElement('span');
    label.className = 'channel-label';
    label.style.color = CHANNEL_COLORS[i % CHANNEL_COLORS.length];
    // Use 10-20 electrode name from server, fall back to generic label
    label.textContent = channelNames[i] ?? `CH${i + 1}`;

    const canvas = document.createElement('canvas');
    canvas.id = `ch-${i}`;
    canvas.width = 800;
    canvas.height = 80;

    row.appendChild(label);
    row.appendChild(canvas);
    channelsEl.appendChild(row);

    if (!channelBuffers[i]) {
      channelBuffers[i] = [];
    }
  }
}

function drawChannel(index: number, samples: number[]): void {
  const canvas = document.querySelector<HTMLCanvasElement>(`#ch-${index}`);
  if (!canvas) return;
  const ctx = canvas.getContext('2d')!;
  const { width, height } = canvas;

  ctx.clearRect(0, 0, width, height);

  if (samples.length < 2) return;

  // Auto-scale based on data range
  let min = samples[0];
  let max = samples[0];
  for (const v of samples) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;
  const padding = range * 0.1;
  const scaledMin = min - padding;
  const scaledMax = max + padding;

  ctx.strokeStyle = CHANNEL_COLORS[index % CHANNEL_COLORS.length];
  ctx.lineWidth = 1.5;
  ctx.beginPath();

  for (let i = 0; i < samples.length; i++) {
    const x = (i / (samples.length - 1)) * width;
    const y = height - ((samples[i] - scaledMin) / (scaledMax - scaledMin)) * height;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }

  ctx.stroke();
}

onEegData((data: EegMessage) => {
  statusEl.textContent = 'Connected — streaming';
  statusEl.className = 'connected';
  infoEl.textContent = `${data.channels.length} channels @ ${data.sample_rate} Hz | ${data.num_samples} samples`;

  renderChannels(data.channels.length, data.channel_names ?? []);

  for (let ch = 0; ch < data.channels.length; ch++) {
    if (!channelBuffers[ch]) channelBuffers[ch] = [];
    channelBuffers[ch].push(...data.channels[ch]);
    // Keep only the last DISPLAY_SAMPLES
    if (channelBuffers[ch].length > DISPLAY_SAMPLES) {
      channelBuffers[ch] = channelBuffers[ch].slice(-DISPLAY_SAMPLES);
    }
    drawChannel(ch, channelBuffers[ch]);
  }

  // Update 3D brain electrode glow from EEG activity
  brainScene.updateActivity(data.channel_names ?? [], data.channels);

  // Update head orientation from accelerometer
  if (data.accel && data.accel.length >= 3) {
    brainScene.updateAccel(data.accel);
  }
});
