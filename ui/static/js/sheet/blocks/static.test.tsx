import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { flush, loadState, recordingActions, renderBlock, type Rendered, getDataPath } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { Armour } from "./Armour";
import { CharacterInfo } from "./CharacterInfo";
import { Characteristics } from "./Characteristics";
import { Fatigue, InitiativeAndSize, Movement } from "./Combat";
import { Skills } from "./Skills";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

const content = () => ({
    characterInfo: { characterName: "Kharn" },
    characteristics: {
        WS: { value: "40", unnatural: "2" },
        T: { value: "35", unnatural: "4" },
        A: { value: "30" },
        I: { value: "31" },
    },
    skillsLeft: { dodge: { plus0: true, plus10: true } },
    skillsRight: { "1_linguistics": { name: "Low Gothic", characteristic: "I", plus0: true } },
    fatigue: { fatigueCur: 0, fatigueMax: 3 },
    initiative: { dice: "1d10", aBonus: true, flatBonus: 2, lastInitiative: "5" },
    size: 1,
    movement: { bonus: 1 },
    armour: { body: { armourValue: 4 }, daemonicValue: 2, woundsMax: 12, woundsCur: 3 },
    conditions: {
        list: {
            items: {
                c1: {
                    name: "Haste", enabled: true, stacks: 1,
                    entries: {
                        items: {
                            e1: { type: "movement_bonus", name: "Run", movementBonus: "2" },
                            e2: { type: "initiative_bonus", initiativeBonus: "1" },
                            e3: { type: "bonus_ap", apType: "other", apValue: "1" },
                        },
                        layouts: {},
                    },
                },
            },
            layouts: { c1: pos(0, 0) },
        },
    },
    gear: {
        list: {
            items: { g1: { name: "Carapace", gearType: "armour", equipped: true, armour: { ap: { torso: "6", head: "-" } } } },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(characterState);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;

function captureRolls(type: "sheet:rollVersus" | "sheet:rollExact") {
    const rolls: unknown[] = [];
    const listener = (e: Event) => rolls.push((e as CustomEvent).detail);
    document.addEventListener(type, listener);
    return { rolls, stop: () => document.removeEventListener(type, listener) };
}

describe("CharacterInfo", () => {
    it("renders the fields at their paths", () => {
        rendered = renderBlock(<CharacterInfo />);
        const name = $('[data-id="characterName"]');
        expect(name.value).toBe("Kharn");
        expect(getDataPath(name)).toBe("characterInfo.characterName");
        expect(rendered.container.querySelectorAll("input")).toHaveLength(10);
    });

    it("sends the edits of the fields", () => {
        const actions = recordingActions();
        rendered = renderBlock(<CharacterInfo />, { actions });
        const name = $('[data-id="characterName"]');
        name.value = "Abaddon";
        name.dispatchEvent(new Event("input", { bubbles: true }));
        const race = $('[data-id="race"]');
        race.value = "Human";
        race.dispatchEvent(new Event("input", { bubbles: true }));

        expect(value("characterInfo.characterName")).toBe("Abaddon");
        expect(actions.scheduled.map(([msg]) => msg)).toEqual([
            { type: "change", path: "characterInfo.characterName", change: "Abaddon" },
            { type: "change", path: "characterInfo.race", change: "Human" },
        ]);
    });
});

describe("Characteristics", () => {
    it("shows computed values, rolls from the label and opens the permanent values", async () => {
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Characteristics />);
        const ws = $('.main-characteristics [data-id="WS"] [data-id="calculatedValue"]');
        expect(ws.value).toBe("40");
        expect($('.main-characteristics [data-id="WS"] [data-id="calculatedUnnatural"]').value).toBe("2");
        expect(warn).not.toHaveBeenCalled();

        const { rolls, stop } = captureRolls("sheet:rollVersus");
        $<HTMLElement>('.main-characteristics [data-id="T"] label').click();
        stop();
        expect(rolls).toEqual([{ target: 35, bonusSuccesses: 2, label: "Toughness" }]);

        const dropdown = $<HTMLElement>(".characteristics-dropdown");
        expect(dropdown.classList.contains("visible")).toBe(false);
        act(() => ws.click());
        expect(dropdown.classList.contains("visible")).toBe(true);
        await flush();
        const perm = $('#perm-characteristics [data-id="WS"] [data-id="value"]');
        expect(document.activeElement).toBe(perm);
        expect(getDataPath(perm)).toBe("characteristics.WS.value");
        // Conditions are in the dropdown.
        expect(dropdown.querySelector('.conditions-section [data-id="c1"]')).not.toBeNull();

        act(() => document.body.click());
        await flush();
        expect(dropdown.classList.contains("visible")).toBe(false);
    });
});

describe("Skills", () => {
    it("renders both skill lists with their headings and difficulties", () => {
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Skills />);
        const left = $<HTMLTableElement>('table[data-id="skillsLeft"]');
        expect(left.querySelectorAll("tr[data-id]")).toHaveLength(27);
        expect(Array.from(left.querySelectorAll("tr.skill-header"), r => r.textContent)).toEqual(["Navigate", "Operate"]);
        expect(left.querySelector('tr[data-id="navigate_warp"]')!.classList.contains("subskill")).toBe(true);
        expect(left.querySelector<HTMLSelectElement>('tr[data-id="acrobatics"] [data-id="characteristic"]')!.value).toBe("A");

        const dodge = left.querySelector<HTMLInputElement>('tr[data-id="dodge"] [data-id="difficulty"]')!;
        // A 30 with two advances.
        expect(dodge.value).toBe("40");

        const right = $<HTMLTableElement>('table[data-id="skillsRight"]');
        expect(right.querySelectorAll("tr[data-id]")).toHaveLength(26);
        const lingua = right.querySelector<HTMLInputElement>('tr[data-id="1_linguistics"] [data-id="name"]')!;
        expect(lingua.value).toBe("Low Gothic");
        expect(getDataPath(lingua)).toBe("skillsRight.1_linguistics.name");
        expect(warn).not.toHaveBeenCalled();

        const { rolls, stop } = captureRolls("sheet:rollVersus");
        dodge.click();
        right.querySelector<HTMLInputElement>('tr[data-id="1_linguistics"] [data-id="difficulty"]')!.click();
        stop();
        expect(rolls).toEqual([
            { target: 40, bonusSuccesses: 0, label: "Dodge" },
            { target: 31, bonusSuccesses: 0, label: "Low Gothic" },
        ]);
    });

    it("sends the advances of a row as one batch", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Skills />, { actions });
        const box = $('tr[data-id="awareness"] [data-id="plus20"]');
        box.checked = true;
        box.dispatchEvent(new Event("input", { bubbles: true }));
        box.dispatchEvent(new Event("change", { bubbles: true }));
        expect(actions.scheduled).toEqual([[{
            type: "batch",
            path: "skillsLeft.awareness",
            changes: { plus0: true, plus10: true, plus20: true, plus30: false },
        }, "skillsLeft.awareness"]]);
    });
});

