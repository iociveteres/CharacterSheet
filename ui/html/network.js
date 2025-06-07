// Mock WebSocket
const socket = {
    send(msg) {
        console.log("WS send:", msg);
    }
};

const root = document;

let globalVersion = 0;
const fieldSeq = new Map();  // path -> seq
const lastValue = new Map(); // path -> last known value
const changedFields = new Map();
let batchTimer = null;

// Patch debounce per field
const patchTimers = new Map();

// You can replace this with diff-match-patch for real diffing
function createTextPatch(oldVal, newVal) {
    // Simple patch fallback: replace entire value
    return JSON.stringify({ from: oldVal, to: newVal });
}

function sendFieldsMessage() {
    if (changedFields.size === 0) return;

    const changes = Array.from(changedFields.entries()).map(([path, value]) => ({ path, value }));
    globalVersion++;
    socket.send(JSON.stringify({
        type: 'fields',
        version: globalVersion,
        changes
    }));

    changedFields.clear();
    batchTimer = null;
}

function scheduleFieldsMessage(path, value) {
    changedFields.set(path, value);
    if (batchTimer) clearTimeout(batchTimer);
    batchTimer = setTimeout(sendFieldsMessage, 50);
}

function sendPatchMessage(path, oldVal, newVal) {
    const patch = createTextPatch(oldVal, newVal);
    const seq = (fieldSeq.get(path) || 0) + 1;
    fieldSeq.set(path, seq);
    globalVersion++;

    socket.send(JSON.stringify({
        type: 'patch',
        version: globalVersion,
        path,
        patch,
        seq
    }));

    lastValue.set(path, newVal);
}

function schedulePatch(path, newVal) {
    if (patchTimers.has(path)) clearTimeout(patchTimers.get(path));

    const oldVal = lastValue.get(path) ?? "";

    patchTimers.set(path, setTimeout(() => {
        sendPatchMessage(path, oldVal, newVal);
        patchTimers.delete(path);
    }, 200));
}

function getDataPath(el) {
    let path = [];
    while (el && el !== root) {
        if (el.hasAttribute("data-id")) {
            path.unshift(el.getAttribute("data-id"));
        }
        el = el.parentElement;
    }
    return path.join(".");
}

function handleChange(e) {
    const el = e.target;
    if (!el.hasAttribute("data-id")) return;

    const tag = el.tagName.toLowerCase();
    const type = el.type;

    let value = el.value;
    const path = getDataPath(el);

    // Numeric inputs
    if (type === "number") value = Number(value);

    // Determine if part of multi-change batch
    if (e.isTrusted && (tag === "input" || tag === "textarea")) {
        // User-typed input — use patching
        if (typeof value === "string") {
            schedulePatch(path, value);
            return;
        }
    }

    // Otherwise, send as batch field change
    scheduleFieldsMessage(path, value);
}

// Attach listener via delegation
root.addEventListener("change", handleChange);
root.addEventListener("input", handleChange); // for real-time typing
