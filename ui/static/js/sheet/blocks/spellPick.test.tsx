import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import {
    loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, teardownSheet, testState, type Rendered,
} from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const S1 = "psykana.tabs.items.t1.powers.items.s1";

let rendered: Rendered | null = null;

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

/** Picks `result` for the spell s1 of a sheet of `kind` with the Magic test `options`; what the pick sends. */
function pick(kind: typeof pathfinderCrusade, options: Record<string, object>, result: { name: string; [key: string]: unknown }) {
    loadState({
        spellcasting: { arcane: true },
        skillsLeft: { deceive: { plus0: true } },
        psykana: {
            testOptions: { items: options, layouts: Object.fromEntries(Object.keys(options).map((id, i) => [id, pos(0, i)])) },
            tabs: { items: { t1: { name: "Spells", powers: { items: { s1: { name: "" } }, layouts: { s1: pos(0, 0) } } } }, layouts: { t1: pos(0, 0) } },
        },
    }, kind);
    attachComputeds(testState());
    const actions = recordingActions();
    const autocomplete = recordingAutocomplete();
    rendered = renderBlock(<Psykana />, { actions, autocomplete });
    pickSuggestion(autocomplete, rendered.container.querySelector<HTMLInputElement>(`[data-id="s1"] .name-field [data-id="name"]`)!, result);
    return actions.sent;
}

const applied = (sent: object[]) => sent.at(-1) as { type: string; path: string; base: { roll: Record<string, unknown> } };

describe("picking a spell from the autocomplete", () => {
    it("lays it over a new spell tested as its Magic test says", () => {
        const sent = pick(pathfinderCrusade, { cast: { base: "cast" }, w: { base: "W" } }, { name: "Terrify", psychotest: "W–20 vs W+0" });
        expect(sent).toHaveLength(1);
        expect(applied(sent)).toMatchObject({ type: "autocompleteApply", path: S1, base: { roll: { testOption: "w", modifier: -20 } } });
    });

    it("adds the test option the sheet has not before the pick, at the end of the options", () => {
        const sent = pick(pathfinderCrusade, { cast: { base: "cast" } }, { name: "Terrify", psychotest: "W–20 vs W+0" });
        const created = sent[0] as { type: string; path: string; itemId: string; init: object; itemPos: object };
        expect(created).toMatchObject({ type: "createItem", path: "psykana.testOptions.items", init: { base: "W", characteristic: "" }, itemPos: pos(0, 1) });
        expect(testState().psykana.testOptions.items[created.itemId].base.value).toBe("W");
        expect(applied(sent)).toMatchObject({ type: "autocompleteApply", base: { roll: { testOption: created.itemId, modifier: -20 } } });
    });

    it("tests an Arts spell on its skill, with the first option for its roll to show", () => {
        const sent = pick(pathfinderCrusade, { cast: { base: "cast" } },
            { name: "Delude (Bard)", subtypes: "Иллюзия, Arts (Bard)", psychotest: "Deceive(F) -10 vs W +0" });
        expect(applied(sent).base.roll).toMatchObject({ testOption: "cast", skill: "deceive", characteristic: "F", modifier: -10 });
    });

    it("reads the tests of Black Crusade powers too", () => {
        const sent = pick(blackCrusade, { psy: { base: "psyniscience" } }, { name: "Fearful Aura", psychotest: "W+20" });
        expect(sent[0]).toMatchObject({ type: "createItem", init: { base: "W", characteristic: "" } });
        expect(applied(sent).base.roll).toMatchObject({ testOption: (sent[0] as { itemId: string }).itemId, modifier: 20 });
    });
});

describe("the Magic test in the roll", () => {
    /** Opens the roll of the spell s1 tested on `test`; the text the roll shows, null without it. */
    function shown(test: string, spell: object = {}) {
        loadState({
            spellcasting: { arcane: true },
            skillsRight: { "1_trade": { name: "Musician", plus0: true } },
            psykana: {
                testOptions: { items: { cast: { base: "cast" } }, layouts: { cast: pos(0, 0) } },
                tabs: {
                    items: { t1: { name: "Spells", powers: { items: { s1: { name: "Spell", psychotest: test, roll: { testOption: "cast" }, ...spell } }, layouts: { s1: pos(0, 0) } } } },
                    layouts: { t1: pos(0, 0) },
                },
            },
        }, pathfinderCrusade);
        attachComputeds(testState());
        rendered?.unmount();
        rendered = renderBlock(<Psykana />);
        act(() => rendered!.container.querySelector<HTMLElement>(`[data-id="s1"] .name label`)!.click());
        const row = rendered.container.querySelector(`[data-id="s1"] [data-id="roll"] [data-id="testText"]`);
        return row ? [row.textContent, row.nextElementSibling!.textContent] : null;
    }

    it("shows the test of a PR spell while its modes are the player's or the roll is not set by it", () => {
        expect(shown("Cs+20/10/0 (vss S+0)")).toEqual(["Cs+20/10/0 (vss S+0)", "Set the Modifier by the mode"]);
        expect(shown("Cs+0/Cs–50")).toEqual(["Cs+0/Cs–50", "Set the Modifier by the mode"]);
        expect(shown("see the description")).toEqual(["see the description", "Pick the test and the Modifier by it"]);
        expect(shown("Cor+0")).toEqual(["Cor+0", "Pick the test and the Modifier by it"]);
        expect(shown("Cs–20")).toBeNull();
        expect(shown("")).toBeNull();
    });

    it("shows the test of an Arts spell while its modifier is not one number", () => {
        const arts = { subtypes: "Arts (Bard)", roll: { testOption: "cast", skill: "1_trade", characteristic: "F" } };
        expect(shown("Trade(Musician, Orator)(F) +20/-20 vs W +0", arts)).toEqual(["Trade(Musician, Orator)(F) +20/-20 vs W +0", "Set the Modifier by the mode"]);
        expect(shown("Trade(Musician)(F) -10", arts)).toBeNull();
    });
});