describe("Fatigue", () => {
    it("shows what fatigue does", () => {
        rendered = renderBlock(<Fatigue />);
        const indicator = $<HTMLElement>('[data-id="fatigueIndicator"]');
        expect(indicator.textContent).toBe("Not affected");

        act(() => updateSignalAtPath("fatigue.fatigueCur", 1));
        expect(indicator.textContent).toBe("Taking −10 to affected rolls");
        expect(indicator.classList.contains("fatigue-active")).toBe(true);
        expect(value("characteristics.WS.valueForRolls")).toBe(30);

        act(() => updateSignalAtPath("fatigue.fatigueCur", 3));
        expect(indicator.textContent).toBe("Unconscious");
    });
});

describe("InitiativeAndSize", () => {
    it("rolls the initiative and keeps the raw roll of this character's result", () => {
        const actions = recordingActions();
        // act runs the effect that listens for the roll result.
        act(() => { rendered = renderBlock(<InitiativeAndSize />, { actions }); });
        // A.b 3 + flat 2 + the Haste entry 1.
        expect($("#initiativeRoll").value).toBe("1d10+6");
        expect($<HTMLElement>("#lastInitiativeDisplay").textContent).toBe("11");
        expect($<HTMLElement>(".initiative-condition-contributions").textContent).toBe("BonusesHaste+1");
        expect($<HTMLSelectElement>('[data-id="size"]').value).toBe("1");
        expect(getDataPath($('[data-id="size"]'))).toBe("size");

        const { rolls, stop } = captureRolls("sheet:rollExact");
        $<HTMLElement>(".initiative-wrapper label.rollable").click();
        stop();
        expect(rolls).toEqual([{ expression: "1d10+6", label: "Initiative" }]);

        // Another character's roll is ignored.
        document.dispatchEvent(new CustomEvent("ws:chatMessage", { detail: { characterName: "Other", commandResult: "1d10+6 = 9" } }));
        act(() => {
            document.dispatchEvent(new CustomEvent("ws:chatMessage", { detail: { characterName: "Kharn", commandResult: "1d10+6 = 14" } }));
        });
        expect(actions.scheduled).toEqual([[{ type: "change", path: "initiative.lastInitiative", change: 8 }, "initiative.lastInitiative"]]);
        expect($<HTMLElement>("#lastInitiativeDisplay").textContent).toBe("14");
    });

    it("shows a negative entry bonus with its own sign", () => {
        act(() => updateSignalAtPath("conditions.list.items.c1.entries.items.e2.initiativeBonus", "-5"));
        rendered = renderBlock(<InitiativeAndSize />);
        // A.b 3 + flat 2 - 5.
        expect($("#initiativeRoll").value).toBe("1d10");
        expect($<HTMLElement>(".initiative-condition-contributions").textContent).toBe("BonusesHaste-5");
        expect($<HTMLElement>("#initiativeResult").title).toBe("Roll: 5, Modifiers: +0, Total: 5");
    });

    it("opens the settings from the roll and closes them on a click outside", async () => {
        rendered = renderBlock(<InitiativeAndSize />);
        const dropdown = $<HTMLElement>(".initiative-dropdown");
        act(() => $("#initiativeRoll").click());
        expect(dropdown.classList.contains("visible")).toBe(true);
        expect($<HTMLButtonElement>(".initiative-dropdown-toggle").textContent).toBe("▲");
        await flush();
        act(() => document.body.click());
        expect(dropdown.classList.contains("visible")).toBe(false);
    });
});

