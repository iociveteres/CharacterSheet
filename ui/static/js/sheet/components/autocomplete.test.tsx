import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { AutocompleteField } from "./AutocompleteField";
import { joinPath, usePath, type AutocompleteResult } from "./context";
import { Scope } from "./Scope";
import { loadState, recordingActions, recordingAutocomplete, renderBlock, teardownSheet, type Rendered } from "./testUtils";

function Talent({ itemId, renderOption }: { itemId: string; renderOption?: (r: AutocompleteResult) => ComponentChildren }) {
    const path = joinPath(usePath(), itemId);
    return (
        <Scope dataId={itemId} class="item-with-description">
            <AutocompleteField field="name" itemPath={path} collection="talents" renderOption={renderOption} />
        </Scope>
    );
}

describe("AutocompleteField", () => {
    let rendered: Rendered | null = null;
    let autocomplete: ReturnType<typeof recordingAutocomplete>;
    let actions: ReturnType<typeof recordingActions>;

    beforeEach(() => {
        vi.useFakeTimers();
        loadState({ talents: { list: { items: { t1: { name: "Amb" }, t2: { name: "" } } } } });
        autocomplete = recordingAutocomplete();
        actions = recordingActions();
    });

    afterEach(() => {
        rendered?.unmount();
        rendered = null;
        teardownSheet();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    const show = () => {
        rendered = renderBlock(<><Talent itemId="t1" /><Talent itemId="t2" /></>, { path: "talents.list.items", actions, autocomplete });
    };
    const input = (itemId: string) => rendered!.container.querySelector<HTMLInputElement>(`[data-id="${itemId}"] [data-id="name"]`)!;
    const dropdown = (itemId: string) => rendered!.container.querySelector(`[data-id="${itemId}"] .autocomplete-dropdown`);
    const options = (itemId: string) => Array.from(dropdown(itemId)?.querySelectorAll(".autocomplete-option") ?? []);

    function type(itemId: string, text: string, pause = 250) {
        const el = input(itemId);
        el.value = text;
        act(() => {
            el.dispatchEvent(new Event("input", { bubbles: true }));
            vi.advanceTimersByTime(pause);
        });
    }

    function answer(results: AutocompleteResult[], query = autocomplete.queries.at(-1)!) {
        act(() => {
            document.dispatchEvent(new CustomEvent("ws:autocompleteResult", {
                detail: { type: "autocompleteResult", eventID: query.eventID, results },
            }));
        });
    }

    const key = (itemId: string, k: string) => act(() => {
        input(itemId).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    });

    it("queries the collection once typing pauses, shows the results next to the field and applies the pick", () => {
        show();
        type("t1", "Am", 100);
        type("t1", "Ambi");
        expect(autocomplete.queries).toMatchObject([{ type: "autocomplete", collection: "talents", query: "Ambi" }]);

        answer([{ name: "Ambidextrous" }, { name: "Ambush", name_ru: "Засада" }]);
        const anchor = input("t1").nextElementSibling!;
        expect(anchor.classList.contains("autocomplete-anchor")).toBe(true);
        expect(anchor.querySelector(".autocomplete-dropdown")).not.toBeNull();
        expect(options("t1").map(o => o.textContent)).toEqual(["Ambidextrous", "Ambush / Засада"]);

        act(() => {
            options("t1")[1].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        });
        expect(actions.sent.at(-1)).toEqual({
            type: "autocompleteApply", path: "talents.list.items.t1", collection: "talents", name: "Ambush", base: {},
        });
        expect(dropdown("t1")).toBeNull();
        // The field waits for autocompleteApplied.
        expect(input("t1").value).toBe("Ambi");
    });

    it("renders the results as text", () => {
        show();
        type("t1", "x");
        answer([{ name: `<img src="x" onerror="alert(1)">` }]);
        expect(dropdown("t1")!.querySelector("img")).toBeNull();
        expect(options("t1")[0].textContent).toBe(`<img src="x" onerror="alert(1)">`);
    });

    it("walks the options with the arrows, picks with Enter and closes with Escape", () => {
        show();
        type("t1", "Am");
        answer([{ name: "A" }, { name: "B" }, { name: "C" }]);
        const active = () => options("t1").findIndex(o => o.classList.contains("active"));

        expect(active()).toBe(-1);
        key("t1", "ArrowDown");
        key("t1", "ArrowDown");
        key("t1", "ArrowDown");
        key("t1", "ArrowDown");
        expect(active()).toBe(2);
        key("t1", "ArrowUp");
        expect(active()).toBe(1);
        key("t1", "Enter");
        expect(actions.sent.at(-1)).toMatchObject({ type: "autocompleteApply", name: "B" });
        expect(dropdown("t1")).toBeNull();

        type("t1", "Am");
        answer([{ name: "A" }]);
        key("t1", "Escape");
        expect(dropdown("t1")).toBeNull();
    });

    it("shows the results of the latest query only, under the field typed in last", () => {
        show();
        type("t1", "Am");
        const first = autocomplete.queries.at(-1)!;
        answer([{ name: "A" }]);
        type("t2", "Bo");
        answer([{ name: "Stale" }], first);
        expect(options("t1").map(o => o.textContent)).toEqual(["A"]);

        answer([{ name: "Bolt" }]);
        expect(dropdown("t1")).toBeNull();
        expect(options("t2").map(o => o.textContent)).toEqual(["Bolt"]);
    });

    it("closes when the text gets too short, on a pointer down outside, and not on one in the field", () => {
        show();
        type("t1", "Am");
        answer([{ name: "A" }]);
        type("t1", " ");
        expect(dropdown("t1")).toBeNull();
        // The answer to the dropped query does not reopen it.
        answer([{ name: "A" }]);
        expect(dropdown("t1")).toBeNull();

        type("t1", "Am");
        answer([{ name: "A" }]);
        act(() => { input("t1").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true })); });
        expect(dropdown("t1")).not.toBeNull();
        act(() => { document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true })); });
        expect(dropdown("t1")).toBeNull();
    });

    it("renders the option the owner gives", () => {
        rendered = renderBlock(<Talent itemId="t1" renderOption={r => <b class="custom">{r.name}!</b>} />,
            { path: "talents.list.items", actions, autocomplete });
        type("t1", "Am");
        answer([{ name: "A" }]);
        expect(options("t1")[0].innerHTML).toBe(`<b class="custom">A!</b>`);
    });

    it("drops the results when the field goes away", () => {
        show();
        type("t1", "Am");
        answer([{ name: "A" }]);
        rendered!.unmount();
        rendered = null;
        expect(autocomplete.suggestions.value).toBeNull();
    });
});
