import { beforeEach, describe, expect, it } from "vitest";
import type { Signal } from "@preact/signals-core";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals } from "./fromJson";
import { characterState } from "./state.js";
import {
    createItemInState, deleteItemFromState, moveItemInState, resolvePath, setLayouts, updateSignalBatch,
} from "./sync.js";

const layouts = (gridPath: string) => (resolvePath(gridPath.replace(/items$/, "layouts")) as Signal).value;

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

beforeEach(() => {
    for (const key of Object.keys(characterState)) delete (characterState as Record<string, unknown>)[key];
    Object.assign(characterState, jsonToSignals(normalizeSheet({
        traits: { list: { items: { t1: {}, t2: {} }, layouts: { t1: pos(0, 0), t2: pos(1, 0) } } },
        conditions: {
            list: {
                items: { c1: { entries: { items: { e1: {} }, layouts: { e1: pos(0, 0) } } } },
                layouts: { c1: pos(0, 0) },
            },
        },
        psykana: {
            tabs: {
                items: { a: { powers: { items: { p1: {} }, layouts: { p1: pos(0, 0) } } }, b: {} },
                layouts: { a: pos(0, 0), b: pos(0, 1) },
            },
        },
    })));
    document.body.innerHTML = "";
});

describe("layouts in the state", () => {
    it("gains the position of a created item", () => {
        createItemInState("traits.list.items", "t3", {}, pos(2, 0));
        expect(layouts("traits.list.items")).toEqual({ t1: pos(0, 0), t2: pos(1, 0), t3: pos(2, 0) });
    });

    it("loses the position of a deleted item", () => {
        deleteItemFromState("traits.list.items.t1");
        expect(layouts("traits.list.items")).toEqual({ t2: pos(1, 0) });
        deleteItemFromState("conditions.list.items.c1.entries.items.e1");
        expect(layouts("conditions.list.items.c1.entries.items")).toEqual({});
    });

    it("moves the position with an item between grids", () => {
        moveItemInState("psykana.tabs.items.a.powers.items", "psykana.tabs.items.b.powers.items", "p1", pos(1, 0));
        expect(layouts("psykana.tabs.items.a.powers.items")).toEqual({});
        expect(layouts("psykana.tabs.items.b.powers.items")).toEqual({ p1: pos(1, 0) });
        expect(resolvePath("psykana.tabs.items.b.powers.items.p1")).not.toBeNull();
    });

    it("is replaced by positionsChanged", () => {
        setLayouts("traits.list.items", { t1: pos(2, 0), t2: pos(2, 1) });
        expect(layouts("traits.list.items")).toEqual({ t1: pos(2, 0), t2: pos(2, 1) });
    });

    it("is replaced by a batch that carries a grid", () => {
        updateSignalBatch("conditions.list.items.c1", {
            name: "Fury",
            entries: { items: { e1: { bonus: "1" } }, layouts: { e1: pos(0, 3) } },
        });
        expect(layouts("conditions.list.items.c1.entries.items")).toEqual({ e1: pos(0, 3) });
        expect((resolvePath("conditions.list.items.c1.entries.items.e1.bonus") as Signal).value).toBe("1");
    });

    it("gives the grids of an item created from markup their layouts from init", () => {
        const host = document.createElement("div");
        host.id = "charactersheet";
        document.body.appendChild(host);
        host.attachShadow({ mode: "open" }).innerHTML = `
            <div data-id="conditions.list.items">
                <div data-id="c2">
                    <input data-id="name" value="New">
                    <div data-id="entries.items">
                        <div data-id="e2"><input data-id="bonus" value=""></div>
                    </div>
                </div>
            </div>`;

        createItemInState("conditions.list.items", "c2", {
            enabled: true,
            entries: { items: { e2: { type: "char_bonus" } }, layouts: { e2: pos(0, 0) } },
        }, pos(1, 0));

        expect(layouts("conditions.list.items")).toEqual({ c1: pos(0, 0), c2: pos(1, 0) });
        expect(layouts("conditions.list.items.c2.entries.items")).toEqual({ e2: pos(0, 0) });
        expect((resolvePath("conditions.list.items.c2.name") as Signal).value).toBe("New");
    });
});
