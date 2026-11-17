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
