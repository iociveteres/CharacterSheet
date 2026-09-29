import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { flush, loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { phenomena, phenomenaReason } from "../state/psychic";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;
const P = "psykana.tabs.items.t1.powers.items.p1";

const content = (psykana: object = {}, power: object = {}, settings: object = {}) => ({
    characteristics: { W: { value: "40" } },
    psykana: {
        psykanaType: "Unbound",
        basePR: 5,
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: {
                t1: {
                    name: "Tab",
                    powers: {
                        items: {
                            p1: { name: "Smite", roll: { testOption: "o1", effectivePR: 3 }, ...power },
                            p2: { name: "Shield", sustained: "Free action" },
                        },
                        layouts: { p1: pos(0, 0), p2: pos(0, 1) },
                    },
                },
            },
            layouts: { t1: pos(0, 0) },
        },
        ...psykana,
    },
    settings: { psykana: { noticeSeen: true, ...settings } },
});

let rendered: Rendered | null = null;

function load(psykana: object = {}, power: object = {}, settings: object = {}): void {
    loadState(content(psykana, power, settings));
    attachComputeds(characterState);
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
});

it("phenomenaReason calls for them on a pushed cast, and on doubles of a success or 99 of a normal one", () => {
    const normal = { safe: false, kick: 0 };
    const test = (roll: number, success: boolean, doubles: boolean) => ({ roll, success, doubles });
    expect(phenomenaReason({ safe: false, kick: 1 }, null)).toBe("pushed");
    expect(phenomenaReason({ safe: true, kick: 1 }, test(99, false, true))).toBe("");
    expect(phenomenaReason(normal, test(33, true, true))).toBe("doubles");
    expect(phenomenaReason(normal, test(55, false, true))).toBe("");
    expect(phenomenaReason(normal, test(99, false, true))).toBe("99");
    expect(phenomenaReason(normal, test(12, true, false))).toBe("");
    expect(phenomenaReason(normal, null)).toBe("");
});

describe("the modifiers of the phenomena", () => {
    const parts = () => Object.fromEntries(phenomena().parts.map(p => [p.key, p.value]));

    it("count the kick of the last cast by the nature of the gift", () => {
        const cast = (psykanaType: string, kick: number, safe = false) => {
            load({ psykanaType, lastCastPower: "p1" }, { cast: { pr: 3 + kick, kick, safe } });
            return parts().nature;
        };
        expect([cast("Bound", 3), cast("Unbound", 2), cast("Daemonic", 2), cast("Unbound", 0), cast("Daemonic", 2, true)])
            .toEqual([10, 10, 20, 0, 0]);
    });

    it("add the sustained powers, the power's own and the other enabled ones", () => {
        load({
            lastCastPower: "p1",
            phenomenaMods: {
                items: { m1: { name: "Warp storm", value: 20, enabled: true }, m2: { name: "Focus", value: -10, enabled: false } },
                layouts: { m1: pos(0, 0), m2: pos(0, 1) },
            },
        }, { cast: { pr: 3 }, phenomenaMod: 5 });
        expect(parts()).toEqual({ nature: 0, sustained: 0, power: 5, other: 20 });

        act(() => updateSignalAtPath("psykana.tabs.items.t1.powers.items.p2.sustain.copies", 1));
        expect(parts().sustained).toBe(10);
        act(() => updateSignalAtPath("psykana.sustainPenalty", 0));
        expect(parts().sustained).toBe(0);
        expect(phenomena().total).toBe(25);
    });

    it("take the typed Sustained Powers while the sheet does not count them", () => {
        load({ sustainedPowers: 1 }, {}, { sustained: false });
        expect(parts().sustained).toBe(10);
        expect(phenomena().power).toBeNull();
    });
});

describe("the phenomena button", () => {
    const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
    const toggle = () => $<HTMLButtonElement>('[data-id="phenomenaToggle"]');

    async function cast(outcome: { roll: number; success: boolean; doubles: boolean }): Promise<void> {
        act(() => $('[data-id="p1"] .name label')!.click());
        let requestId = "";
        const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
        document.addEventListener("sheet:rollVersus", listener);
        act(() => $<HTMLButtonElement>('[data-id="p1"] [data-id="rollButton"]')!.click());
        document.removeEventListener("sheet:rollVersus", listener);
        document.dispatchEvent(new CustomEvent("sheet:rollResult", {
            detail: { requestId, outcome: { target: 60, degrees: 1, crit: false, ...outcome } },
        }));
        await act(async () => { await flush(); });
    }

    it("stands out after a cast that calls for phenomena, and rolls them with the modifiers", async () => {
        load();
        rendered = renderBlock(<Psykana />);
        expect(toggle()!.classList.contains("attention")).toBe(false);

        await cast({ roll: 44, success: true, doubles: true });
        expect(value("psykana.lastCastPower")).toBe("p1");
        expect(value(`${P}.cast.phenomena`)).toBe("doubles");
        expect(toggle()!.classList.contains("attention")).toBe(true);

        act(() => updateSignalAtPath(`${P}.phenomenaMod`, 5));
        act(() => toggle()!.click());
        expect($('[data-id="phenomenaNote"]')!.textContent).toBe("Smite rolled doubles on a success.");
        expect($('[data-id="phenomenaTotal"]')!.textContent).toBe("1d100+5");

        const rolls: unknown[] = [];
        const listener = (e: Event) => rolls.push((e as CustomEvent).detail);
        document.addEventListener("sheet:rollExact", listener);
        act(() => $<HTMLButtonElement>('[data-id="rollPhenomena"]')!.click());
        document.removeEventListener("sheet:rollExact", listener);
        expect(rolls).toEqual([{ expression: "1d100+5", label: "Phenomena, Smite" }]);
        expect(value(`${P}.cast.phenomena`)).toBe("");
        expect(toggle()!.classList.contains("attention")).toBe(false);
    });

    it("calls for them on a pushed cast whatever the test, and not on a plain failure", async () => {
        load({ maxPush: 2 });
        rendered = renderBlock(<Psykana />);

        await cast({ roll: 70, success: false, doubles: false });
        expect(value(`${P}.cast.phenomena`)).toBe("");

        act(() => updateSignalAtPath(`${P}.roll.kickPR`, 2));
        await cast({ roll: 70, success: false, doubles: false });
        expect(value(`${P}.cast.phenomena`)).toBe("pushed");
        act(() => toggle()!.click());
        // Unbound: +5 per point of kick.
        expect($('[data-id="nature"]')!.textContent).toBe("+10");
    });

    it("is gone while the sheet does not count phenomena", () => {
        load({}, {}, { phenomena: false });
        rendered = renderBlock(<Psykana />);
        expect(toggle()).toBeNull();
    });
});
