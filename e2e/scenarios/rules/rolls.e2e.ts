// What the sheet asks the room to roll (sheet:rollVersus and
// sheet:rollExact) for every rollable label, value and Roll button.
import { beforeAll, describe, expect, it } from "vitest";
import type { Query, Roll } from "../../lib/probes";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";

describe("rolls", () => {
    const t = useTable("rolls");
    const item: { [grid: string]: string } = {};

    beforeAll(async () => {
        const { a } = t;
        for (const name of ["customSkills", "powerShields", "rangedAttacks", "meleeAttacks", "psychicPowers", "techPowers"]) {
            item[name] = await addItem(a, await showGrid(a, grid(name)));
        }
        const edits: [string, unknown][] = [
            ["characteristics.WS.value", "45"], ["characteristics.WS.unnatural", "3"],
            ["characteristics.I.value", "35"], ["characteristics.I.unnatural", "4"],
            ["characteristics.W.value", "40"], ["characteristics.W.unnatural", "5"],
            ["characteristics.T.value", "30"], ["characteristics.T.unnatural", "2"],
            ["skillsRight.1_trade.name", "Armourer"],
            [`${item.customSkills}.name`, "Brewing"], [`${item.customSkills}.characteristic`, "WS"],
            [`${item.powerShields}.name`, "Refractor"], [`${item.powerShields}.rating`, "1-35/10"],
            ["initiative.dice", "1d10"], ["initiative.flatBonus", 2],
            [`${item.rangedAttacks}.name`, "Bolter"], [`${item.rangedAttacks}.damage`, "1d10+5"],
            [`${item.meleeAttacks}.name`, "Chainaxe"],
            [`${item.psychicPowers}.name`, "Smite"], [`${item.psychicPowers}.damage`, "2d10"],
            [`${item.techPowers}.name`, "Voltagheist"], [`${item.techPowers}.damage`, "1d10+1"],
        ];
        for (const [path, value] of edits) await a.write(path, value);
        await a.blockRolls();
    });

    /** Clicks and returns the one roll the click asks for. */
    async function rollOf(q: Query | string): Promise<Roll> {
        await t.a.clearRecords();
        await t.a.click(q);
        const rolls = await t.a.rolls();
        expect(rolls, `rolls of ${JSON.stringify(q)}`).toHaveLength(1);
        return rolls[0];
    }

    it("a characteristic label tests the computed value, without the key in the label", async () => {
        await t.a.openNavTab("player");
        expect(await rollOf({ path: "characteristics.WS", sel: "label.rollable" }))
            .toEqual({ kind: "versus", target: 45, bonusSuccesses: 1, label: "Weapon Skill" });
        expect(await rollOf({ path: "characteristics.I", sel: "label.rollable" }))
            .toEqual({ kind: "versus", target: 35, bonusSuccesses: 2, label: "Intellig." });
    });

    it("a skill difficulty tests it with the bonus successes of the row's characteristic", async () => {
        await t.a.openNavTab("player");
        expect(await rollOf("skillsLeft.parry.difficulty"))
            .toEqual({ kind: "versus", target: 25, bonusSuccesses: 1, label: "Parry" });
        expect(await rollOf("skillsRight.1_trade.difficulty"))
            .toEqual({ kind: "versus", target: 15, bonusSuccesses: 2, label: "Armourer" });
        expect(await rollOf(`${item.customSkills}.difficulty`))
            .toEqual({ kind: "versus", target: 25, bonusSuccesses: 1, label: "Brewing" });
    });

    it("the Name label of a power shield rolls d100 with its name and rating", async () => {
        await t.a.openNavTab("combat");
        expect(await rollOf({ path: item.powerShields, sel: "label.rollable" }))
            .toEqual({ kind: "exact", expression: "d100", label: "Refractor 1-35/10" });
    });

    it("the Initiative label rolls the initiative expression", async () => {
        await t.a.openNavTab("combat");
        expect(await rollOf({ sel: ".initiative-wrapper label.rollable" }))
            .toEqual({ kind: "exact", expression: "1d10+2", label: "Initiative" });
    });

    it("Damage labels roll the damage; a melee label names the profile unless it is no or empty", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        expect(await rollOf({ path: item.rangedAttacks, sel: ".damage label.rollable" }))
            .toEqual({ kind: "exact", expression: "1d10+5", label: "Bolter" });

        const tab = `${item.meleeAttacks}.tabs.items.${(await tabIds(a, `${item.meleeAttacks}.tabs.items`))[0]}`;
        await a.write(`${tab}.damage`, "1d10+4");
        const melee = { path: item.meleeAttacks, sel: ".profile-tab .damage label.rollable" };
        for (const [profile, label] of [["sword", "Chainaxe, sword"], ["no", "Chainaxe"], ["", "Chainaxe"]]) {
            await a.write(`${tab}.profile`, profile);
            expect(await rollOf(melee), `profile "${profile}"`).toEqual({ kind: "exact", expression: "1d10+4", label });
        }

        await a.openNavTab("psykana");
        await a.setCollapsed(item.psychicPowers, false);
        expect(await rollOf({ path: item.psychicPowers, sel: ".damage label.rollable" }))
            .toEqual({ kind: "exact", expression: "2d10", label: "Smite" });
        await a.openNavTab("techno");
        await a.setCollapsed(item.techPowers, false);
        expect(await rollOf({ path: item.techPowers, sel: ".damage label.rollable" }))
            .toEqual({ kind: "exact", expression: "1d10+1", label: "Voltagheist" });
    });

    /** Opens the roll dropdown of the item, rolls and checks that the dropdown closed. */
    async function rollButton(itemPath: string): Promise<Roll> {
        const { a } = t;
        await a.click({ path: itemPath, sel: ":scope > .split-header .rollable" });
        expect(await a.count({ path: itemPath, sel: ".roll-dropdown.visible" })).toBe(1);
        const roll = await rollOf(`${itemPath}.roll.rollButton`);
        expect(await a.count({ path: itemPath, sel: ".roll-dropdown.visible" }), "closed after the roll").toBe(0);
        return roll;
    }

    it("the Roll button of an attack or power tests the total, naming non-default options and enabled extras", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        const ranged = `${item.rangedAttacks}.roll`;
        await a.write(`${ranged}.aim.selected`, "half");
        await a.write(`${ranged}.rof.selected`, "short");
        await a.write(`${ranged}.extra1.name`, "Scope");
        await a.write(`${ranged}.extra1.value`, 10);
        await a.write(`${ranged}.extra1.enabled`, true);
        await a.write(`${ranged}.extra2.name`, "Off");
        expect(await rollButton(item.rangedAttacks)).toEqual({
            kind: "versus", target: Number(await a.read(`${ranged}.total`)), bonusSuccesses: 0,
            label: "Bolter, half aim, short burst, Scope",
        });

        const melee = `${item.meleeAttacks}.roll`;
        await a.write(`${melee}.baseSelect`, "WS");
        await a.write(`${melee}.base.selected`, "full");
        await a.write(`${melee}.stance.selected`, "aggressive");
        expect(await rollButton(item.meleeAttacks)).toEqual({
            kind: "versus", target: Number(await a.read(`${melee}.total`)), bonusSuccesses: 1,
            label: "Chainaxe, full attack, aggressive",
        });

        await a.openNavTab("psykana");
        const psychic = `${item.psychicPowers}.roll`;
        await a.write(`${psychic}.baseSelect`, "W");
        await a.write(`${psychic}.effectivePR`, 2);
        await a.write(`${psychic}.kickPR`, 1);
        expect(await rollButton(item.psychicPowers)).toEqual({
            kind: "versus", target: Number(await a.read(`${psychic}.total`)), bonusSuccesses: 2,
            label: "Smite, 2 ePR, +1 kick",
        });

        await a.openNavTab("techno");
        const tech = `${item.techPowers}.roll`;
        await a.write(`${tech}.baseSelect`, "tech-use");
        await a.write(`${tech}.extra2.name`, "Blessing");
        await a.write(`${tech}.extra2.enabled`, true);
        expect(await rollButton(item.techPowers)).toEqual({
            kind: "versus", target: Number(await a.read(`${tech}.total`)), bonusSuccesses: 2,
            label: "Voltagheist, Blessing",
        });
    });

    it("the compensation roll tests T − 10X with X in the label", async () => {
        const { a } = t;
        await a.openNavTab("techno");
        await a.write("technoArcana.compensationRoll.modifier", 2);
        await a.expectValue("technoArcana.compensationRoll.total", "10");
        await a.click({ sel: ".compensation-toggle" });
        expect(await rollOf("technoArcana.compensationRoll.rollButton"))
            .toEqual({ kind: "versus", target: 10, bonusSuccesses: 1, label: "Compensator, X = 2" });
        expect(await a.count({ path: "technoArcana.compensationRoll", sel: ".roll-dropdown.visible" })).toBe(0);
    });
});
