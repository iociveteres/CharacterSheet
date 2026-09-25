import { afterEach, describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals-core";
import {
    onSheetTeardown, pendingTeardowns, sheetEffect, teardownSheet,
} from "./lifecycle";

afterEach(teardownSheet);

describe("sheet teardown", () => {
    it("runs on charactersheet_removing, newest disposer first", () => {
        const order: string[] = [];
        onSheetTeardown(() => order.push("first"));
        onSheetTeardown(() => order.push("second"));

        document.body.dispatchEvent(new CustomEvent("charactersheet_removing", { bubbles: true }));

        expect(order).toEqual(["second", "first"]);
        expect(pendingTeardowns()).toBe(0);
    });

    it("stops sheet effects", () => {
        const s = signal(1);
        const seen: number[] = [];
        sheetEffect(() => { seen.push(s.value); });
        s.value = 2;
        teardownSheet();
        s.value = 3;
        expect(seen).toEqual([1, 2]);
    });

    it("keeps going when a disposer throws", () => {
        const after = vi.fn();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        onSheetTeardown(after);
        onSheetTeardown(() => { throw new Error("boom"); });
        teardownSheet();
        expect(after).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });
});
