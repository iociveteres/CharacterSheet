// The labels of the rolls of characteristics, skills, powers and the stat
// block, worded by the registry (rollLabelText.ts), say what the sheet wrote
// before they became codes, in either language and kind: the "old" builders
// below are the sheet's code at e7ecfb43, which read the same tables and
// phrases. Weapon rolls: weapons/rollLabelMatch.test.ts.
import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../i18n/testDictionary";
import type { Lang } from "../i18n";
import type { Label } from "./rollLabel";

type Kind = "black_crusade" | "pathfinder_crusade";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (rows: Record<string, object>) => ({
    items: rows,
    layouts: Object.fromEntries(Object.keys(rows).map((id, i) => [id, pos(0, i)])),
});
const tab = (powers: Record<string, object>) => grid({ t1: { name: "Tab", powers: grid(powers) } });
const extra = (name: string) => ({ extra1: { name, value: 5, enabled: true } });

const PSY = "psykana.tabs.items.t1.powers.items";
const TECH = "technoArcana.tabs.items.t1.powers.items";

/**
 * A named psychic power cast safe with an extra, one without a name pushed,
 * and the same pair of tech powers; the unnamed psychic power was cast last,
 * kicked, so the phenomena name it; Bardic typed in a skill of the right
 * column, `named` of the kind.
 */
const content = (named: string) => ({
    characteristics: { W: { value: "40" }, T: { value: "35" } },
    skillsRight: { [named]: { name: "Bardic", plus0: true } },
    psykana: {
        lastCastPower: "p2",
        tabs: tab({
            p1: { name: "Smite", roll: { safe: true, effectivePR: 2, ...extra("Focus") } },
            p2: { name: "", roll: { effectivePR: 3, kickPR: 2 }, cast: { pr: 5, kick: 2, safe: false } },
        }),
    },
    technoArcana: {
        compensationRoll: { modifier: 2, ...extra("Haste") },
        tabs: tab({ p1: { name: "Scan", roll: extra("Focus") }, p2: { name: "" } }),
    },
});

