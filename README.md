# NeuralTrace — Real-Time EEG Learning Visualizer

> Visualize your brain forming new connections as you learn — powered by live EEG and interactive 3D neural visualization.

![Status](https://img.shields.io/badge/status-hackathon--build-brightgreen)
![Hardware](https://img.shields.io/badge/hardware-OpenBCI%20Cyton-blue)
![Stack](https://img.shields.io/badge/stack-TypeScript%20%7C%20Web%20Serial%20%7C%20Three.js-purple)

**[Live Demo](https://rohan-pandey1729.github.io/NeuroAIHackathon/)**

> **Note:** Live EEG from hardware requires a browser with [Web Serial API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Serial_API) support (Chrome or Edge 89+). Firefox and Safari are not supported for hardware streaming. The app works in any browser using synthetic EEG data.

---

## What is NeuralTrace?

NeuralTrace reads live EEG signals from an OpenBCI Cyton board **directly in the browser** via the Web Serial API — no backend required. It renders a real-time 3D brain visualization that glows in response to neural activity and serves two audiences:

1. **Learners** — see your own brain activity while studying, compare techniques, and find which method produces the strongest learning-related neural signatures.
2. **Educators** — use the interactive 3D brain and neural connection animations as a teaching tool for neuroscience concepts (action potentials, synapses, brain regions).

Click any glowing electrode region on the 3D brain to open an animated visualization of neural connections forming, complete with educational annotations explaining neurons, axons, dendrites, action potentials, and synapses — all driven by live EEG signal intensity.

---

## Features

- **3D brain model** with 10 electrode positions mapped to the International 10-20 system, rendered with Three.js
- **Live EEG streaming** directly from an OpenBCI Cyton via the browser's **Web Serial API** — no Python/backend needed
- **Synthetic EEG fallback** — automatically generates realistic synthetic signals when no hardware is connected
- **Per-channel waveform charts** with Y-axis magnitude labels and smooth interpolated updates
- **Electrode glow** on the 3D brain surface scaled by real-time RMS amplitude
- **Head orientation tracking** from the board's accelerometer
- **Neural connection popup** — click any lit electrode to see an animated neural network forming, with firing rate driven by live EEG intensity
- **Educational annotations** — the popup labels neurons, dendrites, axons, action potentials, and synapses, and describes the brain region's function
- **In-browser recording** — record EEG sessions per user/technique, buffered in memory
- **In-browser analysis** — compute learning metrics (theta power, gamma power, engagement index, coherence) via a Web Worker, no server calls needed

---

## System Architecture

Everything runs in the browser:

```
OpenBCI Cyton Board (8 channels)
          |
    USB Serial (Web Serial API)
          |
  Browser Frontend (Vite + TypeScript + Three.js)
  ├── cyton-serial.ts  — Web Serial driver: Cyton packet parsing, synthetic fallback
  ├── dsp.ts           — Real-time bandpass filter (1–50 Hz) per channel
  ├── brain3d.ts       — 3D brain mesh, electrode glow shader, click raycasting
  ├── neural-anim.ts   — 3D neural animation popup (Three.js) with edu annotations
  ├── neuro-model.ts   — Biophysical EEG forward/inverse model (4-sphere volume conductor)
  ├── main.ts          — App entry: EEG chart rendering, smooth sample interpolation
  ├── recorder-ui.ts   — Recording session UI
  ├── api.ts           — In-browser recording: buffers EEG in RAM
  ├── analyze.ts       — Band power, coherence, composite learning score (TypeScript port)
  ├── analyze.worker.ts— Web Worker wrapper for analysis (keeps UI thread unblocked)
  └── socket.ts        — Internal EEG event bus (replaces WebSocket)
```

---

## Hardware

- **OpenBCI Cyton Board** (8 EEG channels + 3-axis accelerometer)
- **OpenBCI Ultracortex Mark IV** headset (or any compatible electrode cap)
- A browser that supports the **Web Serial API** (Chrome / Edge 89+)
- No server, no Python runtime required

### Electrode Wiring (10-20 mapping)

| Cyton Pin | Electrode | Region |
|-----------|-----------|--------|
| N1P | F3 | Left Frontal |
| N2P | F4 | Right Frontal |
| N3P | C4 | Right Central |
| N4P | C3 | Left Central |
| N5P | T4 | Right Temporal |
| N6P | T3 | Left Temporal |
| N7P | P4 | Right Parietal |
| N8P | P3 | Left Parietal |
| SRB | A1/A2 | Ear references |

---

## Repo Structure

```
NeuralTrace/
├── frontend/
│   ├── src/
│   │   ├── main.ts            # App entry: EEG charts, smooth interpolation
│   │   ├── cyton-serial.ts    # Web Serial driver + synthetic EEG fallback
│   │   ├── dsp.ts             # Real-time bandpass filter
│   │   ├── brain3d.ts         # Three.js 3D brain, electrode glow, click detection
│   │   ├── neural-anim.ts     # 3D neural animation popup with edu annotations
│   │   ├── neuro-model.ts     # Biophysical EEG forward/inverse model (4-sphere)
│   │   ├── recorder-ui.ts     # Recording session UI panel
│   │   ├── api.ts             # In-browser EEG recording (RAM buffers)
│   │   ├── analyze.ts         # EEG analysis: band power, coherence, composite score
│   │   ├── analyze.worker.ts  # Web Worker wrapper for analysis
│   │   ├── socket.ts          # Internal EEG event bus
│   │   └── style.css          # Styles
│   ├── public/                # Static assets (brain.glb)
│   ├── package.json
│   └── vite.config.ts
├── backend/                   # Legacy Python backend (not required to run)
│   ├── server.py
│   ├── analyze.py
│   └── requirements.txt
└── README.md
```

---

## Quickstart

### 1. Install frontend dependencies

```bash
cd frontend
npm install
```

### 2. Start the dev server

```bash
npm run dev
```

Then open `http://localhost:5173` in Chrome or Edge (Web Serial API required).

### 3. Connect your Cyton board

Click **Connect Serial** in the UI and select the Cyton USB dongle port. The board will initialize and begin streaming automatically.

If no hardware is available, NeuralTrace falls back to synthetic EEG so you can explore all features without a physical board.

### 4. Build for production

```bash
npm run build
```

The output in `dist/` is a fully static site that can be hosted anywhere (e.g., GitHub Pages).

---

## Recording & Analysis

### Recording a session

1. Click **Record Session** in the UI
2. Enter a username, technique name, and duration
3. EEG data is buffered in memory during the session

### Analyzing techniques

After recording one or more sessions, click **Analyze** to compare study techniques. Analysis runs entirely in a Web Worker — no server call needed.

### Analysis Metrics

| Metric | What it measures |
|---|---|
| **Frontal Theta Power** | Memory encoding (4-8 Hz at F3/F4) |
| **Frontal Gamma Power** | Cognitive binding (30-50 Hz at F3/F4) |
| **Engagement Index** | Sustained attention: beta / (alpha + theta) |
| **F-P Theta Coherence** | Frontal-parietal memory network sync |
| **F-T Theta Coherence** | Frontal-temporal encoding circuit sync |

### Composite Learning Score

Weighted sum of metrics relative to baseline:

```
Score = 0.30 * frontal_theta
      + 0.25 * frontal_parietal_coherence
      + 0.20 * engagement_index
      + 0.15 * frontal_gamma
      + 0.10 * frontal_temporal_coherence
```

---

## Interactive Neural Visualization

Clicking a glowing electrode on the 3D brain opens a full 3D animated popup (with orbit controls for rotation/zoom) showing neural connections forming in that region. The animation includes:

- **Neurons (soma)** — glowing cell bodies that expand when receiving a signal; count and size are region-specific (see Biophysical Forward Model below)
- **Dendrites** — branching input fibers growing outward from each neuron
- **Axons** — connection lines between neurons carrying signals
- **Action potentials** — glowing particles traveling along axons; their speed is driven by the live EEG signal intensity from the clicked electrode
- **Synapses** — junctions where connections form between neurons, shown as a flash of light

The popup also displays educational information about the brain region (e.g., frontal lobe's role in planning and memory, temporal lobe's role in auditory processing).

---

## Biophysical Forward Model

The visualization pipeline is grounded in a biophysical EEG forward/inverse model implemented in `neuro-model.ts`. This converts raw scalp voltage into an estimate of the synchronously active neural population under each electrode, which in turn drives the rendered neuron count and soma size in the 3D animation.

### 4-Sphere Volume Conductor

We model the head as four concentric conducting spheres (Nunez & Srinivasan, 2006, Table 1.3):

| Layer | Radius (m) | Conductivity (S/m) |
|-------|-----------|---------------------|
| Brain (cortical surface) | 0.080 | 0.33 |
| CSF | 0.082 | 1.0 |
| Skull | 0.088 | 0.0042 |
| Scalp | 0.092 | 0.33 |

The skull is ~80x less conductive than brain tissue, which is the dominant source of EEG signal attenuation at the scalp.

### Forward/Inverse Equation

The forward model relates scalp voltage to neural activity:

```
V_scalp = G × n × q
```

where **V** is scalp voltage (V), **G** is the lead field gain (V per A·m) from volume conductor geometry, **n** is the number of synchronously active pyramidal neurons, and **q** is the single-neuron PSP dipole moment (~1 pA·m; Murakami & Okada, 2006). We invert this to estimate the active population:

```
n = V / (G × q)
```

### Lead Field Values

Effective lead field G (V/(A·m)) per electrode, derived from 4-sphere numerical solutions (Rush & Driscoll, 1968) for radial dipoles at the cortical surface:

| Electrode | G | Notes |
|-----------|---|-------|
| F3/F4 | 28 | Frontal convexity — good radial alignment |
| C3/C4 | 32 | Vertex — most radial orientation, shortest skull path |
| T3/T4 | 22 | Lateral — thin temporal bone but more tangential dipoles |
| P3/P4 | 30 | Posterior convexity — good radial alignment |
| A1/A2 | 10 | Ear references — minimal cortical sensitivity |

### Cortical Neuron Density

Neuron density (per mm² of cortical surface, all 6 layers) varies by region (Rockel et al., 1980; Collins et al., 2010; Herculano-Houzel, 2009):

| Region | Density (neurons/mm²) | Notes |
|--------|----------------------|-------|
| Prefrontal (F3/F4) | 105,000 | Dense small pyramidals |
| Motor (C3/C4) | 62,000 | Sparse — giant Betz cells |
| Temporal (T3/T4) | 95,000 | Dense — auditory/memory |
| Parietal (P3/P4) | 85,000 | Medium-high density |

Each electrode's sensitivity footprint covers ~600 mm² of cortical surface.

### Soma Diameter Variation

Layer V pyramidal neurons generate most of the EEG signal due to their long apical dendrites oriented perpendicular to the cortical surface. Their soma diameter varies dramatically:

- **Motor cortex (C3/C4):** Betz cells up to 35 µm — among the largest neurons in the human nervous system
- **Prefrontal (F3/F4):** ~18 µm standard pyramidals
- **Temporal (T3/T4):** ~16 µm slightly smaller pyramidals
- **Parietal (P3/P4):** ~20 µm medium-sized pyramidals

### Mapping to the Visualization

The forward model output drives two rendering parameters:

1. **Rendered neuron count** (8–22 per popup): linearly scaled from cortical density, so prefrontal regions show the most neurons (~22) and motor cortex the fewest (~8).
2. **Soma size scale**: normalized to the standard 18 µm pyramidal, so motor cortex Betz cells render at ~2× the diameter of frontal pyramidals.

---

## Scientific Framing

NeuralTrace does **not** claim to show individual synapses or neurons — this is physically impossible with surface EEG. What it shows is **functional connectivity** changing in real time, which is the standard neuroscientific proxy for learning-driven network reorganization. Theta-gamma coupling and inter-regional coherence are well-studied EEG signatures of memory encoding (Helfrich & Knight, 2016; Fell & Axmacher, 2011).

The neural connection animation is an educational visualization, not a literal representation of the underlying biology.

---

## License

MIT
