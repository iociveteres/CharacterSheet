// network.js

import {
    getRoot,
    getGridFromPath,
    findElementByPath
} from "./utils.js"

import { setLayouts } from "./state/sync.js";
import { applyRemoteToState } from "./state/remote";
import { createSheetActions } from "./state/actions";

console.log(document.location.host)
const characters = document.getElementById('characters');
const inviteLinkModal = document.getElementById('invite-link-modal');

// WebSocket connection management
const roomId = document.getElementById('room').dataset.roomId;
let socket = null;
let reconnectAttempts = 0;
let isUnloading = false;
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

export { socket, connect };

// — State & Versioning ——————————————————
let globalVersion = 0;
const timers = new Map();     // Map<fullFieldPath, timer>

// — Sending ———————————————————————————
function debounce(map, key, delay, fn) {
    clearTimeout(map.get(key));
    map.set(key, setTimeout(() => {
        fn();
        map.delete(key);
    }, delay));
}

function schedule(msg, path) {
    debounce(timers,
        path,
        200,
        () => socket.send(msg)
    );
}

function currentSheetID() {
    return document.getElementById('charactersheet')?.dataset?.sheetId ?? null;
}

// Every local edit of the sheet: the fields and the blocks call these, and
// they change the state and send the message.
export const sheetActions = createSheetActions({
    send: msg => socket.send(JSON.stringify({
        ...msg,
        eventID: crypto.randomUUID(),
        sheetID: currentSheetID(),
    })),
    schedule: (msg, key) => schedule(JSON.stringify({
        ...msg,
        eventID: crypto.randomUUID(),
        sheetID: currentSheetID(),
        version: ++globalVersion,
    }), key),
});

function isForCurrentSheet(msg) {
    return msg.sheetID === currentSheetID();
}

const messageHandlers = {
    'OK': () => { },
    'response': () => { },

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

    // Sheet changes for Preact blocks change the state only; the rest go to
    // the DOM handlers of the old blocks.
    'change': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        getRoot().dispatchEvent(new CustomEvent('changeRemote', { detail: msg }));
    },
    'batch': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        const el = findElementByPath(msg.path);
        const target = el ?? getRoot();
        target.dispatchEvent(new CustomEvent('batchRemote', { bubbles: true, detail: msg }));
    },
    'autocompleteApplied': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        const target = findElementByPath(msg.path);
        if (!target) return;

        target.querySelectorAll('input, select, textarea').forEach(el => {
            el.type === 'checkbox' || el.type === 'radio'
                ? (el.checked = false)
                : (el.value = '');
        });
        target.dispatchEvent(new CustomEvent('batchRemote', { bubbles: true, detail: msg }));
    },
    'createItem': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        findElementByPath(msg.path)
            .dispatchEvent(new CustomEvent('createItemRemote', { detail: msg }));
    },
    'deleteItem': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        const parts = msg.path.split('.');
        parts.pop();
        const container = findElementByPath(parts.join('.'));
        if (container) {
            container.dispatchEvent(new CustomEvent('deleteItemRemote', { detail: { path: msg.path } }));
        } else {
            console.error('Could not find container for deleteItem, path:', parts.join('.'));
        }
    },
    'positionsChanged': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        setLayouts(msg.path, msg.positions);
        const container = getRoot().querySelector(`[data-id="${getGridFromPath(msg.path)}"]`);
        container.dispatchEvent(new CustomEvent('positionsChangedRemote', { detail: msg }));
    },
    'moveItemBetweenGrids': msg => {
        if (!isForCurrentSheet(msg) || applyRemoteToState(msg)) return;
        const fromGrid = findElementByPath(msg.fromPath);
        const tabsContainer = fromGrid?.closest('.tabs[data-id$=".items"]');
        if (tabsContainer) {
            tabsContainer.dispatchEvent(new CustomEvent('moveItemBetweenGridsRemote', {
                detail: {
                    fromPath: msg.fromPath,
                    toPath: msg.toPath,
                    itemId: msg.itemId,
                    toPosition: msg.toPosition,
                }
            }));
        }
    },
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
            console.log(msg);
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
