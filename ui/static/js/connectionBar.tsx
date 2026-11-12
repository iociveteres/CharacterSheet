// The bar of a page with a socket (socket.ts), the room's or the bestiary's,
// while the socket is down and reconnecting. The sheet goes read-only by
// itself (sheet/connection.ts); the bar says why to the whole page.
import { signal } from "@preact/signals";

const reconnecting = signal(false);

/** Follows the page's socket; call once, before it can drop. */
export function listenConnection(): void {
    document.addEventListener("ws:disconnected", () => {
        reconnecting.value = true;
    });
    document.addEventListener("ws:reconnected", () => {
        reconnecting.value = false;
    });
    // The page shows why it stopped (the room's modal, the bestiary's toast).
    window.addEventListener("ws:connectionLost", () => {
        reconnecting.value = false;
    });
}

export function ConnectionBar() {
    if (!reconnecting.value) return null;
    return <div class="connection-bar">No connection. Reconnecting…</div>;
}
