// network.js

import {
    mockSocket,
    getRoot
} from "./utils.js"

var conn;
console.log(document.location.host)
if (window["WebSocket"]) {
    const roomId = document.getElementById("room").dataset.roomId;
    conn = new WebSocket("wss://" + document.location.host + `/room/ws/${roomId}`);
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

export const socket = conn

// — State & Versioning ——————————————————
let globalVersion = 0;
const fieldSeq = new Map();  // per-field seq
const lastValue = new Map();  // last sent text per-field

const timers = new Map();     // Map<fullFieldPath, timer>

// — Helpers —————————————————————————————————

// Build dot-path of all data-id ancestors up to <body>
function getDataPath(el) {
    const parts = [];
    while (el && el !== getRoot()) {
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
        sheetId: document.getElementById('charactersheet').dataset.sheetId,
        version: ++globalVersion,
        path: path,
        changes: changes,
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
    // const change = createTextChange(oldVal, newVal);
    const change = newVal;
    const seq = (fieldSeq.get(path) || 0) + 1;
    fieldSeq.set(path, seq);

    socket.send(JSON.stringify({
        type: 'change',
        sheetId: document.getElementById('charactersheet').dataset.sheetId,
        version: ++globalVersion,
        path: path,
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
        sheetId: document.getElementById('charactersheet').dataset.sheetId,
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

// Listen for messages
socket.addEventListener('message', e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'newCharacterItem') {
        console.log(msg)
    }

    if (msg.type === 'createItem') {
        // re-emit as a bubbling event so any grid can catch it
        getRoot().dispatchEvent(new CustomEvent('createItemLocal', {
            detail: {
                gridId: msg.gridId,
                itemId: msg.itemId
            },
            bubbles: true
        }));
    }


    // TO DO: batch, change, delete
});

const newCharacter = document.getElementById("new-character")
newCharacter.addEventListener("click", function () {
    socket.send(JSON.stringify({
        type: 'newCharacter',
    }));
});

const players = document.getElementById('players');
players.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button');
    if (!btn || !players.contains(btn)) return;

    if (!btn.classList.contains('delete-sheet') && btn.dataset.action !== 'delete') return;

    const entry = btn.closest('.character-sheet-entry');
    if (!entry) return;

    const sheetId = entry.dataset.sheetId

    if (!sheetId) {
        console.warn('No sheet id found for delete button', entry);
        return;
    }

    const nameEl = entry.querySelector('.name a');
    const charName = nameEl ? nameEl.textContent.trim() : '(unnamed)';
    if (!confirm(`Delete ${charName}?`)) return;

    // prevent double sends
    if (btn.disabled || btn.classList.contains('deleting')) return;
    btn.disabled = true;
    btn.classList.add('deleting');

    const payload = {
        type: 'deleteCharacter',
        sheetID: String(sheetId)
    };
    const data = JSON.stringify(payload);
    socket.send(data);

    setTimeout(() => {
        btn.disabled = false;
        btn.classList.remove('deleting');
    }, 10_000);
});

// Attach Delegated Listeners ——————————————————

document.addEventListener("charactersheet_inserted", () => {
    const root = getRoot();
    if (!root) {
        return
    }
    root.addEventListener("input", handleInputEvent, true);
    root.addEventListener("change", handleChangeEvent, true);
    root.addEventListener("fieldsUpdated", handleBatchEvent, true);
    root.addEventListener('positionsChanged', handlePositionsChangedEvent, true);
});
