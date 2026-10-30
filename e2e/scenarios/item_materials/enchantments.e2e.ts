// The enchantments of Pathfinder Crusade gear items (blocks/Enchantments.tsx,
// state/enchantments.ts): one picked from the suggestions of ＋ is a chip,
// its level chips choose the capacity it takes and copy the level's text and
// Special, the counter of the item's capacity follows and turns red over it.
// Feather lightens the item; Agile raises Max.A as a Cap Bonus of the item.
import { beforeAll, describe, expect, it } from "vitest";
import { addEnchantment, addGear, chips, enchantmentsOf, expectText, levelChips, pickMaterial, typeInto } from "../../lib/gear";
import type { Player } from "../../lib/player";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("enchantments", () => {
    const t = useTable("enchantments", { kind: "pathfinder_crusade" });
    let sword = "";
    let flaming = "";
    let hauberk = "";
    let agile = "";

    const counter = (item: string) => ({ path: enchantmentsOf(item), sel: ".ench-cap" });

    async function showItem(item: string) {
        for (const p of [t.a, t.b]) {
            await p.openNavTab("gear");
            await p.setCollapsed(item, false);
        }
    }

    /** Opens the details of the enchantment at `path`, named `name`, with a click on its chip unless they are open. */
    async function openChip(p: Player, item: string, path: string, name: string) {
        if (await p.exists(`${path}.name`)) return;
        const nth = (await chips(p, enchantmentsOf(item))).findIndex(c => c.startsWith(name));
        await p.click({ path: enchantmentsOf(item), sel: ":scope > .mods-row > .mod-chip > .mod-chip-name", nth });
        await eventually(() => p.exists(`${path}.name`), shown => expect(shown, `${p.name}: details of ${name}`).toBe(true));
    }

    beforeAll(async () => {
        const { a } = t;
        sword = await addGear(a, "Longs", "Longsword");
        hauberk = await addGear(a, "Mail Ha", "Mail Hauberk");
        await pickMaterial(a, hauberk, "Mith", "Mithral");
        await a.click(`${hauberk}.equipped`);
        await a.openNavTab("player");
        await a.write("characteristics.A.value", "70");
    });

    it("＋ and a suggestion add an enchantment at its first level, open, for both players", async () => {
        const { a, b } = t;
        await showItem(sword);
        await expectText(a, counter(sword), "0/8");
        flaming = await addEnchantment(a, sword, "Flam", "Flaming");
        expect(flaming.startsWith(`${enchantmentsOf(sword)}.ench-`), flaming).toBe(true);

        await eventually(() => chips(a, enchantmentsOf(sword)), c => expect(c, "A: chips").toEqual(["[Flaming 1]"]));
        await eventually(() => levelChips(a, flaming), c => expect(c, "A: levels").toEqual(["[1]", "3", "7", "12"]));
        await a.expectValue(`${flaming}.special`, "Flame (d5)");
        await expectText(a, counter(sword), "1/8");

        await eventually(() => chips(b, enchantmentsOf(sword)), c => expect(c, "B: chips").toEqual(["Flaming 1"]));
        await expectText(b, counter(sword), "1/8");
    });

    it("a level chip takes that capacity and copies its text and Special", async () => {
        const { a, b } = t;
        await showItem(sword);
        await openChip(a, sword, flaming, "Flaming");
        await a.click({ path: flaming, sel: ".level-chip", text: "3" });
        await eventually(() => levelChips(a, flaming), c => expect(c, "A: levels").toEqual(["1", "[3]", "7", "12"]));
        await a.expectValue(`${flaming}.special`, "Flame (d10)");
        await a.expectValue(`${flaming}.description`, "Оружие получает свойство Flame (d10).");
        for (const p of [a, b]) {
            await eventually(() => chips(p, enchantmentsOf(sword)).then(c => c.map(s => s.replace(/[[\]]/g, ""))),
                c => expect(c, `${p.name}: chips`).toEqual(["Flaming 3"]));
            await expectText(p, counter(sword), "3/8");
        }

        await openChip(b, sword, flaming, "Flaming");
        await eventually(() => levelChips(b, flaming), c => expect(c, "B: levels").toEqual(["1", "[3]", "7", "12"]));
        await b.expectValue(`${flaming}.special`, "Flame (d10)");
    });

    it("over the capacity the counter is red, and the level can still be chosen", async () => {
        const { a, b } = t;
        await showItem(sword);
        await openChip(a, sword, flaming, "Flaming");
        await a.click({ path: flaming, sel: ".level-chip", text: "12" });
        for (const p of [a, b]) {
            await expectText(p, counter(sword), "12/8");
            await eventually(() => p.hasClass(counter(sword), "over"), over => expect(over, `${p.name}: red`).toBe(true));
        }
        expect(await (await a.el(counter(sword))).getAttribute("title")).toContain("The enchantments take more");
        await a.click({ path: flaming, sel: ".level-chip", text: "3" });
        await expectText(b, counter(sword), "3/8");
        expect(await b.hasClass(counter(sword), "over")).toBe(false);
    });

    it("its Special is edited in place; another level replaces the edit", async () => {
        const { a, b } = t;
        await showItem(sword);
        await openChip(a, sword, flaming, "Flaming");
        await openChip(b, sword, flaming, "Flaming");
        await a.write(`${flaming}.special`, "Flame (d10), Bright");
        await b.expectValue(`${flaming}.special`, "Flame (d10), Bright");
        await a.reload();
        await showItem(sword);
        await openChip(a, sword, flaming, "Flaming");
        await a.expectValue(`${flaming}.special`, "Flame (d10), Bright");
    });

    it("Feather halves the weight; a typed own enchantment takes a typed capacity", async () => {
        const { a, b } = t;
        await showItem(sword);
        await addEnchantment(a, sword, "Feath", "Feather");
        for (const p of [a, b]) {
            await p.expectValue(`${sword}.weightTotal`, "0.8");
            await expectText(p, counter(sword), "5/8");
        }
        expect(await (await a.el(`${sword}.weightTotal`)).getAttribute("title")).toBe("1.6 Longsword\n× 0.5 Feather\n= 0.8");

        // Enter on a name the rulebook lacks adds it with no levels.
        await a.click({ path: enchantmentsOf(sword), sel: ":scope > .mods-row > .add-mod" });
        await typeInto(a, { path: enchantmentsOf(sword), sel: ".mod-add input" }, "Glowing Runes");
        await a.closeSuggestions();
        await a.click({ path: enchantmentsOf(sword), sel: ".mod-add input" });
        await a.page.keyboard.press("Enter");
        await eventually(() => chips(a, enchantmentsOf(sword)), c => expect(c, "A: chips").toEqual(["Flaming 3", "Feather 2", "[Glowing Runes]"]));
        const own = (await a.sent("createItem")).at(-1)!;
        const glowing = `${enchantmentsOf(sword)}.${own.itemId}`;
        expect(await a.count({ path: glowing, sel: ".level-chip" }), "no level chips").toBe(0);
        await a.write(`${glowing}.capacity`, "2");
        await expectText(b, counter(sword), "7/8");
    });

    it("Agile raises the armour's Max.A with Mithral, and A of the character with it", async () => {
        const { a, b } = t;
        await showItem(hauberk);
        for (const p of [a, b]) await expectText(p, { path: `${hauberk}.materialEffects`, sel: ".raised-cap" }, "Max.A 55");
        agile = await addEnchantment(a, hauberk, "Agil", "Agile");
        await a.click({ path: agile, sel: ".level-chip", text: "3" });
        for (const p of [a, b]) {
            await expectText(p, { path: `${hauberk}.materialEffects`, sel: ".raised-cap" }, "Max.A 65");
            expect(await (await p.el(`${hauberk}.materialEffects.maxA`)).getAttribute("title")).toBe("35 Mail Hauberk\n+20 Mithral\n+10 Agile\n= 65");
            await p.openNavTab("player");
            await p.expectValue("characteristics.A.calculatedValue", "65");
            await (await p.el("characteristics.A.calculatedValue")).hover();
            expect(await (await p.el("characteristics.A.calculatedValue")).getAttribute("title"))
                .toContain("Mail Hauberk: at most 65 (35 +20 Mithral +10 Agile)");
        }
    });

    it("an enchantment deleted with ✖ in Delete Mode frees its capacity", async () => {
        const { a, b } = t;
        await showItem(hauberk);
        await a.setDeleteMode(true);
        await a.click({ path: enchantmentsOf(hauberk), sel: ":scope > .mods-row > .mod-chip .mod-delete" });
        await a.setDeleteMode(false);
        for (const p of [a, b]) {
            await eventually(() => chips(p, enchantmentsOf(hauberk)), c => expect(c, `${p.name}: chips`).toEqual([]));
            await expectText(p, { path: `${hauberk}.materialEffects`, sel: ".raised-cap" }, "Max.A 55");
        }
    });
});
