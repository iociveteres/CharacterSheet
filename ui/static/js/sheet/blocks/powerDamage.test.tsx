import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

const P1 = "psykana.tabs.items.t1.powers.items.p1";

const content = () => ({
    characteristics: { W: { value: "45" } },
    psykana: {
        basePR: 5,
        tabs: {
            items: {
                t1: {
                    name: "Pyromancy",
                    powers: {
                        items: {
                            p1: { name: "Firebolt", damage: "1d10+2×PR", pen: "PR", cast: { pr: 3 } },
                            p2: {
                                name: "Inferno", damage: "2d10", sustain: { copies: 1, pr: 2 },
                                damageMods: { items: { d1: { expr: "W.b", enabled: true } }, layouts: { d1: pos(0, 0) } },
                            },
                        },
                        layouts: { p1: pos(0, 0), p2: pos(0, 1) },
                    },
                },
                t2: {
                    name: "Divination",
                    powers: {
                        items: { p3: { name: "Glimpse", damage: "PRd10", penMods: { items: { e1: { expr: "bPR", enabled: true } }, layouts: { e1: pos(0, 0) } } } },
                        layouts: { p3: pos(0, 0) },
                    },
                },
            },
            layouts: { t1: pos(0, 0), t2: pos(1, 0) },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
    attachComputeds(characterState);
    rendered = renderBlock(<Psykana />);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    resetDragFreeze();
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const power = (id: string, sel: string) => $(`[data-id="${id}"] ${sel}`);
const damage = (id: string) => power(id, '.damage [data-id="damageTotal"]')!;
const pen = (id: string) => power(id, '.pen [data-id="penTotal"]')!;

function rollsOf(run: () => void): unknown[] {
    const out: unknown[] = [];
    const listener = (e: Event) => out.push((e as CustomEvent).detail);
    document.addEventListener("sheet:rollExact", listener);
    run();
    document.removeEventListener("sheet:rollExact", listener);
    return out;
}

describe("the damage of a psychic power", () => {
    it("counts the PR of its last cast, and the PR of a normal cast before one", () => {
        expect(damage("p1").value).toBe("1d10+6");
        expect(pen("p1").value).toBe("3");
        expect(damage("p1").title).toBe("Power 1d10+2×PR, PR 3");

        act(() => updateSignalAtPath(`${P1}.cast.pr`, 0));
        // Base 5 less Inferno, sustained.
        expect(damage("p1").value).toBe("1d10+8");
        act(() => updateSignalAtPath(`${P1}.ignoreTprPenalty`, true));
        expect(damage("p1").value).toBe("1d10+10");
    });

    it("rolls with the PR in the label", () => {
        expect(rollsOf(() => power("p1", ".damage label.rollable")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))))
            .toEqual([{ expression: "1d10+6", label: "Firebolt, PR 3" }]);
    });

    it("lowers the PR of the cast from its dropdown, for the damage and the penetration", () => {
        act(() => power("p1", ".damage .mod-toggle")!.click());
        const dropdown = power("p1", ".damage .mod-dropdown")!;
        expect(dropdown.querySelector('[data-id="prNote"]')!.textContent).toBe("Of the last cast");
        const field = dropdown.querySelector<HTMLInputElement>('[data-id="cast"] [data-id="pr"]')!;
        expect(field.value).toBe("3");

        act(() => {
            field.value = "1";
            field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(value(`${P1}.cast.pr`)).toBe(1);
        expect(damage("p1").value).toBe("1d10+2");
        expect(pen("p1").value).toBe("1");
    });

    it("takes modifiers with PR and PR dice", () => {
        act(() => updateSignalAtPath("psykana.tabs.items.t2.powers.items.p3.cast.pr", 2));
        // Glimpse is in the second tab, which the tabs render too.
        expect(damage("p3").value).toBe("2d10");
        expect(pen("p3").value).toBe("");
        // W 45: W.b 4.
        expect(damage("p2").value).toBe("2d10+4");
    });

    it("copies the modifiers of the other powers by tab, not of the weapons", () => {
        act(() => power("p1", ".damage .mod-toggle")!.click());
        const copy = power("p1", ".damage select.mod-copy") as unknown as HTMLSelectElement;
        const groups = Array.from(copy.querySelectorAll("optgroup"), g => [g.label, Array.from(g.children, o => o.textContent)]);
        expect(groups).toEqual([["Pyromancy", ["Inferno: W.b"]]]);

        act(() => {
            copy.value = "psykana.tabs.items.t1.powers.items.p2";
            copy.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(damage("p1").value).toBe("1d10+10");
    });
});
