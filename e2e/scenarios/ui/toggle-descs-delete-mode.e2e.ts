// Toggle Descs and Delete Mode on every navigation tab, and
// Enter in the name of a collapsed item.
import { beforeAll, describe, expect, it } from "vitest";
import type { NavTab, Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

interface TabCase {
    tab: NavTab;
    grid: string;
    /** The field that gives an item content; powers and advancements always have some. */
    content?: string;
}

const CASES: TabCase[] = [
    { tab: "player", grid: "notes", content: "description" },
    { tab: "combat", grid: "powerShields", content: "rating" },
    { tab: "combat", grid: "rangedAttacks", content: "description" },
    { tab: "talents", grid: "talents", content: "description" },
    { tab: "gear", grid: "gear", content: "description" },
    { tab: "advancements", grid: "mutations", content: "description" },
    { tab: "advancements", grid: "experienceLog" },
    { tab: "psykana", grid: "psychicPowers" },
    { tab: "techno", grid: "techPowers" },
];

const TABS = [...new Set(CASES.map(c => c.tab))];

describe("Toggle Descs and Delete Mode", () => {
    const t = useTable("toggle descs");
    /** Items with content and without it, by case. */
    const items = new Map<TabCase, { full: string[]; empty: string[] }>();

    beforeAll(async () => {
        const { a } = t;
        for (const c of CASES) {
            const path = await showGrid(a, grid(c.grid));
            const first = await addItem(a, path);
            const second = await addItem(a, path);
            if (c.content) {
                await a.write(`${first}.${c.content}`, "Something to show");
                items.set(c, { full: [first], empty: [second] });
            } else {
                items.set(c, { full: [first, second], empty: [] });
            }
        }
    });

    const collapsedOf = (p: Player, paths: string[]) => Promise.all(paths.map(path => p.isCollapsed(path)));

    for (const tab of TABS) {
        it(`${tab}: Toggle Descs collapses every item and expands those with content`, async () => {
            const { a } = t;
            const cases = CASES.filter(c => c.tab === tab);
            const full = cases.flatMap(c => items.get(c)!.full);
            const empty = cases.flatMap(c => items.get(c)!.empty);
            await a.openNavTab(tab);

            // Whether a click expands depends on what is collapsed now: get to all expanded first.
            for (let i = 0; i < 2 && (await collapsedOf(a, full)).some(Boolean); i++) await a.click({ sel: "#toggle-descriptions" });
            expect(await collapsedOf(a, full), "items with content expanded").toEqual(full.map(() => false));
            expect(await collapsedOf(a, empty), "empty items stay collapsed").toEqual(empty.map(() => true));

            await a.click({ sel: "#toggle-descriptions" });
            await eventually(() => collapsedOf(a, [...full, ...empty]), c => expect(c, "all collapsed").toEqual([...full, ...empty].map(() => true)));

            await a.click({ sel: "#toggle-descriptions" });
            await eventually(() => collapsedOf(a, full), c => expect(c, "items with content expanded").toEqual(full.map(() => false)));
            expect(await collapsedOf(a, empty), "empty items are not expanded").toEqual(empty.map(() => true));
        });

        it(`${tab}: delete buttons show only in Delete Mode`, async () => {
            const { a } = t;
            const paths = CASES.filter(c => c.tab === tab).flatMap(c => [...items.get(c)!.full, ...items.get(c)!.empty]);
            await a.openNavTab(tab);
            const shown = () => Promise.all(paths.map(async path =>
                (await a.el({ path, sel: ":scope > .split-header .delete-button, :scope > .delete-button" }))
                    .evaluate(el => getComputedStyle(el).display !== "none")));
            expect(await shown(), "outside Delete Mode").toEqual(paths.map(() => false));
            await a.setDeleteMode(true);
            expect(await shown(), "in Delete Mode").toEqual(paths.map(() => true));
            await a.setDeleteMode(false);
            expect(await shown(), "after Delete Mode").toEqual(paths.map(() => false));
        });
    }

    for (const name of ["notes", "talents", "mutations"]) {
        it(`Enter in the name of a collapsed ${name} item expands it and focuses the description`, async () => {
            const { a } = t;
            const c = CASES.find(c => c.grid === name)!;
            const item = items.get(c)!.full[0];
            await showGrid(a, grid(name));
            await a.setCollapsed(item, true);
            await a.click(`${item}.name`);
            await a.page.keyboard.press("Enter");
            await eventually(() => a.isCollapsed(item), v => expect(v, "expanded").toBe(false));
            await eventually(() => a.page.evaluate(() => {
                const el = window.__e2e.root().activeElement;
                return el ? window.__e2e.pathOf(el) : null;
            }), path => expect(path, "focused").toBe(`${item}.description`));
        });
    }
});
