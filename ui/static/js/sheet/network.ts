// The sheet's messages over the room's socket (room/socket.js): they go out as
// room:sendMessage, and what the server sends comes in as ws:<type> events.
import { applyRemoteToState, type RemoteSheetMessage } from "./state/remote";
import type { Transport } from "./state/actions";
import { sheets } from "./instance";
import { online } from "./connection";

/**
 * Sends `json` over the room's socket; false when the socket is not open and
 * the message did not go.
 */
export function sendToRoom(json: string): boolean {
    return document.dispatchEvent(new CustomEvent("room:sendMessage", { detail: json, cancelable: true }));
}

// — Sending ———————————————————————————

/** Debounced edits waiting to go, by key. */
const scheduled = new Map<string, { timer: ReturnType<typeof setTimeout>; send: () => void }>();

function debounce(key: string, delay: number, send: () => void): void {
    clearTimeout(scheduled.get(key)?.timer);
    const timer = setTimeout(() => {
        scheduled.delete(key);
        send();
    }, delay);
    scheduled.set(key, { timer, send });
}

// The server applies messages in the order they come, so a debounced edit
// must not go after a message that was sent at once: a change after
// deleteItem recreates the item (ChangeField ensures its path), one after
// autocompleteApply overwrites the picked entry, and positionsChanged after
// createItem drops the new item's position.
function flushScheduled(): void {
    const waiting = [...scheduled.values()];
    scheduled.clear();
    for (const { timer, send } of waiting) {
        clearTimeout(timer);
        send();
    }
}

// maxMessageSize in internal/roomws/client.go: a larger message closes the socket.
const MAX_MESSAGE_BYTES = 32 * 1024;

type Edit = { eventID: string; sheetID: string };

/** Sheet edits the server has not answered yet: eventID → sheetID. */
const pending = new Map<string, string>();

/**
 * The edit is applied locally but the server does not have it: main.ts
 * reloads the sheet it shows, if it is that one. `reason` is the code of the server's answer, "tooLarge"
 * or "offline".
 */
function editFailed(sheetID: string, reason: string): void {
    document.dispatchEvent(new CustomEvent("sheet:editFailed", { detail: { sheetID, reason } }));
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
    for (const { timer } of scheduled.values()) clearTimeout(timer);
    scheduled.clear();
}

/** How the actions of sheet `sheetId` (createSheetActions) send its edits, signed with its id. */
export function sheetTransport(sheetId: string): Transport {
    const stamp = (msg: object): object & Edit => ({ ...msg, eventID: crypto.randomUUID(), sheetID: sheetId });
    return {
        send: msg => {
            flushScheduled();
            sendEdit(stamp(msg));
        },
        schedule: (msg, key) => {
            const stamped = stamp(msg);
            // Two sheets editing the same path do not replace each other's edits.
            debounce(`${sheetId}:${key}`, 200, () => sendEdit(stamped));
        },
    };
}

// — Receiving —————————————————————————

const on = <T>(type: string, handle: (msg: T) => void) =>
    document.addEventListener(`ws:${type}`, e => handle((e as CustomEvent<T>).detail));

on<{ eventID: string; OK: boolean; code?: string }>("response", msg => {
    if (!pending.has(msg.eventID)) return;
    const sheetID = pending.get(msg.eventID)!;
    pending.delete(msg.eventID);
    if (!msg.OK) editFailed(sheetID, msg.code ?? "internal");
});

// Changes of a sheet on the page go to its state; the components render it.
const SHEET_MESSAGES = [
    "change", "batch", "autocompleteApplied", "createItem", "deleteItem", "positionsChanged", "moveItemBetweenGrids",
] as const;
for (const type of SHEET_MESSAGES) {
    on<RemoteSheetMessage & { sheetID: string }>(type, msg => {
        const sheet = sheets.get(msg.sheetID);
        if (sheet) applyRemoteToState(sheet, msg);
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
