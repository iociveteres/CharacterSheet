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

// — Batch Update State ——————————————————
let batchTimer = null;
let batchPath = null;         // component path for this batch
const changedFields = new Map();   // Map<fieldKey, value>

// — Change (typing) State —————————————————
const changeTimers = new Map();     // Map<fullFieldPath, timer>

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
function sendFieldsMessage() {
    if (!changedFields.size) return;

    const changes = Array.from(changedFields.entries())
        .map(([key, value]) => ({ field: key, val: value }));

    socket.send(JSON.stringify({
        type: 'batch',
        path: batchPath,
        version: ++globalVersion,
        changes
    }));

    // reset
    changedFields.clear();
    batchPath = null;
    clearTimeout(batchTimer);
}

// 2) Schedule a batch update
//    Pass ‘containerPath’ once to capture the parent component
function scheduleFieldsMessage(fullPath, value, containerPath = null) {
    const [parent, key] = splitPath(fullPath);

    // capture container path only on first change of this batch
    if (containerPath && !batchPath) {
        batchPath = containerPath;
    } else if (!containerPath && !batchPath) {
        batchPath = parent;
    }

    changedFields.set(key, value);

    clearTimeout(batchTimer);
    batchTimer = setTimeout(sendFieldsMessage, 50);
}

// 3) Emit a single-field change message
function sendChangeMessage(fullPath, oldVal, newVal) {
    const [parent, key] = splitPath(fullPath);
    const change = createTextChange(oldVal, newVal);
    const seq = (fieldSeq.get(fullPath) || 0) + 1;
    fieldSeq.set(fullPath, seq);

    socket.send(JSON.stringify({
        type: 'change',
        path: parent,
        version: ++globalVersion,
        field: key,
        change,
        seq
    }));

    lastValue.set(fullPath, newVal);
}

// 4) Schedule a typing change after debounce
function scheduleChange(fullPath, newVal) {
    clearTimeout(changeTimers.get(fullPath));
    const oldVal = lastValue.get(fullPath) || "";

    changeTimers.set(fullPath, setTimeout(() => {
        sendChangeMessage(fullPath, oldVal, newVal);
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

    scheduleFieldsMessage(fullPath, value, parent);
}

function handleFieldsUpdated(e) {
    // from your paste handler or other component
    const containerPath = getDataPath(e.target);
    for (const { path, value } of e.detail.changes) {
        // path here is the leaf key; reassemble fullPath
        const fullPath = containerPath + "." + path;
        scheduleFieldsMessage(fullPath, value, containerPath);
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
document.addEventListener("fields-updated", handleFieldsUpdated, true);
