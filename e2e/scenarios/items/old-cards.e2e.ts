// Toggle Descs and Delete Mode after the cards of a grid were added to,
// dragged and deleted: they act on every card, those from before the edits
// too, on the screen that made the edits and on the one that got them.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

const GRID_NAMES = ["gear", "talents"];

describe("Toggle Descs and Delete Mode after grid edits", () => {
    const t = useTable("old cards");
    const paths = new Map<string, string>();

    /** Adds an item to column `col` with a description, so Toggle Descs expands it. */
    async function addFull(p: Player, path: string, col: number): Promise<string> {
        const item = await addItem(p, path, col);
        await p.write(`${item}.description`, `Card ${col}`);
        return item;
    }

    beforeAll(async () => {
        const { a } = t;
        for (const name of GRID_NAMES) {
            const path = await showGrid(a, grid(name));
            paths.set(name, path);
            for (const col of [0, 0, 1, 2]) await addFull(a, path, col);
            // After the cards are there: one more, one dragged to another column, one deleted.
            await addFull(a, path, 1);
            const [first, second] = (await a.layout(path))[0];
            await a.drag(`${path}.${first}`, `${path}.${(await a.layout(path))[2][0]}`);
            await a.remove(`${path}.${second}`);
            await a.settledSheetMessages();
        }
    });

    const cards = async (p: Player, name: string) => {
        const path = paths.get(name)!;
        return (await p.layout(path)).flat().map(id => `${path}.${id}`);
    };
    const collapsedOf = (p: Player, items: string[]) => Promise.all(items.map(item => p.isCollapsed(item)));
    const deleteShown = (p: Player, items: string[]) => Promise.all(items.map(async path =>
        (await p.el({ path, sel: ":scope > .split-header .delete-button, :scope > .delete-button" }))
            .evaluate(el => getComputedStyle(el).display !== "none")));

    for (const name of GRID_NAMES) {
        for (const who of ["a", "b"] as const) {
            it(`${name}, ${who === "a" ? "A, who edited" : "B, who got the edits"}: Toggle Descs collapses and expands every card`, async () => {
                const p = t[who];
                await showGrid(p, grid(name));
                const items = await cards(p, name);
                expect(items, "four cards after the edits").toHaveLength(4);
                for (let i = 0; i < 2 && (await collapsedOf(p, items)).some(Boolean); i++) await p.click({ sel: "#toggle-descriptions" });
                expect(await collapsedOf(p, items), "all expanded").toEqual(items.map(() => false));
                await p.click({ sel: "#toggle-descriptions" });
                await eventually(() => collapsedOf(p, items), c => expect(c, "all collapsed").toEqual(items.map(() => true)));
                await p.click({ sel: "#toggle-descriptions" });
                await eventually(() => collapsedOf(p, items), c => expect(c, "all expanded again").toEqual(items.map(() => false)));
            });

            it(`${name}, ${who === "a" ? "A" : "B"}: Delete Mode shows the delete button of every card`, async () => {
                const p = t[who];
                await showGrid(p, grid(name));
                const items = await cards(p, name);
                expect(await deleteShown(p, items), "outside Delete Mode").toEqual(items.map(() => false));
                await p.setDeleteMode(true);
                expect(await deleteShown(p, items), "in Delete Mode").toEqual(items.map(() => true));
                await p.setDeleteMode(false);
                expect(await deleteShown(p, items), "after Delete Mode").toEqual(items.map(() => false));
            });
        }
    }
});
