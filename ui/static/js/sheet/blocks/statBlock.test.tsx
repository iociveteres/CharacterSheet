import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, recordingActions, renderBlock, rollOf, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import type { RollDefaults } from "../payload";
import { StatBlock } from "./StatBlock";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const rangedRoll = {
    aim: { selected: "half", no: 0, half: 10, full: 20 },
    target: { selected: "no", no: 0, torso: -10, leg: -15, arm: -20, head: -20, joint: -40, eyes: -50 },
    range: { selected: "combat", melee: -20, pointBlank: 30, short: 10, combat: 0, long: -10, extreme: -30 },
    rof: { selected: "single", single: 10, short: 0, long: -10, suppression: -20 },
    extra1: { name: "", value: 0, enabled: false }, extra2: { name: "", value: 0, enabled: false },
    baseSelect: "BS",
};

const content = () => ({
    characterInfo: { characterName: "Orc" },
    characteristics: { BS: { value: "40", unnatural: "4" }, WS: { value: "35" }, T: { value: "45" }, A: { value: "30" } },
    skillsLeft: { dodge: { plus0: true, plus10: true }, awareness: { plus0: false }, navigate_warp: { plus0: true } },
    skillsRight: { "1_trade": { name: "Trade (Armourer)", plus0: true }, "2_trade": { name: "Trade (Cook)" } },
    customSkills: {
        list: {
            items: { s1: { name: "Waaagh", characteristic: "W", plus0: true }, s2: { name: "Sneaky", characteristic: "A" } },
            layouts: { s1: pos(0, 0), s2: pos(0, 1) },
        },
    },
    rangedAttacks: {
        list: {
            items: { r1: { name: "Shoota", damage: "1d10+4", pen: "2", damageType: "I", rofSingle: "S", rofShort: "3", clipCur: "18", clipMax: "30", roll: rangedRoll } },
            layouts: { r1: pos(0, 0) },
        },
    },
    meleeAttacks: {
        list: {
            items: {
                m1: {
                    name: "Choppa",
                    tabs: { items: { t1: { profile: "axe", damage: "1d10+4", damageType: "R" } }, layouts: { t1: pos(0, 0) } },
                },
            },
            layouts: { m1: pos(0, 0) },
        },
    },
    conditions: {
        list: {
            items: { c1: { name: "Bleeding", enabled: true, stacks: 1 }, c2: { name: "Stunned", enabled: false, stacks: 0 } },
            layouts: { c1: pos(0, 0), c2: pos(0, 1) },
        },
    },
    resourceTrackers: { list: { items: { k1: { name: "Fate", value: 2 } }, layouts: { k1: pos(0, 0) } } },
    fatigue: { fatigueCur: 1, fatigueMax: 4 },
    traits: { list: { items: { x1: { name: "Brutal Charge", description: "+3 damage on a charge" } }, layouts: { x1: pos(0, 0) } } },
    talents: { list: { items: { x2: { name: "Sturdy" }, x3: { name: "" } }, layouts: { x2: pos(0, 0), x3: pos(0, 1) } } },
});

const rollDefaults = { rangedAttack: rangedRoll, meleeAttack: {}, psychicPower: {}, techPower: {} } as RollDefaults;

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(testState());
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const show = (canEdit = true) => {
    const actions = recordingActions();
    rendered = renderBlock(<StatBlock />, { rollDefaults, canEdit, actions });
    return actions;
};
const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const $$ = (selector: string) => Array.from(rendered!.container.querySelectorAll<HTMLElement>(selector));

function capture(type: "sheet:rollVersus" | "sheet:rollExact", run: () => void): unknown[] {
    const rolls: unknown[] = [];
    const listener = (e: Event) => rolls.push(rollOf((e as CustomEvent).detail));
    document.addEventListener(type, listener);
    run();
    document.removeEventListener(type, listener);
    return rolls;
}

