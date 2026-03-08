import argparse
import asyncio
import csv
import json
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn

# Connected WebSocket clients
connected_clients: list[WebSocket] = []

# Board state
board: BoardShim | None = None
streaming = False

# Config (set from CLI args)
board_id: int = BoardIds.CYTON_BOARD
serial_port: str = ""

# Recording state
recording = False
record_user = ""
record_technique = ""
record_duration = 0
record_start_time = 0.0
record_buffer: dict[str, list[tuple[float, float]]] = {}
record_sample_rate = 0

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"
visualizer_dir = Path(__file__).resolve().parent.parent / "visualizer"


async def broadcast(data: dict):
    """Send data to all connected WebSocket clients."""
    message = json.dumps(data)
    disconnected = []
    for client in connected_clients:
        try:
            await client.send_text(message)
        except Exception:
            disconnected.append(client)
    for client in disconnected:
        connected_clients.remove(client)


async def stream_eeg():
    """Continuously read EEG data from the board and broadcast to clients."""
    global streaming, record_sample_rate
    eeg_channels = BoardShim.get_eeg_channels(board.board_id)
    accel_channels = BoardShim.get_accel_channels(board.board_id)
    timestamp_channel = BoardShim.get_timestamp_channel(board.board_id)
    sample_rate = BoardShim.get_sampling_rate(board.board_id)

    # International 10-20 electrode names, ordered by Cyton pin (N1P → N8P).
    # Wiring: N1P=F3(grey), N2P=F4(purple), N3P=C4(blue), N4P=C3(green),
    #         N5P=T4(yellow), N6P=T3(orange), N7P=P4(red), N8P=P3(brown),
    #         then ear references A1(left), A2(right).
    CHANNEL_NAMES_10_20 = ["F3", "F4", "C4", "C3", "T4", "T3", "P4", "P3", "A1", "A2"]

    # FFT bandpass filter: rolling buffer per channel for clean filtering.
    # We accumulate >=1s of data so the FFT has good frequency resolution,
    # then extract only the newly arrived filtered samples.
    FILTER_LOW = 1.0    # Hz — removes DC drift
    FILTER_HIGH = 50.0  # Hz — removes line noise & high-freq artifacts
    filter_buffers: list[np.ndarray] = [np.array([]) for _ in eeg_channels]
    BUFFER_SIZE = int(sample_rate)  # 1 second of history

    print(f"Streaming EEG — {len(eeg_channels)} channels @ {sample_rate} Hz")
    print(f"10-20 channel mapping: {CHANNEL_NAMES_10_20[:len(eeg_channels)]}")
    print(f"FFT bandpass filter: {FILTER_LOW}–{FILTER_HIGH} Hz")

    while streaming:
        await asyncio.sleep(1.0 / 10)  # ~10 pushes per second
        data = board.get_board_data()
        num_samples = data.shape[1]
        if num_samples == 0:
            continue

        raw_eeg = data[eeg_channels]
        timestamps = data[timestamp_channel].tolist()

        # FFT bandpass: accumulate into rolling buffer, filter, take new samples
        filtered_channels = []
        for ch_idx in range(len(eeg_channels)):
            buf = np.concatenate([filter_buffers[ch_idx], raw_eeg[ch_idx]])
            if len(buf) > BUFFER_SIZE:
                buf = buf[-BUFFER_SIZE:]
            filter_buffers[ch_idx] = buf

            if len(buf) >= 16:
                freqs = np.fft.rfftfreq(len(buf), d=1.0 / sample_rate)
                spectrum = np.fft.rfft(buf)
                spectrum[(freqs < FILTER_LOW) | (freqs > FILTER_HIGH)] = 0
                filtered = np.fft.irfft(spectrum, n=len(buf))
                filtered_channels.append(filtered[-num_samples:].tolist())
            else:
                filtered_channels.append(raw_eeg[ch_idx].tolist())

        eeg = filtered_channels

        # Accelerometer: take last sample's [x, y, z] for head orientation
        accel = [data[ch][-1] for ch in accel_channels] if len(accel_channels) > 0 else []

        channel_names = CHANNEL_NAMES_10_20[:len(eeg)]

        # Append to recording buffer if recording is active
        if recording:
            record_sample_rate = sample_rate
            for i, name in enumerate(channel_names):
                if i >= len(eeg):
                    break
                if name not in record_buffer:
                    record_buffer[name] = []
                for j, val in enumerate(eeg[i]):
                    ts = timestamps[j] if j < len(timestamps) else (timestamps[-1] if timestamps else time.time())
                    record_buffer[name].append((ts, val))

            # Auto-stop when duration exceeded
            if time.time() - record_start_time >= record_duration:
                _save_recording()

        await broadcast({
            "type": "eeg",
            "channels": eeg,
            "channel_names": channel_names,
            "accel": accel,
            "timestamps": timestamps,
            "sample_rate": sample_rate,
            "num_samples": num_samples,
        })


