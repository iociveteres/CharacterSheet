// Two tabs editing one sheet at once, with every delivery in a random order:
// the hub and the per-connection handlers of the server reorder answers and
// broadcasts (internal/roomws/hub.go), only a tab's own sends reach the server
// in order. Whatever the order, once everything is delivered both tabs must
// show what a reload would: the content of the server.
import { describe, expect, it } from "vitest";
import { signal } from "@preact/signals-core";
import { blackCrusade } from "./kinds/black_crusade";
import { createSheetActions, type SheetActions, type Transport } from "./state/actions";
import { createState } from "./state/state";
import { SheetUiState } from "./state/ui";
import { DragFreeze } from "./state/dragFreeze";
import { applyRemoteToState, readJson, sinkOf, type RemoteSheetMessage, type RemoteTarget } from "./state/remote";
import { ABSENT, SheetVersions, layoutOf, layoutsOf, touches } from "./versions";
import type { SheetSignals } from "./schema/sheet";

type Json = { [key: string]: unknown };
type Msg = Json & { type: string; eventID: string; path: string };

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

function mulberry32(seed: number): () => number {
    return () => {
        seed |= 0;
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// — The server ——————————————————————————
// The JSONB writes of internal/models/character_sheets_content.go on plain JSON.

const segsOf = (path: string) => path.split(".");

function getAt(content: Json, segs: string[]): unknown {
    let cur: unknown = content;
    for (const s of segs) {
        if (cur === null || typeof cur !== "object" || !(s in cur)) return undefined;
        cur = (cur as Json)[s];
    }
    return cur;
}

/** jsonb_ensure_path + jsonb_set */
function setAt(content: Json, segs: string[], value: unknown): void {
    let cur = content;
    for (const s of segs.slice(0, -1)) {
        if (cur[s] === null || typeof cur[s] !== "object") cur[s] = {};
        cur = cur[s] as Json;
    }
    cur[segs.at(-1)!] = structuredClone(value);
}

function deleteAt(content: Json, segs: string[]): void {
    const parent = getAt(content, segs.slice(0, -1));
    if (parent && typeof parent === "object") delete (parent as Json)[segs.at(-1)!];
}

/** itemOf in character_sheets_content.go: the innermost grid item on the path. */
function itemOf(segs: string[]): string[] {
    for (let i = segs.length - 2; i >= 0; i--) if (segs[i] === "items") return segs.slice(0, i + 2);
    return [];
}

const ENTRY = { name: "Iron Will", description: "From the book" };

class Server {
    version = 1;
    constructor(public content: Json) {}

    /** Applies a message; returns its broadcast (null when nothing was written) or "gone". */
    apply(msg: Msg): Msg | "gone" | null {
        const segs = segsOf(msg.path ?? "");
        const item = itemOf(segs);
        const goneInside = () => item.length > 0 && getAt(this.content, item) === undefined;
        switch (msg.type) {
            case "change":
                if (goneInside()) return "gone";
                setAt(this.content, segs, msg.change);
                break;
            case "batch":
                if (goneInside()) return "gone";
                setAt(this.content, segs, { ...(getAt(this.content, segs) as Json ?? {}), ...(msg.changes as Json) });
                break;
            case "autocompleteApply": {
                if (goneInside()) return "gone";
                const changes = { ...(msg.base as Json), ...ENTRY };
                setAt(this.content, segs, changes);
                return { type: "autocompleteApplied", eventID: msg.eventID, path: msg.path, changes, version: ++this.version };
            }
            case "createItem":
                setAt(this.content, [...segs, msg.itemId as string], msg.init ?? {});
                setAt(this.content, segsOf(layoutOf(`${msg.path}.${msg.itemId}`)), msg.itemPos);
                break;
            case "deleteItem":
                deleteAt(this.content, segs);
                deleteAt(this.content, segsOf(layoutOf(msg.path)));
                break;
            case "positionsChanged":
                setAt(this.content, segsOf(layoutsOf(msg.path)), msg.positions ?? {});
                break;
            default:
                throw new Error(`unknown message ${msg.type}`);
        }
        return { ...msg, version: ++this.version };
    }
}

// — A tab ———————————————————————————————
// The transport mirrors network.ts: debounced edits by key, an edit sent at
// once flushes them first, and the versions learn of both.

type Inbound = { kind: "response"; eventID: string; OK: boolean; version?: number; code?: string } | { kind: "broadcast"; msg: Msg };

class Tab implements RemoteTarget {
    state: SheetSignals;
    ui = new SheetUiState();
    freeze = new DragFreeze();
    portrait = signal<string | null>(null);
    versions: SheetVersions;
    actions: SheetActions;
    outbox: Msg[] = [];
    inbox: Inbound[] = [];
    timers = new Map<string, Msg>();
    failures: string[] = [];
    private nextID = 0;

    constructor(public name: string, content: Json, version: number, public script: ((tab: Tab) => void)[]) {
        this.state = createState(blackCrusade, structuredClone(content));
        this.versions = new SheetVersions(version);
        const stamp = (msg: object) => ({ ...msg, eventID: `${name}${++this.nextID}` }) as Msg;
        const transport: Transport = {
            send: msg => {
                for (const key of [...this.timers.keys()]) this.fire(key);
                this.push(stamp(msg));
            },
            schedule: (msg, key) => {
                this.versions.schedule(key, touches(msg), () => this.timers.delete(key));
                this.timers.set(key, stamp(msg));
            },
            portrait: () => Promise.resolve(),
        };
        this.actions = createSheetActions(this.state, "black_crusade", transport);
    }

    fire(key: string): void {
        const msg = this.timers.get(key)!;
        this.timers.delete(key);
        this.versions.unschedule(key);
        this.push(msg);
    }

    private push(msg: Msg): void {
        this.versions.sending(msg.eventID, touches(msg));
        this.outbox.push(msg);
    }

    receive(inbound: Inbound): void {
        if (inbound.kind === "broadcast") {
            applyRemoteToState(this, inbound.msg as unknown as RemoteSheetMessage);
            return;
        }
        this.versions.answer(inbound.eventID, inbound.OK ? inbound.version ?? null : null, sinkOf(this));
        if (!inbound.OK && inbound.code !== "gone") this.failures.push(inbound.code ?? "internal");
    }

    has(path: string): boolean {
        return readJson(this.state, path) !== ABSENT;
    }
}

// — The run —————————————————————————————

interface Case {
    name: string;
    content: Json;
    a: ((tab: Tab) => void)[];
    b: ((tab: Tab) => void)[];
    /** The paths compared with the server's content once everything is delivered. */
    compare: string[];
}

function run(c: Case, seed: number): { server: Server; tabs: Tab[] } {
    const rand = mulberry32(seed);
    const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
    const server = new Server(structuredClone(c.content));
    const tabs = [new Tab("a", c.content, server.version, [...c.a]), new Tab("b", c.content, server.version, [...c.b])];

    for (let steps = 0; ; steps++) {
        if (steps > 10_000) throw new Error("the run does not end");
        const moves: (() => void)[] = [];
        for (const tab of tabs) {
            if (tab.script.length) moves.push(() => tab.script.shift()!(tab));
            for (const key of tab.timers.keys()) moves.push(() => tab.fire(key));
            if (tab.outbox.length) {
                moves.push(() => {
                    const msg = tab.outbox.shift()!;
                    const result = server.apply(msg);
                    const others = tabs.filter(t => t !== tab);
                    if (result === "gone") {
                        tab.inbox.push({ kind: "response", eventID: msg.eventID, OK: false, code: "gone" });
                    } else if (result?.type === "autocompleteApplied") {
                        // The server sends it to every tab, the author's included, and no answer.
                        for (const t of tabs) t.inbox.push({ kind: "broadcast", msg: result });
                    } else if (result) {
                        tab.inbox.push({ kind: "response", eventID: msg.eventID, OK: true, version: result.version as number });
                        for (const t of others) t.inbox.push({ kind: "broadcast", msg: result });
                    }
                });
            }
            if (tab.inbox.length) {
                moves.push(() => {
                    const i = Math.floor(rand() * tab.inbox.length);
                    tab.receive(tab.inbox.splice(i, 1)[0]);
                });
            }
        }
        if (!moves.length) break;
        pick(moves)();
    }
    return { server, tabs };
}

/**
 * `value` without the positions of items its grids lack. A position can
 * outlive its item, on the server too: positionsChanged sent before the
 * deletion reached the tab that dragged. Nothing renders it, and a reload
 * drops it (normalizeSheet).
 */
function withoutGhosts(value: unknown): unknown {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const obj = Object.fromEntries(Object.entries(value).map(([key, child]) => [key, withoutGhosts(child)])) as Json;
    if (obj.items && obj.layouts && typeof obj.layouts === "object") {
        obj.layouts = Object.fromEntries(Object.entries(obj.layouts as Json).filter(([id]) => id in (obj.items as Json)));
    }
    return obj;
}

/** Runs the case with many orders; returns what the server ended with at `path`, by seed. */
function check(c: Case, seeds = 300): unknown[] {
    const outcomes: unknown[] = [];
    for (let seed = 1; seed <= seeds; seed++) {
        const { server, tabs } = run(c, seed);
        const reloaded = createState(blackCrusade, withoutGhosts(server.content));
        for (const tab of tabs) {
            expect(tab.failures, `seed ${seed}, tab ${tab.name}`).toEqual([]);
            for (const path of c.compare) {
                expect(withoutGhosts(readJson(tab.state, path)), `seed ${seed}, tab ${tab.name}, ${path}`).toEqual(readJson(reloaded, path));
            }
        }
        outcomes.push(readJson(reloaded, c.compare[0]));
    }
    return outcomes;
}

const talents = (items: Json, layouts: Json) => ({ talents: { list: { items, layouts } } });
const T1 = "talents.list.items.t1";
const T2 = "talents.list.items.t2";
const T3 = "talents.list.items.t3";
const GRID = "talents.list.items";
const twoTalents = talents({ t1: { name: "T1", description: "D1" }, t2: { name: "T2" } }, { t1: pos(0, 0), t2: pos(0, 1) });

/** A tab acts on an item only while it shows it, as a user does. */
const onItem = (item: string, act: (tab: Tab) => void) => (tab: Tab) => {
    if (tab.has(item)) act(tab);
};

describe("two tabs editing one sheet, whatever order the server's messages come in", () => {
    it("agree on a field both type into", () => {
        const outcomes = check({
            name: "same field",
            content: twoTalents,
            a: [t => t.actions.change(`${T1}.name`, "A1"), t => t.actions.change(`${T1}.name`, "A2")],
            b: [t => t.actions.change(`${T1}.name`, "B1"), t => t.actions.change(`${T1}.name`, "B2")],
            compare: [`${T1}.name`],
        });
        // The orders differ enough for either tab to win.
        expect(new Set(outcomes)).toEqual(new Set(["A2", "B2"]));
    });

    it("agree on a batch and a change of one of its keys", () => {
        const outcomes = check({
            name: "batch vs change",
            content: twoTalents,
            a: [t => t.actions.batch(T1, { name: "A", description: "Ad" })],
            b: [t => t.actions.change(`${T1}.name`, "B"), t => t.actions.change(`${T1}.description`, "Bd")],
            compare: [T1],
        });
        expect(new Set(outcomes.map(o => (o as Json).name))).toEqual(new Set(["A", "B"]));
    });

    it("agree on an autocomplete of an item and edits of its fields", () => {
        check({
            name: "autocomplete vs field change",
            content: twoTalents,
            a: [
                onItem(T1, t => t.actions.autocompleteApply(T1, "talents", "Iron Will")),
                onItem(T1, t => t.actions.change(`${T1}.description`, "Ad")),
            ],
            b: [
                onItem(T1, t => t.actions.change(`${T1}.name`, "B")),
                onItem(T1, t => t.actions.change(`${T1}.description`, "Bd")),
            ],
            compare: [T1],
        });
    });

    it("agree on a deleted item and edits inside it, and nothing brings it back", () => {
        const outcomes = check({
            name: "delete vs field change",
            content: twoTalents,
            a: [onItem(T1, t => t.actions.deleteItem(T1))],
            b: [
                onItem(T1, t => t.actions.change(`${T1}.name`, "B")),
                onItem(T2, t => t.actions.change(`${T2}.name`, "B2")),
                onItem(T1, t => t.actions.batch(T1, { description: "Bd" })),
            ],
            compare: [T1, "talents.list"],
        });
        expect(outcomes.every(o => o === ABSENT)).toBe(true);
    });

    it("agree on positions and an item created meanwhile", () => {
        check({
            name: "positions vs create",
            content: twoTalents,
            a: [
                t => t.actions.positionsChanged(GRID, { ...readJson(t.state, layoutsOf(GRID)) as Json, t1: pos(1, 0) }),
                t => t.actions.positionsChanged(GRID, { ...readJson(t.state, layoutsOf(GRID)) as Json, t2: pos(1, 1) }),
            ],
            b: [
                t => t.actions.createItem(GRID, "t3", { name: "New" }, pos(0, 2)),
                onItem(T3, t => t.actions.change(`${T3}.name`, "Newer")),
            ],
            compare: ["talents.list"],
        });
    });

    it("agree on a grid a batch replaces and edits inside its items", () => {
        const C1 = "conditions.list.items.c1";
        check({
            name: "grid batch vs nested edits",
            content: {
                conditions: {
                    list: {
                        items: { c1: { name: "C", enabled: true, stacks: 1, entries: { items: { e1: { type: "char_cap", name: "WS", cap: "10" } }, layouts: { e1: pos(0, 0) } } } },
                        layouts: { c1: pos(0, 0) },
                    },
                },
            },
            a: [
                t => t.actions.batch(C1, { entries: { items: { e2: { type: "char_cap", name: "BS", cap: "5" } }, layouts: { e2: pos(0, 0) } } }),
                t => t.actions.change(`${C1}.stacks`, 2),
            ],
            b: [
                onItem(`${C1}.entries.items.e1`, t => t.actions.change(`${C1}.entries.items.e1.cap`, "20")),
                onItem(`${C1}.entries.items.e2`, t => t.actions.change(`${C1}.entries.items.e2.cap`, "7")),
                t => t.actions.change(`${C1}.stacks`, 3),
            ],
            compare: [C1],
        });
    });

    it("agree on everything at once", () => {
        check({
            name: "mixed",
            content: twoTalents,
            a: [
                t => t.actions.change(`${T1}.name`, "A"),
                onItem(T2, t => t.actions.autocompleteApply(T2, "talents", "Iron Will")),
                t => t.actions.positionsChanged(GRID, { ...readJson(t.state, layoutsOf(GRID)) as Json, t1: pos(2, 0) }),
                onItem(T3, t => t.actions.deleteItem(T3)),
                t => t.actions.batch(T1, { name: "A2", description: "Ad" }),
            ],
            b: [
                t => t.actions.createItem(GRID, "t3", { name: "New" }, pos(0, 2)),
                onItem(T2, t => t.actions.change(`${T2}.name`, "B")),
                onItem(T1, t => t.actions.change(`${T1}.description`, "Bd")),
                onItem(T3, t => t.actions.change(`${T3}.description`, "B3")),
                onItem(T1, t => t.actions.deleteItem(T1)),
            ],
            compare: ["talents.list"],
        });
    });
});
