export function getRoot() {
    const el = document.getElementById('charactersheet');
    return el ? el.shadowRoot : null;
}


export function getTemplateInnerHTML(templateId, replace) {
    const template = document.getElementById(templateId);
    if (!template || !(template instanceof HTMLTemplateElement)) {
        throw new Error(`Element with id "${templateId}" is not a <template>.`);
    }

    let html = Array.from(template.content.childNodes)
        .map(node => node.outerHTML ?? node.textContent)
        .join('');

    if (replace && typeof replace.from === 'string') {
        html = html.split(replace.from).join(replace.to ?? '');
    }

    return html;
}

export function getTemplateElement(templateId) {
    const template = document.getElementById(templateId);
    if (!template || !(template instanceof HTMLTemplateElement)) {
        throw new Error(`Element with id "${templateId}" is not a <template>.`);
    }

    // Clone and return the first element child (assumes one root node in the template)
    return template.content.firstElementChild.cloneNode(true);
}

/**
 * A mock socket that just logs send calls.
 */
export const mockSocket = {
    send(message) {
        console.log("[MockSocket] send:", message);
    }
};

// Build dot-path of all data-id ancestors up to <body>
export function getDataPath(el) {
    const parts = [];
    const root = (typeof getRoot === 'function') ? getRoot() : document;

    // 1) normal ancestor walk (outer -> inner)
    let node = el;
    while (node && node !== root && node !== document) {
        if (node.dataset && node.dataset.id) parts.unshift(node.dataset.id);
        node = node.parentElement;
    }

    // 2) if there's a label ancestor with data-id that wasn't captured, insert it
    const label = el.closest && el.closest('label');
    if (label && label.dataset && label.dataset.id && !parts.includes(label.dataset.id)) {
        // put the label id just before the leaf (so path becomes ...label.leaf)
        // if no leaf found, put at the end (safest)
        if (parts.length > 0) {
            const leaf = parts.pop();
            parts.push(label.dataset.id, leaf);
        } else {
            parts.push(label.dataset.id);
        }
    }

    // 3) final dedupe to be safe (preserve order outer->inner)
    const seen = new Set();
    const finalParts = [];
    for (const p of parts) {
        if (!seen.has(p)) {
            seen.add(p);
            finalParts.push(p);
        }
    }

    return finalParts.join('.');
}

export function getDataPathParent(path) {
    const fullPath = getDataPath(path) || '';
    const idx = fullPath.lastIndexOf('.');
    return idx === -1 ? '' : fullPath.slice(0, idx);
}

function parseMaybeNumber(s) {
    if (s === "") return null;
    // integer?
    if (/^-?\d+$/.test(s)) return parseInt(s, 10);
    // float?
    if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);
    // not a number
    return s;
}

export function getChangeValue(el) {
    const tag = el.tagName;
    const type = el.type;

    if (tag === "INPUT") {
        if (type === "number") {
            // note: el.value is a string; convert to number or null
            return parseMaybeNumber(el.value);
        }
        if (type === "checkbox") {
            return el.checked;
        }
        if (type === "radio") {
            // send only the checked radio's value (caller should ensure event fires for the checked one)
            if (!el.checked) return undefined; // don't send anything if not checked
            return parseMaybeNumber(el.value);
        }
        // fallback for text inputs
        if (type === "text" || type === "search" || type === "email" || type === "tel" || type === "url") {
            return el.value;
        }
        // other input types -> fall back to raw value
        return el.value;
    }

    if (tag === "TEXTAREA") {
        return el.value;
    }

    if (tag === "SELECT") {
        if (el.multiple) {
            return Array.from(el.selectedOptions).map(opt => {
                return parseMaybeNumber(opt.value);
            });
        }
        return parseMaybeNumber(el.value);
    }

    // default fallback
    return el.value;
}

export const getGridFromPath = (() => {
    let cachedIds = null;

    function buildCache() {
        cachedIds = Array.from(getRoot().querySelectorAll(".item-grid"))
            .map(el => el.getAttribute("data-id"))
            .filter(Boolean)
    }

    return function (str) {
        if (typeof str !== "string" || !str.length) return null;
        if (cachedIds === null) buildCache();

        for (const id of cachedIds) {
            if (str.includes(id)) return id;
        }
        return null;
    };
})();

export function getLeafFromPath(path) {
    if (typeof path !== "string") return "";
    const parts = path.split(".");
    return parts[parts.length - 1] || "";
}

