// network.js

import { applyRemoteToState } from "./state/remote";
import { createSheetActions } from "./state/actions";
import { currentSheetId } from "./current";
import { online } from "./connection";

// WebSocket connection management
const roomId = document.getElementById('room').dataset.roomId;
/** @type {WebSocket | null} */
let socket = null;
let reconnectAttempts = 0;
let isUnloading = false;
let wasDisconnected = false;
const MAX_RECONNECT_ATTEMPTS = 3;

window.addEventListener('beforeunload', () => {
    // mark unload so close handler won't try to reconnect
    isUnloading = true;
});

function connect() {
    if (!roomId) { console.error('Room ID not found'); return; }

    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
        console.log('Socket already open/connecting — skipping connect');
        return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/room/ws/${roomId}`;

    socket = new WebSocket(wsUrl);

    socket.addEventListener('open', () => {
        console.log('WebSocket connected');
        reconnectAttempts = 0;
        online.value = true;
        // main.ts reads the open sheet again: it missed the changes made meanwhile.
        if (wasDisconnected) document.dispatchEvent(new CustomEvent('ws:reconnected'));
        wasDisconnected = false;
    });

    socket.addEventListener('message', handleMessage);

    socket.addEventListener('error', (e) => {
        console.error('WebSocket error', e);
    });

    socket.addEventListener('close', (e) => {
        console.log('WebSocket closed:', e.code, e.reason, '; wasClean:', e.wasClean);
        if (isUnloading) {
            console.log('Page unloading — skipping reconnect');
            return;
        }
        dropEdits();
        if (!wasDisconnected) document.dispatchEvent(new CustomEvent('ws:disconnected'));
        wasDisconnected = true;
        online.value = false;
        handleDisconnection();
    });
}

function handleDisconnection() {
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        console.log(`Attempting to reconnect (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(connect, 2000 * reconnectAttempts);
    } else {
        console.error('Max reconnection attempts reached');
        window.dispatchEvent(new CustomEvent('ws:connectionLost'));
    }
}

connect();

export { socket };

const timers = new Map();     // Map<fullFieldPath, timer>

// — Sending ———————————————————————————
function debounce(map, key, delay, fn) {
    clearTimeout(map.get(key));
    map.set(key, setTimeout(() => {
        fn();
        map.delete(key);
    }, delay));
}

// maxMessageSize in internal/roomws/client.go: a larger message closes the socket.
const MAX_MESSAGE_BYTES = 32 * 1024;

/** Sheet edits the server has not answered yet: eventID → sheetID. */
const pending = new Map();

/**
 * The edit is applied locally but the server does not have it: main.ts
 * reloads the sheet. `reason` is the code of the server's answer, or
 * "tooLarge".
 */
function editFailed(sheetID, reason) {
    document.dispatchEvent(new CustomEvent('sheet:editFailed', { detail: { sheetID, reason } }));
}

// The message is stamped when the edit is made: a sheet opened meanwhile does
// not take over a debounced edit.
function stamp(msg) {
    return { ...msg, eventID: crypto.randomUUID(), sheetID: currentSheetId() };
}

// The server may or may not have taken what was sent; the sheet is read again
// once the socket is back, and edits still waiting for their debounce go with it.
function dropEdits() {
    pending.clear();
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
}

function sendEdit(msg) {
    const json = JSON.stringify(msg);
    if (new TextEncoder().encode(json).length > MAX_MESSAGE_BYTES) {
        editFailed(msg.sheetID, 'tooLarge');
        return;
    }
    // Before the first connection the sheet is not read-only yet.
    if (socket?.readyState !== WebSocket.OPEN) {
        editFailed(msg.sheetID, 'offline');
        return;
    }
    pending.set(msg.eventID, msg.sheetID);
    socket.send(json);
}

// Every local edit of the sheet: the fields and the blocks call these, and
// they change the state and send the message.
export const sheetActions = createSheetActions({
    send: msg => sendEdit(stamp(msg)),
    schedule: (msg, key) => {
        const stamped = stamp(msg);
        debounce(timers, key, 200, () => sendEdit(stamped));
    },
});

