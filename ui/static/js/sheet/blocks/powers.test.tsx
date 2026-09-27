import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import Sortable from "sortablejs";
import { flush, loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { isFrozen, resetDragFreeze } from "../state/dragFreeze";
import { applyRemoteToState } from "../state/remote";
import { resetUiState } from "../state/ui";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const TABS = "psykana.tabs.items";
const powers = (tab: string) => `${TABS}.${tab}.powers.items`;

let rendered: Rendered;
let actions: ReturnType<typeof recordingActions>;

beforeEach(() => {
    loadState({
        psykana: {
            tabs: {
                items: {
                    t1: { name: "Biomancy", powers: { items: { p1: { name: "Smite", roll: { testOption: "o1" } }, p2: { name: "Haemorrhage" } }, layouts: { p1: pos(0, 0), p2: pos(0, 1) } } },
                    t2: { name: "Telepathy", powers: { items: { p3: { name: "Dominate" } }, layouts: { p3: pos(1, 0) } } },
                },
                layouts: { t1: pos(0, 0), t2: pos(0, 1) },
            },
        },
    });
    actions = recordingActions();
    rendered = renderBlock(<Psykana />, { actions });
});

afterEach(() => {
    rendered.unmount();
    resetUiState();
    resetDragFreeze();
    teardownSheet();
});

const $ = <E extends Element = HTMLElement>(selector: string) => rendered.container.querySelector<E>(selector)!;
const tabs = () => $(".power-tabs");
const columns = (tab: string) => Array.from(rendered.container.querySelectorAll<HTMLElement>(`#psychic-powers-${tab} > .layout-column`));
const ids = (tab: string) => columns(tab).map(col => Array.from(col.querySelectorAll<HTMLElement>(":scope > .psychic-power"), el => el.dataset.id));
const labels = () => Array.from(tabs().querySelectorAll<HTMLElement>(":scope > .tablabel"), el => el.dataset.id);
// Sortable calls these from its pointer handlers; happy-dom cannot drag.
const options = (el: HTMLElement) => Sortable.get(el)!.options as Required<Sortable.Options>;
const event = (e: object) => e as unknown as Sortable.SortableEvent;

describe("dragging a power into another tab", () => {
    it("moves it, sends the complete layout of the target grid and keeps that tab open", () => {
        const [from] = columns("t1");
        const to = columns("t2")[1];
        const p1 = $(`[data-id="p1"]`);
        act(() => options(from).onStart(event({ item: p1, from })));
        // All tabs of the block freeze: the power can land in any of them.
        expect(isFrozen(TABS)).toBe(true);

        // What Sortable does: p1 goes above p3.
        to.insertBefore(p1, to.firstChild);
        act(() => options(from).onEnd(event({ item: p1, from, to })));

        expect(isFrozen(TABS)).toBe(false);
        expect(actions.sent.at(-1)).toEqual({
            type: "moveItemBetweenGrids", fromPath: powers("t1"), toPath: powers("t2"), itemId: "p1", toPosition: pos(1, 0),
        });
        // The server stores only p1's position, which p3 holds too.
        expect(actions.scheduled.at(-1)![0]).toEqual({
            type: "positionsChanged", path: powers("t2"), positions: { p1: pos(1, 0), p3: pos(1, 1) },
        });
        expect(ids("t1")).toEqual([["p2"], []]);
        expect(ids("t2")).toEqual([[], ["p1", "p3"]]);
        expect(rendered.container.querySelectorAll('[data-id="p1"]')).toHaveLength(1);
        expect($<HTMLInputElement>("input.radiotab#t2").checked).toBe(true);
    });

    it("drops the move when a remote change deleted the target tab meanwhile", () => {
        const [from] = columns("t1");
        const to = columns("t2")[0];
        const p1 = $(`[data-id="p1"]`);
        act(() => options(from).onStart(event({ item: p1, from })));
        act(() => { applyRemoteToState({ type: "deleteItem", path: `${TABS}.t2` }); });
        // The deletion waits for the drop.
        expect(labels()).toEqual(["t1", "t2"]);

        to.appendChild(p1);
        act(() => options(from).onEnd(event({ item: p1, from, to })));

        expect(actions.sent).toEqual([]);
        expect(labels()).toEqual(["t1"]);
        expect(ids("t1")).toEqual([["p1", "p2"], []]);
    });
});

describe("sorting the tabs", () => {
    it("holds remote changes to the tabs until the drop and sends the order with them", () => {
        const t2 = $('.tablabel[data-id="t2"]');
        act(() => options(tabs()).onStart(event({ item: t2 })));
        expect(isFrozen(TABS)).toBe(true);
        act(() => {
            applyRemoteToState({ type: "createItem", path: TABS, itemId: "t3", itemPos: pos(0, 2), init: { name: "Divination" } });
        });
        expect(labels()).toEqual(["t1", "t2"]);

        // What Sortable does: t2's label goes before t1's.
        tabs().insertBefore(t2, $('.tablabel[data-id="t1"]'));
        act(() => options(tabs()).onEnd(event({ item: t2 })));

        expect(actions.scheduled.at(-1)![0]).toEqual({
            type: "positionsChanged", path: TABS, positions: { t2: pos(0, 0), t1: pos(0, 1), t3: pos(0, 2) },
        });
        expect(labels()).toEqual(["t2", "t1", "t3"]);
    });
});

describe("a power's roll", () => {
    it("opens from the name label, stays open on a click in the power and closes on a click outside it", async () => {
        const p1 = $('[data-id="p1"]');
        const dropdown = p1.querySelector<HTMLElement>('[data-id="roll"]')!;
        act(() => p1.querySelector<HTMLElement>(".name label")!.click());
        await flush();
        expect(dropdown.classList.contains("visible")).toBe(true);

        act(() => p1.querySelector<HTMLElement>('[data-id="range"]')!.click());
        expect(dropdown.classList.contains("visible")).toBe(true);

        act(() => document.body.click());
        expect(dropdown.classList.contains("visible")).toBe(false);
    });
});
