// Creating, deleting and dragging items of every grid, as the
// other player and a reload see it.
import { beforeAll, describe, expect, it } from "vitest";
import type { Msg } from "../../lib/probes";
import { GRIDS, idPrefix, positionsOf, showGrid, type GridSpec } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("grids: create, delete, drag", () => {
    const t = useTable("grids");
    const paths = new Map<GridSpec, string>();
    let rollDefaults: any;

    beforeAll(async () => {
        for (const g of GRIDS) paths.set(g, await showGrid(t.a, g));
        rollDefaults = (await t.a.sheetState()).rollDefaults;
    });

    /** The init a new item of the grid is created with. */
    function expectedInit(g: GridSpec, msg: Msg): unknown {
        switch (g.name) {
            case "gear":
                return { carried: true };
            case "conditions": {
                const [entryId] = Object.keys(msg.init.entries?.items ?? {});
                expect(entryId).toMatch(/^entry-/);
                return { enabled: true, stacks: 1, entries: { items: { [entryId]: {} }, layouts: { [entryId]: { colIndex: 0, rowIndex: 0 } } } };
            }
            case "rangedAttacks":
                return { roll: rollDefaults.rangedAttack };
            case "meleeAttacks": {
                const [tabId] = Object.keys(msg.init.tabs?.items ?? {});
                expect(tabId).toMatch(/^tab-/);
                return {
                    roll: rollDefaults.meleeAttack,
                    tabs: { items: { [tabId]: { profile: "mace" } }, layouts: { [tabId]: { colIndex: 0, rowIndex: 0 } } },
                };
            }
            case "psychicPowers":
                return { roll: rollDefaults.psychicPower };
            case "techPowers":
                return { roll: rollDefaults.techPower };
            default:
                return {};
        }
    }

    /** B and A after a reload lay every grid out as A does now. */
    async function expectSameEverywhere(what: string) {
        const expected = new Map<GridSpec, string[][]>();
        for (const g of GRIDS) {
            const layout = await t.a.layout(paths.get(g)!);
            expected.set(g, layout);
            await eventually(() => t.b.layout(paths.get(g)!), l => expect(l, `B, ${g.name}, ${what}`).toEqual(layout));
        }
        await t.a.reload();
        for (const g of GRIDS) expect(await t.a.layout(paths.get(g)!), `reload, ${g.name}, ${what}`).toEqual(expected.get(g));
        await t.a.expectNoDragLeftovers();
        await t.b.expectNoDragLeftovers();
    }

    /** Waits for the positionsChanged of the grid and checks it has A's complete layout. */
    async function expectPositionsSent(g: GridSpec) {
        const path = paths.get(g)!;
        const msg = await t.a.waitSent(m => m.type === "positionsChanged" && m.path === path, `positionsChanged of ${g.name}`);
        expect(msg.positions, g.name).toEqual(positionsOf(await t.a.layout(path)));
    }

    it("＋ Add in every column sends createItem with the grid's id prefix, position and init", async () => {
        for (const g of GRIDS) {
            const path = await showGrid(t.a, g);
            for (let col = 0; col < g.columns; col++) {
                for (let row = 0; row < 2; row++) {
                    const msg = await t.a.add(path, col);
                    expect(msg.path, g.name).toBe(path);
                    expect(msg.itemId, g.name).toMatch(new RegExp(`^${idPrefix(g, path)}-[\\w-]{21}$`));
                    expect(msg.itemPos, g.name).toEqual({ colIndex: col, rowIndex: row });
                    expect(msg.init, g.name).toEqual(expectedInit(g, msg));
                }
            }
            const layout = await t.a.layout(path);
            expect(layout.map(col => col.length), g.name).toEqual(Array(g.columns).fill(2));
        }
    });

    it("B has the new items in the same places, and so has a reload", async () => {
        await expectSameEverywhere("after create");
    });

    it("dragging an item up its column sends the complete layout", async () => {
        for (const g of GRIDS) {
            const path = await showGrid(t.a, g);
            const [first, second] = (await t.a.layout(path))[0];
            await t.a.clearRecords();
            await t.a.drag(`${path}.${second}`, `${path}.${first}`, { above: true });
            expect((await t.a.layout(path))[0].slice(0, 2), g.name).toEqual([second, first]);
            await expectPositionsSent(g);
        }
    });

    it("B has the reordered columns, and so has a reload", async () => {
        await expectSameEverywhere("after a drag in a column");
    });

    it("dragging an item to another column sends the complete layout", async () => {
        for (const g of GRIDS.filter(g => g.columns > 1)) {
            const path = await showGrid(t.a, g);
            const before = await t.a.layout(path);
            const moved = before[0][0];
            await t.a.clearRecords();
            await t.a.drag(`${path}.${moved}`, `${path}.${before[1][0]}`);
            const after = await t.a.layout(path);
            expect(after[0], g.name).not.toContain(moved);
            expect(after[1], g.name).toContain(moved);
            await expectPositionsSent(g);
        }
    });

    it("B has the moved items, and so has a reload", async () => {
        await expectSameEverywhere("after a drag between columns");
    });

    it("deleting in Delete Mode sends deleteItem", async () => {
        for (const g of GRIDS) {
            const path = await showGrid(t.a, g);
            const victim = (await t.a.layout(path))[0][0];
            await t.a.clearRecords();
            await t.a.remove(`${path}.${victim}`);
            expect((await t.a.layout(path)).flat(), g.name).not.toContain(victim);
            expect((await t.a.settledSheetMessages()).map(m => m.type), g.name).toEqual(["deleteItem"]);
        }
    });

    it("B no longer has the deleted items, nor has a reload", async () => {
        await expectSameEverywhere("after delete");
    });
});
