import { describe, expect, it, vi } from "vitest";
import { normalizeField, normalizeSheet } from "./normalize";
import { sheetSchema } from "./sheet";
import { SKILLS_LEFT, SKILLS_RIGHT } from "./constants";
import { number, openSelect, radio, select, text, textarea } from "./spec";

// defaultContent in internal/models/character_sheets_defaults.go, the content
// of a newly created sheet.
const DEFAULT_CONTENT = {
    characterInfo: { characterName: "New Character" },
    initiative: { dice: "d10", aBonus: true, flatBonus: 0 },
    size: 0,
    movement: { fullMult: 2, chargeMult: 3, runMult: 6, bonus: 0 },
};

const deepFreeze = <T>(o: T): T => {
    if (o && typeof o === "object") {
        Object.values(o).forEach(deepFreeze);
        Object.freeze(o);
    }
    return o;
};

describe("normalizeSheet", () => {
    it("fills an empty sheet with the defaults the templates show", () => {
        const s = normalizeSheet(sheetSchema, {});

        expect(s.characterInfo.characterName).toBe("");
        expect(s.characteristics.WS).toEqual({ value: "", unnatural: "" });
        expect(Object.keys(s.characteristics)).toEqual(["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"]);
        expect(Object.keys(s.skillsLeft)).toEqual(SKILLS_LEFT.map(r => r.key));
        expect(Object.keys(s.skillsRight)).toEqual(SKILLS_RIGHT.map(r => r.key));
        expect(s.skillsLeft.acrobatics).toEqual({
            characteristic: "A", plus0: false, plus10: false, plus20: false, plus30: false, miscBonus: 0,
        });
        expect(s.skillsRight["1_linguistics"]).toMatchObject({ name: "", characteristic: "I" });
        expect(s.fatigue.fatigueMode).toBe("all");
        expect(s.size).toBe("0");
        expect(s.initiative.lastInitiative).toBe("0");
        expect(s.movement).toEqual({ bonus: 0, fullMult: 2, chargeMult: 3, runMult: 6 });
        expect(s.experience.alignment).toBe("Undivided");
        expect(s.psykana.psykanaType).toBe("Bound");
        expect(s.technoArcana.compensationRoll).toEqual({
            modifier: 0,
            extra1: { name: "", value: 0, enabled: false },
            extra2: { name: "", value: 0, enabled: false },
        });
        expect(s.conditions.list).toEqual({ items: {}, layouts: {} });
        expect(s.experience.experienceLog).toEqual({ items: {}, layouts: {} });
        expect(s.psykana.tabs).toEqual({ items: {}, layouts: {} });
    });

    it("treats content that is not an object as empty", () => {
        expect(normalizeSheet(sheetSchema, null)).toEqual(normalizeSheet(sheetSchema, {}));
        expect(normalizeSheet(sheetSchema, [])).toEqual(normalizeSheet(sheetSchema, {}));
    });

    it("leaves computed outputs out", () => {
        const s = normalizeSheet(sheetSchema, {
            movement: { moveHalf: 4 },
            experience: { experienceSpent: 100, experienceRemaining: 5 },
            carryWeightAndEncumbrance: { carryWeightBase: 7, carryWeight: 20, encumbrance: 3 },
            psykana: { effectivePR: 3 },
            skillsLeft: { dodge: { difficulty: 45 } },
        }) as unknown as Record<string, Record<string, unknown>>;

        expect(s.movement).not.toHaveProperty("moveHalf");
        expect(s.experience).not.toHaveProperty("experienceSpent");
        expect(s.carryWeightAndEncumbrance).toEqual({ carryWeightBase: 7 });
        expect(s.psykana).not.toHaveProperty("effectivePR");
        expect(s.armour).not.toHaveProperty("toughnessBaseAbsorptionValue");
        expect(s.armour.head).not.toHaveProperty("sum");
        expect((s.skillsLeft.dodge as object)).not.toHaveProperty("difficulty");
    });

    it("normalizes a new sheet from defaultContent", () => {
        const s = normalizeSheet(sheetSchema, DEFAULT_CONTENT);

        expect(s.characterInfo.characterName).toBe("New Character");
        expect(s.initiative).toMatchObject({ dice: "d10", aBonus: true, wsBonus: false, flatBonus: 0 });
        expect(s.size).toBe("0");
        expect(s.movement).toEqual({ bonus: 0, fullMult: 2, chargeMult: 3, runMult: 6 });
    });

    it("normalizes an old sheet with missing and null fields", () => {
        const raw = deepFreeze({
            characterInfo: { characterName: "Old\nOne", gender: "not rendered" },
            characteristics: { WS: { value: "35" }, XX: { value: "1" } },
            skillsLeft: { athletics: { characteristic: "Foo" }, dodge: { characteristic: "Cor", plus10: true } },
            skillsRight: { "1_linguistics": { name: "Low Gothic" }, "9_trade": { name: "not rendered" } },
            initiative: { lastInitiative: 42 },
            size: 7,
            movement: { fullMult: 0, chargeMult: 4 },
            notes: { list: { items: null, layouts: null } },
            conditions: {
                list: {
                    items: {
                        c1: {
                            name: "Fury", stacks: -2,
                            entries: { items: { e1: { type: "bonus_unnatural", bonus: "X" }, e2: { apType: "" } } },
                        },
                        c2: { entries: { items: null, layouts: null } },
                    },
                    layouts: { c1: { colIndex: 1, rowIndex: 0 } },
                },
            },
            experience: { experienceLog: { items: { x1: { level: 0 }, x2: { type: "skill", level: 3 } } } },
            rangedAttacks: { list: { items: { r1: { class: "Pistol" }, r2: { roll: { aim: { selected: "bogus" } } } } } },
            gear: { list: { items: { g1: { weight: 1.5, armour: { ablativeWounds: "3" } } } } },
        });

        const s = normalizeSheet(sheetSchema, raw);

        expect(s.characterInfo.characterName).toBe("OldOne");
        expect(s.characterInfo).not.toHaveProperty("gender");
        expect(s.characteristics.WS).toEqual({ value: "35", unnatural: "" });
        expect(s.characteristics).not.toHaveProperty("XX");
        expect(s.skillsLeft.athletics.characteristic).toBe("WS");
        expect(s.skillsLeft.dodge).toMatchObject({ characteristic: "Cor", plus10: true });
        expect(s.skillsRight["1_linguistics"]).toMatchObject({ name: "Low Gothic", characteristic: "I" });
        expect(s.skillsRight).not.toHaveProperty("9_trade");
        expect(s.initiative.lastInitiative).toBe("42");
        expect(s.size).toBe("-3");
        expect(s.movement).toMatchObject({ fullMult: 2, chargeMult: 4, runMult: 6 });
        expect(s.notes.list).toEqual({ items: {}, layouts: {} });

        const c1 = s.conditions.list.items.c1;
        expect(c1).toMatchObject({ name: "Fury", enabled: false, stacks: -2 });
        expect(c1.entries.items.e1).toMatchObject({ type: "char_bonus", bonus: "X", name: "", apType: "natural" });
        expect(c1.entries.items.e2.type).toBe("char_bonus");
        expect(c1.entries.layouts).toEqual({});
        expect(s.conditions.list.items.c2.entries).toEqual({ items: {}, layouts: {} });
        // Items without a position stay, the grid places them.
        expect(s.conditions.list.layouts).toEqual({ c1: { colIndex: 1, rowIndex: 0 } });

        expect(s.experience.experienceLog.items.x1).toMatchObject({ type: "other", level: "1" });
        expect(s.experience.experienceLog.items.x2).toMatchObject({ type: "skill", level: "3" });

        const r1 = s.rangedAttacks.list.items.r1;
        expect(r1.class).toBe("pistol");
        expect(r1).not.toHaveProperty("roll");
        const roll = s.rangedAttacks.list.items.r2.roll!;
        expect(roll.aim).toEqual({ selected: "", no: 0, half: 0, full: 0 });
        expect(roll.range.selected).toBe("");
        expect(roll.testOption).toBe("");
        expect(roll).not.toHaveProperty("total");

        const g1 = s.gear.list.items.g1;
        expect(g1).toMatchObject({ weight: 1.5, gearType: "", carried: false });
        expect(g1.armour).toEqual({
            ap: { head: "", torso: "", arms: "", legs: "" },
            superAp: { head: "", torso: "", arms: "", legs: "" },
            upgrades: "",
            special: "",
        });
        expect(g1.entries).toEqual({ items: {}, layouts: {} });
    });

    it("drops layouts of missing items and reports them", () => {
        const onGhost = vi.fn();
        const s = normalizeSheet(sheetSchema, {
            traits: { list: { items: { t1: { name: "T" } }, layouts: { t1: { colIndex: 0, rowIndex: 0 }, ghost: { colIndex: 1, rowIndex: 0 } } } },
            conditions: {
                list: {
                    items: { c1: { entries: { items: {}, layouts: { e0: { colIndex: 0, rowIndex: 0 } } } } },
                    layouts: {},
                },
            },
        }, { onGhost });

        expect(s.traits.list.layouts).toEqual({ t1: { colIndex: 0, rowIndex: 0 } });
        expect(s.traits.list.items).not.toHaveProperty("ghost");
        expect(s.conditions.list.items.c1.entries.layouts).toEqual({});
        expect(onGhost.mock.calls).toEqual([
            ["conditions.list.items.c1.entries.items", "e0"],
            ["traits.list.items", "ghost"],
        ]);
    });

    it("warns about ghosts in dev mode by default", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => { });
        normalizeSheet(sheetSchema, { notes: { list: { items: {}, layouts: { n1: { colIndex: 0, rowIndex: 0 } } } } });
        expect(warn).toHaveBeenCalledWith(expect.stringContaining("notes.list.items.n1"));
        warn.mockRestore();
    });

    it("does not modify its input", () => {
        const raw = deepFreeze({ traits: { list: { items: { t1: {} }, layouts: { gone: { colIndex: 0, rowIndex: 0 } } } } });
        expect(() => normalizeSheet(sheetSchema, raw, { onGhost: () => { } })).not.toThrow();
    });
});

