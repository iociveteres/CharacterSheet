// The labels of weapon rolls, worded by the registry (rollLabelText.ts), say
// what the sheet wrote before they became codes, in either language: the
// "old" builders below are the sheet's code at a6f9a84f, which read the same
// tables and the same title lines (`label` beside `part`) the sheet still has.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../../i18n/testDictionary";
import type { Lang } from "../../i18n";
import type { RollColumn } from "../schema/constants";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (...rows: object[]) => ({
    items: Object.fromEntries(rows.map((r, i) => [`e${i}`, r])),
    layouts: Object.fromEntries(rows.map((_, i) => [`e${i}`, pos(0, i)])),
});
const thisItem = (weaponField: string, weaponBonus: string) => ({ type: "weapon_bonus", name: "This item", weaponField, weaponBonus });
const hit = (name: string, weaponBonus: string) => ({ type: "weapon_bonus", name, weaponField: "hit", weaponBonus });
const condition = (name: string, ...entries: object[]) => ({ name, enabled: true, stacks: 1, entries: grid(...entries) });

const M1 = "meleeAttacks.list.items.m1";
const M2 = "meleeAttacks.list.items.m2";
const R1 = "rangedAttacks.list.items.r1";
const R2 = "rangedAttacks.list.items.r2";

/**
 * In the Aggressive stance: a Longsword held in one hand, linked to a broken
 * Good Longsword of the gear with a mod that adds to hit, Hook and Sword
 * profiles, columns and an extra selected; a weapon without a name in
 * Mordhau; a Lasgun linked to an item without a name whose mod has none
 * either; a ranged attack without a name. A condition without a name and one
 * with it add to hit.
 */
const CONTENT = {
    characteristics: { WS: { value: "45" }, BS: { value: "40" } },
    conditions: {
        list: {
            items: { c1: condition("", hit("Ranged", "10"), hit("Melee", "-5")), c2: condition("Blessed", hit("Melee", "5")) },
            layouts: { c1: pos(0, 0), c2: pos(0, 1) },
        },
    },
    gear: {
        list: {
            items: {
                g1: { name: "Longsword", gearType: "weapon", quality: "Good", broken: true,
                    weapon: { mods: grid({ name: "Custom Grip", entries: grid(thisItem("hit", "5")) }) } },
                g2: { name: "", gearType: "weapon", weapon: { mods: grid({ name: "", entries: grid(thisItem("hit", "-5")) }) } },
            },
            layouts: { g1: pos(0, 0), g2: pos(0, 1) },
        },
    },
    meleeAttacks: {
        stance: "aggressive",
        list: {
            items: {
                m1: {
                    name: "Longsword", group: "primary", balance: "1", item: "g1", grip: "2р [1р, Бл, Мх]", gripSelected: "1h",
                    tabs: { items: { t1: { profile: "hook", damage: "1d10" }, t2: { profile: "sword", damage: "1d10" } }, layouts: { t1: pos(0, 0), t2: pos(1, 0) } },
                    roll: {
                        aim: { selected: "full" }, target: { selected: "head" }, base: { selected: "charge" }, rof: { selected: "quick" },
                        extra1: { name: "Ambush", value: 10, enabled: true },
                    },
                },
                m2: {
                    name: "", group: "primary", grip: "2р [Мх]", gripSelected: "Mh",
                    tabs: { items: { t1: { profile: "sword", damage: "1d10" } }, layouts: { t1: pos(0, 0) } },
                },
            },
            layouts: { m1: pos(0, 0), m2: pos(0, 1) },
        },
    },
    rangedAttacks: {
        list: {
            items: {
                r1: {
                    name: "Lasgun", class: "basic", item: "g2", damage: "1d10+3",
                    roll: { aim: { selected: "half" }, target: { selected: "torso" }, range: { selected: "point-blank" }, rof: { selected: "suppression" } },
                },
                r2: { name: "", class: "pistol", damage: "1d10" },
            },
            layouts: { r1: pos(0, 0), r2: pos(0, 1) },
        },
    },
};

type Kind = "black_crusade" | "pathfinder_crusade";

