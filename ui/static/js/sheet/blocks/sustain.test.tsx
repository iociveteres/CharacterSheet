import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { flush, loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { castCap, sustainAfterCast, sustainedPowers } from "../state/psychic";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState, selectedTabSignal } from "../state/ui";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;
const power = (id: string) => `psykana.tabs.items.t1.powers.items.${id}`;

const roll = { testOption: "o1", effectivePR: 4 };

/** Powers of one tab but Wisp's, and I 45 (I.b 4: 2 free by Cycle). */
const content = (powers: { [id: string]: object }, settings: object = {}) => ({
    characteristics: { W: { value: "40" }, I: { value: "45" } },
    psykana: {
        basePR: 6,
        sustainedPowers: 2,
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: {
                t1: { name: "Tab", powers: { items: powers, layouts: Object.fromEntries(Object.keys(powers).map((id, i) => [id, pos(0, i)])) } },
                t2: {
                    name: "Other",
                    powers: { items: { w: { name: "Wisp", sustained: "Free", sustain: { copies: 1, pr: 2 } } }, layouts: { w: pos(0, 0) } },
                },
            },
            layouts: { t1: pos(0, 0), t2: pos(0, 1) },
        },
    },
    settings: { psykana: settings },
});

let rendered: Rendered | null = null;

function load(powers: { [id: string]: object }, settings: object = {}): void {
    loadState(content(powers, settings));
    attachComputeds(characterState);
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
});

describe("the sustained powers", () => {
    it("take a PR per sustained cast from the base PR, but free Cycle ones up to ½I.b▲", () => {
        load({
            a: { name: "Shield", sustain: { copies: 1, pr: 3 } },
            b: { name: "Echo", sustain: { copies: 2, pr: 4 } },
            c: { name: "Veil", sustain: { copies: 1, pr: 5, free: true } },
        });
        expect(sustainedPowers().powers.map(p => [p.name, p.taken, p.free])).toEqual([
            ["Shield", 1, false], ["Echo", 2, false], ["Veil", 0, true], ["Wisp", 1, false],
        ]);
        // 6 less 4; Sustained Powers as typed does not count.
        expect(value("psykana.effectivePR")).toBe(2);
    });

    it("count the free ones past ½I.b▲, and none free while Cycle is off", () => {
        const free = { sustain: { copies: 1, pr: 5, free: true } };
        load({ a: { name: "A", ...free }, b: { name: "B", ...free }, c: { name: "C", ...free }, d: { name: "D", ...free } });
        expect(sustainedPowers().powers.map(p => [p.name, p.free, p.overFree])).toEqual([
            ["A", true, false], ["B", true, false], ["C", false, true], ["D", false, true], ["Wisp", false, false],
        ]);
        expect(value("psykana.effectivePR")).toBe(3);

        act(() => updateSignalAtPath("settings.psykana.cycle", false));
        expect(value("psykana.effectivePR")).toBe(1);
    });

    it("are typed while the sheet does not count them", () => {
        load({}, { sustained: false });
        expect(value("psykana.effectivePR")).toBe(4);
    });

    it("leave out a power's own sustaining from the PR of its cast, unless it is Repeatable", () => {
        load({
            a: { name: "Shield", sustain: { copies: 1, pr: 3 } },
            r: { name: "Echo", subtypes: "Повторяемая (2)", sustain: { copies: 1, pr: 3 } },
        });
        expect(value("psykana.effectivePR")).toBe(3);
        expect(castCap(power("a"))).toBe(4);
        expect(castCap(power("r"))).toBe(3);
    });

    it("count the PR of a cast as if its power were not sustained, a Cycle one past the free ones then free", () => {
        const free = { sustain: { copies: 1, pr: 5, free: true } };
        load({ a: { name: "A", ...free }, b: { name: "B", ...free }, c: { name: "C", ...free } });
        // 6 less C, past the free ones, and Wisp.
        expect(value("psykana.effectivePR")).toBe(4);
        // Without A, C is free: 6 less Wisp.
        expect(castCap(power("a"))).toBe(5);
        expect(castCap(power("c"))).toBe(5);
    });

    it("change after a cast: another power's replaces it, a Repeatable one adds up to X", () => {
        load({ a: { name: "Shield", sustain: { copies: 1, pr: 3 } }, r: { name: "Echo", subtypes: "Repeatable (2)" } });
        expect(sustainAfterCast(power("a"), 5, false)).toEqual({ copies: 1, pr: 5, free: false });
        expect(sustainAfterCast(power("r"), 4, true)).toEqual({ copies: 1, pr: 4, free: true });
        act(() => updateSignalAtPath(`${power("r")}.sustain.copies`, 2));
        expect(sustainAfterCast(power("r"), 4, true)).toBeNull();
    });
});

