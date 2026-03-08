# NeuralTrace — Real-Time EEG Learning Visualizer

> Visualize your brain forming new connections as you learn — powered by live EEG and interactive 3D neural visualization.

![Status](https://img.shields.io/badge/status-hackathon--build-brightgreen)
![Hardware](https://img.shields.io/badge/hardware-OpenBCI%20Cyton-blue)
![Stack](https://img.shields.io/badge/stack-Python%20%7C%20FastAPI%20%7C%20Three.js-purple)

---

## What is NeuralTrace?

NeuralTrace reads live EEG signals from an OpenBCI Cyton board and renders a real-time 3D brain visualization that glows in response to neural activity. It serves two audiences:

1. **Learners** — see your own brain activity while studying, compare techniques, and find which method produces the strongest learning-related neural signatures.
2. **Educators** — use the interactive 3D brain and neural connection animations as a teaching tool for neuroscience concepts (action potentials, synapses, brain regions).

Click any glowing electrode region on the 3D brain to open an animated visualization of neural connections forming, complete with educational annotations explaining neurons, axons, dendrites, action potentials, and synapses — all driven by live EEG signal intensity.

---

## Features

- **3D brain model** with 10 electrode positions mapped to the International 10-20 system, rendered with Three.js
- **Live EEG streaming** from OpenBCI Cyton via BrainFlow, with FFT bandpass filtering (1-50 Hz)
- **Per-channel waveform charts** with Y-axis magnitude labels and smooth interpolated updates
- **Electrode glow** on the 3D brain surface scaled by real-time RMS amplitude
- **Head orientation tracking** from the board's accelerometer
- **Neural connection popup** — click any lit electrode to see an animated neural network forming, with firing rate driven by live EEG intensity
- **Educational annotations** — the popup labels neurons, dendrites, axons, action potentials, and synapses, and describes the brain region's function
- **Recording system** — record EEG sessions per user/technique, saved as CSV + metadata JSON
- **Analysis engine** — compute learning metrics (theta power, gamma power, engagement index, coherence) and rank study techniques by composite score

---

## System Architecture

```
OpenBCI Cyton Board (8 channels)
          |
    USB Serial
          |
  Python Backend (FastAPI + BrainFlow)
  ├── server.py  — EEG streaming, WebSocket broadcast, recording API
  └── analyze.py — Band power, coherence, composite learning score
          |
    WebSocket (ws://localhost:8000/ws)
          |
  Browser Frontend (Vite + TypeScript + Three.js)
  ├── brain3d.ts      — 3D brain mesh, electrode glow shader, click raycasting
  ├── neural-anim.ts  — Neural connection animation popup with edu annotations
  ├── main.ts         — EEG chart rendering, smooth sample interpolation
  ├── recorder-ui.ts  — Recording session UI
  ├── socket.ts       — WebSocket client
  └── api.ts          — REST API client for recording/analysis
```

---

## Hardware

- **OpenBCI Cyton Board** (8 EEG channels + 3-axis accelerometer)
- **OpenBCI Ultracortex Mark IV** headset (or any compatible electrode cap)
- Laptop/desktop running Python 3.10+

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
├── backend/
│   ├── server.py          # FastAPI server: EEG stream, WebSocket, recording & analysis APIs
│   ├── analyze.py         # EEG analysis: band power, coherence, composite learning score
│   └── requirements.txt   # Python dependencies
├── frontend/
│   ├── src/
│   │   ├── main.ts        # App entry: EEG charts with Y-axis, smooth interpolation
│   │   ├── brain3d.ts     # Three.js 3D brain, electrode glow shader, click detection
│   │   ├── neural-anim.ts # Neural connection animation popup + educational annotations
│   │   ├── recorder-ui.ts # Recording session UI panel
│   │   ├── socket.ts      # WebSocket client
│   │   ├── api.ts         # REST API client
│   │   └── style.css      # Styles
│   ├── public/            # Static assets (brain.glb)
│   ├── package.json
│   └── vite.config.ts
├── visualizer/
│   └── index.html         # Connections visualizer page
├── data/                  # Recorded EEG sessions (per user/technique)
├── brain.glb              # 3D brain model
├── requirements.txt
└── README.md
```

---

## Quickstart

### 1. Install backend dependencies

```bash
cd backend
pip install -r requirements.txt
```

### 2. Install frontend dependencies

```bash
cd frontend
npm install
```

### 3. Start the backend

```bash
python backend/server.py --serial-port /dev/tty.usbserial-XXXX
```

Options:
- `--board-id` — BrainFlow board ID (default: 0 for Cyton)
- `--serial-port` — serial port for the Cyton dongle

The backend starts streaming EEG on `http://127.0.0.1:8000` and serves the built frontend.

### 4. Development mode (hot reload)

```bash
cd frontend
npm run dev
```

Then open `http://localhost:5173` (Vite dev server proxies API/WebSocket to the backend).

---

## Recording & Analysis

### Recording a session

1. Click **Record Session** in the UI
2. Enter a username, technique name, and duration
3. The system records all channels to `data/<user>/<technique>/` as CSV files + `meta.json`

### Analyzing techniques

POST to `/api/analyze` with `{"user": "yourname"}` to get a ranked comparison of study techniques.

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

Clicking a glowing electrode on the 3D brain opens an animated popup showing neural connections forming in that region. The animation includes:

- **Neurons (soma)** — glowing cell bodies that expand when receiving a signal
- **Dendrites** — branching input fibers growing outward from each neuron
- **Axons** — connection lines between neurons carrying signals
- **Action potentials** — glowing particles traveling along axons; their speed is driven by the live EEG signal intensity from the clicked electrode
- **Synapses** — junctions where connections form between neurons, shown as a flash of light

The popup also displays educational information about the brain region (e.g., frontal lobe's role in planning and memory, temporal lobe's role in auditory processing).

---

## Scientific Framing

NeuralTrace does **not** claim to show individual synapses or neurons — this is physically impossible with surface EEG. What it shows is **functional connectivity** changing in real time, which is the standard neuroscientific proxy for learning-driven network reorganization. Theta-gamma coupling and inter-regional coherence are well-studied EEG signatures of memory encoding (Helfrich & Knight, 2016; Fell & Axmacher, 2011).

The neural connection animation is an educational visualization, not a literal representation of the underlying biology.

---

## License

MIT
