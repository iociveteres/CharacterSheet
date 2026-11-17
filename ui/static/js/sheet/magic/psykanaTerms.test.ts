import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../../i18n/testDictionary";
import { optionLabel, optionValue } from "../schema/constants";

// The terms are taken when the module loads, as on a page whose language is fixed.
async function termsIn(lang: "en" | "ru") {
    installDictionary(lang);
    vi.resetModules();
    return (await import("../schema/constants")).BLACK_CRUSADE_PSYKANA_TERMS;
}

afterEach(() => vi.resetModules());

describe("the psykana phrases of Black Crusade", () => {
    it("put the number typed before into the notice", async () => {
        expect((await termsIn("ru")).typedSustainedNotice(3)).toMatch(/\b3\b/);
        expect((await termsIn("en")).typedSustainedNotice(3)).toMatch(/\b3\b/);
    });
});

async function pathfinderIn(lang: "en" | "ru") {
    installDictionary(lang);
    vi.resetModules();
    return (await import("../kinds/pathfinder_crusade")).pathfinderCrusade;
}

describe("the magic phrases of Pathfinder Crusade", () => {
    it("are its own, apart from those of Black Crusade, in either language", async () => {
        for (const lang of ["en", "ru"] as const) {
            const blackCrusade = await termsIn(lang);
            const { terms } = await pathfinderIn(lang);
            for (const key of ["psykana", "psychicPowers", "noPRLeft", "ignoresSustained"] as const) {
                expect(terms[key]).not.toBe(blackCrusade[key]);
            }
        }
    });

    it("put the number typed before into the notice", async () => {
        expect((await pathfinderIn("ru")).terms.typedSustainedNotice(2)).toMatch(/\b2\b/);
    });

    it("label the skills, gifts and Spellcasting in the page's language, their names and values English", async () => {
        const { stats } = await pathfinderIn("ru");
        const navigation = stats.skillsLeft.find(r => r.key === "navigation_sea")!;
        expect([navigation.name, navigation.group]).toEqual(["Sea", "Navigation"]);
        expect(navigation.label).not.toBe(navigation.name);
        expect(navigation.groupLabel).not.toBe(navigation.group);
        expect(stats.psykanaTypes.map(optionValue)).toEqual(["Arcane", "Bound", "Unbound"]);
        expect(optionLabel(stats.psykanaTypes[0])).not.toBe("Arcane");
        const bard = stats.spellcasting.find(v => v.key === "bard")!;
        // A class written in either language picks the variant.
        expect(bard.classes).toEqual(["Bard", expect.not.stringMatching(/^Bard$/)]);
        expect(bard.gift).toBeUndefined();
        expect(stats.spellcasting.find(v => v.key === "arcane")!.gift).toBe("Arcane");
    });
});