/** The sheet's modules in `lang`, whose tables take their words when they load, and the sheet of `kind`. */
async function load(lang: Lang, kind: Kind = "black_crusade") {
    installDictionary(lang);
    vi.resetModules();
    const [i18n, utils, computed, constants, sync, attacks, grips, gripRules, stanceRules, melee, weaponBonus, weaponDamage, itemLink, rollParts, rollLabel, registry] =
        await Promise.all([
            import("../../i18n"), import("../components/testUtils"), import("../kinds/computed"), import("../schema/constants"),
            import("../core/sync"), import("./Attacks"), import("./Grips"), import("./gripRules"), import("./stanceRules"),
            import("./melee"), import("./weaponBonus"), import("./weaponDamage"), import("./ItemLink"), import("../rolls/rollParts"),
            import("../rollLabel"), import("../rollLabelText"),
        ]);
    const [{ kindOf }, { brokenItem }] = await Promise.all([import("../kinds"), import("../gear/itemLinkRules")]);
    const state = utils.loadState(CONTENT, kindOf(kind)!);
    computed.attachComputeds(state);
    const { t } = i18n;
    const { peekAt } = sync;

    // — The sheet at a6f9a84f ————————————————

    const oldRollLabel = (name: string, modifiers: string[]) => (modifiers.length ? `${name}, ${modifiers.join(", ")}` : name);

    function oldSelectedNames(rollPath: string, columns: readonly RollColumn[]): string[] {
        const out: string[] = [];
        for (const { key, default: def, names, options } of columns) {
            const selected = String(peekAt(state, `${rollPath}.${key}.selected`) ?? "");
            if (!selected || selected === def) continue;
            const option = options.find(o => constants.optionValue(o) === selected);
            const name = names?.[selected] ?? (option && constants.optionLabel(option));
            out.push(name ? name.toLowerCase() : selected);
        }
        return out;
    }

    function oldMeleeRollName(attackPath: string, name: string): string {
        const { grips: all, held } = melee.heldGrip(state, attackPath);
        const stance = stanceRules.stanceOf(state);
        const tags = [held && held !== all[0] ? gripRules.gripText(held) : "", stance.key === "standard" ? "" : stance.name].filter(Boolean);
        return tags.length ? `${name} (${tags.join(", ")})` : name;
    }

    function oldAttackLabel(path: string, columns: readonly RollColumn[], tab: string | null): string {
        const typed = String(peekAt(state, `${path}.name`) || t("common.unknown"));
        const isMelee = path.startsWith("meleeAttacks.");
        const name = isMelee ? oldMeleeRollName(path, typed) : typed;
        const lines = isMelee ? melee.meleeHitLines(state, path, tab) : weaponBonus.hitLines(state, path);
        return oldRollLabel(name, [...oldSelectedNames(`${path}.roll`, columns), ...lines.map(line => line.label), ...rollParts.extraNames(state, `${path}.roll`)]);
    }

    const oldParryLabel = (attackPath: string) =>
        `${oldMeleeRollName(attackPath, String(peekAt(state, `${attackPath}.name`) || t("sheet.weapons.meleeAttack")))}, ${t("sheet.termsSkills.skill.parry")}`;

    const oldDamageLabel = (weaponPath: string, label: string) =>
        (brokenItem(state, weaponPath) ? t("sheet.weapons.link.brokenRoll", { label }) : label);

    return { t, state, constants, attacks, grips, gripRules, stanceRules, weaponDamage, itemLink, rollLabel, registry, oldAttackLabel, oldParryLabel, oldDamageLabel };
}

afterEach(() => {
    vi.resetModules();
});

