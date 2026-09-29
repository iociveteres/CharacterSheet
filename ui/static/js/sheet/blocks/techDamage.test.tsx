import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { resetDragFreeze } from "../state/dragFreeze";
import { characterState } from "../state/state";
import { updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { TechnoArcana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });

const content = () => ({
    characteristics: { I: { value: "45" } },
    technoArcana: {
        tabs: {
            items: {
                t1: {
                    name: "Luminen",
                    powers: {
                        items: {
                            p1: { name: "Luminen Smite", damage: "2d10+2×I.b", pen: "½I.b(Окр.▲)" },
                            p2: {
                                name: "Luminen Surge", damage: "1d10+I.b", pen: "2",
                                damageMods: { items: { d1: { expr: "1d10", enabled: true } }, layouts: { d1: pos(0, 0) } },
                            },
                        },
                        layouts: { p1: pos(0, 0), p2: pos(0, 1) },
                    },
                },
                t2: {
                    name: "Psalms",
                    powers: {
                        items: { p3: { name: "Voltagheist Retribution", damage: "Xd10+I.b", pen: "0" } },
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
    rendered = renderBlock(<TechnoArcana />);
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

describe("the damage of a tech power", () => {
    it("counts the Intelligence bonus of its own damage and penetration", () => {
        // I 45: I.b 4.
        expect(damage("p1").value).toBe("2d10+8");
        expect(damage("p1").title).toBe("Power 2d10+2×I.b");
        expect(pen("p1").value).toBe("2");
        act(() => updateSignalAtPath("characteristics.I.value", "50"));
        expect(damage("p1").value).toBe("2d10+10");
        expect(pen("p1").value).toBe("3");
    });

    it("adds its modifiers and rolls the total with the power's name", () => {
        expect(damage("p2").value).toBe("2d10+4");
        expect(rollsOf(() => power("p2", ".damage label.rollable")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))))
            .toEqual([{ expression: "2d10+4", label: "Luminen Surge" }]);
    });

    it("keeps a damage it cannot read as typed", () => {
        expect(damage("p3").value).toBe("Xd10+I.b");
    });

    it("copies the modifiers of the other tech powers by tab", () => {
        act(() => power("p1", ".damage .mod-toggle")!.click());
        const dropdown = power("p1", ".damage .mod-dropdown")!;
        expect(dropdown.querySelector('[data-id="cast"]')).toBeNull();
        const copy = dropdown.querySelector<HTMLSelectElement>("select.mod-copy")!;
        const groups = Array.from(copy.querySelectorAll("optgroup"), g => [g.label, Array.from(g.children, o => o.textContent)]);
        expect(groups).toEqual([["Luminen", ["Luminen Surge: 1d10"]]]);

        act(() => {
            copy.value = "technoArcana.tabs.items.t1.powers.items.p2";
            copy.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(damage("p1").value).toBe("3d10+8");
    });
});
