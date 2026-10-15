import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath } from "../state/sync";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (items: Record<string, object>) => ({ items, layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])) });

/** A caster of I 40, W 30 and P 25 ticking `ticked`, of `spells` on the Magic test options Cast and W. */
const content = (ticked: string[], spells: Record<string, object>, over: object = {}) => ({
    characteristics: { I: { value: "40" }, W: { value: "30" }, P: { value: "25" } },
    spellcasting: Object.fromEntries(ticked.map(key => [key, true])),
    psykana: {
        testOptions: grid({ o1: { base: "cast" }, o2: { base: "W" } }),
        tabs: grid({ t1: { name: "Tab", powers: grid(spells) } }),
    },
    ...over,
});
const cast = (over: object = {}) => ({ roll: { testOption: "o1", ...over } });

let rendered: Rendered | null = null;

function show(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
    rendered = renderBlock(<Psykana />);
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const openRoll = (id: string) => act(() => $(`[data-id="${id}"] .name label`)!.click());
const inRoll = <E extends HTMLElement = HTMLElement>(id: string, field: string) => $<E>(`[data-id="${id}"] [data-id="roll"] [data-id="${field}"]`);
/** What the roll of spell `id` is tested on, as its select shows it, and its total. */
const test = (id: string) => {
    const select = inRoll<HTMLSelectElement>(id, "testOption")!;
    return [select.options[select.selectedIndex].text, Number(inRoll<HTMLInputElement>(id, "total")!.value)];
};

describe("the Magic test option Cast", () => {
    it("reads as I for a spell of Arcane Spellcasting, W otherwise", () => {
        show(content(["arcane"], { s1: { name: "Bolt", ...cast() } }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (I)", 40]);
        const select = inRoll<HTMLSelectElement>("s1", "testOption")!;
        expect(Array.from(select.options, o => o.text)).toEqual(["Cast (I)", "W"]);

        act(() => updateSignalAtPath(testState(), "spellcasting.arcane", false));
        act(() => updateSignalAtPath(testState(), "spellcasting.spontaneous", true));
        expect(test("s1")).toEqual(["Cast (W)", 30]);
        // Nothing ticked: W.
        act(() => updateSignalAtPath(testState(), "spellcasting.spontaneous", false));
        expect(test("s1")).toEqual(["Cast (W)", 30]);
    });

    it("reads each spell of a cleric-wizard as the characteristic of its own variant", () => {
        show(content(["arcane", "divine"], { s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (I)", 40]);
        openRoll("s2");
        expect(test("s2")).toEqual(["Cast (W)", 30]);
    });

    it("reads as the characteristic it names, for every spell", () => {
        show(content(["arcane", "divine"], { s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }, {
            psykana: {
                testOptions: grid({ o1: { base: "cast", characteristic: "P" } }),
                tabs: grid({ t1: { name: "Tab", powers: grid({ s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }) } }),
            },
        }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (P)", 25]);
        openRoll("s2");
        expect(test("s2")).toEqual(["Cast (P)", 25]);
    });

    it("is offered first under the ⚙ of Magic, and not in Black Crusade", () => {
        const bases = () => {
            act(() => $<HTMLButtonElement>(".block-settings-toggle")!.click());
            const select = $<HTMLSelectElement>('[data-id="o2"] [data-id="base"]')!;
            act(() => { select.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
            return [Array.from(select.querySelectorAll("optgroup"), g => g.label)[0], select.options[0].value];
        };
        show(content([], {}));
        expect(bases()).toEqual(["Spellcasting", "cast"]);
        expect($('[data-id="o1"] [data-id="characteristic"]')!.title).toBe("Tested on; — for the characteristic of each spell's Spellcasting");
        rendered!.unmount();
        teardownSheet();

        show(content([], {}), blackCrusade);
        expect(bases()).toEqual(["Characteristics", "WS"]);
    });
});
