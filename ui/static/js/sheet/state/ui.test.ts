import { describe, expect, it } from "vitest";
import { signal } from "@preact/signals-core";
import { SheetUiState } from "./ui";

describe("the UI state of a sheet", () => {
    it("is its own: an item collapsed in one sheet stays open in another", () => {
        const [a, b] = [new SheetUiState(), new SheetUiState()];
        a.collapsedSignal("talents.list.items.t1", () => false).value = true;
        a.selectedTabSignal("psykana.tabs.items").value = "t2";

        expect(b.collapsedSignal("talents.list.items.t1", () => false).value).toBe(false);
        expect(b.selectedTabSignal("psykana.tabs.items").value).toBe(null);
    });

    it("expands only the items of its sheet on a remote batch", () => {
        const [a, b] = [new SheetUiState(), new SheetUiState()];
        const [inA, inB] = [signal(true), signal(true)];
        a.registerCollapsible("conditions.list.items.c1", { collapsed: inA, hasContent: () => true, autoExpand: true, el: null });
        b.registerCollapsible("conditions.list.items.c1", { collapsed: inB, hasContent: () => true, autoExpand: true, el: null });

        a.expandItem("conditions.list.items.c1");

        expect([inA.value, inB.value]).toEqual([false, true]);
    });
});
