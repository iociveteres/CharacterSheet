import { describe, expect, it } from "vitest";
import { powerTraits, safePR } from "./psychic";

describe("powerTraits", () => {
    it("reads Cycle and Repeatable with their X among the subtypes, any case", () => {
        expect(powerTraits("Призыв, Цикл (5)", "Свободное действие")).toEqual({ sustainable: true, cycle: 5 });
        expect(powerTraits("cycle(3), Repeatable (1)", "Half action")).toEqual({ sustainable: true, cycle: 3, repeatable: 1 });
        expect(powerTraits("Повторяемая (2)", "нет")).toEqual({ sustainable: false, repeatable: 2 });
    });

    it("gives a type without X a null X and ignores what only mentions it", () => {
        expect(powerTraits("Призыв, Цикл", "")).toEqual({ sustainable: false, cycle: null });
        expect(powerTraits("Велоцикл, Cycle of Pain", "Нет")).toEqual({ sustainable: false });
    });

    it("takes a power as sustainable unless its Sustained field says no", () => {
        for (const no of ["", " Нет ", "no", "None", "-", "—"]) expect(powerTraits("", no).sustainable, no).toBe(false);
        for (const yes of ["Свободное действие", "Полудействие", "Yes"]) expect(powerTraits("", yes).sustainable, yes).toBe(true);
    });
});

it("safePR is half the PR rounded up", () => {
    expect([0, 1, 4, 5].map(safePR)).toEqual([0, 1, 2, 3]);
});
