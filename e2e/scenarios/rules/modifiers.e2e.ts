// What modifiers do once they are there: an entry's value and its
// condition's stacks in the characteristic and its roll, a skill bonus
// waiting for its skill, a weapon entry and the name of the weapon it names,
// the talents that add to every weapon and the modifiers dropdown that lists
// what each part adds; for the player who edits and for the other one.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("modifiers", () => {
    const t = useTable("modifiers");
    const players = () => [t.a, t.b];
    let condition: string;
    let entry: string;

    /** Both players show `value` as WS and roll it against `value`. */
    async function ws(value: number) {
        for (const p of players()) {
            await p.openNavTab("player");
            await p.expectValue("characteristics.WS.calculatedValue", String(value));
            await p.clearRecords();
            await p.click({ path: "characteristics.WS", sel: "label.rollable" });
            await eventually(() => p.rolls(), r => expect(r.map(x => x.kind === "versus" ? x.target : NaN), `${p.name}: WS roll`).toEqual([value]));
        }
    }

    /** The class `cls` of the name of `entryPath` for both players, who open the characteristics to see it. */
    async function nameHasClass(entryPath: string, cls: string, on: boolean) {
        for (const p of players()) {
            await p.openCharacteristics();
            await eventually(() => p.hasClass(`${entryPath}.name`, cls), v => expect(v, `${p.name}: ${cls}`).toBe(on));
        }
    }

    /** A new entry of `type` named `name` in the condition, last in its grid. */
    async function addEntry(type: string, name: string): Promise<string> {
        const { a } = t;
        await a.openCharacteristics();
        const created = await a.add(`${condition}.entries.items`);
        const path = `${condition}.entries.items.${created.itemId}`;
        await a.write(`${path}.type`, type);
        await a.write(`${path}.name`, name);
        await a.closeSuggestions();
        return path;
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        for (const [key, value] of [["WS", 40], ["BS", 35], ["S", 30]] as const) await a.write(`characteristics.${key}.value`, String(value));
        for (const p of players()) await p.blockRolls();
        condition = await addItem(a, await showGrid(a, grid("conditions")));
        await a.setCollapsed(condition, false);
        const entryId = await eventually(async () => (await a.layout(`${condition}.entries.items`)).flat()[0], id => expect(id).toBeDefined());
        entry = `${condition}.entries.items.${entryId}`;
        await a.write(`${entry}.type`, "char_bonus");
        await a.write(`${entry}.name`, "WS");
        await a.closeSuggestions();
        for (const p of players()) await p.openCharacteristics();
        await t.b.setCollapsed(condition, false);
    });

    describe("an entry's value and stacks", () => {
        it("+5 then +10 raises WS and its roll", async () => {
            const { a } = t;
            await a.openCharacteristics();
            await a.write(`${entry}.bonus`, "5");
            await ws(45);
            await a.openCharacteristics();
            await a.write(`${entry}.bonus`, "10");
            await ws(50);
        });

        it("5X counts once per stack of the condition", async () => {
            const { a } = t;
            await a.openCharacteristics();
            await a.write(`${entry}.bonus`, "5X");
            await a.write(`${condition}.stacks`, "2");
            await ws(50);
            await a.openCharacteristics();
            await a.write(`${condition}.stacks`, "3");
            await ws(55);
            await a.openCharacteristics();
            await a.write(`${condition}.stacks`, "1");
            await ws(45);
        });

        it("a second entry adds to the first, and deleting it takes its part away", async () => {
            const second = await addEntry("char_bonus", "WS");
            await t.a.write(`${second}.bonus`, "3");
            await ws(48);
            await t.a.openCharacteristics();
            await t.a.remove(second);
            await ws(45);
        });

        it("switching the condition off drops its entries, on brings them back", async () => {
            const { a } = t;
            await a.openCharacteristics();
            await a.write(`${condition}.enabled`, false);
            await ws(40);
            await a.openCharacteristics();
            await a.write(`${condition}.enabled`, true);
            await ws(45);
        });
    });

    describe("a skill bonus and the skill it names", () => {
        let bonus: string;
        let skill: string;

        it("an entry naming a skill the sheet lacks is dashed", async () => {
            bonus = await addEntry("skill_bonus", "Zither Playing");
            await t.a.write(`${bonus}.skillBonus`, "10");
            await nameHasClass(bonus, "unmatched", true);
        });

        it("a custom skill of that name takes the dash away, for both", async () => {
            const { a } = t;
            skill = await addItem(a, await showGrid(a, grid("customSkills")));
            await a.write(`${skill}.name`, "Zither Playing");
            await a.closeSuggestions();
            await nameHasClass(bonus, "unmatched", false);
        });

        it("renaming the skill brings the dash back, the name again takes it away", async () => {
            const { a } = t;
            await a.openNavTab("player");
            await a.write(`${skill}.name`, "Zither");
            await a.closeSuggestions();
            await nameHasClass(bonus, "unmatched", true);
            await a.openNavTab("player");
            await a.write(`${skill}.name`, "zither playing");
            await a.closeSuggestions();
            await nameHasClass(bonus, "unmatched", false);
        });

        it("deleting the skill dashes it again", async () => {
            await t.a.openNavTab("player");
            await t.a.remove(skill);
            await nameHasClass(bonus, "unmatched", true);
        });
    });

    describe("a weapon entry and the weapon it names", () => {
        let weaponEntry: string;
        let bolter: string;

        beforeAll(async () => {
            const { a } = t;
            bolter = await addItem(a, await showGrid(a, grid("rangedAttacks")));
            await a.write(`${bolter}.name`, "Bolter");
            await a.closeSuggestions();
            weaponEntry = await addEntry("weapon_bonus", "Bolter");
        });

        it("names the weapon: no warning", async () => {
            await nameHasClass(weaponEntry, "invalid", false);
        });

        it("renaming the weapon makes the name unknown: the entry warns, for both", async () => {
            await t.a.openNavTab("combat");
            await t.a.write(`${bolter}.name`, "Boltgun");
            await t.a.closeSuggestions();
            await nameHasClass(weaponEntry, "invalid", true);
        });

        it("the old name back takes the warning away", async () => {
            await t.a.openNavTab("combat");
            await t.a.write(`${bolter}.name`, "Bolter");
            await t.a.closeSuggestions();
            await nameHasClass(weaponEntry, "invalid", false);
        });
    });

    describe("talents in the weapon damage, and the modifiers dropdown", () => {
        let profile: string;
        let strength: string;
        let ranged: string;
        let talent: string;

        /** Both players open Combat and show `value` as the damage of `path`. */
        async function damage(path: string, value: string) {
            for (const p of players()) {
                await p.openNavTab("combat");
                await p.expectValue(`${path}.damageTotal`, value);
            }
        }

        /** What the open damage dropdown of `path` lists under the own value: value and label by turn. */
        async function breakdown(p: Player, path: string): Promise<string[]> {
            await p.openMods(path, "damage");
            const q = { path, sel: ".damage .breakdown span" };
            return (await p.count(q)) ? p.page.evaluate(q => window.__e2e.findAll(q).map(el => el.textContent ?? ""), q) : [];
        }

        async function renameTalent(name: string) {
            await t.a.openNavTab("talents");
            await t.a.write(`${talent}.name`, name);
            await t.a.closeSuggestions();
        }

        beforeAll(async () => {
            const { a } = t;
            const melee = await addItem(a, await showGrid(a, grid("meleeAttacks")));
            profile = `${melee}.tabs.items.${(await tabIds(a, `${melee}.tabs.items`))[0]}`;
            await a.openMods(profile, "damage");
            await a.write(`${profile}.damage`, "1d10");
            strength = `${profile}.damageMods.items.${(await a.layout(`${profile}.damageMods.items`)).flat()[0]}`;
            ranged = (await showGrid(a, grid("rangedAttacks"))) + "." + (await a.layout("rangedAttacks.list.items")).flat()[0];
            await a.openMods(ranged, "damage");
            await a.write(`${ranged}.damage`, "1d10+5");
            await a.closeDropdowns();
        });

        it("without talents: the profile adds S.b, the dropdown says each modifier's part", async () => {
            await damage(profile, "1d10+3");
            await damage(ranged, "1d10+5");
            for (const p of players()) {
                await p.openMods(profile, "damage");
                await eventually(async () => (await p.el(`${strength}.added`)).evaluate(el => el.textContent), v => expect(v, `${p.name}: S.b adds`).toBe("+3"));
                expect(await breakdown(p, profile), `${p.name}: no labelled parts`).toEqual([]);
            }
        });

        it("the modifier and the own value follow their edits, for both", async () => {
            const { a } = t;
            await a.openMods(profile, "damage");
            await a.write(`${strength}.expr`, "S.b+1");
            await a.write(`${profile}.damage`, "2d10");
            await damage(profile, "2d10+4");
            for (const p of players()) {
                await p.openMods(profile, "damage");
                await eventually(async () => (await p.el(`${strength}.added`)).evaluate(el => el.textContent), v => expect(v, `${p.name}: S.b+1 adds`).toBe("+4"));
                await eventually(async () => (await p.el({ path: profile, sel: '.damage [data-id="result"]' })).evaluate(el => el.textContent),
                    v => expect(v, `${p.name}: total in the dropdown`).toBe("2d10+4"));
            }
        });

        it("Crushing Blow adds ½WS.b▲ to the melee damage and is listed in its dropdown", async () => {
            const { a } = t;
            talent = await addItem(a, await showGrid(a, grid("talents")));
            await renameTalent("Crushing Blow");
            await damage(profile, "2d10+6");
            await damage(ranged, "1d10+5");
            for (const p of players()) {
                await eventually(() => breakdown(p, profile), b => expect(b, `${p.name}: breakdown`).toEqual(["+2", "Crushing Blow"]));
            }
        });

        it("a WS edit changes what it adds", async () => {
            await t.a.openNavTab("player");
            await t.a.write("characteristics.WS.value", "60");
            await damage(profile, "2d10+7");
            await t.a.openNavTab("player");
            await t.a.write("characteristics.WS.value", "40");
            await damage(profile, "2d10+6");
        });

        it("renamed to another name it adds nothing; its Russian name adds again", async () => {
            await renameTalent("Crushing Blows");
            await damage(profile, "2d10+4");
            for (const p of players()) await eventually(() => breakdown(p, profile), b => expect(b, `${p.name}: breakdown`).toEqual([]));
            await renameTalent("Крушащий удар");
            await damage(profile, "2d10+6");
        });

        it("Mighty Shot adds ½BS.b▲ to the ranged damage, not to the melee one", async () => {
            await renameTalent("Mighty Shot");
            await damage(ranged, "1d10+7");
            await damage(profile, "2d10+4");
            for (const p of players()) {
                await eventually(() => breakdown(p, ranged), b => expect(b, `${p.name}: breakdown`).toEqual(["+2", "Mighty Shot"]));
            }
        });

        it("deleting the talent takes its part away", async () => {
            await t.a.openNavTab("talents");
            await t.a.remove(talent);
            await damage(ranged, "1d10+5");
        });
    });
});
