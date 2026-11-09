import { describe, expect, it } from "vitest";
import { ABSENT, SheetVersions, layoutOf, layoutsOf, touches, type Part, type Sink } from "./versions";

const NAME = "talents.list.items.t1.name";
const ITEM = "talents.list.items.t1";

/** A sink over plain values by path: what the record reads and what it released, in order. */
function sinkOver(local: Record<string, unknown> = {}): Sink & { written: Part[] } {
    const written: Part[] = [];
    return {
        written,
        read: path => (path in local ? local[path] : ABSENT),
        // Every item is there unless a test says otherwise.
        has: path => !(path in local) || local[path] !== ABSENT,
        write: part => written.push(part),
    };
}

const change = (path: string, value: unknown): Part[] => [{ path, value }];

describe("touches", () => {
    it("names the paths each message writes", () => {
        expect(touches({ type: "change", path: NAME })).toEqual([NAME]);
        expect(touches({ type: "batch", path: ITEM, changes: { name: 1, description: 2 } }))
            .toEqual([NAME, `${ITEM}.description`]);
        expect(touches({ type: "createItem", path: "talents.list.items", itemId: "t1" }))
            .toEqual([ITEM, "talents.list.layouts.t1"]);
        expect(touches({ type: "deleteItem", path: "a.items.x.tabs.items.y" }))
            .toEqual(["a.items.x.tabs.items.y", "a.items.x.tabs.layouts.y"]);
        expect(touches({ type: "positionsChanged", path: "talents.list.items" })).toEqual(["talents.list.layouts"]);
        expect(touches({ type: "moveItemBetweenGrids", fromPath: "a.items", toPath: "b.items", itemId: "x" }))
            .toEqual(["a.items.x", "b.items.x", "a.layouts.x", "b.layouts.x"]);
        // Not applied locally: autocompleteApplied comes back to the author.
        expect(touches({ type: "autocompleteApply", path: ITEM })).toEqual([]);
        expect(layoutsOf("items")).toBe("layouts");
        expect(layoutOf("a.items.x.tabs.items.y")).toBe("a.items.x.tabs.layouts.y");
    });
});

describe("a remote write", () => {
    it("is dropped when it is not newer than the payload or than what the path shows", () => {
        const v = new SheetVersions(10);
        const read = sinkOver();
        expect(v.receive(change(NAME, "old"), 10, read)).toEqual([]);
        expect(v.receive(change(NAME, "b"), 12, read)).toEqual(change(NAME, "b"));
        expect(v.receive(change(NAME, "a"), 11, read)).toEqual([]);
    });

    it("is dropped when the item above it was written later", () => {
        const v = new SheetVersions(0);
        const read = sinkOver();
        expect(v.receive([{ path: ITEM, value: { name: "Iron Will" } }], 5, read)).toHaveLength(1);
        // A change made before the autocomplete that replaced its item.
        expect(v.receive(change(NAME, "typed"), 4, read)).toEqual([]);
        expect(v.receive(change(NAME, "typed"), 6, read)).toHaveLength(1);
    });

    it("is dropped while an own edit of the path waits for its debounce: that one goes later and wins", () => {
        const v = new SheetVersions(0);
        v.schedule("k", [NAME], () => {});
        expect(v.receive(change(NAME, "b"), 3, sinkOver())).toEqual([]);
    });

    it("waits for the answer to an own edit of the path, and applies after it only if newer", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("e1", [NAME]);
        v.sending("e2", [`${ITEM}.description`]);
        expect(v.receive(change(NAME, "b3"), 3, sink)).toEqual([]);
        expect(v.receive(change(NAME, "b5"), 5, sink)).toEqual([]);
        // The newest held value stays, whatever order they came in.
        expect(v.receive(change(NAME, "b4"), 4, sink)).toEqual([]);

        v.answer("e2", 6, sink);
        expect(sink.written).toEqual([]);
        v.answer("e1", 2, sink);
        expect(sink.written).toEqual(change(NAME, "b5"));
    });

    it("held is dropped when the own edit was written after it", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("e1", [NAME]);
        v.receive(change(NAME, "b"), 3, sink);
        v.answer("e1", 4, sink);
        expect(sink.written).toEqual([]);
        // Later writes of the path are judged against the own edit.
        expect(v.receive(change(NAME, "late"), 3, sink)).toEqual([]);
    });

    it("held is applied when the own edit failed or was gone", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("e1", [NAME]);
        v.receive(change(NAME, "b"), 3, sink);
        v.answer("e1", null, sink);
        expect(sink.written).toEqual(change(NAME, "b"));
    });

    it("held stays while another own edit of the path is on its way", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("e1", [NAME]);
        v.receive(change(NAME, "b"), 3, sink);
        v.schedule("k", [NAME], () => {});
        v.answer("e1", 2, sink);
        expect(sink.written).toEqual([]);
        v.unschedule("k");
        v.sending("e2", [NAME]);
        v.answer("e2", 4, sink);
        expect(sink.written).toEqual([]);
    });

    it("of an own sent edit's descendant is held whole: an own delete of the item covers its fields", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("d", [ITEM, "talents.list.layouts.t1"]);
        expect(v.receive(change(NAME, "b"), 3, sink)).toEqual([]);
        v.answer("d", 4, sink);
        expect(sink.written).toEqual([]);
    });

    it("released on a dropped socket when it is newer", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        v.sending("e1", [NAME]);
        v.receive(change(NAME, "b"), 3, sink);
        v.dropEdits(sink);
        expect(sink.written).toEqual(change(NAME, "b"));
    });
});

