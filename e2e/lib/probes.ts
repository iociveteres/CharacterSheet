// What every test page gets before its own scripts run: a record of the
// WebSocket traffic and of the rolls the sheet asks for, and helpers that find
// sheet elements by their data-id path. Playwright serializes installProbes,
// so it must not reference anything outside itself.

export type Msg = { type: string; [key: string]: any };

export type Roll =
    | { kind: "versus"; target: number; bonusSuccesses: number; label: string }
    | { kind: "exact"; expression: string; label: string };

/** Picks sheet elements, see Probes.find. */
export interface Query {
    /** data-id path of the element; the sheet root without it. */
    path?: string;
    /** CSS selector inside the element at `path` (`:scope > …` for direct children). */
    sel?: string;
    /** Index among the matches. */
    nth?: number;
    /** Keeps matches whose whitespace-free text is this. */
    text?: string;
}

export interface Probes {
    sent: Msg[];
    received: Msg[];
    rolls: Roll[];
    /** Roll commands the room posts to the chat are recorded but not sent. */
    blockRolls: boolean;
    /** Sheets inserted so far, counted once their blocks have rendered. */
    inserted: number;
    socketOpen(): boolean;
    root(): ShadowRoot;
    pathOf(el: Element): string;
    find(q: Query): Element | null;
    findAll(q: Query): Element[];
    fields(path: string): (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[];
    read(path: string): unknown;
    write(path: string, value: unknown): void;
    layout(gridPath: string): string[][];
}

declare global {
    interface Window {
        __e2e: Probes;
    }
}

export function installProbes(): void {
    const sent: Msg[] = [];
    const received: Msg[] = [];
    const rolls: Roll[] = [];
    const sockets: WebSocket[] = [];

    const parse = (data: unknown): Msg[] => String(data).split("\n").filter(s => s.trim()).map(s => {
        try {
            return JSON.parse(s);
        } catch {
            return { type: "(unparsed)", raw: s };
        }
    });

    const NativeWebSocket = window.WebSocket;
    class RecordedWebSocket extends NativeWebSocket {
        constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            sockets.push(this);
            this.addEventListener("message", e => received.push(...parse(e.data)));
        }

        send(data: Parameters<WebSocket["send"]>[0]) {
            const msgs = parse(data);
            sent.push(...msgs);
            const isRoll = msgs.some(m => m.type === "chatMessage" && String(m.messageBody).startsWith("/r "));
            if (probes.blockRolls && isRoll) return;
            super.send(data);
        }
    }
    window.WebSocket = RecordedWebSocket as typeof WebSocket;

    document.addEventListener("sheet:rollVersus", e => {
        const d = (e as CustomEvent).detail;
        rolls.push({ kind: "versus", target: d.target, bonusSuccesses: d.bonusSuccesses, label: d.label });
    });
    document.addEventListener("sheet:rollExact", e => {
        const d = (e as CustomEvent).detail;
        rolls.push({ kind: "exact", expression: d.expression, label: d.label });
    });

    // The sheet mounts its blocks in a later listener of the same event.
    document.addEventListener("charactersheet_inserted", () => {
        requestAnimationFrame(() => setTimeout(() => { probes.inserted++; }, 0));
    });

    const root = () => {
        const r = document.getElementById("charactersheet")?.shadowRoot;
        if (!r) throw new Error("No sheet on the page");
        return r;
    };

    // The same path network.js sends (getDataPath in ui/static/js/sheet/utils.js).
    const pathOf = (el: Element): string => {
        const parts: string[] = [];
        let node: Element | null = el;
        while (node) {
            const id = (node as HTMLElement).dataset?.id;
            if (id) parts.unshift(id);
            node = node.parentElement;
        }
        const label = el.closest("label") as HTMLElement | null;
        const labelId = label?.dataset.id;
        if (labelId && !parts.includes(labelId)) {
            if (parts.length > 0) {
                const leaf = parts.pop()!;
                parts.push(labelId, leaf);
            } else {
                parts.push(labelId);
            }
        }
        return Array.from(new Set(parts)).join(".");
    };

    const squash = (s: string | null) => (s ?? "").replace(/\s+/g, "");

    const findAll = (q: Query): Element[] => {
        const r = root();
        let scopes: ParentNode[] = [r];
        if (q.path) {
            scopes = Array.from(r.querySelectorAll("[data-id]")).filter(el => pathOf(el) === q.path);
            if (!q.sel) scopes = scopes.slice(0, 1);
        }
        let out: Element[] = q.sel
            ? scopes.flatMap(s => Array.from(s.querySelectorAll(q.sel!)))
            : scopes as Element[];
        if (q.text !== undefined) out = out.filter(el => squash(el.textContent) === squash(q.text!));
        return q.nth === undefined ? out : out.slice(q.nth, q.nth + 1);
    };

    const fields = (path: string) =>
        (Array.from(root().querySelectorAll("input[data-id], select[data-id], textarea[data-id]")) as
            (HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement)[])
            .filter(el => pathOf(el) === path);

    const read = (path: string): unknown => {
        const els = fields(path);
        if (els.length === 0) return undefined;
        const first = els[0];
        if (first instanceof HTMLInputElement && first.type === "radio") {
            return (els as HTMLInputElement[]).find(el => el.checked)?.value ?? null;
        }
        if (first instanceof HTMLInputElement && first.type === "checkbox") return first.checked;
        return first.value;
    };

    // An edit as the player makes it: the events network.js listens to on the sheet root.
    const write = (path: string, value: unknown): void => {
        const els = fields(path);
        if (els.length === 0) throw new Error(`No field at ${path}`);
        const first = els[0];
        if (first instanceof HTMLInputElement && first.type === "radio") {
            const radio = (els as HTMLInputElement[]).find(el => el.value === String(value));
            if (!radio) throw new Error(`No radio ${String(value)} at ${path}`);
            if (!radio.checked) radio.click();
            return;
        }
        if (first instanceof HTMLInputElement && first.type === "checkbox") {
            if (first.checked !== !!value) first.click();
            return;
        }
        first.focus();
        first.value = value === null || value === undefined ? "" : String(value);
        first.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
        first.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    };

    const layout = (gridPath: string): string[][] => {
        const grid = findAll({ path: gridPath })[0];
        if (!grid) throw new Error(`No grid at ${gridPath}`);
        return Array.from(grid.children)
            .filter(col => col.classList.contains("layout-column"))
            .map(col => Array.from(col.children)
                .filter(el => (el as HTMLElement).dataset.id && !el.classList.contains("sortable-fallback"))
                .map(el => (el as HTMLElement).dataset.id!));
    };

    const probes: Probes = {
        sent,
        received,
        rolls,
        blockRolls: false,
        inserted: 0,
        socketOpen: () => sockets.some(s => s.readyState === NativeWebSocket.OPEN),
        root,
        pathOf,
        find: q => findAll(q)[0] ?? null,
        findAll,
        fields,
        read,
        write,
        layout,
    };
    window.__e2e = probes;
}
