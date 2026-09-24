import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { resolvePath } from "../state/sync.js";
import { registerStatePaths } from "../state/migrated";
import { applyRemoteToState } from "../state/remote";
import { resetUiState } from "../state/ui";
import { teardownSheet } from "../lifecycle";
import { setupToggleAll } from "../behaviour.js";
import { joinPath, usePath } from "./context";
import { useCollapsible, ToggleButton } from "./Collapsible";
import { DeleteButton, DragHandle } from "./ItemControls";
import { Dropdown } from "./Dropdown";
import { TextArea, TextField } from "./fields";
import { ItemGrid } from "./ItemGrid";
import { mountBlock, setBlockEnv } from "./mount";
import { Scope } from "./Scope";
import { Tabs } from "./Tabs";
import { loadState, recordingActions, renderBlock, type Rendered } from "./testUtils";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;

function Talent({ itemId }: { itemId: string }) {
    const path = joinPath(usePath(), itemId);
    const { collapsed, toggle, elRef } = useCollapsible(path, {
        hasContent: () => String(value(`${path}.description`) ?? "").trim() !== "",
    });
    return (
        <Scope dataId={itemId} class={collapsed ? "item-with-description collapsed" : "item-with-description"} elRef={elRef}>
            <div class="split-header">
                <TextField field="name" />
                <ToggleButton onToggle={toggle} />
                <DragHandle />
                <DeleteButton itemPath={path} />
            </div>
            <div class="collapsible-content">
                <TextArea field="description" class="split-description" />
            </div>
        </Scope>
    );
}

const talents = () => (
    <ItemGrid dataId="talents.list.items" id="talents" columns={3} renderItem={id => <Talent itemId={id} />} />
);

const columnIds = (container: Element) =>
    Array.from(container.querySelectorAll("#talents > .layout-column"), col =>
        Array.from(col.querySelectorAll(":scope > .item-with-description"), el => (el as HTMLElement).dataset.id));

let rendered: Rendered | null = null;
let unregister = () => {};

beforeEach(() => {
    loadState({
        talents: {
            list: {
                items: { a: { name: "A", description: "text" }, b: { name: "B" }, c: { name: "C" }, d: { name: "D" } },
                layouts: { a: pos(0, 0), b: pos(1, 0), ghost: pos(0, 1) },
            },
        },
    });
    unregister = registerStatePaths(["talents"]);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    unregister();
    resetUiState();
    teardownSheet();
    document.body.innerHTML = "";
});

