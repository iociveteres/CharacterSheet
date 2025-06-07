// network.js

// — Mock WebSocket — replace with your real ws instance
const socket = {
    send(msg) { console.log("WS send:", msg); }
};

// — State & Versioning ——————————————————
let globalVersion = 0;
const fieldSeq = new Map(); // per-field seq
const lastValue = new Map(); // last text per-field

// — Batch Update State ——————————————————
let batchTimer = null;
let batchPath = null;         // container path for batch
const changedFields = new Map(); // Map<fieldKey, value>

// — Patch (typing) State —————————————————
const patchTimers = new Map();

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

// Split a full path into [containerPath, fieldKey]
function splitPath(fullPath) {
    const parts = fullPath.split(".");
    const key = parts.pop();
    const parent = parts.join(".");
    return [parent || null, key];
}

// Simple full-replacement “patch”
function createTextPatch(oldVal, newVal) {
    return JSON.stringify({ from: oldVal, to: newVal });
}

// — Sending ———————————————————————————

// 1) Emit a batched fields message
function sendFieldsMessage() {
    if (!changedFields.size) return;

    const changes = Array.from(changedFields.entries())
        .map(([key, val]) => ({ field: key, val }));

    socket.send(JSON.stringify({
        type: 'batch',
        path: batchPath,               // container path
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
    if (containerPath && !batchPath) {
        batchPath = containerPath;
    }
    changedFields.set(key, value);

    clearTimeout(batchTimer);
    batchTimer = setTimeout(sendFieldsMessage, 50);
}

// 3) Emit a single-field patch message
function sendPatchMessage(fullPath, oldVal, newVal) {
    const [parent, key] = splitPath(fullPath);
    const patch = createTextPatch(oldVal, newVal);
    const seq = (fieldSeq.get(fullPath) || 0) + 1;
    fieldSeq.set(fullPath, seq);

    socket.send(JSON.stringify({
        type: 'patch',
        path: parent,                // container path
        version: ++globalVersion,
        field: key,                   // leaf field key
        patch,
        seq
    }));

    lastValue.set(fullPath, newVal);
}

// 4) Schedule a typing patch after debounce
function schedulePatch(fullPath, newVal) {
    clearTimeout(patchTimers.get(fullPath));
    const oldVal = lastValue.get(fullPath) || "";

    patchTimers.set(fullPath, setTimeout(() => {
        sendPatchMessage(fullPath, oldVal, newVal);
        patchTimers.delete(fullPath);
    }, 200));
}

// — Event Handlers ——————————————————————

function handleInput(e) {
    // Only for text inputs / textareas
    const el = e.target;
    if (!el.dataset?.id) return;
    const tag = el.tagName;
    if ((tag === "INPUT" && el.type !== "number") || tag === "TEXTAREA") {
        schedulePatch(getDataPath(el), el.value);
    }
}

function handleChange(e) {
    // Only for non-text fields
    let el = e.target;

    // If target is label, try finding input inside
    if (el.tagName === 'LABEL') {
        el = el.querySelector('input, textarea, select');
        if (!el) return;
    }


    if (!el.dataset?.id) return;
    const tag = el.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea") {
        // skip text inputs/textareas here
        return;
    }
    let value = el.value;
    if (el.type === "number") value = Number(value);

    scheduleFieldsMessage(getDataPath(el), value);
}

function handleFieldsUpdated(e) {
    // custom batch event from initPasteHandler, etc.
    const containerPath = getDataPath(e.target);
    for (let { path, value } of e.detail.changes) {
        scheduleFieldsMessage(path, value, containerPath);
    }
}

// — Attach Delegated Listeners ——————————————————

document.addEventListener("input", handleInput, true);
document.addEventListener("change", handleChange, true);
document.addEventListener("fields-updated", handleFieldsUpdated, true);
