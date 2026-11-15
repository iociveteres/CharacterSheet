// Two tabs editing one sheet at once, with every delivery in a random order:
// the hub and the per-connection handlers of the server reorder answers and
// broadcasts (internal/roomws/hub.go), only a tab's own sends reach the server
// in order. Whatever the order, once everything is delivered both tabs must
// show what a reload would: the content of the server.
import { describe, expect, it } from "vitest";
import { signal } from "@preact/signals-core";
import { blackCrusade } from "./kinds/black_crusade";
import { createSheetActions, type SheetActions, type Transport } from "./core/actions";
import { createState } from "./core/state";
import { SheetUiState } from "./core/ui";
import { DragFreeze } from "./core/dragFreeze";
import { applyRemoteToState, readJson, sinkOf, type RemoteSheetMessage, type RemoteTarget } from "./core/remote";
import { ABSENT, SheetVersions, layoutOf, layoutsOf, movedTo, touches } from "./versions";
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

    /** Applies a message; returns its broadcast (null when nothing was written) or the code it is refused with. */
    apply(msg: Msg): Msg | "gone" | "destinationGone" | null {
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
            case "moveItemBetweenGrids": {
                const from = `${msg.fromPath}.${msg.itemId}`, to = `${msg.toPath}.${msg.itemId}`;
                const moved = getAt(this.content, segsOf(from));
                if (moved === undefined) return "gone";
                const destination = itemOf(segsOf(msg.toPath as string));
                if (destination.length && getAt(this.content, destination) === undefined) return "destinationGone";
                deleteAt(this.content, segsOf(from));
                deleteAt(this.content, segsOf(layoutOf(from)));
                setAt(this.content, segsOf(to), moved);
                setAt(this.content, segsOf(layoutOf(to)), msg.toPosition);
                // The real move writes twice: a delete, then a create.
                this.version += 2;
                return { ...msg, item: structuredClone(moved), version: this.version };
            }
            default:
                throw new Error(`unknown message ${msg.type}`);
        }
        return { ...msg, version: ++this.version };
    }
}

// — A tab ———————————————————————————————
// The transport mirrors network.ts: debounced edits by key, an edit sent at
// once flushes them first, and the versions learn of both.

type Inbound =
    | { kind: "response"; eventID: string; OK: boolean; version?: number; code?: string; item?: unknown }
    | { kind: "broadcast"; msg: Msg };

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
        this.versions.sending(msg.eventID, touches(msg), movedTo(msg));
        this.outbox.push(msg);
    }

    receive(inbound: Inbound): void {
        if (inbound.kind === "broadcast") {
            applyRemoteToState(this, inbound.msg as unknown as RemoteSheetMessage);
            return;
        }
        const result = inbound.OK ? inbound.version ?? null : inbound.code === "gone" ? "gone" : null;
        this.versions.answer(inbound.eventID, result, sinkOf(this), inbound.item);
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
    /** A third tab, which only watches when its script is empty. */
    c?: ((tab: Tab) => void)[];
    /** The paths compared with the server's content once everything is delivered. */
    compare: string[];
}

function run(c: Case, seed: number): { server: Server; tabs: Tab[] } {
    const rand = mulberry32(seed);
    const pick = <T>(list: T[]): T => list[Math.floor(rand() * list.length)];
    const server = new Server(structuredClone(c.content));
    const scripts = c.c ? [c.a, c.b, c.c] : [c.a, c.b];
    const tabs = scripts.map((script, i) => new Tab("abc"[i], c.content, server.version, [...script]));

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
                    if (result === "gone" || result === "destinationGone") {
                        tab.inbox.push({ kind: "response", eventID: msg.eventID, OK: false, code: result });
                    } else if (result?.type === "autocompleteApplied") {
                        // The server sends it to every tab, the author's included, and no answer.
                        for (const t of tabs) t.inbox.push({ kind: "broadcast", msg: result });
                    } else if (result) {
                        tab.inbox.push({ kind: "response", eventID: msg.eventID, OK: true, version: result.version as number, item: result.item });
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

const TRAITS = "traits.list.items";
const TR1 = "traits.list.items.t1";
const withTraits = { ...twoTalents, traits: { list: { items: {}, layouts: {} } } };

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

    it("agree on a moved item and edits of it at both places", () => {
        const outcomes = check({
            name: "move vs field change",
            content: withTraits,
            a: [
                onItem(T1, t => t.actions.moveItemBetweenGrids(GRID, TRAITS, "t1", pos(0, 0))),
                onItem(TR1, t => t.actions.change(`${TR1}.name`, "A")),
            ],
            b: [
                onItem(T1, t => t.actions.change(`${T1}.name`, "B")),
                onItem(T1, t => t.actions.change(`${T1}.description`, "Bd")),
                onItem(TR1, t => t.actions.change(`${TR1}.description`, "B2")),
            ],
            // Gets the move and B's edits of the old place in any order.
            c: [],
            compare: [TR1, "talents.list", "traits.list"],
        });
        // Some orders carry B's edit of the old place into the moved item.
        expect(outcomes.some(o => (o as Json).description === "Bd")).toBe(true);
    });

    it("agree on a moved item someone deletes, and nothing brings it back", () => {
        check({
            name: "move vs delete",
            content: withTraits,
            a: [onItem(T1, t => t.actions.moveItemBetweenGrids(GRID, TRAITS, "t1", pos(0, 0)))],
            b: [
                onItem(T1, t => t.actions.change(`${T1}.name`, "B")),
                onItem(T1, t => t.actions.deleteItem(T1)),
                onItem(TR1, t => t.actions.deleteItem(TR1)),
            ],
            c: [],
            compare: ["talents.list", "traits.list"],
        });
    });

    it("agree on an item moved between grids of two items and edits inside it", () => {
        const C1 = "conditions.list.items.c1", C2 = "conditions.list.items.c2";
        const E1 = `${C1}.entries.items.e1`, E1moved = `${C2}.entries.items.e1`;
        check({
            name: "nested move vs field change",
            content: {
                conditions: {
                    list: {
                        items: {
                            c1: { name: "C1", enabled: true, stacks: 1, entries: { items: { e1: { type: "char_cap", name: "WS", cap: "10" } }, layouts: { e1: pos(0, 0) } } },
                            c2: { name: "C2", enabled: true, stacks: 1, entries: { items: {}, layouts: {} } },
                        },
                        layouts: { c1: pos(0, 0), c2: pos(0, 1) },
                    },
                },
            },
            a: [
                onItem(E1, t => t.actions.moveItemBetweenGrids(`${C1}.entries.items`, `${C2}.entries.items`, "e1", pos(0, 0))),
                onItem(E1moved, t => t.actions.change(`${E1moved}.cap`, "30")),
            ],
            b: [
                onItem(E1, t => t.actions.change(`${E1}.cap`, "20")),
                onItem(E1, t => t.actions.change(`${E1}.name`, "BS")),
                onItem(E1moved, t => t.actions.change(`${E1moved}.name`, "Ag")),
            ],
            c: [],
            compare: ["conditions.list"],
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
