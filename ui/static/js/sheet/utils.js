export function getRoot() {
    const el = document.getElementById('charactersheet');
    return el ? el.shadowRoot : null;
}


export function getTemplateInnerHTML(templateId) {
    const template = document.getElementById(templateId);
    if (!template || !(template instanceof HTMLTemplateElement)) {
        throw new Error(`Element with id "${templateId}" is not a <template>.`);
    }

    return Array.from(template.content.childNodes)
        .map(node => node.outerHTML ?? node.textContent)
        .join('');
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

export function getDataPathLeaf(path) {
    const fullPath = getDataPath(path) || '';
    const idx = fullPath.lastIndexOf('.');
    return idx === -1 ? fullPath : fullPath.slice(idx + 1);
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

export function getContainerFromContainerPath(path) {
    const parts = path.split(".");
    if (parts.length === 1) return path; // no dots

    const last = parts[parts.length - 1];
    if (last === "tabs" && parts.length >= 2) {
        return parts[parts.length - 2]; // second last part
    }
    return last;
}

export function getContainerFromChildPath(path) {
    const parts = path.split(".");
    if (parts.length < 2) return path; // not enough dots

    const secondLast = parts[parts.length - 2];

    if (secondLast === "tabs" && parts.length >= 3) {
        return parts[parts.length - 3]; // third last
    }

    return secondLast; // normal case
}

export function findElementByPath(path) {
    const parts = path.split(".");
    let current = getRoot();
    if (!current) return null;

    for (const part of parts) {
        if (!part) continue; // skip empty segments
        current = current.querySelector(`[data-id="${part}"]`);
        if (!current) return null;
    }

    return current;
}

export function applyBatch(map, element) {
    for (const [key, value] of Object.entries(map)) {
        if (!key) continue;
        const el = element.querySelector(`[data-id="${key}"]`);
        if (!el) continue;

        if (el instanceof HTMLInputElement) {
            const type = (el.type || "").toLowerCase();

            if (type === "checkbox" || type === "radio") {
                el.checked = Boolean(value);
            } else if (type === "number") {
                // set numeric inputs safely:
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
                el.value = value == null ? "" : String(value);
            }

        } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
            el.value = value == null ? "" : String(value);

        } else if (el.isContentEditable) {
            el.textContent = value == null ? "" : String(value);

        } else {
            el.textContent = value == null ? "" : String(value);
        }
    }
}