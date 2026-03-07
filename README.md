# 🧠 NeuralTrace — Real-Time Learning Visualizer

> Visualize your brain forming new connections as you learn — powered by EEG and live neural signal processing.

![Status](https://img.shields.io/badge/status-hackathon--build-brightgreen)
![Hardware](https://img.shields.io/badge/hardware-OpenBCI%20Ultracortex-blue)
![Stack](https://img.shields.io/badge/stack-Python%20%7C%20WebSockets%20%7C%20Three.js-purple)

---

## What is NeuralTrace?

NeuralTrace reads live EEG signals from an OpenBCI Ultracortex Mark IV headset and renders a 3D brain visualization that reacts in real time to your cognitive state. As you engage in a learning task, the visualizer draws glowing arcs between brain regions when their activity becomes synchronized — the closest surface-EEG analog to "a new connection forming."

The visualization is scientifically grounded in well-established EEG markers for learning:

| Signal | What it means | Visual effect |
|---|---|---|
| **Theta waves (4–8 Hz)** | Memory encoding, hippocampal activity | Arcs solidify between nodes |
| **Gamma bursts (30–100 Hz)** | Active cognitive binding | Node pulses with a ripple |
| **Cross-channel coherence** | Two brain regions firing in sync | New edge drawn between them |
| **Engagement index** | Overall cognitive load rising | Neural density fog deepens |

---

## System Architecture

```
OpenBCI Ultracortex Mark IV
          ↓
  OpenBCI GUI (LSL stream)
          ↓
  Python Backend
  ├── pylsl  — reads EEG stream
  ├── scipy / MNE  — band power + coherence matrix (every ~500ms)
  └── websockets  — pushes JSON state to browser
          ↓
  Browser Visualizer
  ├── Three.js  — 3D brain mesh + electrode nodes
  ├── WebSocket client  — receives live signal updates
  └── Animated edges, glows, and arcs
```

---

## Hardware

- **OpenBCI Ultracortex Mark IV EEG Headset** (16 channels, research-grade)
- Laptop/desktop running Python 3.10+

---

## Repo Structure

```
neuraltrace/
├── backend/
│   ├── stream.py          # LSL stream reader
│   ├── processor.py       # Band power + coherence computation
│   └── server.py          # WebSocket server
├── frontend/
│   ├── index.html
│   ├── brain.js           # Three.js brain + node visualization
│   └── socket.js          # WebSocket client + signal handler
├── tasks/
│   └── vocab_task.html    # Simple in-browser learning task for demos
├── requirements.txt
└── README.md
```

---

## Quickstart

### 1. Install dependencies

```bash
git clone https://github.com/YOUR_USERNAME/neuraltrace.git
cd neuraltrace
pip install -r requirements.txt
```

**requirements.txt**
```
pylsl
numpy
scipy
mne
websockets
```

### 2. Start the OpenBCI stream

- Open **OpenBCI GUI**
- Connect your Ultracortex headset
- Start a **Lab Streaming Layer (LSL)** session
- Keep the GUI running in the background

### 3. Run the backend

```bash
python backend/server.py
```

This reads from the LSL stream, computes band power and coherence every 500ms, and serves updates over WebSocket on `ws://localhost:8765`.

### 4. Open the visualizer

```bash
# Just open in your browser
open frontend/index.html
```

Or serve it locally:

```bash
python -m http.server 3000
# then visit http://localhost:3000/frontend
```

---

## How the Visualization Works

1. **16 electrode positions** from the Ultracortex are mapped to nodes on a 3D brain mesh, grouped by region (frontal, temporal, parietal, occipital).
2. Every 500ms, the backend computes a **coherence matrix** — how synchronized each pair of channels is.
3. When coherence between two nodes crosses a threshold, a **glowing arc** animates between them.
4. Sustained **theta activity** at Fz/Pz slowly solidifies arcs from dashed → solid (representing a "memory path").
5. **Gamma bursts** at any node trigger an outward ripple pulse.

---

## Demo Setup

For a clean, repeatable demo:

1. Have the subject put on the headset and rest for 30 seconds (baseline)
2. Open `tasks/vocab_task.html` — a simple vocabulary learning task
3. Start the visualizer side-by-side
4. Watch connections light up and solidify as learning occurs

---

## Scientific Framing

NeuralTrace does **not** claim to show individual synapses or neurons — this is physically impossible with surface EEG. What it shows is **functional connectivity** changing in real time, which is the standard neuroscientific proxy for learning-driven network reorganization. Theta-gamma coupling and inter-regional coherence are well-studied EEG signatures of memory encoding (Helfrich & Knight, 2016; Fell & Axmacher, 2011).

---

## Team

Built at [Hackathon Name] — [Date]

**Builders**
- Tony
- Rithvi
- Swati

**Guides & Mentors**
- Rohan
- Eric

---

## License

MIT