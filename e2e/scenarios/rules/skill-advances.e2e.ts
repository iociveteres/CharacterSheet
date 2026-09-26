// A click on a skill advance sends the four advances of the row
// as one batch; B shows them and the recomputed difficulty.
import { beforeAll, describe, expect, it } from "vitest";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";

const ADVANCES = ["plus0", "plus10", "plus20", "plus30"];

describe("skill advances", () => {
    const t = useTable("skill advances");
    const rows: { [name: string]: string } = {};

    beforeAll(async () => {
        const { a } = t;
        await a.write("characteristics.WS.value", "40");
        await a.write("characteristics.I.value", "30");
        await a.write("skillsRight.1_trade.name", "Armourer");
        const custom = await addItem(a, await showGrid(a, grid("customSkills")));
        await a.write(`${custom}.name`, "Brewing");
        await a.write(`${custom}.characteristic`, "WS");
        rows["left table"] = "skillsLeft.parry";
        rows["right table"] = "skillsRight.1_trade";
        rows["custom skill"] = custom;
        await t.b.expectValue(`${custom}.characteristic`, "WS");
        await a.openNavTab("player");
    });

    const CASES: [string, number][] = [["left table", 40], ["right table", 30], ["custom skill", 40]];

    for (const [name, characteristic] of CASES) {
        it(`${name}: +20 on empty advances checks +0 to +20, unchecking +0 clears all`, async () => {
            const { a, b } = t;
            const row = rows[name];
            const advances = async (p: typeof a) => Promise.all(ADVANCES.map(k => p.read(`${row}.${k}`)));

            await a.clearRecords();
            await a.click(`${row}.plus20`);
            const first = await a.settledSheetMessages(400);
            expect(first.map(m => [m.type, m.path, m.change ?? m.changes])).toEqual([
                ["batch", row, { plus0: true, plus10: true, plus20: true, plus30: false }],
            ]);
            expect(await advances(a)).toEqual([true, true, true, false]);
            await b.expectValue(`${row}.plus20`, true);
            expect(await advances(b)).toEqual([true, true, true, false]);
            // Three advances: +20.
            await b.expectValue(`${row}.difficulty`, String(characteristic + 20));

            await a.click(`${row}.plus30`);
            await a.settledSheetMessages(400);
            await b.expectValue(`${row}.plus30`, true);
            await a.clearRecords();
            await a.click(`${row}.plus0`);
            const second = await a.settledSheetMessages(400);
            expect(second.map(m => [m.type, m.path, m.change ?? m.changes])).toEqual([
                ["batch", row, { plus0: false, plus10: false, plus20: false, plus30: false }],
            ]);
            expect(await advances(a)).toEqual([false, false, false, false]);
            await b.expectValue(`${row}.plus0`, false);
            expect(await advances(b)).toEqual([false, false, false, false]);
            await b.expectValue(`${row}.difficulty`, String(characteristic - 20));
            await a.expectValue(`${row}.difficulty`, String(characteristic - 20));
        });
    }
});
