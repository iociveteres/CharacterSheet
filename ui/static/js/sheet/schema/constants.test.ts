import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../../i18n/testDictionary";

// The labels are taken when the module loads, as on a page whose language is
// fixed: a test of another language loads the module again after installing it.
async function constantsIn(lang: "en" | "ru") {
    installDictionary(lang);
    vi.resetModules();
    return import("./constants");
}

afterEach(() => vi.resetModules());

describe("the labels of the sheet's fixed lists", () => {
    it("are in the page's language, the stored value unchanged", async () => {
        const { RANGED_CLASSES, optionLabel, optionValue } = await constantsIn("ru");
        const longRifle = RANGED_CLASSES.find(o => optionValue(o) === "long rifle")!;
        expect(optionLabel(longRifle)).toBe("Длинная винтовка");
    });

    it("keep the English labels on an English page", async () => {
        const { MELEE_PROFILES, QUALITIES, optionLabel, optionValue } = await constantsIn("en");
        expect(MELEE_PROFILES.slice(5, 7).map(optionLabel)).toEqual(["Claws.H", "Claws.A"]);
        expect(QUALITIES.map(o => [optionValue(o), optionLabel(o)])).toEqual([
            ["Poor", "Poor"], ["Common", "Comm."], ["Good", "Good"], ["Best", "Best"],
        ]);
    });

    it("write a size with its modifier after the translated name", async () => {
        const { SIZE_OPTIONS, optionLabel } = await constantsIn("ru");
        expect(SIZE_OPTIONS.map(optionLabel).slice(0, 2)).toEqual(["Крохотный (-3)", "Мелкий (-2)"]);
    });

    it("label the radio options of a roll column by the short term", async () => {
        const { RANGED_ROLL_COLUMNS, optionLabel } = await constantsIn("ru");
        const [aim, , range] = RANGED_ROLL_COLUMNS;
        expect([aim.label, ...aim.options.map(optionLabel)]).toEqual(["Прицеливание", "Нет", "Половинное", "Полное"]);
        expect(range.options.map(optionLabel)[1]).toBe("В упор");
    });

    it("keep a skill's English name, which entries and tests write it by, beside its label", async () => {
        const { SKILLS_LEFT, SKILLS_RIGHT } = await constantsIn("ru");
        const surface = SKILLS_LEFT.find(r => r.key === "navigate_surface")!;
        expect(surface).toMatchObject({ name: "Surface", label: "Наземная", group: "Navigate", groupLabel: "Навигация" });
        expect(SKILLS_RIGHT[0]).toMatchObject({ group: "Linguistics", groupLabel: "Язык" });
    });
});