function handleResponse(msg) {
    const sheetID = pending.get(msg.eventID);
    if (sheetID === undefined) return;
    pending.delete(msg.eventID);
    if (!msg.OK) editFailed(sheetID, msg.code);
}

function applyToCurrentSheet(msg) {
    if (msg.sheetID === currentSheetId()) applyRemoteToState(msg);
}

const messageHandlers = {
    'OK': () => { },
    'response': handleResponse,

    'newInviteLink': msg => document.dispatchEvent(new CustomEvent('ws:newInviteLink', { detail: msg })),
    'newCharacterItem': msg => document.dispatchEvent(new CustomEvent('ws:newCharacterItem', { detail: msg })),
    'deleteCharacter': msg => document.dispatchEvent(new CustomEvent('ws:deleteCharacter', { detail: msg })),
    'changeSheetVisibility': msg => document.dispatchEvent(new CustomEvent('ws:changeSheetVisibility', { detail: msg })),
    'folderCreated': msg => document.dispatchEvent(new CustomEvent('ws:folderCreated', { detail: msg })),
    'updateFolder': msg => document.dispatchEvent(new CustomEvent('ws:updateFolder', { detail: msg })),
    'deleteFolder': msg => document.dispatchEvent(new CustomEvent('ws:deleteFolder', { detail: msg })),
    'reorderFolders': msg => document.dispatchEvent(new CustomEvent('ws:reorderFolders', { detail: msg })),
    'moveSheetToFolder': msg => document.dispatchEvent(new CustomEvent('ws:moveSheetToFolder', { detail: msg })),
    'newPlayer': msg => document.dispatchEvent(new CustomEvent('ws:newPlayer', { detail: msg })),
    'kickPlayer': msg => document.dispatchEvent(new CustomEvent('ws:kickPlayer', { detail: msg })),
    'changePlayerRole': msg => document.dispatchEvent(new CustomEvent('ws:changePlayerRole', { detail: msg })),
    'chatMessage': msg => document.dispatchEvent(new CustomEvent('ws:chatMessage', { detail: msg })),
    'deleteMessage': msg => document.dispatchEvent(new CustomEvent('ws:deleteMessage', { detail: msg })),
    'chatHistory': msg => document.dispatchEvent(new CustomEvent('ws:chatHistory', { detail: msg })),
    'dicePresetUpdated': msg => document.dispatchEvent(new CustomEvent('ws:dicePresetUpdated', { detail: msg })),

    // Changes of the open sheet go to its state; the components render it.
    'change': msg => {
        // The room lists every sheet by name, open or not.
        if (msg.path === 'characterInfo.characterName') {
            document.dispatchEvent(new CustomEvent('ws:nameChanged', { detail: msg }));
        }
        applyToCurrentSheet(msg);
    },
    'batch': applyToCurrentSheet,
    'autocompleteApplied': applyToCurrentSheet,
    'createItem': applyToCurrentSheet,
    'deleteItem': applyToCurrentSheet,
    'positionsChanged': applyToCurrentSheet,
    'moveItemBetweenGrids': applyToCurrentSheet,
    'autocompleteResult': msg =>
        document.dispatchEvent(new CustomEvent('sheet:autocompleteResult', {
            detail: { requestId: msg.eventID, results: msg.results }
        })),
};

function handleMessage(e) {
    // Split by newline in case multiple messages are batched
    const messages = e.data.split('\n').filter(function (msg) { return msg.trim() !== ''; });

    messages.forEach(function (msgStr) {
        try {
            const msg = JSON.parse(msgStr);
            handleSingleMessage(msg);
        } catch (err) {
            console.error('Failed to parse message:', msgStr, err);
        }
    });
}

function handleSingleMessage(msg) {
    const handler = messageHandlers[msg.type];
    if (handler) {
        handler(msg);
    } else {
        console.warn('Unhandled message type:', msg.type, msg);
    }
}

// Listen for outgoing messages from Alpine
document.addEventListener('room:sendMessage', (e) => {
    if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(e.detail);
    } else {
        console.error('WebSocket not connected, cannot send message');
    }
});
