// The damage of a weapon with its modifiers (blocks/DamageField.tsx): the
// total follows the characteristics and the modifiers for the player who
// edits and for the other one, and the edits survive a reload.
import { beforeAll, describe, expect, it } from "vitest";
import type { Query, Roll } from "../../lib/probes";
import { addItem, addTab, grid, selectTab, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("damage modifiers", () => {
    const t = useTable("damage");
    let melee: string;
    let tab: string;
    let ranged: string;
    let mod: string;

    /** Both players show `value` as the damage of the attack or profile at `path`. */
    async function total(path: string, value: string) {
        for (const p of [t.a, t.b]) await p.expectValue(`${path}.damageTotal`, value);
    }

    beforeAll(async () => {
        const { a } = t;
        await a.write("characteristics.S.value", "42");
        await a.write("characteristics.WS.value", "35");
        melee = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        tab = `${melee}.tabs.items.${(await tabIds(a, `${melee}.tabs.items`))[0]}`;
        await a.write(`${melee}.name`, "Chainaxe");
        await a.openDamage(tab);
        await a.write(`${tab}.damage`, "1d10+2");
        ranged = await addItem(a, await showGrid(a, grid("rangedAttacks")));
        await a.write(`${ranged}.name`, "Bolter");
        await a.openDamage(ranged);
        await a.write(`${ranged}.damage`, "1d10+5");
    });

    it("a new melee profile adds the Strength bonus, which follows S for both players", async () => {
        // 1d10 + 2 + S.b 4.
        await total(tab, "1d10+6");
        await total(ranged, "1d10+5");
        await t.a.write("characteristics.S.value", "55");
        await total(tab, "1d10+7");
    });

    it("a modifier A adds counts for B while it is enabled, and a reload keeps it", async () => {
        const { a } = t;
        await a.openDamage(tab);
        const created = await a.add(`${tab}.damageMods.items`);
        expect(created.init).toEqual({ enabled: true });
        mod = `${tab}.damageMods.items.${created.itemId}`;
        await a.write(`${mod}.expr`, "½WS.b▲");
        // S.b 5 + ½ × WS.b 3, rounded up.
        await total(tab, "1d10+9");

        await a.write(`${mod}.enabled`, false);
        await total(tab, "1d10+7");
        await a.write(`${mod}.enabled`, true);
        await total(tab, "1d10+9");

        await a.reload();
        await a.expectValue(`${tab}.damageTotal`, "1d10+9");
        await a.openDamage(tab);
        await a.expectValue(`${mod}.expr`, "½WS.b▲");
    });

    it("a term that reads as nothing is marked and leaves its modifier out", async () => {
        const { a } = t;
        await a.openDamage(tab);
        // A term that can become nothing, so it is marked while the field has the focus too.
        await a.write(`${mod}.expr`, "½WS.b▲ + Zz.b");
        await total(tab, "1d10+7");
        await eventually(() => a.hasClass(`${mod}.expr`, "invalid"), v => expect(v, "outlined").toBe(true));
        expect(await (await a.el({ path: mod, sel: ".text-marks mark" })).evaluate(el => el.textContent)).toBe("Zz.b");

        await a.write(`${mod}.expr`, "½WS.b▲");
        await total(tab, "1d10+9");
    });

    it("a new profile tab takes the modifiers of the first one", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        const created = await addTab(a, `${melee}.tabs.items`);
        const mods = Object.values(created.init.damageMods.items);
        expect(mods).toEqual([{ expr: "S.b", enabled: true }, { expr: "½WS.b▲", enabled: true }]);
        const newTab = `${melee}.tabs.items.${created.itemId}`;
        await a.openDamage(newTab);
        await a.write(`${newTab}.damage`, "1d5");
        await total(newTab, "1d5+7");
    });

    it("Copy from replaces the modifiers of the ranged attack with those of the profile", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        await a.openDamage(ranged);
        await a.clearRecords();
        await (await a.el({ path: ranged, sel: "select.damage-copy" })).selectOption(tab);
        const batch = await a.waitSent(m => m.type === "batch" && m.path === ranged, "the batch of the copy");
        expect(Object.values(batch.changes.damageMods.items)).toEqual([{ expr: "S.b", enabled: true }, { expr: "½WS.b▲", enabled: true }]);
        // 1d10 + 5 + S.b 5 + 2.
        await total(ranged, "1d10+12");
        expect(await (await a.el({ path: ranged, sel: "select.damage-copy" })).evaluate(el => (el as HTMLSelectElement).value)).toBe("");
    });

    it("the damage label rolls the total, labelled by the weapon and profile", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        await selectTab(a, `${melee}.tabs.items`, tab.split(".").at(-1)!);
        await a.blockRolls();
        const rollOf = async (q: Query): Promise<Roll> => {
            await a.clearRecords();
            await a.click(q);
            const rolls = await a.rolls();
            expect(rolls, `rolls of ${JSON.stringify(q)}`).toHaveLength(1);
            return rolls[0];
        };
        expect(await rollOf({ path: tab, sel: ".damage label.rollable" }))
            .toEqual({ kind: "exact", expression: "1d10+9", label: "Chainaxe, mace" });
        expect(await rollOf({ path: ranged, sel: ".damage label.rollable" }))
            .toEqual({ kind: "exact", expression: "1d10+12", label: "Bolter" });
        await a.blockRolls(false);
    });
});