/** The sheet's modules in `lang`, whose tables take their words when they load, and a sheet of `kind`. */
async function load(lang: Lang, kind: Kind) {
    installDictionary(lang);
    vi.resetModules();
    const [i18n, utils, computed, kinds, rollLabel, registry, characteristics, statBlock, powers, arts, phenomena, psychic, techno, rollParts] =
        await Promise.all([
            import("../i18n"), import("./components/testUtils"), import("./kinds/computed"), import("./kinds"), import("./rollLabel"),
            import("./rollLabelText"), import("./characteristics/Characteristics"), import("./statblock/StatBlock"),
            import("./magic/Powers"), import("./magic/ArtsRoll"), import("./magic/Phenomena"), import("./magic/psychic"),
            import("./tech/TechnoArcana"), import("./rolls/rollParts"),
        ]);
    const [{ peekAt, textAt, updateSignalAtPath }, { powerPR }, tech] = await Promise.all([import("./core/sync"), import("./magic/powerDamage"), import("./tech/tech")]);
    const def = kinds.kindOf(kind)!;
    const { stats, terms } = def;
    const state = utils.loadState(content(stats.skillsRight[0].key), def);
    computed.attachComputeds(state);
    const { t } = i18n;
    const { extraNames } = rollParts;

    // — The sheet at e7ecfb43 ————————————————

    const oldRollLabel = (name: string, modifiers: string[]) => (modifiers.length ? `${name}, ${modifiers.join(", ")}` : name);
    const name = (path: string, fallback: string) => String(peekAt(state, `${path}.name`) || fallback);

    function oldPsychicLabel(path: string): string {
        const rollPath = `${path}.roll`;
        const effectivePR = Number(peekAt(state, `${rollPath}.effectivePR`)) || 0;
        const kick = psychic.rollKick(state, path);
        return oldRollLabel(name(path, terms.unknownPower), [
            ...(peekAt(state, `${rollPath}.safe`) ? [t("sheet.magic.roll.safe")] : []),
            ...(effectivePR > 0 ? [t("sheet.magic.roll.effectivePR", { pr: effectivePR })] : []),
            ...(kick > 0 ? [t("sheet.magic.roll.kick", { kick })] : []),
            ...extraNames(state, rollPath),
        ]);
    }

    const oldArtsLabel = (path: string, twoSustained: boolean) => oldRollLabel(name(path, terms.unknownPower), [
        t("sheet.magic.roll.effectivePR", { pr: Number(peekAt(state, `${path}.roll.effectivePR`)) }),
        ...(twoSustained ? [t("sheet.magicPf.artsRoll.twoSustained")] : []),
        ...extraNames(state, `${path}.roll`),
    ]);

    function oldPhenomenaLabel(): string {
        const { power } = psychic.phenomena(state);
        const kick = power && !power.safe && power.kick > 0 ? [t("sheet.magic.roll.kick", { kick: power.kick })] : [];
        return oldRollLabel(t("sheet.magic.phenomena.label"), power ? [power.name, ...kick] : []);
    }

    const oldTechLabel = (path: string, x: number | null, quality: string | null) => oldRollLabel(name(path, t("sheet.tech.roll.unknownPower")), [
        ...(x === null ? [] : [`X = ${x}`]),
        ...(quality ? [`${quality}.Q`] : []),
        ...extraNames(state, `${path}.roll`),
    ]);

    function oldCompensationLabel(due: { name: string } | null, modifier: number): string {
        const compensator = t("sheet.termsPowers.techType.compensator");
        return oldRollLabel(due ? `${compensator}, ${due.name}` : compensator, [`X = ${modifier}`, ...extraNames(state, "technoArcana.compensationRoll")]);
    }

    const oldPsychicDamage = (path: string) => `${name(path, terms.psychicPower)}, PR ${powerPR(state, path)}`;
    const oldTechDamage = (path: string) => name(path, t("sheet.termsPowers.tech.techPower"));

    const oldStatSkill = (table: string, row: (typeof stats.skillsLeft)[number], editableName: boolean) => (editableName
        ? textAt(state, `${table}.${row.key}.name`) || row.groupLabel || ""
        : row.groupLabel ? `${row.groupLabel} (${row.label})` : row.label);

    return {
        t, state, stats, rollLabel, registry, characteristics, statBlock, powers, arts, phenomena, psychic, techno, tech, updateSignalAtPath,
        oldPsychicLabel, oldArtsLabel, oldPhenomenaLabel, oldTechLabel, oldCompensationLabel, oldPsychicDamage, oldTechDamage, oldStatSkill,
    };
}

afterEach(() => {
    vi.resetModules();
});