describe("normalizeField", () => {
    it("reads numbers as an <input type=number> does", () => {
        const n = number();
        expect(normalizeField(n, 5)).toBe(5);
        expect(normalizeField(n, "1e3")).toBe(1000);
        expect(normalizeField(n, ".5")).toBe(0.5);
        expect(normalizeField(n, "5.")).toBe(0);
        expect(normalizeField(n, "abc")).toBe(0);
        expect(normalizeField(n, -0)).toBe(0);
        expect(Object.is(normalizeField(n, -0), 0)).toBe(true);
        expect(normalizeField(n, undefined)).toBe(0);
        expect(normalizeField(number(2, { emptyAsDefault: true }), 0)).toBe(2);
        expect(normalizeField(number(2, { emptyAsDefault: true }), -1)).toBe(-1);
    });

    it("strips line breaks from text inputs and normalizes them in textareas", () => {
        expect(normalizeField(text(), "a\r\nb")).toBe("ab");
        expect(normalizeField(text(), 12)).toBe("12");
        expect(normalizeField(text(), null)).toBe("");
        expect(normalizeField(textarea(), "\na\r\nb\rc")).toBe("\na\nb\nc");
    });

    it("picks the option a select shows", () => {
        const s = select(["a", "b", "c"], "b");
        expect(normalizeField(s, "c")).toBe("c");
        expect(normalizeField(s, "")).toBe("b");
        expect(normalizeField(s, undefined)).toBe("b");
        expect(normalizeField(s, "zzz")).toBe("a");
        expect(normalizeField(select(["0", "1"]), 1)).toBe("1");
    });

    it("keeps any value of an open select", () => {
        const s = openSelect("W");
        expect(normalizeField(s, "custom:abc")).toBe("custom:abc");
        expect(normalizeField(s, "")).toBe("W");
        expect(normalizeField(s, null)).toBe("W");
    });

    it("leaves a radio group unchecked for an unknown value", () => {
        const r = radio(["no", "half"]);
        expect(normalizeField(r, "half")).toBe("half");
        expect(normalizeField(r, "full")).toBe("");
        expect(normalizeField(r, undefined)).toBe("");
    });
});
