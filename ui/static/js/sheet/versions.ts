// What a tab knows of the versions of one sheet (_prd/sheet_edit_versions):
// every content write on the server bumps the sheet's version under the row
// lock, and every edit reaches the tabs with it. Each path of the content is a
// last-writer-wins register stamped with the version that wrote it, so the
// tabs end up showing what the database has whatever order the messages come
// in: the hub and the handlers reorder them (internal/roomws/hub.go).
//
// Pure: it knows paths and JSON values, not signals. core/remote.ts reads and
// writes the state for it, network.ts tells it of own edits and their answers.

/** A value that is not there: a deleted item, a position the layouts lack. */
export const ABSENT: unique symbol = Symbol("absent");

/**
 * A write of `value` (JSON or ABSENT) at the dot path `path` of the content;
 * `creates` when it brings the item at `path` (createItem).
 */
export interface Part {
    path: string;
    value: unknown;
    creates?: boolean;
}

/**
 * How the record sees the state: the local value at a path (ABSENT without
 * one), whether there is one, and how a value it released is written.
 */
export interface Sink {
    read(path: string): unknown;
    has(path: string): boolean;
    write(part: Part): void;
}

type PlainObject = { [key: string]: unknown };

const isObject = (v: unknown): v is PlainObject => v !== null && typeof v === "object" && !Array.isArray(v);

/** Whether `a` is `b` or one of its ancestors. */
const covers = (a: string, b: string) => a === b || b.startsWith(`${a}.`);

const relative = (ancestor: string, path: string) => path.slice(ancestor.length + 1).split(".");

function getIn(value: unknown, rel: string[]): unknown {
    let cur = value;
    for (const key of rel) {
        if (!isObject(cur) || !(key in cur)) return ABSENT;
        cur = cur[key];
    }
    return cur;
}

/**
 * Whether the subtree `value` written at `path` lacks a grid item that
 * `rel` goes through (not the one it names): the write deleted it, so an edit
 * inside it is lost or gone, and its local value must not rebuild it.
 */
function lostItem(path: string, value: unknown, rel: string[]): boolean {
    const segs = [...path.split("."), ...rel];
    const base = segs.length - rel.length;
    for (let k = 1; k < rel.length; k++) {
        if (segs[base + k - 2] === "items" && getIn(value, rel.slice(0, k)) === ABSENT) return true;
    }
    return false;
}

/** `value` with `local` at `rel`, copied along the way; ABSENT deletes the key. */
function setIn(value: unknown, rel: string[], local: unknown): unknown {
    if (rel.length === 0) return local;
    const [key, ...rest] = rel;
    const obj = isObject(value) ? { ...value } : {};
    if (rest.length === 0 && local === ABSENT) {
        delete obj[key];
        return obj;
    }
    const child = setIn(obj[key], rest, local);
    if (child === ABSENT) delete obj[key];
    else obj[key] = child;
    return obj;
}

/** The layouts path of the grid `gridPath` ("x.items" → "x.layouts"), as the server's replaceLastSegment. */
export const layoutsOf = (gridPath: string) => gridPath.replace(/(^|\.)items$/, "$1layouts");

/** The path of the position of the item at `itemPath` in its grid's layouts. */
export function layoutOf(itemPath: string): string {
    const dot = itemPath.lastIndexOf(".");
    return `${layoutsOf(itemPath.slice(0, dot))}.${itemPath.slice(dot + 1)}`;
}

/**
 * The paths a sheet message, local or remote, writes. An own
 * autocompleteApply writes none: the tab changes nothing until
 * autocompleteApplied comes back to it as to the others.
 */