describe("ItemGrid", () => {
    it("renders columns from the layouts, placing unpositioned items like the server", () => {
        rendered = renderBlock(talents());
        const grid = rendered.container.querySelector("#talents")!;
        expect(grid.getAttribute("data-id")).toBe("talents.list.items");
        expect(grid.className).toBe("item-grid");
        // c and d have no position: c goes to the empty column 2, d to row 1 of column 0.
        expect(columnIds(rendered.container)).toEqual([["a", "d"], ["b"], ["c"]]);
        expect(grid.querySelectorAll(":scope > .layout-column > .add-slot > .add-button")).toHaveLength(3);
    });

    it("creates an item from the factory at the end of the column", () => {
        const actions = recordingActions();
        rendered = renderBlock(talents(), { actions });
        const addButtons = rendered.container.querySelectorAll<HTMLButtonElement>(".add-button");

        act(() => addButtons[1].click());

        const msg = actions.sent.at(-1) as { itemId: string; itemPos: unknown; init: unknown; path: string };
        expect(msg.path).toBe("talents.list.items");
        expect(msg.itemId).toMatch(/^talents-/);
        expect(msg.itemPos).toEqual(pos(1, 1));
        expect(msg.init).toEqual({ name: "", description: "" });
        expect(columnIds(rendered.container)[1]).toEqual(["b", msg.itemId]);
        expect(value(`talents.list.items.${msg.itemId}.name`)).toBe("");
    });

    it("follows remote creates, deletes and positions, moving the same DOM nodes", () => {
        rendered = renderBlock(talents());
        const nodeA = rendered.container.querySelector('[data-id="a"]');

        act(() => {
            applyRemoteToState({ type: "createItem", path: "talents.list.items", itemId: "e", itemPos: pos(2, 0), init: { name: "E" } });
        });
        // e takes column 2; c and d have no position and fill the short columns.
        expect(columnIds(rendered.container)).toEqual([["a", "c"], ["b", "d"], ["e"]]);
        expect(rendered.container.querySelector<HTMLInputElement>('[data-id="e"] [data-id="name"]')!.value).toBe("E");

        act(() => {
            applyRemoteToState({ type: "positionsChanged", path: "talents.list.items", positions: { d: pos(0, 0), a: pos(0, 1) } });
        });
        expect(columnIds(rendered.container)[0]).toEqual(["d", "a"]);
        expect(rendered.container.querySelector('[data-id="a"]')).toBe(nodeA);

        act(() => { applyRemoteToState({ type: "deleteItem", path: "talents.list.items.d" }); });
        expect(rendered.container.querySelector('[data-id="d"]')).toBeNull();
    });

    it("deletes an item with its delete button", () => {
        const actions = recordingActions();
        rendered = renderBlock(talents(), { actions });
        act(() => rendered!.container.querySelector<HTMLButtonElement>('[data-id="b"] .delete-button')!.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: "talents.list.items.b" });
        expect(rendered.container.querySelector('[data-id="b"]')).toBeNull();
    });

    it("has no add, drag or delete controls without edit rights", () => {
        rendered = renderBlock(talents(), { canEdit: false });
        expect(rendered.container.querySelectorAll(".add-slot")).toHaveLength(3);
        expect(rendered.container.querySelector(".add-button, .drag-handle, .delete-button")).toBeNull();
    });
});

describe("collapsible items", () => {
    it("start collapsed without content and toggle", () => {
        rendered = renderBlock(talents());
        const a = rendered.container.querySelector('[data-id="a"]')!;
        const b = rendered.container.querySelector('[data-id="b"]')!;
        expect(a.classList.contains("collapsed")).toBe(false);
        expect(b.classList.contains("collapsed")).toBe(true);

        act(() => b.querySelector<HTMLButtonElement>(".toggle-button")!.click());
        expect(b.classList.contains("collapsed")).toBe(false);
    });

    it("expand on a remote batch", () => {
        rendered = renderBlock(talents());
        const b = rendered.container.querySelector('[data-id="b"]')!;
        act(() => { applyRemoteToState({ type: "batch", path: "talents.list.items.b", changes: { description: "new" } }); });
        expect(b.classList.contains("collapsed")).toBe(false);
        expect(b.querySelector("textarea")!.value).toBe("new");
    });

    it("follow Toggle Descs through their signal", () => {
        const host = document.createElement("div");
        host.id = "charactersheet";
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `
            <div class="container">
                <div class="controls-block"><button class="toggle-descriptions"></button></div>
                <input class="radiotab" type="radio" name="toggle" checked><label class="tablabel"></label>
                <div class="panel"><div id="mount"></div></div>
            </div>`;
        setBlockEnv({ canEdit: true, actions: recordingActions(), autocomplete: null });
        act(() => mountBlock(root.getElementById("mount")!, talents(), { paths: [] }));
        setupToggleAll(root.querySelector(".container"));
        const toggleAll = root.querySelector<HTMLButtonElement>(".toggle-descriptions")!;
        const collapsed = () => Array.from(root.querySelectorAll(".item-with-description"),
            el => el.classList.contains("collapsed"));

        // Only a has content and it is open: everything collapses.
        expect(collapsed()).toEqual([false, true, true, true]);
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([true, true, true, true]);
        // Now an item with content is collapsed: those with content expand.
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([false, true, true, true]);
    });
});

