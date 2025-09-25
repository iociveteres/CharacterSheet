// network.js

import {
    mockSocket,
    getRoot,
    getDataPath,
    getDataPathLeaf
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
        const path = getDataPath(el);
        const msg = JSON.stringify({
            type: 'change',
            sheetId: document.getElementById('charactersheet').dataset.sheetId,
            version: ++globalVersion,
            path: path,
            change: el.value,
        });
        schedule(msg, path);
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
    let changes = el.value;
    if (type === 'number') changes = Number(changes);

    // Compute fullPath & parent container
    const path = getDataPath(el);

    const msg = JSON.stringify({
        type: 'batch',
        sheetID: document.getElementById('charactersheet').dataset.sheetId,
        version: ++globalVersion,
        path: path,
        changes: changes,
    });
    schedule(msg, path);
}

function handleBatchEvent(e) {
    // from your paste handler or other component
    const path = getDataPath(e.target);
    const changes = e.detail.changes;

    const msg = JSON.stringify({
        type: 'batch',
        sheetID: document.getElementById('charactersheet').dataset.sheetId,
        version: ++globalVersion,
        path: path,
        changes: changes,
    });
    schedule(msg, path);
}

function handlePositionsChangedEvent(e) {
    const path = getDataPathLeaf(e.target);
    const positions = e.detail.positions;

    const msg = JSON.stringify({
        type: 'positionsChanged',
        sheetId: document.getElementById('charactersheet').dataset.sheetId,
        version: ++globalVersion,
        path: path,
        positions: positions
    });
    schedule(msg, path);
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
                path: msg.gridId,
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