export function touches(msg: object): string[] {
    const m = msg as PlainObject & { type: string; path: string; itemId: string };
    switch (m.type) {
        case "change":
        case "autocompleteApplied":
            return [m.path];
        case "batch":
            return Object.keys(m.changes as PlainObject).map(key => `${m.path}.${key}`);
        case "createItem":
            return [`${m.path}.${m.itemId}`, layoutOf(`${m.path}.${m.itemId}`)];
        case "deleteItem":
            return [m.path, layoutOf(m.path)];
        case "positionsChanged":
            return [layoutsOf(m.path)];
        case "moveItemBetweenGrids": {
            const from = `${m.fromPath}.${m.itemId}`, to = `${m.toPath}.${m.itemId}`;
            return [from, to, layoutOf(from), layoutOf(to)];
        }
        default:
            return [];
    }
}

/** Where an own moveItemBetweenGrids puts its item; undefined for other messages. */
export function movedTo(msg: object): string | undefined {
    const m = msg as { type: string; toPath: string; itemId: string };
    return m.type === "moveItemBetweenGrids" ? `${m.toPath}.${m.itemId}` : undefined;
}

interface Held extends Part {
    version: number;
}

export class SheetVersions {
    /** The version of the payload the sheet was built from. */
    readonly base: number;
    /** The version of the value shown at a path, when it is newer than `base`. */
    private seen = new Map<string, number>();
    /** Own edits waiting for their debounce, by debounce key. */
    private scheduled = new Map<string, { paths: string[]; cancel: () => void }>();
    /** Own edits sent and not answered yet, by eventID. */
    private sent = new Map<string, string[]>();
    /** Where the own moves among them put their items, by eventID. */
    private moves = new Map<string, string>();
    /** Remote writes postponed until the own sent edits of their path are answered. */
    private held = new Map<string, Held>();
    /** Remote writes inside an item the tab does not have yet: its createItem is on the way. */
    private orphans = new Map<string, Held>();

    constructor(base: number) {
        this.base = base;
    }

    // — Own edits ——————————————————————————

    /** An own edit of `paths` waits for its debounce under `key`; `cancel` drops it. */
    schedule(key: string, paths: string[], cancel: () => void): void {
        this.scheduled.set(key, { paths, cancel });
    }

    /** The debounce of `key` is over: the edit goes now (sending) or not at all. */
    unschedule(key: string): void {
        this.scheduled.delete(key);
    }

    /** An own edit of `paths` went to the server as `eventID`; a move put its item at `movedTo` (see movedTo). */
    sending(eventID: string, paths: string[], movedTo?: string): void {
        if (paths.length) this.sent.set(eventID, paths);
        if (movedTo) this.moves.set(eventID, movedTo);
    }

    /**
     * The server answered own edit `eventID`: written at `version`, or not
     * written (null: rejected; "gone": its item was deleted). Remote writes
     * held for its paths are applied now if they are newer. A move is
     * answered with `item` as the database moved it.
     */
    answer(eventID: string, version: number | null | "gone", sink: Sink, item?: unknown): void {
        const paths = this.sent.get(eventID);
        const moved = this.moves.get(eventID);
        this.moves.delete(eventID);
        if (!paths) return;
        this.sent.delete(eventID);
        if (typeof version === "number") {
            // The tab moved its own copy, which may lack an edit written just
            // before the move: held, or still on its way and then stale.
            if (moved && item !== undefined) {
                const part = this.filter({ path: moved, value: item, creates: true }, version, sink);
                if (part) sink.write(part);
            }
            for (const path of paths) this.seen.set(path, Math.max(this.seen.get(path) ?? 0, version));
        }
        // The moved item was deleted or moved by someone else first; that
        // reaches the tab at the old place, where it no longer is. Before the
        // release, which may bring a move of the same item to the same place.
        if (version === "gone" && moved) sink.write({ path: moved, value: ABSENT });
        this.release(sink);
    }

    /**
     * The socket dropped: no own edit will be answered, and no item a write
     * waits for will come; the sheet is read again once the socket is back.
     */
    dropEdits(sink: Sink): void {
        this.scheduled.clear();
        this.sent.clear();
        this.moves.clear();
        this.orphans.clear();
        this.release(sink);
    }