@asynccontextmanager
async def lifespan(app: FastAPI):
    global board, streaming

    params = BrainFlowInputParams()
    params.serial_port = serial_port

    BoardShim.enable_dev_board_logger()

    board = BoardShim(board_id, params)
    board.prepare_session()
    board.start_stream()
    streaming = True

    print(f"Board {board_id} streaming on {serial_port or 'default port'}")
    task = asyncio.create_task(stream_eeg())

    yield

    streaming = False
    task.cancel()
    board.stop_stream()
    board.release_session()
    print("Board session released")


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def index():
    return FileResponse(frontend_dir / "index.html")


@app.get("/connections")
async def connections_visualizer():
    return FileResponse(visualizer_dir / "index.html")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    print("Client connected!")
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(ws)
        print("Client disconnected")


DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def _save_recording():
    """Flush the recording buffer to CSV files + meta.json."""
    global recording
    recording = False

    trial_dir = DATA_DIR / record_user / record_technique
    trial_dir.mkdir(parents=True, exist_ok=True)

    for ch_name, rows in record_buffer.items():
        csv_path = trial_dir / f"{ch_name}.csv"
        with open(csv_path, "w", newline="") as f:
            writer = csv.writer(f)
            writer.writerow(["timestamp", "value"])
            writer.writerows(rows)

    meta = {
        "user": record_user,
        "technique": record_technique,
        "duration_seconds": record_duration,
        "sample_rate": record_sample_rate,
        "channels_recorded": list(record_buffer.keys()),
        "total_samples_per_channel": {k: len(v) for k, v in record_buffer.items()},
        "recorded_at": time.strftime("%Y-%m-%d %H:%M:%S"),
    }
    with open(trial_dir / "meta.json", "w") as f:
        json.dump(meta, f, indent=2)

    print(f"Recording saved: {trial_dir} ({len(record_buffer)} channels)")


class RecordStartRequest(BaseModel):
    user: str
    technique: str
    duration: int


class AnalyzeRequest(BaseModel):
    user: str


@app.post("/api/record/start")
async def api_record_start(req: RecordStartRequest):
    global recording, record_user, record_technique, record_duration, record_start_time, record_buffer, record_sample_rate
    if recording:
        return {"error": "Already recording"}
    record_user = req.user
    record_technique = req.technique
    record_duration = req.duration
    record_start_time = time.time()
    record_buffer = {}
    record_sample_rate = 0
    recording = True
    return {"status": "recording"}


@app.post("/api/record/stop")
async def api_record_stop():
    global recording
    if not recording:
        return {"status": "not_recording"}
    _save_recording()
    return {"status": "stopped"}


@app.get("/api/record/status")
async def api_record_status():
    elapsed = time.time() - record_start_time if recording else 0
    return {
        "recording": recording,
        "technique": record_technique,
        "elapsed": elapsed,
        "duration": record_duration,
        "user": record_user,
    }


@app.post("/api/analyze")
async def api_analyze(req: AnalyzeRequest):
    import sys
    backend_dir = str(Path(__file__).resolve().parent)
    if backend_dir not in sys.path:
        sys.path.insert(0, backend_dir)
    from analyze import analyze_trial, composite_learning_score

    user_dir = DATA_DIR / req.user
    if not user_dir.exists():
        return {"error": f"No data for user '{req.user}'"}

    trials = sorted([d.name for d in user_dir.iterdir() if d.is_dir()])

    baseline_metrics = None
    if "baseline" in trials:
        baseline_metrics = analyze_trial(user_dir / "baseline")
        trials = [t for t in trials if t != "baseline"]

    technique_results = {}
    for technique in trials:
        metrics = analyze_trial(user_dir / technique)
        score = composite_learning_score(metrics, baseline_metrics)
        technique_results[technique] = {"metrics": metrics, "composite_score": score}

    ranked = sorted(technique_results.items(), key=lambda x: x[1]["composite_score"], reverse=True)

    return {
        "user": req.user,
        "ranking": [{"technique": t, **r} for t, r in ranked],
        "best_technique": ranked[0][0] if ranked else "",
        "baseline_metrics": baseline_metrics,
    }


@app.get("/api/users")
async def api_users():
    if not DATA_DIR.exists():
        return []
    return sorted([d.name for d in DATA_DIR.iterdir() if d.is_dir()])


# Serve static frontend files (must be mounted after routes)
app.mount("/", StaticFiles(directory=str(frontend_dir)), name="frontend")


if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument('--board-id', type=int, help='board id (default: 0 for Cyton)',
                        required=False, default=BoardIds.CYTON_BOARD)
    parser.add_argument('--serial-port', type=str, help='serial port (e.g. /dev/ttyUSB0, COM4)',
                        required=False, default='')
    args = parser.parse_args()

    board_id = args.board_id
    serial_port = args.serial_port

    # Restart loop: Ctrl+C stops the board gracefully via lifespan cleanup,
    # then the server automatically restarts. Double Ctrl+C to fully exit.
    while True:
        try:
            print(f"\nServing on http://127.0.0.1:8000  (Ctrl+C to restart, double Ctrl+C to quit)")
            uvicorn.run(app, host="127.0.0.1", port=8000)
        except KeyboardInterrupt:
            pass
        print("\nRestarting server in 2 seconds... (Ctrl+C again to quit)")
        try:
            time.sleep(2)
        except KeyboardInterrupt:
            print("\nExiting.")
            sys.exit(0)
