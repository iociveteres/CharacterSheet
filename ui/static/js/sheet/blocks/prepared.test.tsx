import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { resolvePath, valueAt } from "../state/sync";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";

/** A Bound caster of `spells`, by id. */
const content = (spells: Record<string, object>, over: object = {}) => ({
    characteristics: { W: { value: "40" }, I: { value: "30" } },
    psykana: {
        psykanaType: "Bound",
        basePR: 2,
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: { t1: { name: "Tab", powers: { items: spells, layouts: Object.fromEntries(Object.keys(spells).map((id, i) => [id, pos(i % 2, i >> 1)])) } } },
            layouts: { t1: pos(0, 0) },
        },
    },
    ...over,
});

let rendered: Rendered | null = null;

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);

describe("the prepared spells of a Pathfinder Crusade sheet", () => {
    it("are marked on the spell, which a Black Crusade power has no field for", () => {
        load(content({ s1: { name: "Bolt", prepared: true }, s2: { name: "Ward" } }));
        expect([valueAt(testState(), `${POWERS}.s1.prepared`), valueAt(testState(), `${POWERS}.s2.prepared`)]).toEqual([true, false]);
        expect(valueAt(testState(), "settings.psykana.prepared")).toBe(true);

        load(content({ s1: { name: "Bolt", prepared: true } }), blackCrusade);
        expect("prepared" in (resolvePath(testState(), `${POWERS}.s1`) as object)).toBe(false);
        expect("prepared" in testState().settings.psykana).toBe(false);
    });

    it("start unprepared on a new spell, made by the item of the kind", () => {
        const added = () => {
            act(() => $<HTMLButtonElement>('[data-id="powers.items"] .add-button')!.click());
            const items = resolvePath(testState(), POWERS) as Record<string, object>;
            return items[Object.keys(items).find(id => id !== "s1")!];
        };
        load(content({ s1: { name: "Bolt" } }));
        rendered = renderBlock(<Psykana />);
        expect(added()).toHaveProperty("prepared.value", false);
        rendered.unmount();
        teardownSheet();

        load(content({ s1: { name: "Bolt" } }), blackCrusade);
        rendered = renderBlock(<Psykana />);
        expect(added()).not.toHaveProperty("prepared");
    });
});
