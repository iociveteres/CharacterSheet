// Picking an entry of a collection in a name field replaces the
// item with the entry laid over a new item, for both players and the stored
// sheet. The queries need the collections of internal/gamedata/assets.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, openTab, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

interface Case {
    collection: string;
    grid: string;
    query: string;
    /** A text field set before the pick: afterwards it has the entry's value or none. */
    stale?: string;
    /** The rollDefaults key of the roll the new item starts with. */
    roll?: string;
    /** A power starts tested on the first test option of its block. */
    power?: boolean;
}

const CASES: Case[] = [
    { collection: "talents", grid: "talents", query: "Comb", stale: "description" },
    { collection: "traits", grid: "traits", query: "Amor", stale: "description" },
    { collection: "powerShields", grid: "powerShields", query: "Refr", stale: "description" },
    { collection: "gear", grid: "gear", query: "Gamb", stale: "description" },
    { collection: "cybernetics", grid: "cybernetics", query: "Bion", stale: "description" },
    { collection: "advancements", grid: "experienceLog", query: "WS +" },
    { collection: "ranged", grid: "rangedAttacks", query: "Flin", stale: "upgrades", roll: "rangedAttack" },
    { collection: "melee", grid: "meleeAttacks", query: "Warh", stale: "grip", roll: "meleeAttack" },
    { collection: "psychicPowers", grid: "psychicPowers", query: "Spar", stale: "subtypes", roll: "psychicPower", power: true },
    { collection: "techPowers", grid: "techPowers", query: "Volt", stale: "subtypes", roll: "techPower", power: true },
];

/**
 * Ids of a one-column grid of an entry in the order the sheet shows them
 * (columnsFromLayout): by row, then by id. Melee tabs of the collections come
 * without layouts, so their order is that of their random ids.
 */
const byLayout = (grid: { items: object; layouts?: { [id: string]: { rowIndex: number } } }) => {
    const row = (id: string) => grid.layouts?.[id]?.rowIndex ?? Infinity;
    return Object.keys(grid.items).sort((p, q) => row(p) - row(q) || (p < q ? -1 : p > q ? 1 : 0));
};

describe("autocomplete", () => {
    const t = useTable("autocomplete");
    let rollDefaults: any;

    beforeAll(async () => {
        rollDefaults = (await t.a.sheetState()).rollDefaults;
    });

    for (const c of CASES) {
        it(`${c.collection}: the picked entry fills the item for both players and after a reload`, async () => {
            const { a, b } = t;
            const item = await addItem(a, await showGrid(a, grid(c.grid)));
            const stale = c.stale && `${item}.${c.stale}`;
            if (stale) await a.write(stale, "e2e stale");

            await a.clearRecords();
            await a.click(`${item}.name`);
            await a.page.keyboard.type(c.query);
            const query = await a.waitSent(m => m.type === "autocomplete", "the query");
            expect(query).toMatchObject({ collection: c.collection, query: c.query });
            const result = await a.waitReceived(m => m.type === "autocompleteResult" && m.eventID === query.eventID, "the results");
            expect(result.results.length, "results").toBeGreaterThan(0);

            await eventually(() => a.count({ sel: ".autocomplete-dropdown" }), n => expect(n, "the dropdown").toBe(1));
            const dropdown = await a.el({ sel: ".autocomplete-dropdown" });
            expect(await dropdown.evaluate((el, path) => {
                const anchor = el.parentElement!;
                return anchor.classList.contains("autocomplete-anchor")
                    && window.__e2e.pathOf(anchor.previousElementSibling!) === path;
            }, `${item}.name`), "the dropdown is in the anchor next to the field").toBe(true);

            await a.click({ sel: ".autocomplete-dropdown .autocomplete-option", nth: 0 });
            const picked = result.results[0].name;
            const apply = await a.waitSent(m => m.type === "autocompleteApply", "autocompleteApply");
            const roll = c.roll && { ...rollDefaults[c.roll], ...(c.power && { testOption: "test-option-1" }) };
            const base = roll ? { roll } : c.grid === "gear" ? { carried: true } : {};
            expect(apply).toMatchObject({ path: item, collection: c.collection, name: picked, base });
            expect(await a.count({ sel: ".autocomplete-dropdown" }), "closed").toBe(0);

            const applied = await a.waitReceived(m => m.type === "autocompleteApplied" && m.path === item, "autocompleteApplied");
            const entry = applied.changes;
            expect(entry.name).toBe(picked);
            await b.waitReceived(m => m.type === "autocompleteApplied" && m.path === item, "autocompleteApplied");

            const check = async (p: Player, when: string) => {
                await p.expectValue(`${item}.name`, picked);
                if (stale && await p.exists(stale)) expect(await p.read(stale), `${p.name} ${when}: ${c.stale}`).toBe(String(entry[c.stale!] ?? ""));
                if (c.collection === "melee") {
                    const tabs = `${item}.tabs.items`;
                    expect(await tabIds(p, tabs), `${p.name} ${when}: profile tabs`).toEqual(byLayout(entry.tabs));
                    expect(await openTab(p, tabs), `${p.name} ${when}: the first tab is open`).toBe(byLayout(entry.tabs)[0]);
                }
                if (c.collection === "gear") {
                    expect((await p.layout(`${item}.entries.items`)).flat(), `${p.name} ${when}: entries`).toEqual(byLayout(entry.entries));
                }
            };
            await check(a, "now");
            await check(b, "now");

            const stored = await a.exported(t.sheet);
            const [top, ...rest] = item.split(".");
            expect(rest.reduce((node: any, key) => node?.[key], stored[top]), "stored item").toEqual(entry);
            await a.reload();
            await check(a, "after a reload");
        });
    }
});
