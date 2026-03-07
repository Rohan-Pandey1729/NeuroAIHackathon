import argparse
import time
from pathlib import Path

from brainflow.board_shim import BoardShim, BrainFlowInputParams, BoardIds
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import uvicorn

app = FastAPI()

# Connected WebSocket clients
connected_clients: list[WebSocket] = []

frontend_dir = Path(__file__).resolve().parent.parent / "frontend"


@app.get("/")
async def index():
    return FileResponse(frontend_dir / "index.html")


@app.websocket("/ws")
async def websocket_endpoint(ws: WebSocket):
    await ws.accept()
    connected_clients.append(ws)
    print("Connected!")
    try:
        while True:
            await ws.receive_text()
    except WebSocketDisconnect:
        connected_clients.remove(ws)
        print("Disconnected")


# Serve static frontend files (must be mounted after routes)
app.mount("/", StaticFiles(directory=str(frontend_dir)), name="frontend")


def log_data():
    BoardShim.enable_dev_board_logger()

    params = BrainFlowInputParams()
    # params.ip_port = args.ip_port
    params.serial_port = "COM4"
    # params.mac_address = args.mac_address
    # params.other_info = args.other_info
    # params.serial_number = args.serial_number
    # params.ip_address = args.ip_address
    # params.ip_protocol = args.ip_protocol
    # params.timeout = args.timeout
    # params.file = args.file
    # params.master_board = args.master_board
    board_id = 0
    board = BoardShim(board_id, params)
    board.prepare_session()
    board.start_stream()

    time.sleep(10)
    
    data = board.get_board_data()
    board.stop_stream()
    board.release_session()

    print(data)


if __name__ == "__main__":

    parser = argparse.ArgumentParser()
    parser.add_argument('--timeout', type=int, help='timeout for device discovery or connection', required=False,
                        default=0)
    parser.add_argument('--ip-port', type=int, help='ip port', required=False, default=0)
    parser.add_argument('--ip-protocol', type=int, help='ip protocol, check IpProtocolType enum', required=False,
                        default=0)
    parser.add_argument('--ip-address', type=str, help='ip address', required=False, default='')
    parser.add_argument('--serial-port', type=str, help='serial port', required=False, default='')
    parser.add_argument('--mac-address', type=str, help='mac address', required=False, default='')
    parser.add_argument('--other-info', type=str, help='other info', required=False, default='')
    parser.add_argument('--serial-number', type=str, help='serial number', required=False, default='')
    parser.add_argument('--board-id', type=int, help='board id, check docs to get a list of supported boards',
                        required=True)
    parser.add_argument('--file', type=str, help='file', required=False, default='')
    parser.add_argument('--master-board', type=int, help='master board id for streaming and playback boards',
                        required=False, default=BoardIds.NO_BOARD)
    args = parser.parse_args()

    print("Serving on http://127.0.0.1:8000")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="error")
