import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import {
    hoverLines, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, rollOf, teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import type { Autocomplete } from "../autocomplete";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import type { RollDefaults } from "../payload";
import { Psykana, TechnoArcana } from "./Powers";
import { StatBlock } from "./StatBlock";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const rangedRoll = {
    aim: { selected: "half", no: 0, half: 10, full: 20 },
    target: { selected: "no", no: 0, torso: -10, leg: -15, arm: -20, head: -20, joint: -40, eyes: -50 },
    range: { selected: "combat", melee: -20, pointBlank: 30, short: 10, combat: 0, long: -10, extreme: -30 },
    rof: { selected: "single", single: 10, short: 0, long: -10, suppression: -20 },
    extra1: { name: "", value: 0, enabled: false }, extra2: { name: "", value: 0, enabled: false },
    testOption: "bs",
};

const content = () => ({
    characterInfo: { characterName: "Orc" },
    characteristics: {
        BS: { value: "40", unnatural: "4" }, WS: { value: "35" }, T: { value: "45" }, A: { value: "30" }, W: { value: "40" }, I: { value: "40" },
    },
    armour: { woundsMax: 12, woundsCur: 2 },
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
        testOptions: { items: { bs: { base: "BS" } }, layouts: { bs: pos(0, 0) } },
    },
    meleeAttacks: {
        list: {
            items: {
                m1: {
                    name: "Choppa",
                    tabs: { items: { t1: { profile: "axe", damage: "1d10+4", damageType: "R" } }, layouts: { t1: pos(0, 0) } },
                },
                m2: {
                    name: "Shield",
                    group: "primary (shield)",
                    shield: { ap: 4, arm: "right", equipped: true, defensive: false },
                    tabs: { items: { t2: { profile: "shield", damage: "1d5" } }, layouts: { t2: pos(0, 0) } },
                },
            },
            layouts: { m1: pos(0, 0), m2: pos(0, 1) },
        },
    },
    conditions: {
        list: {
            items: { c1: { name: "Bleeding", enabled: true, stacks: 1 }, c2: { name: "Stunned", enabled: false, stacks: 0 } },
            layouts: { c1: pos(0, 0), c2: pos(0, 1) },
        },
    },
    resourceTrackers: { list: { items: { k1: { name: "Fate", value: 2 } }, layouts: { k1: pos(0, 0) } } },
    fatigue: { fatigueCur: 1, threshold: { base: "4" } },
    traits: { list: { items: { x1: { name: "Brutal Charge", description: "+3 damage on a charge" } }, layouts: { x1: pos(0, 0) } } },
    talents: { list: { items: { x2: { name: "Sturdy" }, x3: { name: "" } }, layouts: { x2: pos(0, 0), x3: pos(0, 1) } } },
    settings: { psykana: { sustained: true, phenomena: true }, technoArcana: { price: true } },
    psykana: {
        basePR: 4,
        maxPush: 2,
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: {
                t1: {
                    name: "Attack",
                    powers: {
                        items: {
                            p1: {
                                name: "Smite", action: "Half", range: "30m", damage: "PRd10", pen: "4", damageType: "E",
                                roll: { testOption: "o1", modifier: 5, effectivePR: 2, kickPR: 1 },
                            },
                        },
                        layouts: { p1: pos(0, 0) },
                    },
                },
                t2: { name: "Defence", powers: { items: { p2: { name: "Shield", sustain: { copies: 1, pr: 2 } } }, layouts: { p2: pos(0, 0) } } },
            },
            layouts: { t1: pos(0, 0), t2: pos(0, 1) },
        },
    },
    technoArcana: {
        currentCognition: 3,
        currentEnergy: 2,
        testOptions: { items: { o1: { base: "awareness", characteristic: "I" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: {
                t1: {
                    name: "Tab",
                    powers: { items: { q1: { name: "Scan", price: "1 ⚙", action: "Half", roll: { testOption: "o1", modifier: -5 } } }, layouts: { q1: pos(0, 0) } },
                },
            },
            layouts: { t1: pos(0, 0) },
        },
    },
});

const rollDefaults = { rangedAttack: rangedRoll, meleeAttack: {}, psychicPower: {}, techPower: {} } as RollDefaults;

let rendered: Rendered | null = null;

function load(sheet: object = content()): void {
    loadState(sheet);
    attachComputeds(testState());
}

beforeEach(() => load());

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const show = (canEdit = true, autocomplete: Autocomplete | null = null) => {
    rendered?.unmount();
    const actions = recordingActions();
    rendered = renderBlock(<StatBlock />, { rollDefaults, canEdit, actions, autocomplete });
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
        expect($('[data-id="BS"] [data-id="calculatedUnnatural"]').textContent).toBe("4");
        expect($('[data-id="WS"] [data-id="calculatedUnnatural"]')).toBeNull();
        // T 45: its bonus is the armour of every part without armour.
        expect($('.stat-armour [data-id="head"] [data-id="total"]').textContent).toBe("4");
        expect($(".stat-wounds").textContent).toBe("10 / 12");
        expect($('.stat-wounds [data-id="ablativeWounds"]')).toBeNull();
        expect($('.stat-movement [data-id="moveHalf"]').textContent).toBe("3");
        expect($('.stat-ranged [data-id="damage"]').textContent).toBe("1d10+4");
        expect($('.stat-ranged [data-id="pen"]').textContent).toBe("2");
        expect($<HTMLInputElement>('.stat-ranged [data-id="clipCur"]').value).toBe("18");
        expect($('.stat-melee .stat-profile').textContent).toContain("Axe");
        expect($$(".stat-condition").map(c => c.textContent)).toEqual(["BleedingX:", "StunnedX:"]);
        expect($(".stat-condition.disabled").textContent).toContain("Stunned");
        expect($<HTMLInputElement>('[data-id="fatigue"] [data-id="fatigueCur"]').value).toBe("1");
        expect($<HTMLInputElement>('[data-id="k1"] [data-id="value"]').value).toBe("2");
        expect($$(".stat-chip").map(c => [c.textContent, c.title])).toEqual([["Brutal Charge", "+3 damage on a charge"], ["Sturdy", ""]]);
    });

    it("collapses a section by the button beside its title, for every stat block the viewer opens", () => {
        show();
        const section = () => $$(".stat-section").find(el => el.querySelector(".stat-section-title h4")!.textContent === "Psychic powers")!;
        const toggle = () => section().querySelector<HTMLButtonElement>(".stat-section-toggle")!;
        expect(toggle().getAttribute("aria-label")).toBe("Collapse Psychic powers");
        act(() => toggle().click());
        expect(section().classList.contains("collapsed")).toBe(true);
        expect(section().querySelector('[data-id="p1"]')).toBeNull();
        // The phenomena stay by the title.
        expect(section().querySelector('[data-id="phenomenaToggle"]')).not.toBeNull();
        expect(JSON.parse(localStorage.getItem("statblock_collapsed")!)).toEqual(["Psychic powers"]);

        show();
        expect(section().classList.contains("collapsed")).toBe(true);
        act(() => toggle().click());
        expect(section().querySelector('[data-id="p1"]')).not.toBeNull();
        expect(JSON.parse(localStorage.getItem("statblock_collapsed")!)).toEqual([]);
    });

    it("keeps a line for the ablative wounds without them", () => {
        show();
        expect($(".stat-wounds .stat-ablative")).not.toBeNull();
        expect($(".stat-wounds .stat-ablative").textContent).toBe("");
    });

    it("leaves out a section with nothing in it", () => {
        load({});
        show();
        // Conditions stay for the field that adds them.
        expect($$(".stat-section h4").map(h => h.textContent)).toEqual(["Armour", "Wounds", "Fatigue", "Movement", "Conditions"]);
        show(false);
        expect($$(".stat-section h4").map(h => h.textContent)).toEqual(["Armour", "Wounds", "Fatigue", "Movement"]);
    });

    it("shows the fatigue beside the wounds and edits it through the actions", () => {
        const actions = show();
        const pools = $$(".stat-defence-side .stat-pool");
        expect(pools.map(p => p.querySelector("h4")!.textContent)).toEqual(["Wounds", "Fatigue"]);
        expect(pools[1].textContent).toBe("Fatigue / 4");
        const fatigue = pools[1].querySelector<HTMLInputElement>('[data-id="fatigue"] [data-id="fatigueCur"]')!;
        expect(fatigue.value).toBe("1");
        fatigue.value = "2";
        act(() => { fatigue.dispatchEvent(new Event("input", { bubbles: true })); });
        expect([...actions.sent, ...actions.scheduled.map(([msg]) => msg)]).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "change", path: "fatigue.fatigueCur", change: 2 }),
        ]));
    });

    it("shows the movement as a table", () => {
        show();
        expect($$(".stat-movement th").map(th => th.textContent)).toEqual(["Half", "Full", "Charge", "Run"]);
        // Agility 30: its bonus 3 is the half move.
        expect($$(".stat-movement td").map(td => [td.dataset.id, td.textContent]))
            .toEqual([["moveHalf", "3"], ["moveFull", "6"], ["moveCharge", "9"], ["moveRun", "18"]]);
    });

    it("shows the trackers and the conditions between the skills and the attacks, without the fatigue", () => {
        show();
        const sections = $$(".stat-section-title > h4").map(h => h.textContent);
        expect(sections.slice(sections.indexOf("Skills"), sections.indexOf("Attacks") + 1)).toEqual(["Skills", "Trackers", "Conditions", "Attacks"]);
        expect($$(".stat-trackers .stat-tracker").map(t => t.dataset.id)).toEqual(["k1"]);
        expect($('.stat-trackers [data-id="fatigue"]')).toBeNull();
    });

    it("lists the trained skills only", () => {
        show();
        expect($$(".stat-skill-name").map(s => s.textContent)).toEqual(["Dodge", "Navigate (Warp)", "Trade (Armourer)", "Waaagh"]);
        // A long name is cut short by the CSS: the whole of it is on hover.
        expect($$(".stat-skill-name").map(s => s.title)).toEqual(["Dodge", "Navigate (Warp)", "Trade (Armourer)", "Waaagh"]);
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

    it("adds a condition picked from the conditions collection", () => {
        vi.useFakeTimers();
        const autocomplete = recordingAutocomplete();
        const actions = show(true, autocomplete);
        const input = $<HTMLInputElement>(".stat-add-condition input");
        expect(input.placeholder).toBe("Add condition…");
        input.value = "Stun";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);
        vi.useRealTimers();
        expect(autocomplete.queries).toMatchObject([{ type: "autocomplete", collection: "conditions", query: "Stun" }]);

        pickSuggestion(autocomplete, input, { name: "Stunned" });
        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { itemId: string };
        expect(created).toMatchObject({ path: "conditions.list.items", init: { name: "Stunned", enabled: true } });
        // The server lays the entry over the new row, as a pick in the sheet does.
        expect(actions.sent.at(-1)).toMatchObject({
            type: "autocompleteApply", path: `conditions.list.items.${created.itemId}`, collection: "conditions", name: "Stunned",
        });
        // The grid has two columns: the row ends the last one, and the list.
        expect(actions.scheduled.map(([msg]) => msg)).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "positionsChanged", positions: expect.objectContaining({ [created.itemId]: { colIndex: 1, rowIndex: 0 } }) }),
        ]));
        expect($$(".stat-condition").map(c => c.dataset.id)).toEqual(["c1", "c2", created.itemId]);
        expect(input.value).toBe("");
    });

    it("adds a condition by its name on Enter and nothing on Escape", () => {
        const actions = show(true, recordingAutocomplete());
        const input = $<HTMLInputElement>(".stat-add-condition input");
        const key = (k: string) => act(() => { input.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });

        input.value = "Bleh";
        key("Escape");
        expect(input.value).toBe("");
        input.value = "On fire";
        input.dispatchEvent(new Event("blur"));
        expect(actions.sent).toEqual([]);

        key("Enter");
        expect(actions.sent).toEqual([expect.objectContaining({ type: "createItem", path: "conditions.list.items", init: expect.objectContaining({ name: "On fire" }) })]);
        expect($$(".stat-condition").at(-1)!.textContent).toContain("On fire");
        // The field moves on to the cell after the new condition.
        expect($(".stat-conditions").lastElementChild!.contains(input)).toBe(true);
        expect(input.value).toBe("");
        // Enter with nothing typed adds nothing.
        key("Enter");
        expect(actions.sent).toHaveLength(1);
    });

    it("shows the shield of a melee attack and switches whether it is equipped and defensive", () => {
        const actions = show();
        expect($('[data-id="m1"] .stat-shield')).toBeNull();
        expect($('[data-id="m2"] .stat-shield [data-id="ap"]').textContent).toBe("4");
        expect($<HTMLSelectElement>('[data-id="m2"] [data-id="arm"]').value).toBe("right");
        expect($<HTMLInputElement>('[data-id="m2"] [data-id="equipped"]').checked).toBe(true);
        act(() => $<HTMLInputElement>('[data-id="m2"] [data-id="defensive"]').click());
        act(() => $<HTMLInputElement>('[data-id="m2"] [data-id="equipped"]').click());
        const arm = $<HTMLSelectElement>('[data-id="m2"] [data-id="arm"]');
        arm.value = "left";
        act(() => { arm.dispatchEvent(new Event("change", { bubbles: true })); });
        expect([...actions.sent, ...actions.scheduled.map(([msg]) => msg)]).toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "change", path: "meleeAttacks.list.items.m2.shield.arm", change: "left" }),
            expect.objectContaining({ type: "change", path: "meleeAttacks.list.items.m2.shield.defensive", change: true }),
            expect.objectContaining({ type: "change", path: "meleeAttacks.list.items.m2.shield.equipped", change: false }),
        ]));
    });

    it("names the melee profiles, Other too, and puts the specials after the damage", () => {
        const sheet = content();
        const melee = sheet.meleeAttacks.list.items.m1;
        melee.tabs.items = { ...melee.tabs.items, t3: { profile: "", damage: "1d5", damageType: "I" }, t4: { profile: "no", damage: "1d10", damageType: "I" } } as typeof melee.tabs.items;
        melee.tabs.layouts = { ...melee.tabs.layouts, t3: pos(0, 1), t4: pos(0, 2) } as typeof melee.tabs.layouts;
        (sheet.rangedAttacks.list.items.r1 as Record<string, unknown>).special = "Tearing";
        load(sheet);
        show();
        expect($$('[data-id="m1"] .stat-profile').map(p => p.querySelector(".stat-profile-name")?.textContent ?? null)).toEqual(["Axe", "Other", null]);
        const lines = $$('[data-id="r1"] .stat-line');
        expect(lines[0].querySelector(".stat-damage")!.nextElementSibling!.textContent).toBe("Tearing");
        expect(lines).toHaveLength(2);
    });

    it("counts the ablative wounds apart from the maximum, taken first", () => {
        const ablative = { list: { items: { c3: {
            name: "Iron Skin", enabled: true, stacks: 1,
            entries: { items: { e1: { type: "ablative_wounds", ablativeWounds: "3" } }, layouts: { e1: pos(0, 0) } },
        } }, layouts: { c3: pos(0, 0) } } };
        load({ ...content(), conditions: ablative });
        show();
        // 2 taken of 3 ablative: the maximum is whole.
        expect($('.stat-wounds [data-id="woundsRemaining"]').textContent).toBe("12");
        expect($('.stat-wounds [data-id="woundsMax"]').textContent).toBe("12");
        expect($('.stat-wounds [data-id="ablativeWounds"]').textContent).toBe("+1 ablative");
        act(() => updateSignalAtPath(testState(), "armour.woundsCur", 5));
        expect($('.stat-wounds [data-id="woundsRemaining"]').textContent).toBe("10");
        expect($('.stat-wounds [data-id="ablativeWounds"]').textContent).toBe("+0 ablative");
    });

    it("tells on hover what a condition changes, with its stacks for X", () => {
        const entries = {
            e1: { type: "char_bonus", name: "WS, BS", bonus: "-5X", unnaturalBonus: "1" },
            e2: { type: "char_override", name: "T", overrideValue: "", overrideUnnatural: "0" },
            e3: { type: "roll_bonus", name: "Any", rollBonus: "10", domainMode: "only", domains: { ranged: true, psychic: true } },
            e4: { type: "skill_bonus", name: "Dodge", skillBonus: "0.5X▲" },
            e5: { type: "bonus_ap", apType: "natural", apValue: "2" },
            // Changes nothing: left out.
            e6: { type: "movement_bonus", movementBonus: "" },
        };
        const ids = Object.keys(entries);
        const conditions = { list: { items: {
            c1: { name: "Bleeding", enabled: true, stacks: 1 },
            c3: {
                name: "Pinned", enabled: false, stacks: 3,
                entries: { items: entries, layouts: Object.fromEntries(ids.map((id, i) => [id, pos(0, i)])) },
            },
        }, layouts: { c1: pos(0, 0), c3: pos(0, 1) } } };
        load({ ...content(), conditions });
        show();
        expect(hoverLines($('[data-id="c3"] .stat-condition-name'))).toEqual([
            "Pinned",
            "WS, BS -15, unnatural +1",
            "T unnatural = 0",
            "Tests on Any +10 (only Ranged, Psy)",
            "Dodge +2",
            "Natural AP +2",
        ]);
        expect(hoverLines($('[data-id="c1"] .stat-condition-name'))).toEqual(["Bleeding"]);
    });

    it("tells on hover what makes up a characteristic, a skill, a move and a damage", () => {
        const sheet = content();
        Object.assign(sheet.rangedAttacks.list.items.r1, { damageMods: { items: { d1: { expr: "2", enabled: true } }, layouts: { d1: pos(0, 0) } } });
        load(sheet);
        show();
        const bs = $('.stat-characteristics [data-id="BS"]');
        // Built on hover only: a render reads nothing of what it explains.
        expect(bs.title).toBe("");
        // Fatigue 1 takes 10 from the tests.
        expect(hoverLines(bs)).toEqual(["Test Ballistic Skill", "BS 40", "Permanent 40", "Tests at 30:", "Fatigue -10"]);
        expect(hoverLines(bs.querySelector('[data-id="calculatedUnnatural"]')!))
            .toEqual(["Unnatural BS 4: +2 successes on a passed test", "Permanent 4"]);
        expect(hoverLines($('[data-id="dodge"] [data-id="difficulty"]'))).toEqual(["Difficulty 30", "A 30", "Fatigue -10", "Advances +10"]);
        expect(hoverLines($('.stat-movement [data-id="moveHalf"]'))).toEqual(["Half move 3", "A.b +3"]);
        expect(hoverLines($('[data-id="r1"] [data-id="damage"]'))).toEqual(["Weapon 1d10+4", "+2"]);
        // Without modifiers the damage is the weapon's own: nothing to explain.
        expect(hoverLines($('[data-id="r1"] [data-id="pen"]'))).toEqual([]);
    });

    it("tells on hover what makes up the armour of a part, its toughness and super armour", () => {
        const gearArmour = (head: string, superHead: string) => ({ ap: { head, torso: "-" }, superAp: { head: superHead } });
        const sheet = content();
        Object.assign(sheet.meleeAttacks.list.items.m2.shield, { defenseSectors: "A1" });
        load({
            ...sheet,
            characteristics: { ...content().characteristics, T: { value: "45", unnatural: "1" } },
            armour: {
                woundsMax: 12, woundsCur: 2, naturalArmourValue: 1, daemonicValue: 2,
                head: { armourValue: 3, extra1Name: "Helmet plate", extra1Value: 1, superArmour: 5 },
                body: { armourValue: 3, superArmour: 2 },
            },
            gear: { list: { items: {
                g1: { name: "Carapace", gearType: "armour", equipped: true, armour: gearArmour("6", "") },
                g2: { name: "Power Armour", gearType: "armour", equipped: true, armour: gearArmour("5", "4") },
            }, layouts: { g1: pos(0, 0), g2: pos(0, 1) } } },
        });
        show();
        const head = $('.stat-armour [data-id="head"]');
        // Worn gear replaces the part's own armour and super armour: the best piece counts.
        expect(hoverLines(head)).toEqual([
            "Total damage absorption 15", "Carapace +6", "Helmet plate +1", "Toughness bonus +5", "Daemonic +2", "Natural +1",
        ]);
        expect(hoverLines(head.querySelector('[data-id="superArmourSub"]')!).slice(1)).toEqual(["Power Armour 4"]);
        expect(hoverLines(head.querySelector('[data-id="toughnessSuper"]')!))
            .toEqual(["Toughness bonus and daemonic armour 7", "T 45: +4", "Unnatural T +1", "Daemonic +2"]);
        // The shield of the right arm; the body is not covered by the gear: its own armour counts.
        expect(hoverLines($('.stat-armour [data-id="rightArm"]'))).toContain("Shield (shield) +4");
        const body = $('.stat-armour [data-id="body"]');
        expect(hoverLines(body).slice(0, 2)).toEqual(["Total damage absorption 11", "Armour +3"]);
        expect(hoverLines(body.querySelector('[data-id="superArmourSub"]')!)).toHaveLength(1);
    });

    it("names a trained skill of the right column never named by its group", () => {
        load({ ...content(), skillsRight: { "3_trade": { plus0: true } } });
        show();
        expect($('[data-id="3_trade"] .stat-skill-name').textContent).toBe("Trade");
    });

    // A creature of another user's collection on the bestiary page: it is
    // checked with rolls, as a read-only full sheet is.
    it("rolls a sheet it may not edit, and edits nothing", () => {
        show(false);
        expect($(".stat-add-condition")).toBeNull();
        expect($<HTMLInputElement>('[data-id="m2"] [data-id="equipped"]').disabled).toBe(true);
        expect($<HTMLSelectElement>('[data-id="m2"] [data-id="arm"]').disabled).toBe(true);
        expect($<HTMLInputElement>('[data-id="clipCur"]').readOnly).toBe(true);
        expect($<HTMLInputElement>('[data-id="c1"] [data-id="enabled"]').disabled).toBe(true);
        expect($<HTMLInputElement>('[data-id="dodge"] [data-id="difficulty"]').value).toBe("30");
        expect(capture("sheet:rollVersus", () => $('[data-id="BS"] label').click()))
            .toEqual([{ target: 30, bonusSuccesses: 2, label: "Ballistic Skill" }]);
        expect(capture("sheet:rollExact", () => $('[data-id="m1"] .stat-damage label').click()))
            .toEqual([{ expression: "1d10+4", label: "Choppa, axe" }]);
        // The attack rolls with the modifiers the sheet keeps; it cannot change them.
        act(() => $('[data-id="r1"] .stat-attack-name label').click());
        const selects = $$('[data-id="r1"] [data-id="roll"] select') as HTMLSelectElement[];
        expect(selects.length).toBeGreaterThan(0);
        expect(selects.filter(s => !s.disabled)).toEqual([]);
    });
    it("shows the powers of every tab after the attacks, under what a fight needs of their bars", () => {
        show();
        expect($$(".stat-section h4").map(h => h.textContent)).toEqual([
            "Armour", "Wounds", "Fatigue", "Movement", "Skills", "Trackers", "Conditions", "Attacks", "Psychic powers", "Tech powers", "Traits and talents",
        ]);
        // Base PR 4 less the sustained Shield.
        expect($('[data-id="psykana"] [data-id="effectivePR"]').textContent).toBe("3");
        expect($('[data-id="psykana"] [data-id="maxPush"]').textContent).toBe("2");
        // By the title, where the bar under it never moves it.
        expect($('.stat-section-title [data-id="psykana"] [data-id="phenomenaToggle"]')).not.toBeNull();
        expect($('[data-id="psykana"] .sustained-list').textContent).toContain("Shield");
        expect($$(".stat-psychic .stat-power-name > :first-child").map(n => n.textContent)).toEqual(["Smite", "Shield"]);
        expect($('[data-id="p1"] [data-id="pr"]').textContent).toBe("PR 3");
        expect($('[data-id="p1"] [data-id="range"]').textContent).toBe("Range 30m");
        expect($('[data-id="p1"] [data-id="damage"]').textContent).toBe("3d10");
        // Without a roll, its name opens nothing.
        expect($('[data-id="p2"] .stat-power-name label')).toBeNull();

        // I 40: 4 ⚙ at most, 2 restored a turn.
        expect($<HTMLInputElement>('[data-id="technoArcana"] [data-id="currentCognition"]').value).toBe("3");
        expect($('[data-id="technoArcana"] .stat-resource').textContent).toBe("Cognition  / 4+2 a turn");
        expect($<HTMLInputElement>('[data-id="technoArcana"] [data-id="currentEnergy"]').value).toBe("2");
        expect($('[data-id="q1"] [data-id="price"]').textContent).toBe("1 ⚙");
        // As in the sheet, without a Compensator power too.
        expect($('.stat-section-title [data-id="technoArcana"] [data-id="compensationRoll"]')).not.toBeNull();
    });

    it("keeps the line of the cost of the Processes while none is held, so that the first moves nothing", () => {
        show();
        // The sheet counts the Processes unless told not to.
        expect($('[data-id="technoArcana"] [data-id="processCost"]').textContent).toBe("Processes 0 ⚙ a turn");
        expect($('[data-id="q1"] [data-id="processPill"]')).toBeNull();

        const sheet = content();
        load({ ...sheet, settings: { ...sheet.settings, technoArcana: { price: true, processes: false } } });
        show();
        expect($('[data-id="technoArcana"] [data-id="processCost"]')).toBeNull();
    });

    it("has no power sections without powers", () => {
        load({ ...content(), psykana: { basePR: 3, tabs: { items: { t1: { name: "Tab" } }, layouts: { t1: pos(0, 0) } } }, technoArcana: {} });
        show();
        const titles = $$(".stat-section h4").map(h => h.textContent);
        expect(titles).not.toContain("Psychic powers");
        expect(titles).not.toContain("Tech powers");
    });

    it("rolls a psychic power with its PR as the sheet does", () => {
        show();
        const power = $('[data-id="p1"]');
        act(() => power.querySelector<HTMLElement>(".stat-power-name label")!.click());
        const dropdown = power.querySelector<HTMLElement>('[data-id="roll"]')!;
        expect(dropdown.classList.contains("visible")).toBe(true);
        const fromBlock = capture("sheet:rollVersus", () => act(() => dropdown.querySelector<HTMLButtonElement>('[data-id="rollButton"]')!.click()));
        // W 40 − fatigue 10 + modifier 5 + ePR 2 × 5 + kick 1 × 5.
        expect(fromBlock).toEqual([{ target: 50, bonusSuccesses: 0, label: "Smite, 2 ePR, +1 kick" }]);
        expect(power.querySelector('[data-id="roll"]')).toBeNull();

        rendered!.unmount();
        load();
        rendered = renderBlock(<Psykana />, { rollDefaults, actions: recordingActions() });
        act(() => $('[data-id="p1"] .name label').click());
        expect(capture("sheet:rollVersus", () => act(() => $('[data-id="p1"] [data-id="rollButton"]').click()))).toEqual(fromBlock);
    });

    it("activates a tech power at its price as the sheet does", () => {
        const actions = show();
        act(() => $('[data-id="q1"] .stat-power-name label').click());
        const fromBlock = capture("sheet:rollVersus", () => act(() => $('[data-id="q1"] [data-id="rollButton"]').click()));
        // Untrained Awareness on I 40 is 20, − fatigue 10 − modifier 5.
        expect(fromBlock).toEqual([{ target: 5, bonusSuccesses: 0, label: "Scan" }]);
        const edits = [...actions.sent, ...actions.scheduled.map(([msg]) => msg)];
        expect(edits).toEqual(expect.arrayContaining([
            expect.objectContaining({ path: "technoArcana.currentCognition", change: 2 }),
        ]));

        rendered!.unmount();
        load();
        rendered = renderBlock(<TechnoArcana />, { rollDefaults, actions: recordingActions() });
        act(() => $('[data-id="q1"] .name label').click());
        expect(capture("sheet:rollVersus", () => act(() => $('[data-id="q1"] [data-id="rollButton"]').click()))).toEqual(fromBlock);
    });

    it("offers the Compensation Roll with a Compensator power", () => {
        updateSignalAtPath(testState(), "technoArcana.tabs.items.t1.powers.items.q1.subtypes", "Compensator (2)");
        show();
        expect($('[data-id="technoArcana"] [data-id="compensationRoll"] .compensation-toggle')).not.toBeNull();
    });
});
