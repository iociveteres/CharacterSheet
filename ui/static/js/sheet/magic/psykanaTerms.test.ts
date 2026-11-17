import { afterEach, describe, expect, it, vi } from "vitest";
import { installDictionary } from "../../i18n/testDictionary";

// The terms are taken when the module loads, as on a page whose language is fixed.
async function termsIn(lang: "en" | "ru") {
    installDictionary(lang);
    vi.resetModules();
    return (await import("../schema/constants")).BLACK_CRUSADE_PSYKANA_TERMS;
}

afterEach(() => vi.resetModules());

describe("the psykana phrases of Black Crusade", () => {
    it("are whole in Russian, the power declined in each", async () => {
        const terms = await termsIn("ru");
        expect([terms.psykana, terms.psychicPowers, terms.noPRLeft, terms.ignoresSustained]).toEqual([
            "Псайкана", "Психосилы", "Не осталось PR для новой психосилы", "Талант: без учёта PR, занятого поддерживаемыми психосилами",
        ]);
    });

    it("put the number typed before into the notice", async () => {
        expect((await termsIn("ru")).typedSustainedNotice(3)).toBe(
            "В поле «Поддерживаемые психосилы» было введено 3. Теперь оно считает психосилы, отмеченные как поддерживаемые: отметьте их или отключите подсчёт.",
        );
        expect((await termsIn("en")).typedSustainedNotice(3)).toBe(
            "Sustained Powers was typed as 3. It now counts the powers marked sustained: mark them, or turn the counting off.",
        );
    });
});

async function pathfinderIn(lang: "en" | "ru") {
    installDictionary(lang);
    vi.resetModules();
    return (await import("../kinds/pathfinder_crusade")).pathfinderCrusade;
}

describe("the magic phrases of Pathfinder Crusade", () => {
    it("are whole in Russian, the spell declined in each, the words of the dictionary capitalized as headings", async () => {
        const { terms } = await pathfinderIn("ru");
        expect([terms.psykana, terms.psykanaType, terms.psychicPower, terms.psychicPowers, terms.noPRLeft, terms.ignoresSustained]).toEqual([
            "Магия", "Природа Дара", "Заклинание", "Заклинания", "Не осталось PR для нового заклинания",
            "Талант: без учёта PR, занятого поддерживаемыми заклинаниями",
        ]);
        expect((await pathfinderIn("en")).terms.psychicPowers).toBe("Spells");
    });

    it("put the number typed before into the notice", async () => {
        expect((await pathfinderIn("ru")).terms.typedSustainedNotice(2)).toBe(
            "В поле «Поддерживаемые заклинания» было введено 2. Теперь оно считает заклинания, отмеченные как поддерживаемые: отметьте их или отключите подсчёт.",
        );
    });

    it("label the skills, gifts and Spellcasting in Russian, their names and values English", async () => {
        const { stats } = await pathfinderIn("ru");
        const navigation = stats.skillsLeft.find(r => r.key === "navigation_sea")!;
        expect([navigation.name, navigation.group, navigation.label, navigation.groupLabel]).toEqual(["Sea", "Navigation", "Море", "Навигация"]);
        expect(stats.psykanaTypes).toEqual([
            { value: "Arcane", label: "Арканный" }, { value: "Bound", label: "Связанный" }, { value: "Unbound", label: "Несвязанный" },
        ]);
        const bard = stats.spellcasting.find(v => v.key === "bard")!;
        expect([bard.label, bard.trait, bard.pool, bard.gift, bard.classes]).toEqual(["Бард", "Искусства Барда", "Фокус Барда", undefined, ["Bard", "Бард"]]);
        expect(stats.spellcasting.find(v => v.key === "arcane")!.gift).toBe("Arcane");
    });
});
