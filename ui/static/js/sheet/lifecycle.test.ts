import { describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals-core";
import { SheetScope } from "./lifecycle";

describe("sheet teardown", () => {
    it("runs the disposers newest first", () => {
        const scope = new SheetScope();
        const order: string[] = [];
        scope.onTeardown(() => order.push("first"));
        scope.onTeardown(() => order.push("second"));

        scope.teardown();

        expect(order).toEqual(["second", "first"]);
        expect(scope.pending).toBe(0);
    });

    it("stops sheet effects", () => {
        const scope = new SheetScope();
        const s = signal(1);
        const seen: number[] = [];
        scope.effect(() => { seen.push(s.value); });
        s.value = 2;
        scope.teardown();
        s.value = 3;
        expect(seen).toEqual([1, 2]);
    });

    it("keeps going when a disposer throws", () => {
        const scope = new SheetScope();
        const after = vi.fn();
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        scope.onTeardown(after);
        scope.onTeardown(() => { throw new Error("boom"); });
        scope.teardown();
        expect(after).toHaveBeenCalled();
        expect(error).toHaveBeenCalled();
        error.mockRestore();
    });

    it("leaves the scopes of other sheets alone", () => {
        const [a, b] = [new SheetScope(), new SheetScope()];
        const disposed: string[] = [];
        a.onTeardown(() => disposed.push("a"));
        b.onTeardown(() => disposed.push("b"));

        a.teardown();

        expect(disposed).toEqual(["a"]);
        expect(b.pending).toBe(1);
    });
});
