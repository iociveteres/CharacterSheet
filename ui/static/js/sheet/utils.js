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

