// The grips of a melee weapon (blocks/Grips.tsx): the grip string edited
// under ✎ shows as chips, and the chip held changes the weapon's Range,
// Balance, damage, Special and Parry for both players. Parry rolls from its
// label, and a Weapon entry of a condition adds to the Range of the weapons
// it names.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("melee grips and parry", () => {
    const t = useTable("grips");
    let melee: string;
    let tab: string;
    /** The Parry skill of the sheet, the base of a weapon's Parry. */
    let skill: number;

    const chip = (id: string) => ({ path: melee, sel: ".grip-chip", text: id });

    /** The weapon as both players show it on Combat. */
    async function weapon(want: { range: string; balance: string; damage: string; parry: string; added: string | null }) {
        for (const p of [t.a, t.b]) {
            await p.openNavTab("combat");
            await eventually(async () => ({
                range: await p.read(`${tab}.rangeTotal`),
                balance: await p.read(`${melee}.balanceTotal`),
                damage: await p.read(`${tab}.damageTotal`),
                parry: await p.read(`${melee}.parryTotal`),
                added: await p.exists(`${tab}.addedProperties`)
                    ? await (await p.el(`${tab}.addedProperties`)).evaluate(el => el.textContent)
                    : null,
            }), v => expect(v, `${p.name}: the weapon`).toEqual(want));
        }
    }

    /** The chips of the weapon and the one held, as `p` shows them. */
    const chips = (p: Player) => p.page.evaluate(path => window.__e2e.findAll({ path, sel: ".grip-chip" })
        .map(el => (el.classList.contains("selected") ? `[${el.textContent}]` : el.textContent)), melee);

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.WS.value", "40");
        await a.write("characteristics.S.value", "30");
        skill = Number(await a.read("skillsLeft.parry.difficulty"));

        melee = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        tab = `${melee}.tabs.items.${(await tabIds(a, `${melee}.tabs.items`))[0]}`;
        await a.write(`${melee}.name`, "Longsword");
        await a.closeSuggestions();
        await a.write(`${tab}.profile`, "sword");
        await a.write(`${tab}.special`, "Primitive");

        // A click on a total opens its window at the weapon's own value.
        await a.click(`${tab}.rangeTotal`);
        await a.write(`${tab}.range`, "2");
        await a.closeDropdowns();
        await a.click(`${melee}.balanceTotal`);
        await a.write(`${melee}.balance`, "1");
        await a.closeDropdowns();
        await a.openMods(tab, "damage");
        await a.write(`${tab}.damage`, "1d10+2");
        await a.closeDropdowns();
        await a.blockRolls();
    });

    it("a grip string typed in Russian under ✎ shows English chips, the primary held", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click({ path: melee, sel: ".grip-edit" });
        await a.page.keyboard.type("2р [1р, Бл]");
        await a.page.keyboard.press("Enter");
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            await eventually(() => chips(p), v => expect(v, `${p.name}: the chips`).toEqual(["[2h]", "1h", "Cl"]));
        }
        // The primary grip is the weapon as typed: S.b 3 in the damage, Balance 1 gives Parry +10.
        await weapon({ range: "2", balance: "1", damage: "1d10+5", parry: String(skill + 10), added: null });
    });

    it("1h: Rng +1, Balance −1, a die less with −4 for a single one, WS −5 in Parry", async () => {
        const { a, b } = t;
        await a.click(chip("1h"));
        for (const p of [a, b]) await eventually(() => chips(p), v => expect(v, `${p.name}: the chips`).toEqual(["2h", "[1h]", "Cl"]));
        await weapon({ range: "3", balance: "0", damage: "1d10+1", parry: String(skill - 5), added: null });

        await a.click({ path: melee, sel: ".layout-row.balance .mod-toggle" });
        const breakdown = await (await a.el({ path: melee, sel: ".layout-row.balance .breakdown" })).evaluate(el => el.textContent);
        expect(breakdown).toBe("-11h0");
        await a.closeDropdowns();
    });

    it("Cl: Rng −2 down to 0, Precise after Special, Balance −2 that cannot parry", async () => {
        const { a, b } = t;
        await a.click(chip("Cl"));
        await weapon({ range: "0", balance: "-2", damage: "1d10+5", parry: "—", added: "+ Precise" });
        for (const p of [a, b]) {
            expect(await p.hasClass(`${melee}.parryTotal`, "dimmed"), `${p.name}: Parry dimmed`).toBe(true);
            expect(await p.hasClass({ path: melee, sel: ".layout-row.parry label" }, "dimmed"), `${p.name}: Parry: dimmed`).toBe(true);
        }
        // It still rolls, without the Balance's modifier: the rules only warn.
        await a.clearRecords();
        await a.click({ path: melee, sel: ".layout-row.parry label.rollable" });
        expect(await a.rolls()).toEqual([{ kind: "versus", target: skill, bonusSuccesses: 0, label: "Longsword (Cl), Parry" }]);
    });

    it("the primary chip takes the grip's changes back, and a reload keeps the grip held", async () => {
        const { a } = t;
        await a.click(chip("2h"));
        await weapon({ range: "2", balance: "1", damage: "1d10+5", parry: String(skill + 10), added: null });

        await a.click(chip("1h"));
        await weapon({ range: "3", balance: "0", damage: "1d10+1", parry: String(skill - 5), added: null });
        await a.reload();
        await a.openNavTab("combat");
        await eventually(() => chips(a), v => expect(v, "after a reload").toEqual(["2h", "[1h]", "Cl"]));
    });

    it("Parry: rolls the weapon's Parry with its modifiers, naming a grip not the primary", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click({ path: melee, sel: ".layout-row.parry .mod-toggle" });
        const created = await a.add(`${melee}.parryMods.items`);
        const mod = `${melee}.parryMods.items.${created.itemId}`;
        await a.write(`${mod}.expr`, "10");
        await eventually(async () => (await a.el(`${mod}.added`)).evaluate(el => el.textContent), v => expect(v, "what it adds").toBe("+10"));
        await a.closeDropdowns();
        await weapon({ range: "3", balance: "0", damage: "1d10+1", parry: String(skill + 5), added: null });

        await a.clearRecords();
        await a.click({ path: melee, sel: ".layout-row.parry label.rollable" });
        expect(await a.rolls()).toEqual([{ kind: "versus", target: skill + 5, bonusSuccesses: 0, label: "Longsword (1h), Parry" }]);
        expect(await b.read(`${melee}.parryTotal`)).toBe(String(skill + 5));
    });

    it("a Weapon entry of a condition adds to the Range of the weapons it names while it is on", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click(chip("2h"));
        const range = async (value: string) => {
            for (const p of [a, b]) {
                await p.openNavTab("combat");
                await p.expectValue(`${tab}.rangeTotal`, value);
            }
        };
        await range("2");

        const condition = await addItem(a, await showGrid(a, grid("conditions")));
        await a.write(`${condition}.name`, "Long Arms");
        await a.closeSuggestions();
        const entries = `${condition}.entries.items`;
        const entry = `${entries}.${(await a.layout(entries)).flat()[0]}`;
        await a.write(`${entry}.type`, "weapon_bonus");
        await a.write(`${entry}.weaponField`, "rng");
        await a.write(`${entry}.weaponBonus`, "2");
        await a.write(`${entry}.name`, "sword");
        await a.closeDropdowns();
        await range("4");
        await a.openNavTab("combat");
        expect(await a.attr(`${tab}.rangeTotal`, "title")).toBe("2 Weapon\n+2 Long Arms\n= 4");

        // A word that names no weapon turns the entry off.
        await a.openCharacteristics();
        await a.write(`${entry}.name`, "sword, spoon");
        await a.closeDropdowns();
        await range("2");
        await a.openCharacteristics();
        await a.write(`${entry}.name`, "Longsword");
        await a.closeDropdowns();
        await range("4");

        await a.openCharacteristics();
        await a.write(`${condition}.enabled`, false);
        await range("2");
    });
});
