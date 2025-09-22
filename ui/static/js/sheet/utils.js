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


/**
 * Listens for *remote* create-item messages from the server
 * and re-emits them as a DOM event on the correct container.
 *
 * @param {{ socket: WebSocket }} options
 */
export function initCreateItemReceiver({ socket }) {
    socket.addEventListener('message', msgEvent => {
        let msg;
        try { msg = JSON.parse(msgEvent.data); }
        catch { return; }
        if (msg.type !== 'create-item') return;

        const target = document.getElementById(msg.gridId);
        if (!target) return;

        target.dispatchEvent(new CustomEvent('remote-create-item', {
            bubbles: true,
            detail: { itemId: msg.itemId }
        }));
    });
}


/**
 * Listens for WS “delete-item” messages and re-emits them
 * as `remote-delete-item` on the correct container.
 *
 * @param {{ socket: { addEventListener: fn } }} options
 */
export function initDeleteItemReceiver({ socket = mockSocket }) {
    socket.addEventListener('message', msgEvent => {
        let msg;
        try { msg = JSON.parse(msgEvent.data); }
        catch { return; }
        if (msg.type !== 'delete-item') return;

        const target = document.getElementById(msg.gridId);
        if (!target) return;

        target.dispatchEvent(new CustomEvent('remote-delete-item', {
            bubbles: true,
            detail: { itemId: msg.itemId }
        }));
    });
}

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

export function getDataPathParent(el) {
    const fullPath = getDataPath(el) || '';
    const idx = fullPath.lastIndexOf('.');
    return idx === -1 ? '' : fullPath.slice(0, idx);
}

export function getDataPathLeaf(el) {
    const fullPath = getDataPath(el) || '';
    const idx = fullPath.lastIndexOf('.');
    return idx === -1 ? fullPath : fullPath.slice(idx + 1);
}