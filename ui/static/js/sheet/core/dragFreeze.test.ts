import { describe, expect, it } from "vitest";
import { DragFreeze } from "./dragFreeze";

describe("frozen grids", () => {
    it("hold the changes of their own sheet only", () => {
        const [a, b] = [new DragFreeze(), new DragFreeze()];
        const ran: string[] = [];
        a.freeze("conditions.list.items");

        a.runOrQueue(["conditions.list.items.c1.name"], () => ran.push("a"));
        b.runOrQueue(["conditions.list.items.c1.name"], () => ran.push("b"));
        expect(ran).toEqual(["b"]);
        expect(b.isRenderFrozen("conditions.list.items")).toBe(false);

        for (const op of a.thaw("conditions.list.items")) op();
        expect(ran).toEqual(["b", "a"]);
    });
});
