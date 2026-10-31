import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { conditionOf, loadState, renderBlock, teardownSheet, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
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

function load(reload: string, kind = pathfinderCrusade) {
    const conditions = conditionOf({ type: "weapon_bonus", name: "Ranged", weaponField: "reload", weaponBonus: "×½" });
    conditions.list.items.c1.name = "Rapid Reload";
    const state = loadState({
        conditions,
        rangedAttacks: { list: { items: { r1: { name: "Crossbow", reload } }, layouts: { r1: { colIndex: 0, rowIndex: 0 } } } },
    }, kind);
    attachComputeds(state);
    rendered = renderBlock(<RangedAttacks />);
    return state;
}

describe("the Reload of a ranged attack", () => {
    it("shows its total, and the weapon's own Reload with what changed it in the title", () => {
        load("4");
        const total = $('[data-id="reloadTotal"]')!;
        expect(total.value).toBe("2");
        expect(total.title).toBe("4 Weapon\n×½ Rapid Reload\n= 2\n\nIn half-actions; Free is a free action.");
    });

    it("opens at the weapon's own Reload on a click, with the unit, and counts an edit of it", () => {
        const state = load("4");
        act(() => $('[data-id="reloadTotal"]')!.click());
        const own = $('.mod-dropdown [data-id="reload"]')!;
        expect(own.value).toBe("4");
        expect(document.activeElement).toBe(own);
        expect($('[data-id="unit"]')!.textContent).toBe("In half-actions; Free is a free action.");
        expect($('[data-id="breakdown"]')!.textContent).toBe("×½Rapid Reload2");

        act(() => updateSignalAtPath(state, "rangedAttacks.list.items.r1.reload", "½"));
        expect($('[data-id="reloadTotal"]')!.value).toBe("Free");
    });

    it("counts in actions in Black Crusade, and shows a Reload of no number as typed", () => {
        const state = load("1", blackCrusade);
        expect($('[data-id="reloadTotal"]')!.value).toBe("½");
        expect($('[data-id="reloadTotal"]')!.title).toContain("In actions: ½ is a half-action, 1 a full one");

        act(() => updateSignalAtPath(state, "rangedAttacks.list.items.r1.reload", "2 [½]"));
        expect($('[data-id="reloadTotal"]')!.value).toBe("2 [½]");
    });
});
