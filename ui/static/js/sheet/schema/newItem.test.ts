import { describe, expect, it } from "vitest";
import { newItemOf } from "./newItem";
import { normalizeValue } from "./normalize";
import { condition, customSkill, gearItem, rangedAttack } from "./sheet";

describe("newItemOf", () => {
    it("takes a field's initial value over its default", () => {
        expect(newItemOf(condition)).toEqual({ enabled: true, name: "", stacks: 1, entries: { items: {}, layouts: {} } });
        // A stored condition without these keys still shows the defaults.
        expect(normalizeValue(condition, {})).toMatchObject({ enabled: false, stacks: 0 });
    });

    it("fills in groups and leaves out computed outputs and optional groups", () => {
        expect(newItemOf(gearItem).armour).toEqual({
            ap: { head: "", torso: "", arms: "", legs: "" },
            superAp: { head: "", torso: "", arms: "", legs: "" },
            upgrades: "",
            special: "",
        });
        expect(newItemOf(customSkill)).not.toHaveProperty("difficulty");
        expect(newItemOf(rangedAttack)).not.toHaveProperty("roll");
    });

    it("is already normalized", () => {
        for (const spec of [condition, customSkill, gearItem, rangedAttack]) {
            expect(normalizeValue(spec, newItemOf(spec))).toEqual(newItemOf(spec));
        }
    });
});
