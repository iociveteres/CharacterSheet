import { describe, expect, it, vi } from "vitest";
import { signal } from "@preact/signals-core";
import { installDictionary } from "../../i18n/testDictionary";
import type { SheetSignals } from "../schema/sheet";

// The columns' names are computed when schema/constants.ts loads, so each
// language loads the modules anew.
async function load() {
    vi.resetModules();
    const [{ RANGED_ROLL_COLUMNS, MELEE_ROLL_COLUMNS }, { selectedCodes, rollLabel }, { labelText }] =
        await Promise.all([import("../schema/constants"), import("./rollParts"), import("../rollLabelText")]);
    return { RANGED_ROLL_COLUMNS, MELEE_ROLL_COLUMNS, selectedCodes, rollLabel, labelText };
}

const rollOf = (selected: { [column: string]: string }) => ({
    r: { roll: Object.fromEntries(Object.entries(selected).map(([key, value]) => [key, { selected: signal(value) }])) },
}) as unknown as SheetSignals;

describe("the roll label", () => {
    it("codes the selected options but the defaults, worded in lower case after the name", async () => {
        const { RANGED_ROLL_COLUMNS, selectedCodes, rollLabel, labelText } = await load();
        const state = rollOf({ aim: "half", target: "torso", range: "point-blank", rof: "single" });
        const codes = selectedCodes(state, "r.roll", RANGED_ROLL_COLUMNS);
        expect(codes).toEqual([["aim:half"], ["target:torso"], ["range:point-blank"]]);
        expect(labelText(rollLabel("Lasgun", codes))).toBe("Lasgun, half aim, torso, point-blank");
    });

    it("codes the melee columns apart from the ranged ones whose keys they share", async () => {
        const { MELEE_ROLL_COLUMNS, selectedCodes } = await load();
        expect(selectedCodes(rollOf({ aim: "full", base: "charge", rof: "lightning" }), "r.roll", MELEE_ROLL_COLUMNS))
            .toEqual([["aim:full"], ["meleeBase:charge"], ["meleeRof:lightning"]]);
    });

    it("keeps the same codes in every language and is worded in the reader's", async () => {
        const ranged = rollOf({ aim: "full", target: "head", range: "combat", rof: "suppression" });
        const english = await load();
        const englishCodes = english.selectedCodes(ranged, "r.roll", english.RANGED_ROLL_COLUMNS);
        const englishText = english.labelText(english.rollLabel("Lasgun", englishCodes));
        installDictionary("ru");
        const { RANGED_ROLL_COLUMNS, selectedCodes, rollLabel, labelText } = await load();
        const codes = selectedCodes(ranged, "r.roll", RANGED_ROLL_COLUMNS);
        expect(codes).toEqual(englishCodes);
        const text = labelText(rollLabel("Lasgun", codes));
        expect(text).not.toBe(englishText);
        expect(text).toMatch(/^Lasgun, [^A-Za-z]+$/);
    });

    it("words an option the column does not know as its value", async () => {
        const { RANGED_ROLL_COLUMNS, selectedCodes, rollLabel, labelText } = await load();
        expect(labelText(rollLabel("Lasgun", selectedCodes(rollOf({ range: "orbital" }), "r.roll", RANGED_ROLL_COLUMNS)))).toBe("Lasgun, orbital");
    });
});