    // — Remote writes ———————————————————————

    /**
     * Filters the parts of a remote message written at `version`; returns
     * the parts to apply, with the values of protected descendants replaced by
     * the local ones. Rules, per path:
     * 1. written before what the tab shows there (or above it) → dropped;
     * 2. an own edit of it waits for its debounce → dropped, it will win;
     * 3. an own edit of it was sent and not answered → held until it is;
     * 4. otherwise applied.
     */
    receive(parts: Part[], version: number, sink: Sink): Part[] {
        const kept: Part[] = [];
        for (const part of parts) {
            const applied = this.filter(part, version, sink);
            if (applied) kept.push(applied);
        }
        return kept;
    }

    /**
     * Applies the writes that waited for their item, once it is there: call
     * it after applying a remote change, which may have brought one.
     */
    adopt(sink: Sink): void {
        if (!this.orphans.size) return;
        const ready = [...this.orphans.values()]
            .filter(o => !this.orphaned(o, sink))
            .sort((a, b) => a.version - b.version);
        for (const o of ready) {
            this.orphans.delete(o.path);
            const part = this.filter(o, o.version, sink);
            if (part) sink.write(part);
        }
    }

    /**
     * A remote deleteItem or moveItemBetweenGrids of the items at `items`
     * and their positions, at `version`: applied whole unless an item shows
     * something newer (rule 1 only). Only the items decide: a later
     * positionsChanged may still hold the position of a deleted item, as the
     * server does. The own edits of a deleted item that wait for their
     * debounce are dropped, those sent end as "gone"; remote writes waiting
     * inside it are dropped.
     */
    receiveItems(items: string[], version: number, { deleted = false } = {}): boolean {
        if (items.some(item => this.stale(item, version))) return false;
        for (const gone of deleted ? items : []) this.forget(gone);
        for (const item of items) {
            this.mark(item, version);
            this.mark(layoutOf(item), version);
        }
        return true;
    }

    /**
     * The old place of a remote moveItemBetweenGrids at `version` that
     * carries the item as the database moved it: whether the item goes from
     * `from` as deleted. Not when something newer shows there, e.g. a later
     * deletion of the old place, which wrote nothing on the server, or the
     * item moved back. The caller writes the item and its position at the new
     * place through receive, judged on their own, so the tab shows the moved
     * item, not its copy: edits written before the move are in it, own edits
     * of the old place that the move overtook are lost or answered "gone".
     */
    receiveMove(from: string, version: number): boolean {
        if (this.stale(from, version)) return false;
        this.forget(from);
        this.mark(from, version);
        this.mark(layoutOf(from), version);
        return true;
    }

    /** Own edits inside the item at `gone` waiting for their debounce are dropped, so are remote writes waiting inside it. */
    private forget(gone: string): void {
        for (const [key, edit] of this.scheduled) {
            if (edit.paths.some(path => covers(gone, path))) {
                edit.cancel();
                this.scheduled.delete(key);
            }
        }
        for (const waiting of [this.held, this.orphans]) {
            for (const path of waiting.keys()) {
                if (covers(gone, path)) waiting.delete(path);
            }
        }
    }

    // A version names one write: an ancestor at the same version is the write
    // the value came from, e.g. a field held out of an autocomplete of its item.
    private stale(path: string, version: number): boolean {
        if (version <= this.base || (this.seen.get(path) ?? 0) >= version) return true;
        for (let p = path; p.includes(".");) {
            p = p.slice(0, p.lastIndexOf("."));
            if ((this.seen.get(p) ?? 0) > version) return true;
        }
        return false;
    }

    /** How own edits cover `path`: one of `path` or above it waits, was sent, or none. */
    private ownOf(path: string): "scheduled" | "sent" | null {
        for (const { paths } of this.scheduled.values()) {
            if (paths.some(p => covers(p, path))) return "scheduled";
        }
        for (const paths of this.sent.values()) {
            if (paths.some(p => covers(p, path))) return "sent";
        }
        return null;
    }

