import { describe, expect, it } from "vitest";
import { newItemOf } from "./newItem";
import { normalizeValue } from "./normalize";
import { condition, conditionEntry, gearItem } from "./sheet";
import { group, number, text } from "./spec";

describe("newItemOf", () => {
    it("holds only the fields that start other than their default", () => {
        expect(newItemOf(condition)).toEqual({ enabled: true, stacks: 1 });
        expect(newItemOf(conditionEntry)).toEqual({});
        expect(newItemOf(gearItem)).toEqual({});
    });

    it("normalizes to the full new item, while a missing key still shows the default", () => {
        expect(normalizeValue(condition, newItemOf(condition))).toEqual({
            enabled: true, name: "", stacks: 1, entries: { items: {}, layouts: {} },
        });
        expect(normalizeValue(condition, {})).toMatchObject({ enabled: false, stacks: 0 });
    });

    it("keeps a group only when a field inside it has an initial value", () => {
        const spec = group({ a: group({ n: number(0, { initial: 2 }) }), b: group({ s: text() }) });
        expect(newItemOf(spec)).toEqual({ a: { n: 2 } });
    });
});
