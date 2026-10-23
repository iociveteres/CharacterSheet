import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import { RangedAttacks } from "./Attacks";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(`[data-id="r1"] ${selector}`);

function load(attack: object) {
    const state = loadState({
        characteristics: { S: { value: "40" } },
        rangedAttacks: { list: { items: { r1: { name: "Frag", ...attack } }, layouts: { r1: { colIndex: 0, rowIndex: 0 } } } },
    });
    attachComputeds(state);
    rendered = renderBlock(<RangedAttacks />);
    return state;
}

describe("the range of a ranged attack", () => {
    it("shows its total; the ⚙ opens the weapon's own range, by the rules for a grenade, and the modifiers", () => {
        const state = load({ class: "grenade" });
        expect($('[data-id="rangeTotal"]')!.value).toBe("12м");

        act(() => $<HTMLButtonElement>(".range .mod-toggle")!.click());
        expect($('.mod-dropdown [data-id="range"]')!.placeholder).toBe("S.b×3м");
        expect($('[data-id="rule"]')).not.toBeNull();

        act(() => updateSignalAtPath(state, "rangedAttacks.list.items.r1.range", "S.b×5м"));
        expect($('[data-id="rule"]')).toBeNull();
        expect($('[data-id="result"]')!.textContent).toBe("20м");
        expect($('[data-id="rangeTotal"]')!.value).toBe("20м");
    });

    it("multiplies by a factor of its modifiers, and outlines one that reads as nothing", () => {
        load({ range: "S.b×10м", rangeMods: {
            items: { m1: { expr: "×2", enabled: true }, m2: { expr: "far", enabled: true } },
            layouts: { m1: { colIndex: 0, rowIndex: 0 }, m2: { colIndex: 0, rowIndex: 1 } },
        } });
        expect($('[data-id="rangeTotal"]')!.value).toBe("80м");

        act(() => $<HTMLButtonElement>(".range .mod-toggle")!.click());
        expect($('[data-id="m1"] [data-id="added"]')!.textContent).toBe("×2");
        expect($('[data-id="m2"] [data-id="expr"]')!.classList.contains("invalid")).toBe(true);
    });
});
