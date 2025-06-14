// network.js

import {
    mockSocket
} from "./utils.js"

// — Mock WebSocket — replace with your real ws instance
const socket = mockSocket

// — State & Versioning ——————————————————
let globalVersion = 0;
const fieldSeq = new Map();  // per-field seq
const lastValue = new Map();  // last sent text per-field

const changeTimers = new Map();     // Map<fullFieldPath, timer>
const batchTimers = new Map();     // Map<fullFieldPath, timer>

// — Helpers —————————————————————————————————

// Build dot-path of all data-id ancestors up to <body>
function getDataPath(el) {
    const parts = [];
    while (el && el !== document.body) {
        if (el.dataset?.id) parts.unshift(el.dataset.id);
        el = el.parentElement;
    }
    return parts.join(".");
}

// Split a full path ("parent.child") → [ "parent", "child" ]
function splitPath(fullPath) {
    const parts = fullPath.split(".");
    const key = parts.pop();
    const parent = parts.join(".");
    return [parent || null, key];
}

// Simple full-replacement “change”
function createTextChange(oldVal, newVal) {
    return JSON.stringify({ from: oldVal, to: newVal });
}

// — Sending ———————————————————————————

// 1) Emit a batched fields message
function sendBatch(path, changes) {
    socket.send(JSON.stringify({
        type: 'batch',
        path: path,
        version: ++globalVersion,
        changes
    }));
}

// 2) Schedule a batch
function scheduleBatch(path, changes) {
    clearTimeout(batchTimers.get(path));

    batchTimers.set(path, setTimeout(() => {
        sendBatch(path, changes);
        batchTimers.delete(path);
    }, 200));
}

// 3) Emit a single-field change message
function sendChange(path, oldVal, newVal) {
    const [parent, key] = splitPath(path);
    const change = createTextChange(oldVal, newVal);
    const seq = (fieldSeq.get(path) || 0) + 1;
    fieldSeq.set(path, seq);

    socket.send(JSON.stringify({
        type: 'change',
        path: parent,
        version: ++globalVersion,
        field: key,
        change,
        seq
    }));

    lastValue.set(path, newVal);
}

// 4) Schedule a typing change after debounce
function scheduleChange(fullPath, newVal) {
    clearTimeout(changeTimers.get(fullPath));
    const oldVal = lastValue.get(fullPath) || "";

    changeTimers.set(fullPath, setTimeout(() => {
        sendChange(fullPath, oldVal, newVal);
        changeTimers.delete(fullPath);
    }, 200));
}

// — Event Handlers ——————————————————————


function handleInput(e) {
    // Only change real text entry (text inputs & textareas)
    const el = e.target;
    if (!el.dataset?.id) return;

    const tag = el.tagName;
    const type = el.type;

    // **Only** text chars, not numbers, checkboxes, selects, etc.
    const isTextInput = tag === "INPUT" && type === "text";
    const isTextarea = tag === "TEXTAREA";

    if (isTextInput || isTextarea) {
        const fullPath = getDataPath(el);
        scheduleChange(fullPath, el.value);
    }
}

function handleChange(e) {
    // Redirect label → its inner control
    let el = e.target;
    if (el.tagName === 'LABEL') {
        el = el.querySelector('input, textarea, select');
        if (!el) return;
    }

    if (!el.dataset?.id) return;

    const tag = el.tagName.toLowerCase();
    const type = el.type;

    // Skip pure-text here—those go through handleInput
    const isTextInput = tag === 'input' && type === 'text';
    const isTextarea = tag === 'textarea';
    if (isTextInput || isTextarea) return;

    // Normalize value
    let value = el.value;
    if (type === 'number') value = Number(value);

    // Compute fullPath & parent container
    const fullPath = getDataPath(el);
    const [parent] = splitPath(fullPath);

    scheduleBatch(fullPath, value);
}

function handleBatch(e) {
    // from your paste handler or other component
    const path = getDataPath(e.target);
    const changes = e.detail.changes;

    scheduleBatch(path, changes)
}

}

// Listening

// socket.addEventListener('message', e => {
//     const msg = JSON.parse(e.data);

//     if (msg.type === 'create-item') {
//         // re-emit as a bubbling event so any grid can catch it
//         document.body.dispatchEvent(new CustomEvent('remote-create-item', {
//             detail: {
//                 gridId: msg.gridId,
//                 itemId: msg.itemId
//             },
//             bubbles: true
//         }));
//     }


//     // TO DO: batch, change, delete
// });

// Attach Delegated Listeners ——————————————————

document.addEventListener("input", handleInput, true);
document.addEventListener("change", handleChange, true);
document.addEventListener("fields-updated", handleBatch, true);
