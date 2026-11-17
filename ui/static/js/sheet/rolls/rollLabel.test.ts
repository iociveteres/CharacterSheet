import { describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals-core";
import { installDictionary } from "../../i18n/testDictionary";
import type { SheetSignals } from "../schema/sheet";

// The columns' names are computed when schema/constants.ts loads, so each
// language loads the modules anew.
async function load() {
    vi.resetModules();
    const [{ RANGED_ROLL_COLUMNS, MELEE_ROLL_COLUMNS }, { selectedNames, rollLabel }] =
        await Promise.all([import("../schema/constants"), import("./rollParts")]);
    return { RANGED_ROLL_COLUMNS, MELEE_ROLL_COLUMNS, selectedNames, rollLabel };
}

const rollOf = (selected: { [column: string]: string }) => ({
    r: { roll: Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, { selected: signal(value) }])) },
}) as unknown as SheetSignals;

describe("the roll label", () => {
    it("names the selected options but the defaults, in lower case after the name", async () => {
        const { RANGED_ROLL_COLUMNS, selectedNames, rollLabel } = await load();
        const state = rollOf({ aim: "half", target: "torso", range: "point-blank", rof: "single" });
        expect(rollLabel("Lasgun", selectedNames(state, "r.roll", RANGED_ROLL_COLUMNS)))
            .toBe("Lasgun, half aim, torso, point-blank");
    });

    it("is in the language of the one who rolls", async () => {
        const ranged = rollOf({ aim: "full", target: "head", range: "combat", rof: "suppression" });
        const english = await load();
        const englishNames = english.selectedNames(ranged, "r.roll", english.RANGED_ROLL_COLUMNS);
        installDictionary("ru");
        const { RANGED_ROLL_COLUMNS, MELEE_ROLL_COLUMNS, selectedNames, rollLabel } = await load();
        const names = selectedNames(ranged, "r.roll", RANGED_ROLL_COLUMNS);
        expect(names).toHaveLength(3);
        expect(names).not.toEqual(englishNames);
        expect(rollLabel("Лазган", names)).toMatch(/^Лазган, /);
        expect(selectedNames(rollOf({ base: "charge", rof: "lightning" }), "r.roll", MELEE_ROLL_COLUMNS)).toHaveLength(2);
    });

    it("names an option the column does not know by its value", async () => {
        const { RANGED_ROLL_COLUMNS, selectedNames } = await load();
        expect(selectedNames(rollOf({ range: "orbital" }), "r.roll", RANGED_ROLL_COLUMNS)).toEqual(["orbital"]);
    });
});
