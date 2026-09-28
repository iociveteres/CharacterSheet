// Entries of conditions, gear and implants: the first entry, the
// fields an entry type shows, and what entries of equipped gear add.
import { describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

/** Fields and name placeholder an entry of each type shows. */
const TYPES = {
    char_bonus: { placeholder: "WS, BS or Any -T", fields: ["bonus", "unnaturalBonus"] },
    skill_bonus: { placeholder: "Skill name", fields: ["skillBonus"] },
    ablative_wounds: { placeholder: null, fields: ["ablativeWounds"] },
    bonus_ap: { placeholder: null, fields: ["apType", "apValue"] },
} as const;

const VALUE_FIELDS = ["bonus", "unnaturalBonus", "cap", "overrideValue", "overrideUnnatural", "rollBonus", "skillBonus",
    "ablativeWounds", "initiativeBonus", "movementBonus", "apType", "apValue"];

async function expectEntryOfType(p: Player, entry: string, type: keyof typeof TYPES) {
    const { placeholder, fields } = TYPES[type];
    await p.expectValue(`${entry}.type`, type);
    expect(await p.attr(`${entry}.name`, "placeholder"), `${p.name}: placeholder of ${type}`).toBe(placeholder);
    const shown = [];
    for (const f of VALUE_FIELDS) if (await p.exists(`${entry}.${f}`)) shown.push(f);
    expect(shown, `${p.name}: fields of ${type}`).toEqual(fields);
}

describe("entries of conditions, gear and implants", () => {
    const t = useTable("entries");

    for (const name of ["gear", "cybernetics"]) {
        it(`＋ condition adds the first entry of a ${name} item and goes away`, async () => {
            const { a, b } = t;
            const path = await showGrid(a, grid(name));
            const item = await addItem(a, path);
            await a.setCollapsed(item, false);
            const itemId = item.split(".").pop()!;
            await a.clearRecords();
            await a.click({ path: item, sel: ".add-first-condition" });
            const msg = await a.waitSent(m => m.type === "createItem", "createItem of the entry");
            expect(msg).toMatchObject({ path: `${item}.entries.items`, itemPos: { colIndex: 0, rowIndex: 0 }, init: {} });
            expect(msg.itemId).toMatch(new RegExp(`^entries-${itemId}-`));
            expect(await a.exists({ path: item, sel: ".add-first-condition" })).toBe(false);
            await eventually(() => b.layout(`${item}.entries.items`), l => expect(l, "B").toEqual([[msg.itemId]]));
            expect(await b.exists({ path: item, sel: ".add-first-condition" })).toBe(false);
        });
    }

    for (const name of ["conditions", "gear", "cybernetics"]) {
        it(`the type of a ${name} entry picks its fields, for B too`, async () => {
            const { a, b } = t;
            const path = await showGrid(a, grid(name));
            const item = await addItem(a, path);
            await a.setCollapsed(item, false);
            const entries = `${item}.entries.items`;
            if (name !== "conditions") await a.click({ path: item, sel: ".add-first-condition" });
            const entryId = await eventually(async () => (await a.layout(entries)).flat()[0], id => expect(id).toBeDefined());
            const entry = `${entries}.${entryId}`;
            await eventually(() => b.layout(entries), l => expect(l, "B has the same entry").toEqual([[entryId]]));
            for (const type of Object.keys(TYPES) as (keyof typeof TYPES)[]) {
                await a.write(`${entry}.type`, type);
                await expectEntryOfType(a, entry, type);
                await eventually(() => b.read(`${entry}.type`), v => expect(v).toBe(type));
                await expectEntryOfType(b, entry, type);
            }
        });
    }

    it("a char_bonus entry of equipped gear adds to the characteristic until unequipped or deleted", async () => {
        const { a, b } = t;
        await a.write("characteristics.WS.value", "40");
        const ws = async (value: string) => {
            await a.expectValue("characteristics.WS.calculatedValue", value);
            await b.expectValue("characteristics.WS.calculatedValue", value);
        };
        await ws("40");

        const path = await showGrid(a, grid("gear"));
        const item = await addItem(a, path);
        await a.setCollapsed(item, false);
        const addBonus = async () => {
            await a.click({ path: item, sel: ".add-first-condition" });
            const entryId = await eventually(async () => (await a.layout(`${item}.entries.items`)).flat()[0], id => expect(id).toBeDefined());
            const entry = `${item}.entries.items.${entryId}`;
            await a.write(`${entry}.type`, "char_bonus");
            await a.write(`${entry}.name`, "WS");
            await a.write(`${entry}.bonus`, "5");
            return entry;
        };
        const entry = await addBonus();
        await ws("40");

        await a.write(`${item}.equipped`, true);
        await ws("45");
        await a.write(`${item}.equipped`, false);
        await ws("40");
        await a.write(`${item}.equipped`, true);
        await ws("45");

        await a.remove(entry);
        await ws("40");

        await addBonus();
        await ws("45");
        await a.remove(item);
        await ws("40");
    });
});
