// The bar of a page with a socket (socket.ts), the room's or the bestiary's,
// on what keeps the page from sending: the socket is down and reconnecting,
// or the server runs a newer bundle than the page's (its hello). The sheet
// goes read-only by itself (sheet/connection.ts); the bar says why to the
// whole page.
import { signal } from "@preact/signals";

const reconnecting = signal(false);
const outdated = signal(false);

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
    // The page carries the hash of its bundle in data-build (view_room.html,
    // bestiary.html); a server under -dev sends no hello.
    document.addEventListener("ws:hello", e => {
        const page = document.querySelector<HTMLElement>("[data-build]")?.dataset.build;
        outdated.value = page !== undefined && (e as CustomEvent<{ build: string }>).detail.build !== page;
    });
}

export function ConnectionBar() {
    if (outdated.value) {
        return (
            <div class="connection-bar">
                A new version is out: reload the page to go on editing.
                <button type="button" onClick={() => window.location.reload()}>Reload</button>
            </div>
        );
    }
    if (reconnecting.value) return <div class="connection-bar">No connection. Reconnecting…</div>;
    return null;
}