// Build dot-path of all data-id ancestors up to <body>
export function findElementByPath(path) {
    if (!path || typeof path !== "string") return null;

    const parts = path.split(".");
    const root = (typeof getRoot === "function") ? getRoot() : document;
    if (!root) return null;

    // recursive search: try to match parts[idx...] starting from `current`
    function searchFrom(current, idx) {
        if (idx >= parts.length) return current; // matched all parts
        const rawPart = parts[idx];
        if (!rawPart) return searchFrom(current, idx + 1);

        // 1) Try exact matches first (fast / common case)
        const exactCandidates = current.querySelectorAll(`[data-id="${rawPart}"]`);
        for (const cand of exactCandidates) {
            const res = searchFrom(cand, idx + 1);
            if (res) return res;
        }

        // 2) Then try elements whose data-id contains dots (e.g. "powers.items")
        //    We only accept the candidate if its split parts match the next path segments exactly.
        const dotCandidates = current.querySelectorAll('[data-id*="."]');
        for (const cand of dotCandidates) {
            const candRaw = cand.getAttribute("data-id");
            if (!candRaw) continue;
            const candParts = candRaw.split(".");
            // If the candidate has more logical parts than we have remaining, skip
            if (candParts.length > parts.length - idx) continue;

            // Check all candidate parts match the corresponding path parts
            let ok = true;
            for (let i = 0; i < candParts.length; i++) {
                if (candParts[i] !== parts[idx + i]) { ok = false; break; }
            }
            if (!ok) continue;

            // Advance idx by the number of logical parts this element represents
            const res = searchFrom(cand, idx + candParts.length);
            if (res) return res;
        }

        return null; // no candidate led to a full match
    }

    return searchFrom(root, 0);
}

// If only I'd knew how to do this better
// I decided to let label and panel share data, so they have same path.
// It's convenient for the db update, and logically it's one piece of data.
// But it makes getting right element from selector a mess,
// so I decided to reverse logic here, first find fields, then match them with data.
export function applyBatch(container, map) {
    if (!container || !map || typeof map !== "object") return;

    // Build: data-id -> [elements...]
    const elementsById = buildShallowElementsById(container);

    const isPlainObject = v => v !== null && typeof v === "object" && !Array.isArray(v);

    // Iterate DOM-first: for each id actually present in the container
    for (const [id, nodes] of elementsById.entries()) {
        // only act if incoming map has this key
        if (!Object.prototype.hasOwnProperty.call(map, id)) continue;

        const value = map[id];

        if (isPlainObject(value)) {
            // only recurse into nodes that actually contain nested [data-id] children
            for (const node of nodes) {
                if (node.querySelector && node.querySelector("[data-id]")) {
                    applyBatch(node, value);
                } else {
                    // node is a leaf form-control
                }
            }
        } else {
            // Primitive
            for (const node of nodes) {
                setFormValue(node, value);
            }
        }
    }
}

function buildShallowElementsById(container) {
    const m = new Map();
    const all = container.querySelectorAll("[data-id]");

    for (const el of all) {
        // skip elements that are inside another [data-id] element (still inside container)
        let p = el.parentElement;
        let skip = false;
        while (p && p !== container) {
            if (p.hasAttribute && p.hasAttribute("data-id")) { skip = true; break; }
            p = p.parentElement;
        }
        if (skip) continue;

        const id = el.getAttribute("data-id");
        if (!id) continue;
        const arr = m.get(id);
        if (arr) arr.push(el); else m.set(id, [el]);
    }

    return m;
}

function setFormValue(el, value) {
    const str = value == null ? "" : String(value);

    if (el instanceof HTMLInputElement) {
        const type = (el.type || "").toLowerCase();

        if (type === "checkbox" || type === "radio") {
            el.checked = Boolean(value);
        } else if (type === "number") {
            if (value == null || value === "") {
                el.value = "";
            } else {
                const n = Number(value);
                if (Number.isFinite(n)) {
                    el.valueAsNumber = n;
                } else {
                    el.value = "";
                }
            }
        } else {
            el.value = str;
        }

    } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        el.value = str;

    } else if (el.isContentEditable) {
        el.textContent = str;

    } else {
        el.textContent = str;
    }
}

export function applyPositions(container, positions) {
    // group by column
    const groups = {};
    for (const [id, pos] of Object.entries(positions)) {
        if (!pos || typeof pos.colIndex === "undefined" || typeof pos.rowIndex === "undefined") continue;
        const col = String(pos.colIndex);
        (groups[col] || (groups[col] = [])).push({ id, row: Number(pos.rowIndex) });
    }

    // sort rows within each column
    for (const col in groups) groups[col].sort((a, b) => a.row - b.row);

    const cols = Object.keys(groups).sort((a, b) => Number(a) - Number(b));

    for (const colKey of cols) {
        const colEl = container.querySelector(`.layout-column[data-column="${colKey}"]`);
        if (!colEl) continue;

        const addSlot = colEl.querySelector(".add-slot");
        if (!addSlot) continue;

        for (const item of groups[colKey]) {
            const el = container.querySelector(`[data-id="${item.id}"]`);
            if (!el) continue;
            colEl.insertBefore(el, addSlot);
        }
    }
}

export function stripBrackets(v) {
    if (v == null) return '';
    v = String(v).trim();
    if (v.startsWith('[')) v = v.slice(1);
    if (v.endsWith(']')) v = v.slice(0, -1);
    return v;
}