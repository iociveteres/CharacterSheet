import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { flush, loadState, renderBlock, rollOf, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { PathfinderCrusadeStatBlock, pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { powerPR } from "../state/damage";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";
const S1 = `${POWERS}.s1`;

const advances = (n: number) => Object.fromEntries(["plus0", "plus10", "plus20", "plus30"].slice(0, n).map(key => [key, true]));

/** A bard of F 40 with Deceive +20 and Delude, a Sorcery spell of Level 1 tested on Deceive. */
const content = (delude: object = {}, over: object = {}, spells: Record<string, object> = {}) => {
    const all = { s1: { name: "Delude", subtypes: "Sorcery (Bard)", sustained: "Free action", level: 1, roll: { skill: "deceive" }, ...delude }, ...spells };
    return {
        characteristics: { F: { value: "40" }, W: { value: "30" } },
        skillsLeft: { deceive: advances(3) },
        psykana: {
            psykanaType: "Arcane",
            testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
            tabs: {
                items: { t1: { name: "Bard", powers: { items: all, layouts: Object.fromEntries(Object.keys(all).map((id, i) => [id, pos(0, i)])) } } },
                layouts: { t1: pos(0, 0) },
            },
        },
        mana: { current: 5, max: { base: "5" } },
        sorceryMana: { current: 2, max: { base: "F.b" } },
        ...over,
    };
};

let rendered: Rendered | null = null;

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
}

function show(c: object, kind = pathfinderCrusade) {
    load(c, kind);
    rendered = renderBlock(<Psykana />);
    act(() => $(`[data-id="s1"] .name label`)!.click());
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const inRoll = <E extends HTMLElement = HTMLElement>(id: string) => $<E>(`[data-id="s1"] [data-id="roll"] [data-id="${id}"]`);
const rollButton = () => inRoll<HTMLButtonElement>("rollButton")!;
const total = () => Number(inRoll<HTMLInputElement>("total")!.value);
const at = (path: string) => valueAt(testState(), path);

/** The tests the clicks of `run` send. */
function rolls(run: () => void): { [key: string]: unknown }[] {
    const sent: { [key: string]: unknown }[] = [];
    const listener = (e: Event) => sent.push((e as CustomEvent).detail);
    document.addEventListener("sheet:rollVersus", listener);
    act(run);
    document.removeEventListener("sheet:rollVersus", listener);
    return sent;
}

const answer = (requestId: unknown, outcome: object) => document.dispatchEvent(new CustomEvent("sheet:rollResult", {
    detail: { requestId, outcome: { target: 50, roll: 22, degrees: 2, success: true, doubles: true, crit: false, ...outcome } },
}));

describe("the roll of a Sorcery spell", () => {
    it("is tested on its skill, without 5 per ePR, kick or Safe, and takes the skill's level as its Max", () => {
        show(content({ roll: { skill: "deceive", modifier: 5, effectivePR: 1, kickPR: 2 } }));
        expect(inRoll("skill")).not.toBeNull();
        expect([inRoll("safePR"), inRoll("kickPR"), inRoll("testOption")]).toEqual([null, null, null]);
        // F 40 at +20: 60, and 5.
        expect(total()).toBe(65);
        expect(inRoll("capSource")!.textContent).toBe("Max 3: Deceive +20");

        act(() => inRoll<HTMLButtonElement>("maxPR")!.click());
        expect(at(`${S1}.roll.effectivePR`)).toBe(3);
        expect(total()).toBe(65);

        act(() => updateSignalAtPath(testState(), `${S1}.roll.characteristic`, "W"));
        expect(total()).toBe(55);
    });

    it("offers the skills of the sheet without the characteristics, and its own characteristic first", () => {
        show(content());
        const skill = inRoll<HTMLSelectElement>("skill")!;
        expect([...skill.querySelectorAll("optgroup")].map(g => g.label)).toEqual(["Skills", "Navigation", "Operate"]);
        expect(skill.value).toBe("deceive");
        const characteristic = inRoll<HTMLSelectElement>("characteristic")!;
        expect([characteristic.options[0].value, characteristic.options[0].textContent]).toEqual(["", "Skill's own"]);
    });

    it("pays its Level from the Sorcery pool, calls no phenomena and sustains on success", async () => {
        show(content({ roll: { skill: "deceive", effectivePR: 2 } }));
        expect(inRoll("manaCost")!.textContent).toBe("1 of 2");
        const [sent] = rolls(() => rollButton().click());
        expect(rollOf(sent)).toEqual({ target: 60, bonusSuccesses: 0, label: "Delude, 2 ePR" });
        expect([at("sorceryMana.current"), at("mana.current")]).toEqual([1, 5]);
        expect([at(`${S1}.cast.pr`), at(`${S1}.cast.kick`), at("psykana.lastCastPower")]).toEqual([2, 0, ""]);

        // Doubles of a success call for none.
        answer(sent.requestId, {});
        await flush();
        expect(at(`${S1}.cast.phenomena`)).toBe("");
        expect([at(`${S1}.sustain.copies`), at(`${S1}.sustain.pr`)]).toEqual([1, 2]);
        // It takes no PR.
        expect(at("psykana.effectivePR")).toBe(0);
    });

    it("warns of an untrained skill, a missing Level and the sustain limit, and rolls all the same", () => {
        const blur = { name: "Blur", subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } };
        show(content({ level: 0 }, { skillsLeft: { deceive: {} } }, { s2: blur }));
        expect(inRoll("untrained")!.textContent).toBe("Deceive is not trained: a Sorcery spell cannot be cast");
        expect(inRoll("noLevel")!.textContent).toBe("Set the Level: it is the mana cost");
        expect(inRoll("sustainLimit")!.textContent).toBe("Already sustaining Blur: the limit is 1");
        expect([rollButton().disabled, rollButton().title]).toEqual([false, ""]);

        // Unticked, it will not sustain past the limit.
        act(() => inRoll<HTMLInputElement>("sustain")!.click());
        expect(inRoll("sustainLimit")).toBeNull();
    });

    it("shows −10 while two others are sustained, and the Max of Mastery", () => {
        const sustained = { subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } };
        show(content({}, {
            skillsLeft: { deceive: advances(4) },
            talents: { list: { items: { a1: { name: "Expanded Sustain" }, a2: { name: "Mastery (Deceive)" } }, layouts: { a1: pos(0, 0), a2: pos(1, 0) } } },
        }, { s2: { name: "Blur", ...sustained }, s3: { name: "Haste", ...sustained } }));
        expect(inRoll("sustainPenalty")!.textContent).toBe("-10: two sustained");
        // F 40 at +30: 70.
        expect(total()).toBe(60);
        expect(inRoll("capSource")!.textContent).toBe("Max 5: Mastery (Deceive)");
        expect(inRoll("sustainLimit")!.textContent).toBe("Already sustaining Blur, Haste: the limit is 2");
    });

    it("is not rolled without a skill or the Sorcery mana", () => {
        show(content({ roll: {} }));
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "Pick the skill"]);
        expect(inRoll("capSource")).toBeNull();
        rendered!.unmount();
        teardownSheet();

        show(content({ level: 3 }));
        expect(inRoll("noMana")).not.toBeNull();
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "Not enough mana: the cast costs 3, 2 left"]);
    });

    it("counts its Max as the PR of its damage before a cast", () => {
        load(content({ damage: "1d10+PR" }));
        expect(powerPR(testState(), S1)).toBe(3);
        updateSignalAtPath(testState(), `${S1}.cast.pr`, 2);
        expect(powerPR(testState(), S1)).toBe(2);
    });

    it("is rolled from the stat block too", () => {
        load(content());
        rendered = renderBlock(<PathfinderCrusadeStatBlock />);
        act(() => $('[data-id="s1"] .stat-power-name label')!.click());
        expect(inRoll("skill")).not.toBeNull();
        expect(inRoll("safePR")).toBeNull();
    });

    it("is the PR roll on a Black Crusade sheet, whatever the Subtypes say", () => {
        show(content({ roll: { testOption: "o1" } }), blackCrusade);
        expect(inRoll("skill")).toBeNull();
        expect(inRoll("safePR")).not.toBeNull();
    });
});

