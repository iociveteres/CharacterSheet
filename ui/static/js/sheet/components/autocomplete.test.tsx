import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { Autocomplete } from "../autocomplete.js";
import { joinPath, usePath } from "./context";
import { TextField } from "./fields";
import { Scope } from "./Scope";
import { AutocompleteAnchor, useAutocomplete } from "./useAutocomplete";
import { loadState, recordingActions, renderBlock, type Rendered } from "./testUtils";

function Talent({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { inputRef, anchorRef } = useAutocomplete(path, "talents", r => `<span class="ac-name">${r.name}</span>`);
    return (
        <Scope dataId={itemId} class="item-with-description">
            <TextField field="name" inputRef={inputRef} />
            <AutocompleteAnchor anchorRef={anchorRef} />
        </Scope>
    );
}

describe("useAutocomplete", () => {
    let rendered: Rendered | null = null;
    let root: ShadowRoot;
    let sent: string[];
    let autocomplete: InstanceType<typeof Autocomplete>;

    beforeEach(() => {
        vi.useFakeTimers();
        loadState({ talents: { list: { items: { t1: { name: "Amb" } } } } });
        // autocomplete.js puts its dropdown into the sheet's shadow root.
        const host = document.createElement("div");
        host.id = "charactersheet";
        document.body.appendChild(host);
        root = host.attachShadow({ mode: "open" });
        sent = [];
        autocomplete = new Autocomplete({
            socket: { send: (m: string) => sent.push(m) } as unknown as WebSocket,
            root: root as unknown as HTMLElement,
        });
    });

    afterEach(() => {
        rendered?.unmount();
        rendered = null;
        autocomplete.destroy();
        vi.useRealTimers();
        document.body.innerHTML = "";
    });

    it("queries the collection, shows results in the anchor and applies the pick to the item", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Talent itemId="t1" />, { path: "talents.list.items", actions, autocomplete });
        // Move the block into the shadow root, where the sheet lives.
        root.appendChild(rendered.container);

        const input = rendered.container.querySelector<HTMLInputElement>('[data-id="name"]')!;
        input.value = "Ambi";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);

        const query = JSON.parse(sent.at(-1)!);
        expect(query).toMatchObject({ type: "autocomplete", collection: "talents", query: "Ambi" });

        document.dispatchEvent(new CustomEvent("sheet:autocompleteResult", {
            detail: { requestId: query.eventID, results: [{ name: "Ambidextrous" }] },
        }));

        const anchor = rendered.container.querySelector(".autocomplete-anchor")!;
        const dropdown = anchor.querySelector<HTMLElement>(".autocomplete-dropdown")!;
        expect(dropdown).not.toBeNull();
        expect(dropdown.textContent).toBe("Ambidextrous");

        act(() => {
            dropdown.querySelector(".autocomplete-option")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
        });
        expect(actions.sent.at(-1)).toEqual({
            type: "autocompleteApply", path: "talents.list.items.t1", collection: "talents", name: "Ambidextrous",
            base: { name: "", description: "" },
        });
        // The field waits for autocompleteApplied.
        expect(input.value).toBe("Ambi");
    });

    it("unregisters the input when the item goes away", () => {
        const unregister = vi.spyOn(autocomplete, "unregister");
        rendered = renderBlock(<Talent itemId="t1" />, { path: "talents.list.items", autocomplete });
        const input = rendered.container.querySelector("input");
        rendered.unmount();
        rendered = null;
        expect(unregister).toHaveBeenCalledWith(input);
    });
});
