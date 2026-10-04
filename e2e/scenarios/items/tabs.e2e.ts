// Tabs of melee profiles, Psykana and Techno Arcana: adding,
// deleting and sorting them, and moving a power to another tab.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, addTab, grid, openTab, positionsOf, selectTab, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

interface TabsCase {
    name: string;
    /** Shows the tabs on A's screen and returns their path. */
    show(p: Player): Promise<string>;
    init: object;
}

describe("tabs", () => {
    const t = useTable("tabs");
    let melee = "";

    beforeAll(async () => {
        melee = await addItem(t.a, await showGrid(t.a, grid("meleeAttacks")));
    });

    const CASES: TabsCase[] = [
        { name: "melee profiles", show: async p => { await p.openNavTab("combat"); return `${melee}.tabs.items`; }, init: {} },
        { name: "Psykana", show: async p => { await p.openNavTab("psykana"); return "psykana.tabs.items"; }, init: { name: "New Tab" } },
        { name: "Techno Arcana", show: async p => { await p.openNavTab("techno"); return "technoArcana.tabs.items"; }, init: { name: "New Tab" } },
    ];

    /** B and A after a reload have the tabs in A's order. */
    async function expectSameOrder(c: TabsCase, path: string) {
        const order = await tabIds(t.a, path);
        await c.show(t.b);
        await eventually(() => tabIds(t.b, path), ids => expect(ids, `B, ${c.name}`).toEqual(order));
        await t.a.reload();
        await c.show(t.a);
        expect(await tabIds(t.a, path), `reload, ${c.name}`).toEqual(order);
        await t.a.expectNoDragLeftovers();
        return order;
    }

    for (const c of CASES) {
        describe(c.name, () => {
            it("a new tab is created and opened", async () => {
                const path = await c.show(t.a);
                for (let i = 0; i < 3; i++) {
                    const before = await tabIds(t.a, path);
                    const msg = await addTab(t.a, path);
                    expect(msg).toMatchObject({ path, itemPos: { colIndex: 0, rowIndex: before.length }, init: c.init });
                    expect(msg.itemId).toMatch(/^tab-[\w-]{21}$/);
                    expect(await tabIds(t.a, path)).toEqual([...before, msg.itemId]);
                    expect(await openTab(t.a, path)).toBe(msg.itemId);
                }
                await expectSameOrder(c, path);
            });

            it("dragging a tab label sorts the tabs", async () => {
                const path = await c.show(t.a);
                const before = await tabIds(t.a, path);
                const last = before[before.length - 1];
                await t.a.clearRecords();
                await t.a.grab(`${path}.${last}`);
                const first = await t.a.el({ path, sel: `:scope > label.tablabel[for="${before[0]}"]` });
                const box = (await first.boundingBox())!;
                await t.a.moveTo({ x: box.x + box.width * 0.2, y: box.y + box.height / 2 });
                await t.a.drop();
                const after = await tabIds(t.a, path);
                expect(after).toEqual([last, ...before.slice(0, -1)]);
                const msg = await t.a.waitSent(m => m.type === "positionsChanged" && m.path === path, "positionsChanged");
                expect(msg.positions).toEqual(positionsOf([after]));
                await expectSameOrder(c, path);
            });

            it("deleting the open tab opens the last one", async () => {
                const path = await c.show(t.a);
                const before = await tabIds(t.a, path);
                await selectTab(t.a, path, before[1]);
                await t.a.remove(`${path}.${before[1]}`);
                const after = await tabIds(t.a, path);
                expect(after).toEqual(before.filter(id => id !== before[1]));
                await eventually(() => openTab(t.a, path), id => expect(id).toBe(after[after.length - 1]));
                await expectSameOrder(c, path);
            });
        });
    }

    for (const block of ["psykana", "technoArcana"] as const) {
        it(`${block}: resting on a tab label opens it, and the drop moves the power there`, async () => {
            const { a, b } = t;
            const tabsPath = `${block}.tabs.items`;
            const navTab = block === "psykana" ? "psykana" : "techno";
            await a.openNavTab(navTab);
            const [from, to] = await tabIds(a, tabsPath);
            await selectTab(a, tabsPath, from);
            const fromGrid = `${tabsPath}.${from}.powers.items`;
            const toGrid = `${tabsPath}.${to}.powers.items`;
            const power = await addItem(a, fromGrid, 0);
            const powerId = power.split(".").pop()!;
            await a.clearRecords();

            await a.grab(power);
            await a.moveTo(await a.center({ path: tabsPath, sel: `:scope > label.tablabel[for="${to}"]` }));
            await a.page.waitForTimeout(700);
            expect(await openTab(a, tabsPath), "the hovered tab opens").toBe(to);
            await a.moveTo(await a.center({ path: toGrid, sel: ":scope > .layout-column", nth: 0 }));
            await a.drop();

            const moved = await a.waitSent(m => m.type === "moveItemBetweenGrids", "moveItemBetweenGrids");
            expect(moved).toMatchObject({ fromPath: fromGrid, toPath: toGrid, itemId: powerId, toPosition: { colIndex: 0, rowIndex: 0 } });
            expect(await openTab(a, tabsPath), "the tab of the drop stays open").toBe(to);
            expect((await a.layout(toGrid)).flat()).toContain(powerId);
            expect((await a.layout(fromGrid)).flat()).not.toContain(powerId);
            await a.expectNoDragLeftovers();

            const movedPath = `${toGrid}.${powerId}`;
            await b.openNavTab(navTab);
            await selectTab(b, tabsPath, to);
            await eventually(() => b.layout(toGrid), l => expect(l.flat(), "B").toContain(powerId));
            expect((await b.layout(fromGrid)).flat()).not.toContain(powerId);

            // The roll total of the moved power still follows its fields.
            await Promise.all([a.openRoll(movedPath), b.openRoll(movedPath)]);
            const total = Number(await a.read(`${movedPath}.roll.total`));
            await a.write(`${movedPath}.roll.modifier`, 7);
            await a.expectValue(`${movedPath}.roll.total`, String(total + 7));
            await b.expectValue(`${movedPath}.roll.total`, String(total + 7));

            await a.reload();
            await a.openNavTab(navTab);
            await selectTab(a, tabsPath, to);
            expect((await a.layout(toGrid)).flat(), "reload").toContain(powerId);
            await a.openRoll(movedPath);
            await a.expectValue(`${movedPath}.roll.total`, String(total + 7));
        });
    }
});
