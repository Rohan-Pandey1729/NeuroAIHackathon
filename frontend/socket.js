const wsUrl = `ws://${window.location.host}/ws`;
let socket;

function connect() {
    socket = new WebSocket(wsUrl);

    socket.onopen = () => {
        console.log("connected");
    };

    socket.onclose = () => {
        console.log("disconnected, reconnecting...");
        setTimeout(connect, 1000);
    };

    socket.onerror = (err) => {
        console.error("WebSocket error:", err);
        socket.close();
    };
}

connect();
