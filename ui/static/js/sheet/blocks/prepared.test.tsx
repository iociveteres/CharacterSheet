import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { resolvePath, updateSignalAtPath, valueAt } from "../state/sync";
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
const toggle = (id: string) => $<HTMLButtonElement>(`[data-id="${id}"] [data-id="prepared"]`);
/** The card class of each spell: prepared, unprepared or neither. */
const marks = (...ids: string[]) => ids.map(id => {
    const card = $(`.psychic-power[data-id="${id}"]`)!.classList;
    return card.contains("prepared") ? "prepared" : card.contains("unprepared") ? "unprepared" : "";
});

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

    it("are toggled by the bookmark at the left of the header, the card marked either way", () => {
        load(content({ s1: { name: "Bolt", prepared: true }, s2: { name: "Ward", sustain: { copies: 1, pr: 2 } } }));
        rendered = renderBlock(<Psykana />);
        expect(marks("s1", "s2")).toEqual(["prepared", "unprepared"]);
        // First in the header, before the Name: label.
        expect($('[data-id="s1"] .name')!.firstElementChild).toBe(toggle("s1"));
        expect([toggle("s1")!.getAttribute("aria-pressed"), toggle("s1")!.classList.contains("active")]).toEqual(["true", true]);

        act(() => toggle("s2")!.click());
        act(() => toggle("s1")!.click());
        expect(marks("s1", "s2")).toEqual(["unprepared", "prepared"]);
        expect(rendered.env.actions).toHaveProperty("scheduled", [
            [{ type: "change", path: `${POWERS}.s2.prepared`, change: true }, `${POWERS}.s2.prepared`],
            [{ type: "change", path: `${POWERS}.s1.prepared`, change: false }, `${POWERS}.s1.prepared`],
        ]);
        // Preparing does not touch the sustaining.
        expect(valueAt(testState(), `${POWERS}.s2.sustain.copies`)).toBe(1);
    });

    it("cannot be toggled by a viewer", () => {
        load(content({ s1: { name: "Bolt", prepared: true } }));
        rendered = renderBlock(<Psykana />, { canEdit: false });
        expect(toggle("s1")!.disabled).toBe(true);
        expect(marks("s1")).toEqual(["prepared"]);
    });

    it("show nothing for a gift that does not prepare, while the rule is off, or on a Black Crusade sheet", () => {
        const spells = { s1: { name: "Bolt", prepared: true }, s2: { name: "Ward" } };
        const none = () => {
            rendered = renderBlock(<Psykana />);
            expect([toggle("s1"), toggle("s2")]).toEqual([null, null]);
            expect(marks("s1", "s2")).toEqual(["", ""]);
            rendered.unmount();
            rendered = null;
            teardownSheet();
        };
        load(content(spells));
        rendered = renderBlock(<Psykana />);
        act(() => updateSignalAtPath(testState(), "psykana.psykanaType", "Unbound"));
        expect([toggle("s1"), marks("s1", "s2")]).toEqual([null, ["", ""]]);
        rendered.unmount();
        teardownSheet();

        load(content(spells, { settings: { psykana: { prepared: false } } }));
        none();
        load(content(spells), blackCrusade);
        none();
    });
});
