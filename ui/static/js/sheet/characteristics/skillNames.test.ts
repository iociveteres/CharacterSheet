import { afterEach, describe, expect, it } from "vitest";
import { computed, type Signal } from "@preact/signals-core";
import { conditionOf, loadState, teardownSheet, testState } from "../components/testUtils";
import { BLACK_CRUSADE_STATS, SKILLS_LEFT, optionValue } from "../schema/constants";
import { normalizeSkillName, namesSheetSkill, skillNameGroups, talentNames } from "./skillNames";
import { attachComputeds } from "../kinds/computed";
import { resolvePath } from "../core/sync";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;

afterEach(() => teardownSheet());

function load(extra: object = {}): void {
    loadState({
        skillsRight: { "1_linguistics": { name: "Low Gothic" } },
        customSkills: { list: { items: { c1: { name: "Void Pilot" }, c2: { name: "" } }, layouts: { c1: pos(0, 0), c2: pos(0, 1) } } },
        ...extra,
    });
    attachComputeds(testState());
}

describe("skillNameGroups", () => {
    it("names every left row as skillDifficulty matches it", () => {
        load();
        const names = skillNameGroups(testState(), BLACK_CRUSADE_STATS).flatMap(g => g.options.map(optionValue));
        for (const row of SKILLS_LEFT) {
            expect(names.map(normalizeSkillName), row.key).toContain(normalizeSkillName(row.key));
        }
        expect(names).toContain("Navigate Surface");
        expect(names).toContain("Tech-Use");
    });

    it("lists the named right rows and custom skills in their groups, not the unnamed ones", () => {
        load();
        const groups = skillNameGroups(testState(), BLACK_CRUSADE_STATS);
        expect(groups.map(g => g.label)).toEqual(["Skills", "Navigate", "Operate", "Linguistics", "Custom skills"]);
        expect(groups.find(g => g.label === "Linguistics")!.options).toEqual([{ value: "Low Gothic", label: "Low Gothic" }]);
        expect(groups.find(g => g.label === "Custom skills")!.options).toEqual([{ value: "Void Pilot", label: "Void Pilot" }]);
        expect(groups.find(g => g.label === "Navigate")!.options[0]).toEqual({ value: "Navigate Surface", label: "Surface" });
    });

    it("gives a name the bonus of a skill_bonus entry counts under", () => {
        load({ conditions: conditionOf({ type: "skill_bonus", name: "Navigate Surface", skillBonus: "10" }) });
        // Untrained I 0 is -20.
        expect(value("skillsLeft.navigate_surface.difficulty")).toBe(-10);
        expect(value("skillsLeft.navigate_stellar.difficulty")).toBe(-20);
    });
});

describe("namesSheetSkill", () => {
    it("matches a skill of the sheet whatever the case and separators", () => {
        load();
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "dodge")).toBe(true);
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "navigate-surface")).toBe(true);
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "low gothic")).toBe(true);
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "Void  Pilot")).toBe(true);
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "Navigate (Surface)")).toBe(false);
        expect(namesSheetSkill(testState(), BLACK_CRUSADE_STATS, "High Gothic")).toBe(false);
    });
});

describe("talent names", () => {
    const talents = (...names: string[]) => ({
        talents: {
            list: {
                items: Object.fromEntries(names.map((name, i) => [`t${i}`, { name }])),
                layouts: Object.fromEntries(names.map((_, i) => [`t${i}`, pos(0, i)])),
            },
        },
    });

    it("are one list for all readers, kept while the names stay the same", () => {
        loadState(talents("Crushing Blow", "Mighty Shot"));
        const state = testState();
        let runs = 0;
        const reader = computed(() => {
            runs++;
            return talentNames(state);
        });
        const names = reader.value;
        expect(names).toEqual(["Crushing Blow", "Mighty Shot"]);
        expect(talentNames(state)).toBe(names);

        (resolvePath(state, "talents.list.items.t0.name") as Signal<string>).value = "Crushing Blow ";
        expect(reader.value).toBe(names);
        expect(runs).toBe(1);

        (resolvePath(state, "talents.list.items.t1.name") as Signal<string>).value = "Balearic";
        expect(reader.value).toEqual(["Crushing Blow", "Balearic"]);
        expect(runs).toBe(2);
    });
});
