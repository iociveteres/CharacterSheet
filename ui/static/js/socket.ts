// The WebSocket of a page: the room's (room/socket.js) or the bestiary's
// (bestiary/socket.ts). Every message of the server goes out as a ws:<type>
// event on document, with the message as its detail: the page and the sheet
// (sheet/network.ts) listen to the types they handle. They send with
// room:sendMessage, the name the sheet has always used, and room:closeSocket
// closes the socket for good.

/** Why the page stopped reconnecting: the session ended, or the page is no longer the user's. */
export type ConnectionLostReason = "signedOut" | "noAccess";

export interface ConnectionLost {
    reason: ConnectionLostReason;
}

const MAX_DELAY_MS = 30_000;
/** Failed reconnects in a row after which the check URL tells whether to go on. */
const CHECK_EVERY = 3;

/**
 * Connects to `path` on this host and reconnects after a drop for as long as
 * it takes: ws:disconnected and ws:reconnected on document mark a drop. The
 * browser does not tell a script why a handshake was refused, so after every
 * third failure in a row `checkURL`, a page of the same user, says whether it
 * is worth going on; when the user was signed out or lost the page,
 * ws:connectionLost on window (ConnectionLost) says it has to be reloaded.
 * Once the page dispatches room:closeSocket, the socket closes and none of
 * that follows.
 */
export function connectSocket(path: string, checkURL: string): void {
    let socket: WebSocket | null = null;
    /** Reconnects in a row that closed without opening. */
    let failures = 0;
    let isUnloading = false;
    let wasDisconnected = false;
    let closedByPage = false;
    let gaveUp = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    window.addEventListener("beforeunload", () => {
        // mark unload so close handler won't try to reconnect
        isUnloading = true;
    });

    const done = () => isUnloading || closedByPage || gaveUp;
    const connecting = () => socket !== null && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);

    function connect(): void {
        if (done()) return;
        if (connecting()) {
            console.log("Socket already open/connecting — skipping connect");
            return;
        }

        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const current = new WebSocket(`${protocol}//${window.location.host}${path}`);
        socket = current;
        let opened = false;

        current.addEventListener("open", () => {
            console.log("WebSocket connected");
            opened = true;
            failures = 0;
            // What was said meanwhile never arrived; the sheet reads itself again.
            if (wasDisconnected) document.dispatchEvent(new CustomEvent("ws:reconnected"));
            wasDisconnected = false;
        });

        current.addEventListener("message", handleMessage);

        current.addEventListener("error", e => {
            console.error("WebSocket error", e);
        });

        current.addEventListener("close", e => {
            console.log("WebSocket closed:", e.code, e.reason, "; wasClean:", e.wasClean);
            if (done()) {
                console.log("Page unloading or done with the socket — skipping reconnect");
                return;
            }
            if (!wasDisconnected) document.dispatchEvent(new CustomEvent("ws:disconnected"));
            wasDisconnected = true;
            if (!opened) failures++;
            if (failures > 0 && failures % CHECK_EVERY === 0) void checkThenRetry(current);
            else retry();
        });
    }

    function retry(): void {
        // The spread keeps the tabs of a restarted server from coming back in the same second.
        const delay = Math.min(MAX_DELAY_MS, 1000 * 2 ** failures * (0.8 + Math.random() * 0.4));
        console.log(`Reconnecting in ${Math.round(delay / 1000)} s (${failures} failed in a row)`);
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, delay);
    }

    async function checkThenRetry(failed: WebSocket): Promise<void> {
        const reason = await lostReason(checkURL);
        // An online or visibility retry may have gone meanwhile.
        if (socket !== failed || done()) return;
        if (reason === null) {
            retry();
            return;
        }
        gaveUp = true;
        console.error(`Stopped reconnecting: ${reason}`);
        window.dispatchEvent(new CustomEvent<ConnectionLost>("ws:connectionLost", { detail: { reason } }));
    }

    // The network or the tab is back: no point in waiting out the delay.
    function retryNow(): void {
        if (!wasDisconnected || done() || connecting()) return;
        clearTimeout(reconnectTimer);
        failures = 0;
        connect();
    }
    window.addEventListener("online", retryNow);
    document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") retryNow();
    });

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

    document.addEventListener("room:closeSocket", () => {
        closedByPage = true;
        clearTimeout(reconnectTimer);
        socket?.close();
    });

    connect();
}

/**
 * Why the socket of the page is refused, by what `checkURL` answers: null
 * while the user may still have it, or when the network is what fails.
 */
async function lostReason(checkURL: string): Promise<ConnectionLostReason | null> {
    let res: Response;
    try {
        // requireAuthentication sends a signed-out user to /user/login.
        res = await fetch(checkURL, { redirect: "manual", credentials: "same-origin" });
    } catch {
        return null;
    }
    if (res.type === "opaqueredirect") return "signedOut";
    if (res.status === 403 || res.status === 404) return "noAccess";
    return null;
}
