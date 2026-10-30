// The material, inlay gem and Broken of Pathfinder Crusade gear items
// (blocks/Materials.tsx, state/materials.ts): Mithral picked from the
// suggestions halves the weight and adds AP, the effects line says what it
// does, a gem adds capacity for enchantments, Broken halves the AP. The armour
// totals count in the Armour block of Combat, and Mithral raises Max.A.
import { beforeAll, describe, expect, it } from "vitest";
import { enchantmentsOf, expectText, addGear, pickMaterial } from "../../lib/gear";
import type { Player } from "../../lib/player";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("materials", () => {
    const t = useTable("materials", { kind: "pathfinder_crusade" });
    let sword = "";
    let hauberk = "";

    const capacity = (item: string) => ({ path: enchantmentsOf(item), sel: ".ench-cap" });
    const title = (p: Player, path: string) => p.el(path).then(el => el.getAttribute("title"));

    /** Both players on Gear with the item expanded: each expands it as a user does. */
    async function showItem(item: string) {
        for (const p of [t.a, t.b]) {
            await p.openNavTab("gear");
            await p.setCollapsed(item, false);
        }
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        // A 60, over the hauberk's cap of 35.
        await a.write("characteristics.A.value", "60");
        sword = await addGear(a, "Longs", "Longsword");
        hauberk = await addGear(a, "Mail Ha", "Mail Hauberk");
    });

    it("Mithral picked on a weapon halves its weight and shows its effects for both players", async () => {
        const { a } = t;
        await showItem(sword);
        await a.expectValue(`${sword}.weight`, "1.6");
        expect(await a.exists(`${sword}.weightTotal`), "no total without a material").toBe(false);

        await pickMaterial(a, sword, "Mith", "Mithral");
        for (const p of [t.a, t.b]) {
            await p.expectValue(`${sword}.material.name`, "Mithral");
            await p.expectValue(`${sword}.weightTotal`, "0.8");
            expect(await p.hasClass(`${sword}.weightTotal`, "weight-total"), `${p.name}: dotted total`).toBe(true);
            expect(await title(p, `${sword}.weightTotal`)).toBe("1.6 Longsword\n× 0.5 Mithral\n= 0.8");
            // A weapon without a cap of A keeps the material's own text for Max.A.
            await expectText(p, `${sword}.materialEffects`, "wt ×0.5 · Pen +1 · Dur 2 · Cap ×1 · +20 Max.A");
            await expectText(p, capacity(sword), "0/8");
        }

        // The own weight is edited on focus.
        await a.click(`${sword}.weightTotal`);
        await eventually(() => a.page.evaluate(() => (window.__e2e.root().activeElement as HTMLElement | null)?.dataset.id ?? null),
            id => expect(id, "the own weight focused").toBe("weight"));
        await a.expectValue(`${sword}.weight`, "1.6");
        await a.closeDropdowns();
    });

    it("an inlay gem adds its bonus to the capacity for enchantments", async () => {
        const { a } = t;
        await showItem(sword);
        await (await a.el(`${sword}.inlay`)).selectOption("Ruby");
        for (const p of [t.a, t.b]) {
            await p.expectValue(`${sword}.inlay`, "Ruby");
            await expectText(p, capacity(sword), "0/12");
        }
        expect(await (await t.b.el(capacity(sword))).getAttribute("title")).toContain("Ruby");
    });

    it("Broken is a checkbox of weapons and armour, not of other gear", async () => {
        const { a, b } = t;
        await showItem(sword);
        await a.click(`${sword}.broken`);
        await b.expectValue(`${sword}.broken`, true);
        await a.click(`${sword}.broken`);
        await b.expectValue(`${sword}.broken`, false);

        await (await a.el(`${sword}.gearType`)).selectOption("tool");
        await eventually(() => b.exists(`${sword}.broken`), shown => expect(shown, "B: Broken of a tool").toBe(false));
        // The material stays on any gear.
        await b.expectValue(`${sword}.material.name`, "Mithral");
        await (await a.el(`${sword}.gearType`)).selectOption("weapon");
        await eventually(() => b.exists(`${sword}.broken`), shown => expect(shown, "B: Broken of a weapon").toBe(true));
    });

    it("Mithral on armour: the AP cells show the totals dotted, the own AP on focus", async () => {
        const { a } = t;
        await showItem(hauberk);
        await a.expectValue(`${hauberk}.armour.ap.torso`, "4");
        await pickMaterial(a, hauberk, "Mith", "Mithral");
        const torso = `${hauberk}.armour.ap.torsoTotal`;
        for (const p of [t.a, t.b]) {
            await p.expectValue(torso, "5");
            await p.expectValue(`${hauberk}.armour.ap.legsTotal`, "5");
            // The head is not covered: no total.
            await p.expectValue(`${hauberk}.armour.ap.head`, "–");
            expect(await p.hasClass(torso, "ap-total"), `${p.name}: the AP total class`).toBe(true);
            expect(await (await p.el(torso)).evaluate(el => getComputedStyle(el).textDecorationStyle), `${p.name}: dotted`).toBe("dotted");
            expect(await title(p, torso)).toBe("4 Mail Hauberk\n+1 Mithral\n= 5");
            await p.expectValue(`${hauberk}.weightTotal`, "5");
            // Max.A of the hauberk, 35, raised by Mithral, replaces "+20 Max.A".
            await expectText(p, `${hauberk}.materialEffects`, "wt ×0.5 · AP +1 · Max.A 55 · Dur 2 · Cap ×1");
            expect(await title(p, `${hauberk}.materialEffects.maxA`)).toBe("35 Mail Hauberk\n+20 Mithral\n= 55");
        }
        await a.click(torso);
        await a.expectValue(`${hauberk}.armour.ap.torso`, "4");
        await a.closeDropdowns();
        await a.expectValue(torso, "5");
    });

    it("the equipped armour's totals count in the Armour block, Broken halves them", async () => {
        const { a, b } = t;
        await showItem(hauberk);
        await a.click(`${hauberk}.equipped`);
        await b.expectValue(`${hauberk}.equipped`, true);
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await p.expectValue("armour.body.sum", "5");
            await p.expectValue("armour.leftArm.sum", "5");
            await p.expectValue("armour.head.sum", "0");
        }

        await showItem(hauberk);
        await a.click(`${hauberk}.broken`);
        for (const p of [a, b]) {
            await p.expectValue(`${hauberk}.armour.ap.torsoTotal`, "2");
            expect(await title(p, `${hauberk}.armour.ap.torsoTotal`)).toBe("4 Mail Hauberk\n+1 Mithral\n÷ 2 Broken\n= 2");
            await p.openNavTab("combat");
            await p.expectValue("armour.body.sum", "2");
        }
        await showItem(hauberk);
        await a.click(`${hauberk}.broken`);
        await b.openNavTab("combat");
        await b.expectValue("armour.body.sum", "5");
    });

    it("the equipped hauberk caps A at 55: Mithral's +20 over its 35", async () => {
        const { a, b } = t;
        for (const p of [a, b]) {
            await p.openNavTab("player");
            await p.expectValue("characteristics.A.calculatedValue", "55");
            await (await p.el("characteristics.A.calculatedValue")).hover();
            expect(await title(p, "characteristics.A.calculatedValue")).toContain("Mail Hauberk: at most 55 (35 +20 Mithral)");
        }
    });

    it("clearing the material drops its effects; a reload keeps the material and gem", async () => {
        const { a, b } = t;
        await a.reload();
        await showItem(sword);
        await a.expectValue(`${sword}.material.name`, "Mithral");
        await a.expectValue(`${sword}.inlay`, "Ruby");
        await a.expectValue(`${sword}.weightTotal`, "0.8");

        await a.click(`${sword}.material.name`);
        await a.page.keyboard.press("Control+A");
        await a.page.keyboard.press("Backspace");
        await a.closeSuggestions();
        for (const p of [a, b]) {
            await p.expectValue(`${sword}.weight`, "1.6");
            expect(await p.exists(`${sword}.materialEffects`), `${p.name}: no effects line`).toBe(false);
            // The gem alone: 8 + 4.
            await expectText(p, capacity(sword), "0/12");
        }
    });
});
