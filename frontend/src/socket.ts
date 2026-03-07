export interface EegMessage {
  type: "eeg";
  channels: number[][];
  timestamps: number[];
  sample_rate: number;
  num_samples: number;
}

type MessageHandler = (data: EegMessage) => void;

const wsUrl = `ws://${window.location.host}/ws`;
let socket: WebSocket | null = null;
const listeners: MessageHandler[] = [];

export function onEegData(handler: MessageHandler): void {
  listeners.push(handler);
}

function connect(): void {
  socket = new WebSocket(wsUrl);

  socket.onopen = () => {
    console.log("WebSocket connected");
  };

  socket.onmessage = (event: MessageEvent) => {
    const data: EegMessage = JSON.parse(event.data);
    if (data.type === "eeg") {
      for (const handler of listeners) {
        handler(data);
      }
    }
  };

  socket.onclose = () => {
    console.log("WebSocket disconnected, reconnecting...");
    setTimeout(connect, 1000);
  };

  socket.onerror = () => {
    socket?.close();
  };
}

connect();