// Only a gear item of Pathfinder Crusade can be broken.
describe.each([["en", "black_crusade"], ["ru", "black_crusade"], ["en", "pathfinder_crusade"], ["ru", "pathfinder_crusade"]] as const)("the label of a weapon roll in %s on a sheet of %s", (lang, kind) => {
    it("of an attack, with its columns, grip, stance, what adds to hit and the extras", async () => {
        const { state, constants: { MELEE_ROLL_COLUMNS, RANGED_ROLL_COLUMNS }, attacks: { attackRollLabel }, registry: { labelText, hasCodes }, oldAttackLabel } = await load(lang, kind);
        const cases = [
            [M1, MELEE_ROLL_COLUMNS, "t1"], [M1, MELEE_ROLL_COLUMNS, "t2"], [M2, MELEE_ROLL_COLUMNS, null],
            [R1, RANGED_ROLL_COLUMNS, null], [R2, RANGED_ROLL_COLUMNS, null],
        ] as const;
        for (const [path, columns, tab] of cases) {
            const label = attackRollLabel(state, path, columns, path.startsWith("melee") ? "meleeAttacks" : "rangedAttacks", tab);
            expect(labelText(label), `${path} ${tab ?? ""}`).toBe(oldAttackLabel(path, columns, tab));
            expect(hasCodes(label)).toBe(true);
        }
        // The tables are in the language loaded: a Russian label has Cyrillic words of the sheet's.
        expect(/[а-я]/i.test(labelText(attackRollLabel(state, M1, MELEE_ROLL_COLUMNS, "meleeAttacks", "t1")))).toBe(lang === "ru");
        // Each kind of line is there: the profile, the Quality and the mod of the item, the conditions with and without a name.
        expect(attackRollLabel(state, M1, MELEE_ROLL_COLUMNS, "meleeAttacks", "t1").m).toHaveLength(4 + 5 + 1);
        expect(attackRollLabel(state, R1, RANGED_ROLL_COLUMNS, "rangedAttacks", null).m).toHaveLength(4 + 2);
    });

    it("of a Parry", async () => {
        const { state, grips: { parryRollLabel }, registry: { labelText }, oldParryLabel } = await load(lang, kind);
        for (const path of [M1, M2]) expect(labelText(parryRollLabel(state, path))).toBe(oldParryLabel(path));
    });

    it("of a damage, marked for a broken item", async () => {
        const { t, state, weaponDamage: { profileLabel, profileRollLabel }, itemLink: { damageRollLabel }, rollLabel: { code, label, NAME, SPACE, WRAP },
            registry: { labelText }, oldDamageLabel } = await load(lang, kind);
        const melee = damageRollLabel(state, `${M1}.tabs.items.t1`, profileRollLabel("Longsword", "hook"));
        expect(melee.w).toBe(kind === "pathfinder_crusade" ? WRAP.broken : undefined);
        expect(labelText(melee)).toBe(oldDamageLabel(`${M1}.tabs.items.t1`, profileLabel("Longsword", "hook")));
        const unnamed = damageRollLabel(state, R2, label(code(SPACE.name, NAME.rangedAttack)));
        expect(unnamed.w).toBeUndefined();
        expect(labelText(unnamed)).toBe(oldDamageLabel(R2, t("sheet.weapons.rangedAttack")));
    });

    it("of every grip, stance, profile and column option the tables have", async () => {
        const {
            constants: { MELEE_PROFILES, MELEE_ROLL_COLUMNS, RANGED_ROLL_COLUMNS, columnCode, optionValue },
            gripRules: { GRIP_KEYS, gripPart, gripText }, stanceRules: { STANCES }, weaponDamage: { profileLabel, profileRollLabel },
            rollLabel: { code, label, SPACE }, registry: { labelText },
        } = await load(lang, kind);
        for (const key of GRIP_KEYS) {
            const grip = { id: key, keys: [key] };
            expect(labelText(label("W", { t: [gripPart(grip)] }))).toBe(`W (${gripText(grip)})`);
        }
        const combined = { id: "1h+Rev", keys: ["1h", "Rev"] as const };
        expect(labelText(label("W", { t: [gripPart({ ...combined, keys: [...combined.keys] })] }))).toBe(`W (${gripText({ ...combined, keys: [...combined.keys] })})`);
        for (const stance of STANCES) {
            expect(labelText(label(code(SPACE.stance, stance.key)))).toBe(stance.name);
            expect(labelText(label(code(SPACE.stanceSource, stance.key)))).toBe(stance.source);
        }
        for (const profile of MELEE_PROFILES.map(optionValue)) {
            expect(labelText(profileRollLabel("W", profile))).toBe(profileLabel("W", profile));
        }
        for (const column of [...RANGED_ROLL_COLUMNS, ...MELEE_ROLL_COLUMNS]) {
            for (const value of column.options.map(optionValue).filter(v => v !== column.default)) {
                expect(labelText(label(code(columnCode(column), value)))).toBe(column.names[value].toLowerCase());
            }
        }
    });
});