    /**
     * Whether the write lands inside an item the tab lacks, or replaces one
     * it lacks without creating it. Not deleted later (that is stale), the
     * item is created by a message still on its way: the hub may deliver an
     * edit of a new item before the item.
     */
    private orphaned({ path, value, creates }: Part, sink: Sink): boolean {
        if (value === ABSENT) return false;
        const segs = path.split(".");
        for (let k = 2; k <= segs.length; k++) {
            if (segs[k - 2] !== "items" || (k === segs.length && creates)) continue;
            if (!sink.has(segs.slice(0, k).join("."))) return true;
        }
        return false;
    }

    private filter(part: Part, version: number, sink: Sink): Part | null {
        const { path, creates } = part;
        let { value } = part;
        if (this.stale(path, version)) return null;
        const own = this.ownOf(path);
        if (own === "scheduled") return null;
        if (own === "sent") {
            this.hold({ path, value, creates, version });
            return null;
        }
        if (this.orphaned(part, sink)) {
            const old = this.orphans.get(path);
            if (!old || old.version < version) this.orphans.set(path, { path, value, creates, version });
            return null;
        }
        if (isObject(value)) value = this.protect(path, value, version, sink.read);
        this.mark(path, version);
        return { path, value, creates };
    }

    /**
     * A subtree written at `version`, with the local value at each descendant
     * that shows something newer or that an own edit is on its way to; the
     * remote value of a descendant with an own sent edit is held.
     */
    private protect(path: string, value: PlainObject, version: number, read: (path: string) => unknown): unknown {
        const kept: string[] = [];
        for (const [p, v] of this.seen) {
            if (v >= version && p.startsWith(`${path}.`)) kept.push(p);
        }
        for (const { paths } of this.scheduled.values()) {
            kept.push(...paths.filter(p => p.startsWith(`${path}.`)));
        }
        for (const paths of this.sent.values()) {
            for (const p of paths) {
                if (!p.startsWith(`${path}.`) || lostItem(path, value, relative(path, p))) continue;
                kept.push(p);
                if (!this.stale(p, version)) this.hold({ path: p, value: getIn(value, relative(path, p)), version });
            }
        }
        // A kept path inside another kept one is already local.
        kept.sort((a, b) => a.length - b.length);
        const outer = kept.filter((p, i) => !kept.slice(0, i).some(q => covers(q, p)) && !lostItem(path, value, relative(path, p)));
        let result: unknown = value;
        for (const p of outer) result = setIn(result, relative(path, p), read(p));
        return result;
    }

    /** `path` shows the value written at `version`; what was seen below it is older, unless it was kept. */
    private mark(path: string, version: number): void {
        for (const [p, v] of this.seen) {
            if (v < version && p.startsWith(`${path}.`)) this.seen.delete(p);
        }
        this.seen.set(path, Math.max(this.seen.get(path) ?? 0, version));
    }

    /** Holds a remote write; of two at one path the newer stays, and it replaces older ones below it. */
    private hold(write: Held): void {
        const old = this.held.get(write.path);
        if (old && old.version >= write.version) return;
        for (const [p, h] of this.held) {
            if (h.version < write.version && p.startsWith(`${write.path}.`)) this.held.delete(p);
        }
        this.held.set(write.path, write);
    }

    /** Applies, oldest first, the held writes no own edit covers any more, by the rules of receive. */
    private release(sink: Sink): void {
        const free = [...this.held.values()]
            .filter(h => this.ownOf(h.path) === null)
            .sort((a, b) => a.version - b.version);
        for (const h of free) {
            this.held.delete(h.path);
            const part = this.filter(h, h.version, sink);
            if (part) sink.write(part);
        }
        this.adopt(sink);
    }
}