describe.each([["en", "black_crusade"], ["ru", "black_crusade"], ["en", "pathfinder_crusade"], ["ru", "pathfinder_crusade"]] as const)("the label of a roll in %s on a sheet of %s", (lang, kind) => {
    it("of a characteristic", async () => {
        const { state, stats, characteristics: { rollCharacteristic }, registry: { labelText, hasCodes } } = await load(lang, kind);
        for (const { key, label: old } of stats.characteristics) {
            const sent: Label[] = [];
            const rolls = { versus: (_target: number, _bonus: number, label: Label) => { sent.push(label); return Promise.resolve(null); } };
            rollCharacteristic({ state, rolls: rolls as never, kindName: kind }, key);
            expect(sent.map(labelText), key).toEqual([old]);
            expect(hasCodes(sent[0])).toBe(true);
        }
    });

    it("of a skill, in the skill table and in the stat block", async () => {
        const { state, stats, rollLabel: { code, label, SPACE }, registry: { labelText }, statBlock: { statSkillLabel }, oldStatSkill } = await load(lang, kind);
        // The skill table: a fixed row by its name alone.
        for (const row of stats.skillsLeft) expect(labelText(label(code(SPACE.skill, row.key), { k: kind }))).toBe(row.label);
        for (const [table, rows, editableName] of [["skillsLeft", stats.skillsLeft, false], ["skillsRight", stats.skillsRight, true]] as const) {
            for (const row of rows) expect(labelText(statSkillLabel(state, table, row, editableName, kind)), row.key).toBe(oldStatSkill(table, row, editableName));
        }
        // Both columns have grouped rows: a sub-skill with its group, a right one with no name typed by its group.
        expect(stats.skillsLeft.some(row => row.groupLabel)).toBe(true);
        expect(stats.skillsRight.slice(1).some(row => row.groupLabel)).toBe(true);
    });

    it("of a cast of a psychic power and of an Arts spell, and of the phenomena", async () => {
        const { state, powers: { psychicRollLabel }, arts: { artsRollLabel }, phenomena: { phenomenaRollLabel }, psychic: { phenomena },
            registry: { labelText, hasCodes }, oldPsychicLabel, oldArtsLabel, oldPhenomenaLabel } = await load(lang, kind);
        for (const id of ["p1", "p2"]) {
            const path = `${PSY}.${id}`;
            const label = psychicRollLabel(state, path, kind);
            expect(labelText(label), id).toBe(oldPsychicLabel(path));
            expect(hasCodes(label)).toBe(true);
            for (const twoSustained of [false, true]) expect(labelText(artsRollLabel(state, path, kind, twoSustained))).toBe(oldArtsLabel(path, twoSustained));
        }
        // The kick and the safe mark are both there.
        expect(psychicRollLabel(state, `${PSY}.p1`, kind).m).toHaveLength(3);
        expect(psychicRollLabel(state, `${PSY}.p2`, kind).m).toHaveLength(2);
        expect(labelText(phenomenaRollLabel(phenomena(state).power))).toBe(oldPhenomenaLabel());
        expect(phenomenaRollLabel(phenomena(state).power).m).toHaveLength(2);
        expect(labelText(phenomenaRollLabel(null))).toBe(labelText({ n: phenomenaRollLabel(null).n }));
    });

    it("of an activation of a tech power and of the Compensation Roll", async () => {
        const { state, techno: { techRollLabel, compensationRollLabel }, tech: { compensationDue }, updateSignalAtPath,
            registry: { labelText, hasCodes }, oldTechLabel, oldCompensationLabel } = await load(lang, kind);
        for (const id of ["p1", "p2"]) {
            const path = `${TECH}.${id}`;
            for (const [x, quality] of [[null, null], [3, "Poor"], [0, "Best"]] as const) {
                const label = techRollLabel(state, path, x, quality ? { name: "Cogitator", quality } : null);
                expect(labelText(label), `${id} ${x} ${quality}`).toBe(oldTechLabel(path, x, quality));
                if (id === "p2" || quality) expect(hasCodes(label)).toBe(true);
            }
        }
        // Paid by a power with a name, by one without, by one deleted since; and nothing to give back.
        updateSignalAtPath(state, "technoArcana.compensation.energy", 2);
        for (const power of ["p1", "p2", "gone", ""]) {
            updateSignalAtPath(state, "technoArcana.compensation.power", power);
            const due = compensationDue(state);
            expect(due === null).toBe(power === "");
            expect(labelText(compensationRollLabel(state, due, 2)), power).toBe(oldCompensationLabel(due, 2));
        }
    });

    it("of a damage of a power, on the sheet and in the stat block", async () => {
        const { state, powers: { psychicDamageLabel }, techno: { techDamageLabel }, registry: { labelText, hasCodes }, oldPsychicDamage, oldTechDamage } = await load(lang, kind);
        for (const id of ["p1", "p2"]) {
            expect(labelText(psychicDamageLabel(state, `${PSY}.${id}`, kind)), id).toBe(oldPsychicDamage(`${PSY}.${id}`));
            expect(labelText(techDamageLabel(state, `${TECH}.${id}`)), id).toBe(oldTechDamage(`${TECH}.${id}`));
        }
        expect(hasCodes(psychicDamageLabel(state, `${PSY}.p2`, kind))).toBe(true);
        expect(hasCodes(techDamageLabel(state, `${TECH}.p1`))).toBe(false);
    });

    it("names what a kind names its own way by the kind it carries", async () => {
        const { t, registry: { labelText }, rollLabel: { code, label, NAME, SPACE } } = await load(lang, kind);
        const words = (value: string, k?: string) => labelText(label(code(SPACE.name, value), { k }));
        // The compensation's power names: the tech power and the deleted one.
        expect(words(NAME.techPower)).toBe(t("sheet.termsPowers.tech.techPower"));
        expect(words(NAME.deletedTechPower)).toBe(t("sheet.tech.deletedPower"));
        // A label of Black Crusade carries no kind, so a Pathfinder one words its spell apart only by `k`.
        expect(words(NAME.unknownPower, kind) === words(NAME.unknownPower)).toBe(kind === "black_crusade");
    });
});
