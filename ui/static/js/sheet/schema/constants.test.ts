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
        const english = await constantsIn("en");
        const englishLabel = english.optionLabel(english.RANGED_CLASSES.find(o => english.optionValue(o) === "long rifle")!);
        const { RANGED_CLASSES, QUALITIES, optionLabel, optionValue } = await constantsIn("ru");
        const longRifle = RANGED_CLASSES.find(o => optionValue(o) === "long rifle")!;
        expect(optionLabel(longRifle)).not.toBe(englishLabel);
        expect(QUALITIES.map(optionValue)).toEqual(["Poor", "Common", "Good", "Best"]);
    });

    it("write a size with its modifier after the translated name", async () => {
        const { SIZE_OPTIONS, optionLabel } = await constantsIn("ru");
        expect(SIZE_OPTIONS.map(optionLabel).slice(0, 2)).toEqual([expect.stringMatching(/ \(-3\)$/), expect.stringMatching(/ \(-2\)$/)]);
    });

    it("keep a skill's English name, which entries and tests write it by, beside its label", async () => {
        const { SKILLS_LEFT, SKILLS_RIGHT } = await constantsIn("ru");
        const surface = SKILLS_LEFT.find(r => r.key === "navigate_surface")!;
        expect(surface).toMatchObject({ name: "Surface", group: "Navigate" });
        expect(surface.label).not.toBe("Surface");
        expect(surface.groupLabel).not.toBe("Navigate");
        expect(SKILLS_RIGHT[0]).toMatchObject({ group: "Linguistics" });
        expect(SKILLS_RIGHT[0].groupLabel).not.toBe("Linguistics");
    });
});
