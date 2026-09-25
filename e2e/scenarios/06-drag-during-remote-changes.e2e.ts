// Scenario 6: A drags an item while B changes the same grid. The changes
// wait for the drop, then every copy of the sheet lays the grid out alike.
import { beforeAll, describe, expect, it } from "vitest";
import { addItem, grid, showGrid } from "../lib/sheet";
import { useTable } from "../lib/table";
import { eventually } from "../lib/wait";

describe("6. dragging while the other player changes the grid", () => {
    const t = useTable("06 drag during changes");

    beforeAll(async () => {
        await t.b.openNavTab("talents");
    });

    it("B's create, rename and delete wait for A's drop", async () => {
        const { a, b } = t;
        const path = await showGrid(a, grid("talents"));
        const [x, y, z] = [await addItem(a, path, 0), await addItem(a, path, 0), await addItem(a, path, 0)];
        const w = await addItem(a, path, 1);
        for (const [item, name] of [[x, "X"], [y, "Y"], [z, "Z"], [w, "W"]]) await a.write(`${item}.name`, name);
        const idOf = (p: string) => p.split(".").pop()!;
        await eventually(() => b.layout(path), l => expect(l).toEqual([[x, y, z].map(idOf), [idOf(w)], []]));
        const before = (await a.layout(path)).flat().sort();

        await a.grab(x);
        const target = await a.center(w);
        await a.moveTo({ x: target.x - 40, y: target.y }, 10);

        const created = await b.add(path, 0);
        await b.write(`${y}.name`, "Y renamed");
        await b.remove(z);
        await b.settledSheetMessages();

        // Frozen: the grid keeps its items until the drop.
        expect((await a.layout(path)).flat().sort()).toEqual(before);

        await a.moveTo(target, 10);
        await a.drop();

        const after = await a.layout(path);
        expect(after.flat()).toContain(created.itemId);
        expect(after.flat()).not.toContain(idOf(z));
        expect(after[1]).toContain(idOf(x));
        expect(after[created.itemPos.colIndex]).toContain(created.itemId);
        await a.expectValue(`${y}.name`, "Y renamed");
        await a.expectNoDragLeftovers();

        await eventually(() => b.layout(path), l => expect(l, "B").toEqual(after));
        await a.reload();
        expect(await a.layout(path), "reload").toEqual(after);
        await a.expectValue(`${y}.name`, "Y renamed");
    });

    it("in condition entries, a rename of the condition applies at once and a new entry after the drop", async () => {
        const { a, b } = t;
        const path = await showGrid(a, grid("conditions"));
        const condition = await addItem(a, path, 0);
        const entries = `${condition}.entries.items`;
        await a.add(entries, 0);
        const [first, second] = (await a.layout(entries))[0];
        await b.openCharacteristics();
        await eventually(() => b.layout(entries), l => expect(l).toEqual([[first, second]]));

        await a.grab(`${entries}.${second}`);
        const target = await a.el(`${entries}.${first}`);
        const box = (await target.boundingBox())!;
        await a.moveTo({ x: box.x + box.width / 2, y: box.y + box.height + 2 }, 5);

        await b.write(`${condition}.name`, "Stunned");
        await a.expectValue(`${condition}.name`, "Stunned");
        const created = await b.add(entries, 0);
        await b.settledSheetMessages();
        expect((await a.layout(entries)).flat().sort(), "no new entry before the drop").toEqual([first, second].sort());

        await a.moveTo({ x: box.x + box.width / 2, y: box.y + box.height * 0.25 }, 10);
        await a.drop();

        const after = await a.layout(entries);
        expect(after[0].slice(0, 2)).toEqual([second, first]);
        expect(after[0]).toContain(created.itemId);
        await a.expectNoDragLeftovers();
        await eventually(() => b.layout(entries), l => expect(l, "B").toEqual(after));
        await a.reload();
        await a.openCharacteristics();
        expect(await a.layout(entries), "reload").toEqual(after);
        await a.expectValue(`${condition}.name`, "Stunned");
    });
});
