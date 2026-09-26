import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed.js";
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

beforeEach(() => {
    loadState({
        characteristics: { W: { value: "40" }, T: { value: "35" }, I: { value: "40" } },
        psykana: {
            tabs: tabWith({
                name: "Smite",
                roll: {
                    baseSelect: "W", modifier: 5, effectivePR: 2, kickPR: 1,
                    extra1: { name: "Focus", value: 3, enabled: true },
                },
            }),
        },
        technoArcana: {
            compensationRoll: { modifier: 2, extra1: { value: 4, enabled: true } },
            tabs: tabWith({
                name: "Scan",
                roll: {
                    baseSelect: "awareness (I)", modifier: -5,
                    extra1: { value: 9, enabled: false },
                    extra2: { value: 2, enabled: true },
                },
            }),
        },
    });
    attachComputeds(characterState);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
});

const total = (scope: string) => rendered!.container.querySelector<HTMLInputElement>(`${scope} [data-id="total"]`)!.value;

function rolls(run: () => void): unknown[] {
    const out: unknown[] = [];
    const listener = (e: Event) => out.push((e as CustomEvent).detail);
    document.addEventListener("sheet:rollVersus", listener);
    run();
    document.removeEventListener("sheet:rollVersus", listener);
    return out;
}

describe("the roll total of a power", () => {
    it("adds the modifier, 5 per PR and the enabled extras to a psychic power's test", () => {
        rendered = renderBlock(<Psykana />);
        // W 40 + modifier 5 + ePR 2 × 5 + kick 1 × 5 + Focus 3.
        expect(total('[data-id="p1"]')).toBe("63");

        act(() => updateSignalAtPath("psykana.tabs.items.t1.powers.items.p1.roll.kickPR", 0));
        expect(total('[data-id="p1"]')).toBe("58");

        const button = rendered.container.querySelector<HTMLButtonElement>('[data-id="p1"] [data-id="rollButton"]')!;
        expect(rolls(() => button.click())).toEqual([{ target: 58, bonusSuccesses: 0, label: "Smite, 2 ePR, Focus" }]);
    });

    it("adds the modifier and the enabled extras to a tech power's test", () => {
        rendered = renderBlock(<TechnoArcana />);
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