describe("sustaining from the roll", () => {
    const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
    const openRoll = (id: string) => act(() => $(`[data-id="${id}"] .name label`)!.click());

    /** Rolls the power `id` and answers its test with `success`. */
    async function cast(id: string, success: boolean): Promise<void> {
        let requestId = "";
        const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
        document.addEventListener("sheet:rollVersus", listener);
        act(() => $<HTMLButtonElement>(`[data-id="${id}"] [data-id="rollButton"]`)!.click());
        document.removeEventListener("sheet:rollVersus", listener);
        const outcome = { roll: success ? 20 : 90, target: 60, success, degrees: 1, crit: false, doubles: false };
        document.dispatchEvent(new CustomEvent("sheet:rollResult", { detail: { requestId, outcome } }));
        await act(async () => { await flush(); });
    }

    it("marks a sustainable power once its test succeeds", async () => {
        load({ a: { name: "Shield", sustained: "Free action", roll }, n: { name: "Bolt", sustained: "нет", roll } });
        rendered = renderBlock(<Psykana />);

        openRoll("n");
        expect($('[data-id="n"] [data-id="sustainChoice"]')).toBeNull();

        openRoll("a");
        expect($<HTMLInputElement>('[data-id="a"] [data-id="sustain"]')!.checked).toBe(true);
        await cast("a", false);
        expect(value(`${power("a")}.sustain.copies`)).toBe(0);

        openRoll("a");
        await cast("a", true);
        expect([value(`${power("a")}.sustain.copies`), value(`${power("a")}.sustain.pr`)]).toEqual([1, 4]);
        expect($('[data-id="a"] [data-id="sustainPill"]')!.textContent).toBe("Sustained PR 4✕");
        expect(value("psykana.effectivePR")).toBe(4);
    });

    it("leaves the sustaining alone when unticked, and a full Repeatable power's cast instant", async () => {
        load({
            a: { name: "Shield", sustained: "Free action", roll },
            r: { name: "Echo", sustained: "Free action", subtypes: "Repeatable (1)", roll, sustain: { copies: 1, pr: 2 } },
        });
        rendered = renderBlock(<Psykana />);

        openRoll("a");
        act(() => $<HTMLInputElement>('[data-id="a"] [data-id="sustain"]')!.click());
        await cast("a", true);
        expect(value(`${power("a")}.sustain.copies`)).toBe(0);

        openRoll("r");
        expect($('[data-id="r"] [data-id="instant"]')!.textContent).toBe("Instant: 1 of Repeatable (1) sustained");
        await cast("r", true);
        expect([value(`${power("r")}.sustain.copies`), value(`${power("r")}.sustain.pr`)]).toEqual([1, 2]);
    });

    it("sustains a Cycle power free when cast at ePR X or more", async () => {
        load({ c: { name: "Veil", sustained: "Free action", subtypes: "Цикл (5)", roll } });
        rendered = renderBlock(<Psykana />);

        openRoll("c");
        const free = () => $<HTMLInputElement>('[data-id="c"] [data-id="free"]')!;
        expect(free().disabled).toBe(true);
        act(() => updateSignalAtPath(`${power("c")}.roll.kickPR`, 1));
        expect([free().disabled, free().checked]).toEqual([false, true]);

        await cast("c", true);
        expect([value(`${power("c")}.sustain.pr`), value(`${power("c")}.sustain.free`)]).toEqual([5, true]);
        // Only Wisp takes PR.
        expect(value("psykana.effectivePR")).toBe(5);
    });
});

describe("the sustained powers in the psykana bar", () => {
    const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);

    it("count Sustained Powers, list the powers and stop sustaining one", () => {
        load({ b: { name: "Echo", subtypes: "Repeatable (2)", sustain: { copies: 2, pr: 4 } } });
        rendered = renderBlock(<Psykana />);

        expect($<HTMLInputElement>('[data-id="sustainedCount"]')!.value).toBe("3");
        const pills = () => Array.from(rendered!.container.querySelectorAll('[data-id="sustainedList"] .sustain-pill'), p => p.textContent);
        expect(pills()).toEqual(["Echo×2 · PR 4✕", "WispPR 2✕"]);

        act(() => $<HTMLButtonElement>('[data-id="sustainedList"] .sustain-pill [data-id="dropSustain"]')!.click());
        expect(value(`${power("b")}.sustain.copies`)).toBe(1);
        expect($<HTMLInputElement>('[data-id="sustainedCount"]')!.value).toBe("2");

        act(() => Array.from(rendered!.container.querySelectorAll<HTMLButtonElement>('[data-id="sustainedList"] .sustain-name'))[1].click());
        expect(selectedTabSignal("psykana.tabs.items").value).toBe("t2");
    });

    it("are set by hand under the ⚙: sustained or not, casts only for a Repeatable power", () => {
        load({ a: { name: "Shield" }, r: { name: "Echo", subtypes: "Repeatable (2)" } });
        rendered = renderBlock(<Psykana />);
        const traits = (id: string) => act(() => $<HTMLButtonElement>(`[data-id="${id}"] .power-traits-toggle`)!.click());

        traits("a");
        expect($('[data-id="a"] .power-traits-sustain [data-id="copies"]')).toBeNull();
        act(() => $<HTMLInputElement>('[data-id="a"] [data-id="marked"]')!.click());
        expect(value(`${power("a")}.sustain.copies`)).toBe(1);
        expect($<HTMLInputElement>('[data-id="sustainedCount"]')!.value).toBe("2");

        traits("r");
        expect($('[data-id="r"] [data-id="marked"]')).toBeNull();
        expect($('[data-id="r"] .power-traits-sustain label')!.textContent).toBe("Sustained casts (of 2) ");
    });

    it("keep Sustained Powers typed while the sheet does not count them", () => {
        load({}, { sustained: false });
        rendered = renderBlock(<Psykana />);
        expect($('[data-id="sustainedList"]')).toBeNull();
        expect($<HTMLInputElement>('[data-id="sustainedPowers"]')!.readOnly).toBe(false);
        expect($('[data-id="sustainPill"]')).toBeNull();
    });
});
