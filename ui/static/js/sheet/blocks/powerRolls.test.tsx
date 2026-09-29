import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { conditionOf, loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { getRollValue } from "../state/rollBase";
import { resolvePath } from "../state/sync";
import { characterState } from "../state/state";
import { updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { Psykana, TechnoArcana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const tabWith = (power: object) => ({
    items: { t1: { name: "Tab", powers: { items: { p1: power }, layouts: { p1: pos(0, 0) } } } },
    layouts: { t1: pos(0, 0) },
});

let rendered: Rendered | null = null;

const content = () => ({
    characteristics: { W: { value: "40" }, T: { value: "35" }, I: { value: "40" } },
    psykana: {
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: tabWith({
            name: "Smite",
            roll: {
                testOption: "o1", modifier: 5, effectivePR: 2, kickPR: 1,
                extra1: { name: "Focus", value: 3, enabled: true },
            },
        }),
    },
    technoArcana: {
        compensationRoll: { modifier: 2, extra1: { value: 4, enabled: true } },
        testOptions: { items: { o1: { base: "awareness", characteristic: "I" } }, layouts: { o1: pos(0, 0) } },
        tabs: tabWith({
            name: "Scan",
            roll: {
                testOption: "o1", modifier: -5,
                extra1: { value: 9, enabled: false },
                extra2: { value: 2, enabled: true },
            },
        }),
    },
});

function load(extra: object = {}): void {
    loadState({ ...content(), ...extra });
    attachComputeds(characterState);
}

beforeEach(() => load());

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
});

const openRoll = (power: string) => act(() => rendered!.container.querySelector<HTMLElement>(`${power} .name label`)!.click());

const total = (scope: string) => rendered!.container.querySelector<HTMLInputElement>(`${scope} [data-id="total"]`)!.value;

function rolls(run: () => void): unknown[] {
    const out: unknown[] = [];
    // The requestId of a test is new each time.
    const listener = (e: Event) => {
        const { requestId: _, ...roll } = (e as CustomEvent).detail;
        out.push(roll);
    };
    document.addEventListener("sheet:rollVersus", listener);
    run();
    document.removeEventListener("sheet:rollVersus", listener);
    return out;
}

describe("the roll total of a power", () => {
    it("adds the modifier, 5 per PR and the enabled extras to a psychic power's test", () => {
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');
        // W 40 + modifier 5 + ePR 2 × 5 + kick 1 × 5 + Focus 3.
        expect(total('[data-id="p1"]')).toBe("63");

        act(() => updateSignalAtPath("psykana.tabs.items.t1.powers.items.p1.roll.kickPR", 0));
        expect(total('[data-id="p1"]')).toBe("58");

        const button = rendered.container.querySelector<HTMLButtonElement>('[data-id="p1"] [data-id="rollButton"]')!;
        expect(rolls(() => button.click())).toEqual([{ target: 58, bonusSuccesses: 0, label: "Smite, 2 ePR, Focus" }]);
    });

    it("adds the modifier and the enabled extras to a tech power's test", () => {
        rendered = renderBlock(<TechnoArcana />);
        openRoll('[data-id="p1"]');
        // Untrained Awareness on I 40 is 20; - 5 + extra2 2, extra1 is off.
        expect(total('[data-id="p1"]')).toBe("17");
    });

    it("tests the compensation roll on T - 10 × X plus the enabled extras", () => {
        rendered = renderBlock(<TechnoArcana />);
        // T 35 - 10 × 2 + 4.
        expect(total('[data-id="compensationRoll"]')).toBe("19");

        act(() => updateSignalAtPath("technoArcana.compensationRoll.modifier", 1));
        expect(total('[data-id="compensationRoll"]')).toBe("29");
    });
});

describe("the cast of a psychic power", () => {
    const power = "psykana.tabs.items.t1.powers.items.p1";
    const at = (path: string) => (resolvePath(`${power}.${path}`) as { value: unknown }).value;
    const button = (id: string) => rendered!.container.querySelector<HTMLButtonElement>(`[data-id="p1"] [data-id="${id}"]`)!;

    beforeEach(() => {
        load();
        act(() => {
            updateSignalAtPath("psykana.basePR", 5);
            updateSignalAtPath("psykana.sustainedPowers", 1);
            updateSignalAtPath("psykana.maxPush", 3);
        });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');
    });

    it("casts normally at the current PR and safely at half of it without a kick", () => {
        act(() => button("maxPR").click());
        expect([at("roll.effectivePR"), at("roll.safe")]).toEqual([4, false]);

        act(() => button("safePR").click());
        expect([at("roll.effectivePR"), at("roll.kickPR"), at("roll.safe")]).toEqual([2, 0, true]);
        expect(button("kickMax").disabled).toBe(true);
        // A kick left from before counts for nothing in a safe cast.
        act(() => updateSignalAtPath(`${power}.roll.kickPR`, 2));
        // W 40 + 5 + ePR 2 × 5 + Focus 3.
        expect(total('[data-id="p1"]')).toBe("58");

        act(() => button("safePR").click());
        expect([at("roll.effectivePR"), at("roll.safe")]).toEqual([2, false]);
        expect(total('[data-id="p1"]')).toBe("68");
    });

    it("counts a talented power from the base PR", () => {
        act(() => updateSignalAtPath(`${power}.ignoreTprPenalty`, true));
        act(() => button("maxPR").click());
        expect(at("roll.effectivePR")).toBe(5);
        act(() => button("safePR").click());
        expect(at("roll.effectivePR")).toBe(3);
    });

    it("warns when no PR is left", () => {
        expect(rendered!.container.querySelector('[data-id="noPR"]')).toBeNull();
        act(() => updateSignalAtPath("psykana.sustainedPowers", 5));
        expect(rendered!.container.querySelector('[data-id="noPR"]')).not.toBeNull();
    });

    it("remembers the PR, the kick and the mode of the cast it rolls", () => {
        act(() => updateSignalAtPath(`${power}.roll.effectivePR`, 4));
        act(() => updateSignalAtPath(`${power}.roll.kickPR`, 2));
        expect(rolls(() => button("rollButton").click())).toMatchObject([{ label: "Smite, 4 ePR, +2 kick, Focus" }]);
        expect([at("cast.pr"), at("cast.kick"), at("cast.safe")]).toEqual([6, 2, false]);

        openRoll('[data-id="p1"]');
        act(() => button("safePR").click());
        expect(rolls(() => button("rollButton").click())).toMatchObject([{ label: "Smite, safe, 2 ePR, Focus" }]);
        expect([at("cast.pr"), at("cast.kick"), at("cast.safe")]).toEqual([2, 0, true]);
    });

    it("lists the traits of the power and its talent under its ⚙", () => {
        act(() => {
            updateSignalAtPath(`${power}.subtypes`, "Призыв, Цикл (5)");
            updateSignalAtPath(`${power}.sustained`, "Свободное действие");
        });
        act(() => rendered!.container.querySelector<HTMLButtonElement>('[data-id="p1"] .power-traits-toggle')!.click());
        const items = [...rendered!.container.querySelectorAll('[data-id="p1"] [data-id="traits"] li')].map(li => li.textContent);
        expect(items).toEqual(["Can be sustained", "Cycle (5): sustaining it may be free when cast at ePR 5 or more"]);

        act(() => rendered!.container.querySelector<HTMLInputElement>('[data-id="p1"] [data-id="ignoreTprPenalty"]')!.click());
        expect(at("ignoreTprPenalty")).toBe(true);
    });
});

describe("a roll bonus limited to some rolls", () => {
    const valueForRolls = (key: string) => (resolvePath(`characteristics.${key}.valueForRolls`) as { value: number }).value;

    it("counts a bonus except psychic powers on the characteristic and its skills, but not on a power", () => {
        // Recaf: -10 to W tests except psychic ones.
        load({ conditions: conditionOf({ type: "roll_bonus", name: "W", rollBonus: "-10", domainMode: "except", domains: { psychic: true } }) });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(valueForRolls("W")).toBe(30);
        // Untrained Interrogation, on W.
        expect(getRollValue("interrogation")).toBe(10);
        expect(total('[data-id="p1"]')).toBe("63");
    });

    it("keeps fatigue in every roll", () => {
        load({
            conditions: conditionOf({ type: "roll_bonus", name: "W", rollBonus: "-10", domainMode: "except", domains: { psychic: true } }),
            fatigue: { fatigueCur: 1, fatigueMode: "mental" },
        });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(valueForRolls("W")).toBe(20);
        expect(total('[data-id="p1"]')).toBe("53");
    });

    it("counts a named bonus only for psychic powers on that characteristic", () => {
        load({
            conditions: conditionOf(
                { type: "roll_bonus", name: "w", rollBonus: "10", domainMode: "only", domains: { psychic: true } },
                { type: "roll_bonus", name: "T", rollBonus: "20", domainMode: "only", domains: { psychic: true } },
            ),
        });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(valueForRolls("W")).toBe(40);
        expect(total('[data-id="p1"]')).toBe("73");
    });

    it("counts a compensation bonus on Any in the compensation roll only", () => {
        load({ conditions: conditionOf({ type: "roll_bonus", name: "Any", rollBonus: "20", domainMode: "only", domains: { compensation: true } }) });
        rendered = renderBlock(<TechnoArcana />);
        openRoll('[data-id="p1"]');

        expect(total('[data-id="compensationRoll"]')).toBe("39");
        expect(total('[data-id="p1"]')).toBe("17");
        expect(valueForRolls("T")).toBe(35);
    });

    it("counts a tech power bonus on Any on the characteristic of the power's skill", () => {
        load({ conditions: conditionOf({ type: "roll_bonus", name: "any", rollBonus: "-5", domainMode: "only", domains: { techPower: true, melee: true } }) });
        rendered = renderBlock(<TechnoArcana />);
        openRoll('[data-id="p1"]');

        expect(total('[data-id="p1"]')).toBe("12");
        expect(total('[data-id="compensationRoll"]')).toBe("19");
        expect(getRollValue("awareness (I)")).toBe(20);
    });

    it("counts an except bonus in every roll when no domain is ticked, and an only bonus in none", () => {
        load({
            conditions: conditionOf(
                { type: "roll_bonus", name: "W", rollBonus: "-10", domainMode: "except" },
                { type: "roll_bonus", name: "W", rollBonus: "50", domainMode: "only" },
            ),
        });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(valueForRolls("W")).toBe(30);
        expect(total('[data-id="p1"]')).toBe("53");
    });

    it("counts an unnamed bonus in no roll", () => {
        load({ conditions: conditionOf({ type: "roll_bonus", rollBonus: "20", domainMode: "only", domains: { psychic: true } }) });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(total('[data-id="p1"]')).toBe("63");
    });

    it("counts a bonus on Any except psychic powers on every tested characteristic but in a power", () => {
        load({ conditions: conditionOf({ type: "roll_bonus", name: "Any -T", rollBonus: "-10", domainMode: "except", domains: { psychic: true } }) });
        rendered = renderBlock(<Psykana />);
        openRoll('[data-id="p1"]');

        expect(valueForRolls("W")).toBe(30);
        expect(valueForRolls("F")).toBe(-10);
        expect(valueForRolls("Inf")).toBe(0);
        expect(valueForRolls("Cor")).toBe(0);
        expect(valueForRolls("T")).toBe(35);
        expect(total('[data-id="p1"]')).toBe("63");
    });
});