describe("a remote subtree write", () => {
    it("keeps the local value of descendants that show something newer or that own edits are on the way to", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver({ [NAME]: "mine", [`${ITEM}.description`]: "newer" });
        v.receive(change(`${ITEM}.description`, "newer"), 9, sink);
        v.schedule("k", [NAME], () => {});

        const [part] = v.receive([{ path: ITEM, value: { name: "Iron Will", description: "Entry", cost: 3 } }], 5, sink);
        expect(part).toEqual({ path: ITEM, value: { name: "mine", description: "newer", cost: 3 } });
    });

    it("holds the remote value of a descendant with an own sent edit, and applies it once that one is older", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver({ [NAME]: "mine" });
        v.sending("e1", [NAME]);
        const [part] = v.receive([{ path: ITEM, value: { name: "Iron Will" } }], 5, sink);
        expect(part.value).toEqual({ name: "mine" });

        v.answer("e1", 4, sink);
        expect(sink.written).toEqual(change(NAME, "Iron Will"));
    });

    it("holds 'absent' for a descendant the subtree lacks", () => {
        const v = new SheetVersions(0);
        const layouts = "talents.list.layouts";
        const sink = sinkOver({ [`${layouts}.t3`]: { colIndex: 0, rowIndex: 2 } });
        v.sending("create", [`talents.list.items.t3`, `${layouts}.t3`]);
        const [part] = v.receive([{ path: layouts, value: { t1: { colIndex: 1, rowIndex: 0 } } }], 6, sink);
        expect(part.value).toEqual({ t1: { colIndex: 1, rowIndex: 0 }, t3: { colIndex: 0, rowIndex: 2 } });

        v.answer("create", 5, sink);
        expect(sink.written).toEqual([{ path: `${layouts}.t3`, value: ABSENT }]);
    });

    it("does not rebuild an item it deleted around an own edit inside it", () => {
        const v = new SheetVersions(0);
        const cap = "conditions.list.items.c1.entries.items.e1.cap";
        const sink = sinkOver({ [cap]: "20" });
        v.sending("e1", [cap]);
        const entries = { items: { e2: { cap: "5" } }, layouts: {} };
        const [part] = v.receive([{ path: "conditions.list.items.c1.entries", value: entries }], 5, sink);
        expect(part.value).toEqual(entries);
        v.answer("e1", null, sink);
        expect(sink.written).toEqual([]);
    });
});

describe("a remote deletion", () => {
    it("is applied whole unless older than what its item shows, and drops own edits waiting inside the item", () => {
        const v = new SheetVersions(0);
        const sink = sinkOver();
        let cancelled = 0;
        v.schedule("inside", [NAME], () => cancelled++);
        v.schedule("outside", ["talents.list.items.t2.name"], () => cancelled += 10);
        v.sending("e1", [`${ITEM}.description`]);
        v.receive(change(`${ITEM}.description`, "b"), 3, sink);

        expect(v.receiveItems([ITEM], 4, { deleted: true })).toBe(true);
        expect(cancelled).toBe(1);
        // The held change inside it is gone with it.
        v.answer("e1", null, sink);
        expect(sink.written).toEqual([]);
        // Changes written before the deletion come too late.
        expect(v.receive(change(NAME, "late"), 2, sink)).toEqual([]);
        expect(v.receiveItems([ITEM], 1, { deleted: true })).toBe(false);
    });

    it("is applied after positions written later that still hold the item", () => {
        const v = new SheetVersions(0);
        expect(v.receive([{ path: "talents.list.layouts", value: { t1: {} } }], 5, sinkOver())).toHaveLength(1);
        expect(v.receiveItems([ITEM], 4, { deleted: true })).toBe(true);
    });
});