describe("Movement", () => {
    it("shows the moves and the entries that add to them", () => {
        rendered = renderBlock(<Movement />);
        // A.b 3 + size 1 + bonus 1 + entry 2.
        expect($('[data-id="moveHalf"]').value).toBe("7");
        expect($('[data-id="moveRun"]').value).toBe("42");
        expect($('[data-id="fullMult"]').value).toBe("2");
        expect($('[data-id="moveHalf"]').title).toBe("Result = A.b + Size + Bonus\nOther bonuses:\nRun: +2");
    });

    it("shows a negative entry bonus with its own sign", () => {
        act(() => updateSignalAtPath("conditions.list.items.c1.entries.items.e1.movementBonus", "-1"));
        rendered = renderBlock(<Movement />);
        expect($('[data-id="moveHalf"]').value).toBe("4");
        expect($('[data-id="moveHalf"]').title).toBe("Result = A.b + Size + Bonus\nOther bonuses:\nRun: -1");
    });
});

describe("Armour", () => {
    it("adds up the parts and lists what adds to them", async () => {
        rendered = renderBlock(<Armour />);
        const part = (id: string) => $<HTMLElement>(`.body-part[data-id="${id}"]`);
        const total = (id: string) => part(id).querySelector<HTMLInputElement>('[data-id="total"]')!.value;
        // Gear 6, T.b 3 with unnatural 4, daemonic 2, other 1.
        expect(total("body")).toBe("16");
        // The gear does not cover the head: its own armour (none) counts.
        expect(total("head")).toBe("10");
        expect($('[data-id="woundsRemaining"]').value).toBe("9");

        // Worn armour replaces the body's own armour field.
        expect(part("body").querySelector('[data-id="armourValue"]')!.closest("label")!.classList.contains("field-hidden")).toBe(true);
        expect(part("head").querySelector('[data-id="armourValue"]')!.closest("label")!.classList.contains("field-hidden")).toBe(false);
        expect(part("body").querySelector(".armour-contributions")!.textContent).toBe("ArmourCarapace+6");
        expect(part("body").querySelector(".misc-contributions")!.textContent).toBe("MiscDaemonic+2Haste (Other)+1");

        const toggle = (id: string) => part(id).querySelector<HTMLButtonElement>(".armour-extra-toggle")!;
        const open = (id: string) => part(id).querySelector(".armour-extra-dropdown")!.classList.contains("visible");
        act(() => toggle("head").click());
        expect(open("head")).toBe(true);
        expect(part("head").style.zIndex).toBe("100");
        await flush();
        act(() => toggle("body").click());
        expect([open("head"), open("body")]).toEqual([false, true]);
        await flush();
        act(() => document.body.click());
        expect(open("body")).toBe(false);
    });

    it("lists the manual Other armour, which stacks with the entries, under Misc", () => {
        act(() => updateSignalAtPath("armour.otherArmourValue", 2));
        rendered = renderBlock(<Armour />);
        const body = $<HTMLElement>('.body-part[data-id="body"]');
        // 16 as above, plus the manual 2.
        expect(body.querySelector<HTMLInputElement>('[data-id="total"]')!.value).toBe("18");
        expect(body.querySelector(".misc-contributions")!.textContent).toBe("MiscDaemonic+2Haste (Other)+1Other+2");
    });
});
