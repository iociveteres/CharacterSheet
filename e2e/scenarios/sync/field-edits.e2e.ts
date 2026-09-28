// An edit of every kind of field in every block reaches the
// other player and survives a reload. What follows from an edit is in
// rules/computed.e2e.ts.
import { beforeAll, describe, expect, it } from "vitest";
import type { NavTab } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";

type Kind = "text" | "number" | "textarea" | "select" | "numberSelect" | "checkbox" | "radio";

interface Case {
    path: string;
    kind: Kind;
    value: string | number | boolean;
}

/** What the change message carries for an edit of `kind`. */
function sentValue(kind: Kind, value: Case["value"]): unknown {
    switch (kind) {
        case "number":
        case "numberSelect":
            return Number(value);
        case "checkbox":
            return !!value;
        default:
            return String(value);
    }
}

/** The item whose roll dropdown holds the field at `path`, which must be open to show it. */
const rollItem = (path: string) => path.match(/^(.*)\.roll\./)?.[1];

/** The attack or melee profile whose damage dropdown holds the field at `path`. */
const damageItem = (path: string) => path.match(/^((?:rangedAttacks|meleeAttacks)\..*)\.damage$/)?.[1];

/** What the field shows after the edit. */
const shown = (c: Case) => (c.kind === "checkbox" ? !!c.value : String(c.value));