describe("StatBlock", () => {
    it("shows the sheet short", () => {
        show();
        expect($('[data-id="BS"] [data-id="calculatedValue"]').textContent).toBe("40");
        expect($('[data-id="BS"] [data-id="calculatedUnnatural"]').textContent).toBe("(4)");
        expect($('[data-id="WS"] [data-id="calculatedUnnatural"]')).toBeNull();
        // T 45: its bonus is the armour of every part without armour.
        expect($('.stat-armour [data-id="head"] [data-id="total"]').textContent).toBe("4");
        expect($('.stat-movement [data-id="moveHalf"]').textContent).toBe("3");
        expect($('.stat-ranged [data-id="damage"]').textContent).toBe("1d10+4");
        expect($('.stat-ranged [data-id="pen"]').textContent).toBe("2");
        expect($<HTMLInputElement>('.stat-ranged [data-id="clipCur"]').value).toBe("18");
        expect($('.stat-melee .stat-profile').textContent).toContain("Axe");
        expect($$(".stat-condition").map(c => c.textContent)).toEqual(["BleedingX ", "StunnedX "]);
        expect($(".stat-condition.disabled").textContent).toContain("Stunned");
        expect($<HTMLInputElement>('[data-id="fatigue"] [data-id="fatigueCur"]').value).toBe("1");
        expect($<HTMLInputElement>('[data-id="k1"] [data-id="value"]').value).toBe("2");
        expect($$(".stat-chip").map(c => [c.textContent, c.title])).toEqual([["Brutal Charge", "+3 damage on a charge"], ["Sturdy", ""]]);
    });

    it("leaves out a section with nothing in it", () => {
        loadState({});
        attachComputeds(testState());
        show();
        expect($$(".stat-section h4").map(h => h.textContent)).toEqual(["Armour", "Movement", "Conditions and trackers"]);
    });

    it("lists the trained skills only", () => {
        show();
        expect($$(".stat-skill-name").map(s => s.textContent)).toEqual(["Dodge", "Navigate (Warp)", "Trade (Armourer)", "Waaagh"]);
        act(() => updateSignalAtPath(testState(), "skillsLeft.awareness.plus0", true));
        act(() => updateSignalAtPath(testState(), "customSkills.list.items.s2.plus0", true));
        expect($$(".stat-skill-name").map(s => s.textContent)).toEqual(expect.arrayContaining(["Awareness", "Sneaky"]));
    });

    it("rolls characteristics, skills, attacks and damage as the sheet does", () => {
        show();
        // Fatigue 1 takes 10 off the tests, as in the sheet.
        expect(capture("sheet:rollVersus", () => $('[data-id="BS"] label').click()))
            .toEqual([{ target: 30, bonusSuccesses: 2, label: "Ballistic Skill" }]);
        // A 30, +10 trained, −10 fatigue.
        expect(capture("sheet:rollVersus", () => $('[data-id="dodge"] [data-id="difficulty"]').click()))
            .toEqual([{ target: 30, bonusSuccesses: 0, label: "Dodge" }]);

        const r1 = $('[data-id="r1"]');
        const dropdown = r1.querySelector<HTMLElement>('[data-id="roll"]')!;
        expect(dropdown.classList.contains("visible")).toBe(false);
        act(() => r1.querySelector<HTMLElement>(".stat-attack-name label")!.click());
        expect(dropdown.classList.contains("visible")).toBe(true);
        // BS 40 − fatigue 10 + half aim 10 + single shot 10.
        expect(capture("sheet:rollVersus", () => act(() => dropdown.querySelector<HTMLButtonElement>('[data-id="rollButton"]')!.click())))
            .toEqual([{ target: 50, bonusSuccesses: 2, label: "Shoota, half aim" }]);

        expect(capture("sheet:rollExact", () => r1.querySelector<HTMLElement>(".stat-damage label")!.click()))
            .toEqual([{ expression: "1d10+4", label: "Shoota" }]);
        expect(capture("sheet:rollExact", () => $('[data-id="m1"] .stat-damage label').click()))
            .toEqual([{ expression: "1d10+4", label: "Choppa, axe" }]);
    });

    it("edits the ammo and the conditions of a fight through the actions", () => {
        const actions = show();
        const clip = $<HTMLInputElement>('[data-id="r1"] [data-id="clipCur"]');
        clip.value = "17";
        act(() => { clip.dispatchEvent(new Event("input", { bubbles: true })); });
        const checkbox = $<HTMLInputElement>('[data-id="c2"] [data-id="enabled"]');
        act(() => checkbox.click());
        const edits = [...actions.sent, ...actions.scheduled.map(([msg]) => msg)];
        expect(edits).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "change", path: "rangedAttacks.list.items.r1.clipCur", change: "17" }),
            expect.objectContaining({ type: "change", path: "conditions.list.items.c2.enabled", change: true }),
        ]));
    });

    it("only shows a sheet it may not edit", () => {
        show(false);
        expect($$(".rollable")).toEqual([]);
        expect($('[data-id="roll"]')).toBeNull();
        expect($<HTMLInputElement>('[data-id="clipCur"]').readOnly).toBe(true);
        expect($<HTMLInputElement>('[data-id="c1"] [data-id="enabled"]').disabled).toBe(true);
        expect($<HTMLInputElement>('[data-id="dodge"] [data-id="difficulty"]').value).toBe("30");
        expect(capture("sheet:rollVersus", () => $('[data-id="BS"] label').click())).toEqual([]);
    });
});
