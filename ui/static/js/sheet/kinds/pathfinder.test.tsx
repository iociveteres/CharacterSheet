import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { canPush, phenomena, rollKick } from "../state/psychic";
import { getRollValue } from "../state/rollBase";
import { SheetUiState } from "../state/ui";
import { Characteristics } from "../blocks/Characteristics";
import { Psykana } from "../blocks/Powers";
import { Skills } from "../blocks/Skills";
import { blackCrusade } from "./black_crusade";
import { PathfinderCrusade, pathfinderCrusade } from "./pathfinder_crusade";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $$ = (selector: string) => Array.from(rendered!.container.querySelectorAll<HTMLElement>(selector));
const options = (select: Element) => Array.from((select as HTMLSelectElement).options).map(o => o.value);

describe("a Pathfinder Crusade sheet", () => {
    it("has Fate for Infamy and Corruption", () => {
        const state = loadState({ characteristics: { Inf: { value: "40" }, Fa: { value: "35" } } }, pathfinderCrusade);
        attachComputeds(state);
        expect(Object.keys(state.characteristics)).toEqual(["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Fa"]);
        expect(getRollValue(state, "Fa")).toBe(35);

        rendered = renderBlock(<Characteristics />);
        expect($$('.main-characteristics > [data-id]').map(el => el.dataset.id)).toEqual(Object.keys(state.characteristics));
        expect(rendered.container.textContent).toContain("Fate");
        expect(rendered.container.textContent).not.toContain("Infamy");
    });

    it("has the skills of its rules, tested on its characteristics", () => {
        const state = loadState({ skillsLeft: { spellcraft: { characteristic: "Fa" }, psyniscience: { plus0: true } } }, pathfinderCrusade);
        expect(state.skillsLeft.spellcraft.characteristic.value).toBe("Fa");
        expect(state.skillsLeft.psyniscience).toBeUndefined();

        rendered = renderBlock(<Skills />);
        const rows = $$('[data-id="skillsLeft"] tr[data-id]');
        expect(rows.map(r => r.dataset.id)).toContain("use_magic");
        expect($$('[data-id="skillsLeft"] tr.skill-header').map(r => r.textContent)).toEqual(["Navigation", "Operate"]);
        expect(options(rows[0].querySelector("select")!)).toEqual(["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Fa"]);
        expect($$('[data-id="skillsRight"] tr:not([data-id])').map(r => r.textContent)).toContain("Forbidden Lore");
    });

    it("calls its psykana Magic and its powers spells", () => {
        loadState({ psykana: { basePR: 2, tabs: { items: { t1: { name: "Tab", powers: { items: { s1: {} }, layouts: { s1: { colIndex: 0, rowIndex: 0 } } } } },
            layouts: { t1: { colIndex: 0, rowIndex: 0 } } } } }, pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<Psykana />);
        const text = rendered.container.textContent!;
        expect($$("h2").map(h => h.textContent)).toContain("Magic");
        expect(text).toContain("Gift:");
        expect(text).toContain("Sustained Spells:");
        expect(text).not.toMatch(/psyker|Psykana|Powers/);
    });

    it("has the Arcane gift, which cannot push", () => {
        const spell = { name: "Bolt", roll: { effectivePR: 3, kickPR: 2 }, cast: { pr: 5, kick: 2 } };
        const psykana = (psykanaType: string) => ({ psykana: {
            psykanaType, basePR: 3, lastCastPower: "s1",
            tabs: { items: { t1: { powers: { items: { s1: spell }, layouts: { s1: { colIndex: 0, rowIndex: 0 } } } } }, layouts: { t1: { colIndex: 0, rowIndex: 0 } } },
        } });
        const roll = "psykana.tabs.items.t1.powers.items.s1.roll";

        const state = loadState(psykana("Arcane"), pathfinderCrusade);
        attachComputeds(state);
        expect([canPush(state), rollKick(state, roll)]).toEqual([false, 0]);
        expect(phenomena(state).parts.find(p => p.key === "nature")!.value).toBe(0);
        rendered = renderBlock(<Psykana />);
        expect(options(rendered.container.querySelector('[data-id="psykanaType"]')!)).toEqual(["Arcane", "Bound", "Unbound", "Daemonic"]);

        expect(rollKick(loadState(psykana("Bound"), pathfinderCrusade), roll)).toBe(2);
        // Black Crusade has no Arcane gift: the select shows its first one.
        expect(loadState(psykana("Arcane"), blackCrusade).psykana.psykanaType.value).toBe("Bound");
    });

    it("lays out Magic for Psykana, Fame Points for Infamy and no Techno Arcana", () => {
        loadState({}, pathfinderCrusade);
        const ui = new SheetUiState();
        ui.selectedTabSignal("navigation-tabs").value = "show-combat";
        rendered = renderBlock(<PathfinderCrusade />, { ui });
        expect($$(".tablabel").map(l => l.textContent)).toEqual(["Player Sheet", "Combat", "Talents", "Gear", "Advancements", "Magic"]);
        expect($$("#combat h3").map(h => h.textContent)).toContain("Fame Points");

        act(() => $$(".initiative-dropdown-toggle")[0].click());
        expect($$('[data-id="initiative"] fieldset label').map(l => l.textContent!.trim())).toEqual(
            ["WS.b", "BS.b", "S.b", "T.b", "A.b", "I.b", "P.b", "W.b", "F.b", "Fa.b"]);
    });
});
