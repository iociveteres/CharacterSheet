// network.js

import {
    mockSocket,
    root
} from "./utils.js"

var conn;
console.log(document.location.host)
if (window["WebSocket"]) {
        conn = new WebSocket("wss://" + document.location.host + "/sheet/show/ws");
        conn.onclose = function (evt) {
            console.log("Connection closed")
        };
        conn.onmessage = function (evt) {
                var messages = evt.data.split('\n');
                console.log(messages)
        };
    } else {
        var item = document.createElement("div");
        item.innerHTML = "<b>Your browser does not support WebSockets.</b>";
        appendLog(item);
    }

// — Mock WebSocket — replace with your real ws instance
const socket = mockSocket

// — State & Versioning ——————————————————
let globalVersion = 0;
const fieldSeq = new Map();  // per-field seq
const lastValue = new Map();  // last sent text per-field

const timers = new Map();     // Map<fullFieldPath, timer>

// — Helpers —————————————————————————————————

// Build dot-path of all data-id ancestors up to <body>
function getDataPath(el) {
    const parts = [];
    while (el && el !== root) {
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

function scheduleDebounced(map, key, delay, fn) {
    clearTimeout(map.get(key));
    map.set(key, setTimeout(() => {
        fn();
        map.delete(key);
    }, delay));
}

function sendBatch(path, changes) {
    socket.send(JSON.stringify({
        type: 'batch',
        version: ++globalVersion,
        path: path,
        changes
    }));
}

function scheduleBatch(path, changes) {
    scheduleDebounced(timers,
        path,
        200,
        () => sendBatch(path, changes));
}

function sendChange(path, oldVal, newVal) {
    const [parent, key] = splitPath(path);
    const change = createTextChange(oldVal, newVal);
    const seq = (fieldSeq.get(path) || 0) + 1;
    fieldSeq.set(path, seq);

    socket.send(JSON.stringify({
        type: 'change',
        version: ++globalVersion,
        path: parent,
        field: key,
        change,
        seq
    }));

    lastValue.set(path, newVal);
}

function scheduleChange(path, newVal) {
    const oldVal = lastValue.get(path) || "";
    scheduleDebounced(timers,
        path,
        200,
        () => {
            sendChange(path, oldVal, newVal);
        });
}

function sendPositionChanged(path, positions) {
    socket.send(JSON.stringify({
        type: 'positionsChanged',
        version: ++globalVersion,
        path: path,
        positions
    }));
}

function schedulePositionsChanged(path, positions) {
    scheduleDebounced(timers,
        path,
        200,
        () => {
            sendPositionChanged(path, positions);
        });
}

// — Event Handlers ——————————————————————


function handleInputEvent(e) {
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

function handleChangeEvent(e) {
    if (e.target.matches('input[type="checkbox"]') &&
        e.target.closest('#skills, #custom-skills')) {
        return;
    }

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

function handleBatchEvent(e) {
    // from your paste handler or other component
    const path = getDataPath(e.target);
    const changes = e.detail.changes;

    scheduleBatch(path, changes)
}

function handlePositionsChangedEvent(e) {
    const path = getDataPath(e.target);
    const positions = e.detail.positions;

    schedulePositionsChanged(path, positions);
}

// Listening

// socket.addEventListener('message', e => {
//     const msg = JSON.parse(e.data);

//     if (msg.type === 'create-item') {
//         // re-emit as a bubbling event so any grid can catch it
//         root.dispatchEvent(new CustomEvent('remote-create-item', {
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

root.addEventListener("input", handleInputEvent, true);
root.addEventListener("change", handleChangeEvent, true);
root.addEventListener("fields-updated", handleBatchEvent, true);
root.addEventListener('positions-changed', handlePositionsChangedEvent, true);
