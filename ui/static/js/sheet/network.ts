// The sheet's messages over the room's socket (room/socket.js): they go out as
// room:sendMessage, and what the server sends comes in as ws:<type> events.
import { applyRemoteToState, type RemoteSheetMessage } from "./state/remote";
import { createSheetActions } from "./state/actions";
import { currentSheetId } from "./current";
import { online } from "./connection";

/**
 * Sends `json` over the room's socket; false when the socket is not open and
 * the message did not go.
 */
export function sendToRoom(json: string): boolean {
    return document.dispatchEvent(new CustomEvent("room:sendMessage", { detail: json, cancelable: true }));
}

// — Sending ———————————————————————————

const timers = new Map<string, ReturnType<typeof setTimeout>>();

function debounce(key: string, delay: number, fn: () => void): void {
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
        fn();
        timers.delete(key);
    }, delay));
}

// maxMessageSize in internal/roomws/client.go: a larger message closes the socket.
const MAX_MESSAGE_BYTES = 32 * 1024;

type Edit = { eventID: string; sheetID: string | null };

/** Sheet edits the server has not answered yet: eventID → sheetID. */
const pending = new Map<string, string | null>();

/**
 * The edit is applied locally but the server does not have it: main.ts
 * reloads the sheet. `reason` is the code of the server's answer, "tooLarge"
 * or "offline".
 */
function editFailed(sheetID: string | null, reason: string): void {
    document.dispatchEvent(new CustomEvent("sheet:editFailed", { detail: { sheetID, reason } }));
}

// The message is stamped when the edit is made: a sheet opened meanwhile does
// not take over a debounced edit.
function stamp(msg: object): object & Edit {
    return { ...msg, eventID: crypto.randomUUID(), sheetID: currentSheetId() };
}

function sendEdit(msg: object & Edit): void {
    const json = JSON.stringify(msg);
    if (new TextEncoder().encode(json).length > MAX_MESSAGE_BYTES) {
        editFailed(msg.sheetID, "tooLarge");
        return;
    }
    // Before the first connection the sheet is not read-only yet.
    if (!sendToRoom(json)) {
        editFailed(msg.sheetID, "offline");
        return;
    }
    pending.set(msg.eventID, msg.sheetID);
}

// The server may or may not have taken what was sent; the sheet is read again
// once the socket is back, and edits still waiting for their debounce go with it.
function dropEdits(): void {
    pending.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
}

// Every local edit of the sheet: the fields and the blocks call these, and
// they change the state and send the message.
export const sheetActions = createSheetActions({
    send: msg => sendEdit(stamp(msg)),
    schedule: (msg, key) => {
        const stamped = stamp(msg);
        debounce(key, 200, () => sendEdit(stamped));
    },
});

// — Receiving —————————————————————————

const on = <T>(type: string, handle: (msg: T) => void) =>
    document.addEventListener(`ws:${type}`, e => handle((e as CustomEvent<T>).detail));

on<{ eventID: string; OK: boolean; code?: string }>("response", msg => {
    if (!pending.has(msg.eventID)) return;
    const sheetID = pending.get(msg.eventID)!;
    pending.delete(msg.eventID);
    if (!msg.OK) editFailed(sheetID, msg.code ?? "internal");
});

// Changes of the open sheet go to its state; the components render it.
const SHEET_MESSAGES = [
    "change", "batch", "autocompleteApplied", "createItem", "deleteItem", "positionsChanged", "moveItemBetweenGrids",
] as const;
for (const type of SHEET_MESSAGES) {
    on<RemoteSheetMessage & { sheetID: string }>(type, msg => {
        if (msg.sheetID === currentSheetId()) applyRemoteToState(msg);
    });
}

// main.ts reads the open sheet again once the socket is back.
on("disconnected", () => {
    dropEdits();
    online.value = false;
});
on("reconnected", () => {
    online.value = true;
});
