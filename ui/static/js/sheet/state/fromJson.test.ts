import { describe, expect, it } from "vitest";
import { Signal } from "@preact/signals-core";
import { normalizeSheet } from "../schema/normalize";
import { jsonToSignals, specAtPath, type SignalTree } from "./fromJson";

const at = (tree: SignalTree, path: string): unknown =>
    path.split(".").reduce<unknown>((node, seg) => (node as SignalTree)?.[seg], tree);

const valueAt = (tree: SignalTree, path: string) => (at(tree, path) as Signal).value;

describe("jsonToSignals", () => {
    const tree = jsonToSignals(normalizeSheet({
        characteristics: { WS: { value: "35" } },
        conditions: {
            list: {
                items: { c1: { name: "Fury", stacks: 2, entries: { items: { e1: { bonus: "X" } }, layouts: { e1: { colIndex: 0, rowIndex: 0 } } } } },
                layouts: { c1: { colIndex: 1, rowIndex: 0 } },
            },
        },
        rangedAttacks: {
            list: {
                items: {
                    r1: { name: "no roll" },
                    r2: { roll: { aim: { selected: "half" }, target: { selected: "" } } },
                },
            },
        },
    }));

    it("puts a signal at every stored field", () => {
        expect(at(tree, "characteristics.WS.value")).toBeInstanceOf(Signal);
        expect(valueAt(tree, "characteristics.WS.value")).toBe("35");
        expect(valueAt(tree, "conditions.list.items.c1.stacks")).toBe(2);
        expect(valueAt(tree, "conditions.list.items.c1.entries.items.e1.bonus")).toBe("X");
        expect(valueAt(tree, "size")).toBe("0");
    });

    it("keeps grid layouts in a signal next to the items", () => {
        expect(at(tree, "conditions.list.layouts")).toBeInstanceOf(Signal);
        expect(valueAt(tree, "conditions.list.layouts")).toEqual({ c1: { colIndex: 1, rowIndex: 0 } });
        expect(valueAt(tree, "conditions.list.items.c1.entries.layouts")).toEqual({ e1: { colIndex: 0, rowIndex: 0 } });
        expect(valueAt(tree, "notes.list.layouts")).toEqual({});
        expect(at(tree, "notes.list.items")).toEqual({});
    });

    it("leaves out what the markup gives no signal for", () => {
        // Computed outputs: attachComputeds() places them.
        expect(at(tree, "characteristics.WS.calculatedValue")).toBeUndefined();
        expect(at(tree, "movement.moveHalf")).toBeUndefined();
        // An absent roll is not rendered.
        expect(at(tree, "rangedAttacks.list.items.r1.roll")).toBeUndefined();
        // A radio group with nothing checked.
        expect(valueAt(tree, "rangedAttacks.list.items.r2.roll.aim.selected")).toBe("half");
        expect(at(tree, "rangedAttacks.list.items.r2.roll.target.selected")).toBeUndefined();
        expect(valueAt(tree, "rangedAttacks.list.items.r2.roll.target.no")).toBe(0);
    });
});

describe("specAtPath", () => {
    it("finds fields through groups and grids", () => {
        expect(specAtPath("characteristics.WS.value")).toMatchObject({ kind: "field", control: "text" });
        expect(specAtPath("characteristics.WS.calculatedValue")).toMatchObject({ kind: "computed" });
        expect(specAtPath("conditions.list.items.c1.entries.items.e1.type")).toMatchObject({ control: "select" });
        expect(specAtPath("psykana.tabs.items.t1.powers.items.p1.roll.modifier")).toMatchObject({ kind: "field" });
        expect(specAtPath("conditions.list.items.c1")).toMatchObject({ kind: "group" });
    });

    it("returns null for paths the schema does not have", () => {
        expect(specAtPath("characteristics.XX.value")).toBeNull();
        expect(specAtPath("conditions.list.layouts.c1")).toBeNull();
        expect(specAtPath("size.value")).toBeNull();
    });
});