describe("the card of a Sorcery spell", () => {
    const card = (id: string, selector: string) => $(`[data-id="${id}"] ${selector}`);
    const chip = (id: string) => card(id, '[data-id="sorceryChip"]')?.textContent ?? null;
    const traits = (id: string) => {
        act(() => card(id, ".power-traits-toggle")!.click());
        return [...rendered!.container.querySelectorAll(`[data-id="${id}"] [data-id="traits"] li`)].map(li => li.textContent);
    };

    it("has a chip of its class and cost after the name, following Subtypes and Level", () => {
        load(content({}, {}, { s2: { name: "Shield", prepared: true } }));
        rendered = renderBlock(<Psykana />);
        expect([chip("s1"), chip("s2")]).toEqual(["Bard, 1 mana", null]);
        // After the name and its ⚙, out of the name's row.
        expect(card("s1", ".name [data-id=\"sorceryChip\"]")).toBeNull();

        act(() => updateSignalAtPath(testState(), `${S1}.level`, 0));
        expect(chip("s1")).toBe("Bard");
        act(() => updateSignalAtPath(testState(), `${S1}.subtypes`, "Illusion, Колдовство (Следопыт)"));
        expect(chip("s1")).toBe("Следопыт");
        act(() => updateSignalAtPath(testState(), `${S1}.subtypes`, "Колдовство"));
        expect(chip("s1")).toBeNull();
    });

    it("has a Level by its Subtypes, which a PR spell has not", () => {
        load(content({ level: 2 }, {}, { s2: { name: "Shield" } }));
        rendered = renderBlock(<Psykana />);
        const level = card("s1", '.level [data-id="level"]') as HTMLInputElement;
        expect(level.value).toBe("2");
        expect(level.closest(".layout-row.level")!.previousElementSibling!.classList.contains("subtypes")).toBe(true);
        expect(card("s2", '[data-id="level"]')).toBeNull();
    });

    it("lists its type under the ⚙", () => {
        load(content());
        rendered = renderBlock(<Psykana />);
        expect(traits("s1")).toContain("Sorcery (Bard): tested on a skill, ePR by its level, costs its Level, no phenomena");
    });

    it("is none of a Black Crusade sheet", () => {
        load(content(), blackCrusade);
        rendered = renderBlock(<Psykana />);
        expect([chip("s1"), card("s1", '[data-id="level"]')]).toEqual([null, null]);
        expect(traits("s1").some(line => line!.startsWith("Sorcery"))).toBe(false);
    });
});