describe("Tabs", () => {
    let unregisterTabs = () => {};
    afterEach(() => unregisterTabs());
    beforeEach(() => {
        unregisterTabs = registerStatePaths(["psykana"]);
        loadState({
            psykana: {
                tabs: {
                    items: { t1: { name: "Biomancy" }, t2: { name: "Divination" } },
                    layouts: { t1: pos(0, 1), t2: pos(0, 0) },
                },
            },
        });
    });

    const tabs = () => (
        <Scope dataId="psykana">
            <Tabs
                dataId="tabs.items"
                group="psykana-tabs"
                class="power-tabs"
                renderLabel={() => <TextField field="name" />}
                renderPanel={id => <span class="panel-content">{id}</span>}
            />
        </Scope>
    );

    const radios = (c: Element) => Array.from(c.querySelectorAll<HTMLInputElement>(".radiotab"));

    it("renders radio, label and panel per tab in layout order, the first one open", () => {
        rendered = renderBlock(tabs());
        const container = rendered.container.querySelector(".tabs")!;
        expect(Array.from(container.children, el => el.className))
            .toEqual(["radiotab", "tablabel", "panel", "radiotab", "tablabel", "panel", "add-tab-btn"]);
        expect(radios(container).map(r => [r.id, r.checked, r.name])).toEqual([
            ["t2", true, "psykana-tabs"],
            ["t1", false, "psykana-tabs"],
        ]);
        const label = container.querySelector<HTMLLabelElement>("label.tablabel")!;
        expect(label.htmlFor).toBe("t2");
        expect(label.querySelector<HTMLInputElement>('[data-id="name"]')!.value).toBe("Divination");
    });

    it("opens a tab whose radio changes, as a drag over its label does", () => {
        rendered = renderBlock(tabs());
        const [, second] = radios(rendered.container);
        act(() => {
            second.checked = true;
            second.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
        });
        expect(radios(rendered.container).map(r => r.checked)).toEqual([false, true]);
    });

    it("opens a new tab and falls back to the last one when the open tab is deleted", () => {
        const actions = recordingActions();
        rendered = renderBlock(tabs(), { actions });
        act(() => rendered!.container.querySelector<HTMLButtonElement>(".add-tab-btn")!.click());
        const created = (actions.sent.at(-1) as { itemId: string; itemPos: unknown }).itemId;
        expect((actions.sent.at(-1) as { itemPos: unknown }).itemPos).toEqual(pos(0, 2));
        expect(radios(rendered.container).map(r => [r.id, r.checked])).toEqual([["t2", false], ["t1", false], [created, true]]);

        act(() => rendered!.container.querySelector<HTMLButtonElement>(`label[for="${created}"] .delete-button`)!.click());
        expect(radios(rendered.container).map(r => [r.id, r.checked])).toEqual([["t2", false], ["t1", true]]);
    });
});

describe("Dropdown", () => {
    it("opens with its toggle and closes on a click outside, but not on the sheet controls", () => {
        rendered = renderBlock(
            <div>
                <button id="toggle-descriptions">Toggle Descs</button>
                <p id="outside">outside</p>
                <Dropdown class="characteristics" toggleClass="char-dropdown-toggle" dropdownClass="characteristics-dropdown"
                    toggle={open => (open ? "▲" : "▼")}>
                    <span id="inside">content</span>
                </Dropdown>
            </div>,
        );
        const c = rendered.container;
        const toggle = c.querySelector<HTMLButtonElement>(".char-dropdown-toggle")!;
        const dropdown = c.querySelector(".characteristics-dropdown")!;

        act(() => toggle.click());
        expect(dropdown.classList.contains("visible")).toBe(true);
        expect(toggle.classList.contains("active")).toBe(true);
        expect(toggle.textContent).toBe("▲");

        act(() => c.querySelector<HTMLElement>("#inside")!.click());
        act(() => c.querySelector<HTMLElement>("#toggle-descriptions")!.click());
        expect(dropdown.classList.contains("visible")).toBe(true);

        act(() => c.querySelector<HTMLElement>("#outside")!.click());
        expect(dropdown.classList.contains("visible")).toBe(false);
        expect(toggle.textContent).toBe("▼");
    });
});
