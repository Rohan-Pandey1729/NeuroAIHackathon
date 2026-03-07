import argparse
import asyncio
import json
from contextlib import asynccontextmanager
from pathlib import Path

from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

# Connected WebSocket clients
connected_clients: list[WebSocket] = []

# Board state
board: BoardShim | None = None
streaming = False

# Config (set from CLI args)
board_id: int = BoardIds.CYTON_BOARD
serial_port: str = ""

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"


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
    global streaming
    eeg_channels = BoardShim.get_eeg_channels(board.board_id)
    timestamp_channel = BoardShim.get_timestamp_channel(board.board_id)
    sample_rate = BoardShim.get_sampling_rate(board.board_id)

    print(f"Streaming EEG — {len(eeg_channels)} channels @ {sample_rate} Hz")

    while streaming:
        await asyncio.sleep(1.0 / 30)  # ~30 pushes per second
        data = board.get_board_data()
        num_samples = data.shape[1]
        if num_samples == 0:
            continue

        eeg = data[eeg_channels].tolist()
        timestamps = data[timestamp_channel].tolist()

        await broadcast({
            "type": "eeg",
            "channels": eeg,
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

    print(f"Serving on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000)
