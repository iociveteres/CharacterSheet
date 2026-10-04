// The WebSocket of a page: the room's (room/socket.js) or the bestiary's
// (bestiary/socket.ts). Every message of the server goes out as a ws:<type>
// event on document, with the message as its detail: the page and the sheet
// (sheet/network.ts) listen to the types they handle. They send with
// room:sendMessage, the name the sheet has always used.

const MAX_RECONNECT_ATTEMPTS = 3;

/**
 * Connects to `path` on this host and reconnects after a drop, three times
 * at most: ws:disconnected and ws:reconnected on document mark a drop, and
 * ws:connectionLost on window that the page has to be reloaded.
 */
export function connectSocket(path: string): void {
    let socket: WebSocket | null = null;
    let reconnectAttempts = 0;
    let isUnloading = false;
    let wasDisconnected = false;

    window.addEventListener("beforeunload", () => {
        // mark unload so close handler won't try to reconnect
        isUnloading = true;
    });

    function connect(): void {
        if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
            console.log("Socket already open/connecting — skipping connect");
            return;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}${path}`);

        socket.addEventListener("open", () => {
            console.log("WebSocket connected");
            reconnectAttempts = 0;
            // What was said meanwhile never arrived; the sheet reads itself again.
            if (wasDisconnected) document.dispatchEvent(new CustomEvent("ws:reconnected"));
            wasDisconnected = false;
        });

        socket.addEventListener("message", handleMessage);

        socket.addEventListener("error", e => {
            console.error("WebSocket error", e);
        });

        socket.addEventListener("close", e => {
            console.log("WebSocket closed:", e.code, e.reason, "; wasClean:", e.wasClean);
            if (isUnloading) {
                console.log("Page unloading — skipping reconnect");
                return;
            }
            if (!wasDisconnected) document.dispatchEvent(new CustomEvent("ws:disconnected"));
            wasDisconnected = true;
            handleDisconnection();
        });
    }

    function handleDisconnection(): void {
        if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            reconnectAttempts++;
            console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
            setTimeout(connect, 2000 * reconnectAttempts);
        } else {
            console.error("Max reconnection attempts reached");
            window.dispatchEvent(new CustomEvent("ws:connectionLost"));
        }
    }

    function handleMessage(e: MessageEvent<string>): void {
        // The server joins the messages it has queued with newlines.
        for (const line of e.data.split("\n")) {
            if (line.trim() === "") continue;
            let msg;
            try {
                msg = JSON.parse(line);
            } catch (err) {
                console.error("Failed to parse message:", line, err);
                continue;
            }
            document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));
        }
    }

    // The event is canceled when the socket is not open, so a sender that
    // dispatches it as cancelable learns that its message did not go.
    document.addEventListener("room:sendMessage", e => {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send((e as CustomEvent<string>).detail);
        } else {
            console.error("WebSocket not connected, cannot send message");
            e.preventDefault();
        }
    });

    connect();
}
