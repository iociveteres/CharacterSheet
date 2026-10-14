import { describe, expect, it } from "vitest";
import { powerTraits, safePR } from "./psychic";

describe("powerTraits", () => {
    it("reads Cycle and Repeatable with their X among the subtypes, any case", () => {
        expect(powerTraits("Призыв, Цикл (5)", "Свободное действие")).toEqual({ sustainable: true, cycle: 5 });
        expect(powerTraits("cycle(3), Repeatable (1)", "Half action")).toEqual({ sustainable: true, cycle: 3, repeatable: 1 });
        expect(powerTraits("Повторяемая (2)", "нет")).toEqual({ sustainable: false, repeatable: 2 });
        expect(powerTraits("Аура, Поддержание (1)", "Свободное действие")).toEqual({ sustainable: true, upkeep: 1 });
        expect(powerTraits("upkeep (2), Cycle", "Free action")).toEqual({ sustainable: true, upkeep: 2, cycle: null });
    });

    it("gives a type without X a null X and ignores what only mentions it", () => {
        expect(powerTraits("Призыв, Цикл", "")).toEqual({ sustainable: false, cycle: null });
        expect(powerTraits("Велоцикл, Cycle of Pain", "Нет")).toEqual({ sustainable: false });
    });

    it("reads Sorcery with its class, which any name can be, and only with it", () => {
        expect(powerTraits("Иллюзия, Sorcery (Bard)", "")).toEqual({ sustainable: false, sorcery: "Bard" });
        expect(powerTraits("Колдовство ( Бард ), Поддержание (1)", "Free action")).toEqual({ sustainable: true, sorcery: "Бард", upkeep: 1 });
        expect(powerTraits("sorcery(Ranger)", "").sorcery).toBe("Ranger");
        expect(powerTraits("SORCERY (Elite Archetype)", "").sorcery).toBe("Elite Archetype");
        for (const not of ["Колдовство", "Sorcery", "Sorcery ()", "Sorcery (  )", "Sorcery of the Bard", "Black Sorcery (Bard)"]) {
            expect(powerTraits(not, ""), not).toEqual({ sustainable: false });
        }
    });

    it("takes a power as sustainable unless its Sustained field says no", () => {
        for (const no of ["", " Нет ", "no", "None", "-", "—"]) expect(powerTraits("", no).sustainable, no).toBe(false);
        for (const yes of ["Свободное действие", "Полудействие", "Yes"]) expect(powerTraits("", yes).sustainable, yes).toBe(true);
    });
});

it("safePR is half the PR rounded up", () => {
    expect([0, 1, 4, 5].map(safePR)).toEqual([0, 1, 2, 3]);
});