describe("field edits reach the other player and survive a reload", () => {
    const t = useTable("field edits");
    const cases: Case[] = [];
    const item: { [grid: string]: string } = {};

    beforeAll(async () => {
        const { a } = t;
        for (const name of ["customSkills", "notes", "conditions", "resourceTrackers", "powerShields", "rangedAttacks",
            "meleeAttacks", "traits", "talents", "gear", "cybernetics", "experienceLog", "mutations", "mentalDisorders",
            "diseases", "psychicPowers", "techPowers"]) {
            item[name] = await addItem(a, await showGrid(a, grid(name)));
        }
        const firstId = async (gridPath: string) => (await a.layout(gridPath)).flat()[0];
        const conditionEntry = `${item.conditions}.entries.items.${await firstId(`${item.conditions}.entries.items`)}`;
        const meleeTab = `${item.meleeAttacks}.tabs.items.${(await tabIds(a, `${item.meleeAttacks}.tabs.items`))[0]}`;
        const psykanaTab = item.psychicPowers.split(".").slice(0, 4).join(".");
        const technoTab = item.techPowers.split(".").slice(0, 4).join(".");

        // By the navigation tab they are on.
        const add = (_tab: NavTab, list: Case[]) => cases.push(...list);
        add("player", [
            { path: "characterInfo.archetype", kind: "text", value: "Sorcerer" },
            { path: "characteristics.WS.value", kind: "text", value: "45" },
            { path: "characteristics.WS.unnatural", kind: "text", value: "2" },
            { path: "characteristics.A.value", kind: "text", value: "30" },
            { path: "skillsLeft.parry.miscBonus", kind: "number", value: 5 },
            { path: "skillsLeft.awareness.characteristic", kind: "select", value: "WS" },
            { path: "skillsRight.1_linguistics.name", kind: "text", value: "Low Gothic" },
            { path: "skillsRight.1_linguistics.characteristic", kind: "select", value: "F" },
            { path: `${item.customSkills}.name`, kind: "text", value: "Brewing" },
            { path: `${item.customSkills}.characteristic`, kind: "select", value: "WS" },
            { path: `${item.customSkills}.miscBonus`, kind: "number", value: 3 },
            { path: `${item.notes}.name`, kind: "text", value: "A note" },
            { path: `${item.notes}.description`, kind: "textarea", value: "Line one\nline two" },
            { path: `${item.conditions}.enabled`, kind: "checkbox", value: false },
            { path: `${item.conditions}.name`, kind: "text", value: "Blessed" },
            { path: `${item.conditions}.stacks`, kind: "number", value: 2 },
            { path: `${conditionEntry}.type`, kind: "select", value: "skill_bonus" },
            { path: `${conditionEntry}.name`, kind: "text", value: "Parry" },
            { path: `${conditionEntry}.skillBonus`, kind: "text", value: "X" },
        ]);
        add("combat", [
            { path: "infamyPoints.infamyMax", kind: "number", value: 10 },
            { path: "fatigue.fatigueMode", kind: "select", value: "mental" },
            { path: "fatigue.fatigueCur", kind: "number", value: 1 },
            { path: `${item.resourceTrackers}.name`, kind: "text", value: "Ammo" },
            { path: `${item.resourceTrackers}.value`, kind: "number", value: 7 },
            { path: "initiative.dice", kind: "text", value: "1d10" },
            { path: "initiative.wsBonus", kind: "checkbox", value: true },
            { path: "initiative.flatBonus", kind: "number", value: 2 },
            { path: "size", kind: "numberSelect", value: "2" },
            { path: "movement.bonus", kind: "number", value: 1 },
            { path: "movement.fullMult", kind: "number", value: 3 },
            { path: "armour.head.armourValue", kind: "number", value: 4 },
            { path: "armour.head.extra1Name", kind: "text", value: "Helm" },
            { path: "armour.woundsMax", kind: "number", value: 12 },
            { path: "armour.naturalArmourValue", kind: "number", value: 1 },
            { path: `${item.powerShields}.name`, kind: "text", value: "Refractor" },
            { path: `${item.powerShields}.rating`, kind: "text", value: "1-35/10" },
            { path: `${item.powerShields}.nature`, kind: "select", value: "arcane" },
            { path: `${item.powerShields}.type`, kind: "select", value: "phase" },
            { path: `${item.powerShields}.description`, kind: "textarea", value: "Shimmers" },
            { path: `${item.rangedAttacks}.name`, kind: "text", value: "Bolter" },
            { path: `${item.rangedAttacks}.class`, kind: "select", value: "rifle" },
            { path: `${item.rangedAttacks}.damage`, kind: "text", value: "1d10+5" },
            { path: `${item.rangedAttacks}.roll.aim.selected`, kind: "radio", value: "half" },
            { path: `${item.rangedAttacks}.roll.aim.half`, kind: "number", value: 10 },
            { path: `${item.rangedAttacks}.roll.extra1.enabled`, kind: "checkbox", value: true },
            { path: `${item.rangedAttacks}.roll.baseSelect`, kind: "select", value: "P" },
            { path: `${item.meleeAttacks}.name`, kind: "text", value: "Chainaxe" },
            { path: `${item.meleeAttacks}.group`, kind: "select", value: "primary (shield)" },
            { path: `${item.meleeAttacks}.shield.equipped`, kind: "checkbox", value: true },
            { path: `${item.meleeAttacks}.shield.ap`, kind: "number", value: 2 },
            { path: `${meleeTab}.profile`, kind: "select", value: "sword" },
            { path: `${meleeTab}.damage`, kind: "text", value: "1d10+4" },
            { path: `${item.meleeAttacks}.roll.stance.selected`, kind: "radio", value: "aggressive" },
        ]);
        add("talents", [
            { path: `${item.traits}.name`, kind: "text", value: "Amorphous" },
            { path: `${item.traits}.description`, kind: "textarea", value: "Shapeless" },
            { path: `${item.talents}.name`, kind: "text", value: "Combat Formation" },
            { path: `${item.talents}.description`, kind: "textarea", value: "Plans ahead" },
        ]);
        add("gear", [
            { path: "carryWeightAndEncumbrance.carryWeightBase", kind: "number", value: 5 },
            { path: `${item.gear}.name`, kind: "text", value: "Backpack" },
            { path: `${item.gear}.weight`, kind: "number", value: 2.5 },
            { path: `${item.gear}.gearType`, kind: "select", value: "tool" },
            { path: `${item.gear}.equipped`, kind: "checkbox", value: true },
            { path: `${item.gear}.carried`, kind: "checkbox", value: false },
            { path: `${item.gear}.description`, kind: "textarea", value: "Holds things" },
            { path: `${item.cybernetics}.name`, kind: "text", value: "Bionic Arm" },
            { path: `${item.cybernetics}.description`, kind: "textarea", value: "Clanks" },
        ]);
        add("advancements", [
            { path: "experience.useDevotion", kind: "checkbox", value: true },
            { path: "experience.alignment", kind: "select", value: "Khorne (Vanguard)" },
            { path: "experience.aptitudes", kind: "text", value: "WS, Off" },
            { path: "experience.experienceTotal", kind: "number", value: 1000 },
            { path: `${item.experienceLog}.name`, kind: "text", value: "WS +10" },
            { path: `${item.experienceLog}.type`, kind: "select", value: "characteristic" },
            { path: `${item.experienceLog}.level`, kind: "numberSelect", value: "3" },
            { path: `${item.mutations}.name`, kind: "text", value: "Third Eye" },
            { path: "mentalDisorders.insanityPoints", kind: "number", value: 3 },
            { path: `${item.mentalDisorders}.name`, kind: "text", value: "Paranoia" },
            { path: `${item.diseases}.description`, kind: "textarea", value: "Coughing" },
        ]);
        add("psykana", [
            { path: "psykana.psykanaType", kind: "select", value: "Unbound" },
            { path: "psykana.basePR", kind: "number", value: 3 },
            { path: `${psykanaTab}.name`, kind: "text", value: "Biomancy" },
            { path: `${item.psychicPowers}.name`, kind: "text", value: "Smite" },
            { path: `${item.psychicPowers}.roll.testOption`, kind: "select", value: "test-option-2" },
            { path: `${item.psychicPowers}.roll.modifier`, kind: "number", value: 5 },
            { path: `${item.psychicPowers}.effect`, kind: "textarea", value: "Lightning" },
        ]);
        add("techno", [
            { path: "technoArcana.currentCognition", kind: "number", value: 4 },
            { path: "technoArcana.compensationRoll.modifier", kind: "number", value: 1 },
            { path: `${technoTab}.name`, kind: "text", value: "Lore" },
            { path: `${item.techPowers}.name`, kind: "text", value: "Voltagheist Shield" },
            { path: `${item.techPowers}.roll.modifier`, kind: "number", value: 2 },
        ]);
    });

    it("sends one change per edit, typed as the field reads it, and B shows it", async () => {
        const { a, b } = t;
        await a.clearRecords();
        for (const c of cases) {
            const roll = rollItem(c.path);
            if (roll) await Promise.all([a.openRoll(roll), b.openRoll(roll)]);
            const damage = damageItem(c.path);
            if (damage) await Promise.all([a.openDamage(damage), b.openDamage(damage)]);
            await a.write(c.path, c.value);
            // The next edit waits for this one's debounce, so the two do not merge.
            const change = sentValue(c.kind, c.value);
            await a.waitSent(m => m.type === "change" && m.path === c.path && m.change === change, `the change of ${c.path}`);
            await b.expectValue(c.path, shown(c));
        }
        const msgs = await a.settledSheetMessages();
        expect(msgs.map(m => [m.type, m.path, m.change])).toEqual(cases.map(c => ["change", c.path, sentValue(c.kind, c.value)]));
    });

    it("A shows every edit after a reload", async () => {
        const { a } = t;
        await a.reload();
        const expected = new Map(cases.map(c => [c.path, shown(c)]));
        const actual = new Map<string, unknown>();
        for (const path of expected.keys()) {
            const roll = rollItem(path);
            if (roll) await a.openRoll(roll);
            const damage = damageItem(path);
            if (damage) await a.openDamage(damage);
            actual.set(path, await a.read(path));
        }
        expect(Object.fromEntries(actual)).toEqual(Object.fromEntries(expected));
    });
});
