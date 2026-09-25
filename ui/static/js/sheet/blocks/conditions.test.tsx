import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { setupToggleAll } from "../behaviour.js";
import { setBlockEnv } from "../components/mount";
import { loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import type { AutocompleteService } from "../components/context";
import { teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed.js";
import { applyRemoteToState } from "../state/remote";
import { characterState } from "../state/state.js";
import { getItemVersion, resolvePath, updateSignalAtPath } from "../state/sync.js";
import { resetUiState } from "../state/ui";
import { getDataPath } from "../utils.js";
import { Conditions } from "./Conditions";
import { mountBlocks } from "./index";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;
const C1 = "conditions.list.items.c1";

const content = () => ({
    characteristics: { WS: { value: "30" } },
    conditions: {
        list: {
            items: {
                c1: {
                    name: "Frenzy", enabled: true, stacks: 2,
                    entries: {
                        items: {
                            e1: { type: "char_bonus", name: "WS", bonus: "5", unnaturalBonus: "1" },
                            e2: { type: "skill_bonus", name: "Dodge", skillBonus: "10" },
                            e3: { type: "bonus_ap", apType: "daemonic", apValue: "2" },
                        },
                        layouts: { e1: pos(0, 0), e2: pos(0, 1), e3: pos(0, 2) },
                    },
                },
                c2: { name: "Empty", enabled: false, stacks: 0, entries: { items: {}, layouts: {} } },
            },
            layouts: { c1: pos(1, 0), c2: pos(0, 0) },
        },
    },
});

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState(content());
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

const $ = <E extends Element = HTMLInputElement>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const item = (id: string) => $<HTMLElement>(`[data-id="${id}"]`);
const entryIds = (conditionId: string) =>
    Array.from(item(conditionId).querySelectorAll<HTMLElement>(".condition-entry"), el => el.dataset.id);
const field = (itemId: string, name: string) => item(itemId).querySelector<HTMLInputElement>(`[data-id="${name}"]`);

describe("Conditions", () => {
    it("renders the conditions in their columns with every field at its state path", () => {
        const warn = vi.spyOn(console, "warn");
        rendered = renderBlock(<Conditions />);

        const grid = $<HTMLElement>("#conditions");
        expect(grid.dataset.id).toBe("conditions.list.items");
        const columns = Array.from(grid.querySelectorAll(":scope > .layout-column.condition-column"), col =>
            Array.from(col.querySelectorAll<HTMLElement>(":scope > .condition-item"), el => el.dataset.id));
        expect(columns).toEqual([["c2"], ["c1"]]);
        expect(Array.from(rendered.container.querySelectorAll(".copyable"), el => el.textContent)).toEqual(["▲", "▼"]);

        expect(field("c1", "enabled")!.checked).toBe(true);
        expect(field("c1", "name")!.value).toBe("Frenzy");
        expect(field("c1", "stacks")!.value).toBe("2");
        expect(field("c2", "enabled")!.checked).toBe(false);
        expect(entryIds("c1")).toEqual(["e1", "e2", "e3"]);
        expect(entryIds("c2")).toEqual([]);

        const bonus = field("e1", "bonus")!;
        expect(bonus.value).toBe("5");
        expect(getDataPath(bonus)).toBe(`${C1}.entries.items.e1.bonus`);
        expect(field("e1", "unnaturalBonus")!.value).toBe("1");
        expect(field("e3", "apType")!.value).toBe("daemonic");
        // Fields check their data-id path against the state path in dev builds.
        expect(warn).not.toHaveBeenCalled();
    });

    it("shows the name and the value fields of the entry type", () => {
        rendered = renderBlock(<Conditions />);
        const groups = (id: string) => Array.from(item(id).querySelectorAll(".entry-field-group"), el => el.classList[0]);

        expect(field("e1", "name")!.placeholder).toBe("Characteristic (e.g. WS)");
        expect(groups("e1")).toEqual(["value-char-bonus"]);
        expect(field("e2", "name")!.placeholder).toBe("Skill name");
        expect(groups("e2")).toEqual(["value-skill-bonus"]);
        // Armour points name no characteristic.
        expect(field("e3", "name")).toBeNull();
        expect(groups("e3")).toEqual(["value-bonus-ap"]);

        act(() => updateSignalAtPath(`${C1}.entries.items.e1.type`, "movement_bonus"));
        expect(field("e1", "name")).toBeNull();
        expect(groups("e1")).toEqual(["value-movement-bonus"]);
        expect(field("e1", "bonus")).toBeNull();
        expect(getDataPath(field("e1", "movementBonus")!)).toBe(`${C1}.entries.items.e1.movementBonus`);

        act(() => updateSignalAtPath(`${C1}.entries.items.e1.type`, "skill_bonus"));
        expect(field("e1", "name")!.value).toBe("WS");
        expect(field("e1", "name")!.placeholder).toBe("Skill name");
    });

    it("creates a condition from the factory: enabled, one stack and one entry both players share", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });

        act(() => $<HTMLButtonElement>('#conditions > [data-column="0"] > .add-slot > .add-button').click());

        const msg = actions.sent.at(-1) as {
            type: string; path: string; itemId: string; itemPos: unknown;
            init: { entries: { items: object; layouts: object } };
        };
        expect(msg.type).toBe("createItem");
        expect(msg.path).toBe("conditions.list.items");
        expect(msg.itemId).toMatch(/^conditions-/);
        expect(msg.itemPos).toEqual(pos(0, 1));
        const [entryId] = Object.keys(msg.init.entries.items);
        expect(msg.init).toEqual({
            enabled: true, stacks: 1,
            entries: { items: { [entryId]: {} }, layouts: { [entryId]: pos(0, 0) } },
        });
        expect(value(`conditions.list.items.${msg.itemId}.entries.items.${entryId}.type`)).toBe("char_bonus");

        expect(field(msg.itemId, "enabled")!.checked).toBe(true);
        expect(field(msg.itemId, "stacks")!.value).toBe("1");
        expect(entryIds(msg.itemId)).toEqual([entryId]);
        // A new condition shows its entry.
        expect(item(msg.itemId).classList.contains("collapsed")).toBe(false);

        // The other player builds the condition from the same message.
        rendered.unmount();
        rendered = null;
        loadState(content());
        act(() => { applyRemoteToState(msg as Parameters<typeof applyRemoteToState>[0]); });
        expect(Object.keys(resolvePath(`conditions.list.items.${msg.itemId}.entries.items`) as object)).toEqual([entryId]);
        expect(value(`conditions.list.items.${msg.itemId}.stacks`)).toBe(1);
    });

    it("bumps the key the computeds read when entries are created or deleted, locally and remotely", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        const version = getItemVersion("conditions.list.items");
        const bumps = () => version.peek();
        const start = bumps();

        act(() => item("c1").querySelector<HTMLButtonElement>(".condition-entries .add-button")!.click());
        const created = actions.sent.at(-1) as { path: string; itemId: string; init: unknown; itemPos: unknown };
        expect(created.path).toBe(`${C1}.entries.items`);
        expect(created.itemId).toMatch(/^entries-c1-/);
        expect(created.init).toEqual({});
        expect(created.itemPos).toEqual(pos(0, 3));
        expect(entryIds("c1")).toEqual(["e1", "e2", "e3", created.itemId]);
        expect(bumps()).toBe(start + 1);

        act(() => item("e2").querySelector<HTMLButtonElement>(".delete-button")!.click());
        expect(actions.sent.at(-1)).toEqual({ type: "deleteItem", path: `${C1}.entries.items.e2` });
        expect(entryIds("c1")).toEqual(["e1", "e3", created.itemId]);
        expect(bumps()).toBe(start + 2);

        act(() => {
            applyRemoteToState({ type: "createItem", path: `${C1}.entries.items`, itemId: "r1", itemPos: pos(0, 0), init: { type: "roll_bonus", name: "BS" } });
        });
        // e1 holds row 0 too; equal rows go by id.
        expect(entryIds("c1").slice(0, 2)).toEqual(["e1", "r1"]);
        expect(field("r1", "rollBonus")).not.toBeNull();
        expect(bumps()).toBe(start + 3);

        act(() => { applyRemoteToState({ type: "deleteItem", path: `${C1}.entries.items.r1` }); });
        expect(entryIds("c1")).not.toContain("r1");
        expect(bumps()).toBe(start + 4);
    });

    it("updates characteristics when entries are created, edited and deleted", () => {
        attachComputeds(characterState);
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        const ws = () => value("characteristics.WS.calculatedValue");
        expect(ws()).toBe(35);

        act(() => item("c1").querySelector<HTMLButtonElement>(".condition-entries .add-button")!.click());
        const { itemId } = actions.sent.at(-1) as { itemId: string };
        act(() => {
            updateSignalAtPath(`${C1}.entries.items.${itemId}.name`, "ws");
            updateSignalAtPath(`${C1}.entries.items.${itemId}.bonus`, "X");
        });
        // X is the stack count.
        expect(ws()).toBe(37);

        act(() => item("e1").querySelector<HTMLButtonElement>(".delete-button")!.click());
        expect(ws()).toBe(32);

        act(() => { applyRemoteToState({ type: "deleteItem", path: `${C1}.entries.items.${itemId}` }); });
        expect(ws()).toBe(30);

        act(() => updateSignalAtPath(`${C1}.enabled`, false));
        act(() => { applyRemoteToState({ type: "createItem", path: `${C1}.entries.items`, itemId: "r1", init: { type: "char_bonus", name: "WS", bonus: "9" } }); });
        expect(ws()).toBe(30);
        act(() => updateSignalAtPath(`${C1}.enabled`, true));
        expect(ws()).toBe(39);
    });

    it("applies a remote batch with entries, as autocomplete sends it, to the state and the entries", () => {
        rendered = renderBlock(<Conditions />);
        const version = getItemVersion("conditions.list.items");
        const before = version.peek();
        // A condition without entries starts collapsed; the batch opens it.
        expect(item("c2").classList.contains("collapsed")).toBe(true);

        act(() => {
            applyRemoteToState({
                type: "autocompleteApplied",
                path: "conditions.list.items.c2",
                changes: {
                    name: "Blinded",
                    entries: { items: { x1: { type: "roll_bonus", name: "BS", rollBonus: "-30" } }, layouts: { x1: pos(0, 0) } },
                },
            });
        });

        expect(field("c2", "name")!.value).toBe("Blinded");
        expect(entryIds("c2")).toEqual(["x1"]);
        expect(field("x1", "rollBonus")!.value).toBe("-30");
        expect(value("conditions.list.items.c2.entries.items.x1.type")).toBe("roll_bonus");
        expect(version.peek()).toBeGreaterThan(before);
        expect(item("c2").classList.contains("collapsed")).toBe(false);

        // A batch replaces the entries as a whole, as the server's jsonb || does.
        act(() => {
            applyRemoteToState({
                type: "batch",
                path: C1,
                changes: { entries: { items: { y1: { type: "char_cap", name: "S", cap: "40" } }, layouts: {} } },
            });
        });
        expect(entryIds("c1")).toEqual(["y1"]);
        expect(field("y1", "cap")!.value).toBe("40");
    });

    it("registers the name field for autocomplete of the conditions collection", () => {
        const register = vi.fn();
        const autocomplete: AutocompleteService = { register, unregister: vi.fn() };
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions, autocomplete });

        const call = register.mock.calls.find(([input]) => input === field("c1", "name"))!;
        expect(call[2].anchor.classList.contains("autocomplete-anchor")).toBe(true);
        call[1].onSelect({ name: "Stunned" });
        // Fields the collection entry lacks start over, entries included.
        expect(actions.sent.at(-1)).toEqual({
            type: "autocompleteApply", path: C1, collection: "conditions", name: "Stunned",
            base: { enabled: true, stacks: 1 },
        });
    });

    it("shows the values without the controls to the viewer who cannot edit", () => {
        rendered = renderBlock(<Conditions />, { canEdit: false });
        const c = rendered.container;

        expect(c.querySelectorAll(".add-button, .drag-handle, .delete-button")).toHaveLength(0);
        expect(field("c1", "name")!.readOnly).toBe(true);
        expect(field("c1", "stacks")!.readOnly).toBe(true);
        expect(field("c1", "enabled")!.disabled).toBe(true);
        expect(field("e1", "type")!.disabled).toBe(true);
        expect(field("e1", "bonus")!.readOnly).toBe(true);
        expect(field("e1", "bonus")!.value).toBe("5");
    });
});

describe("mountBlocks", () => {
    it("renders into the mount point of the sheet and follows Toggle Descs", () => {
        const host = document.createElement("div");
        host.id = "charactersheet";
        document.body.appendChild(host);
        const root = host.attachShadow({ mode: "open" });
        root.innerHTML = `
            <div class="container">
                <div class="controls-block"><button class="toggle-descriptions"></button></div>
                <input class="radiotab" type="radio" name="toggle" checked><label class="tablabel"></label>
                <div class="panel"><div class="block-mount" data-block="conditions"></div></div>
            </div>`;
        setBlockEnv({ canEdit: true, actions: recordingActions(), autocomplete: null });

        act(() => mountBlocks(root));
        setupToggleAll(root.querySelector(".container"));

        const mount = root.querySelector('[data-block="conditions"]')!;
        expect(mount.firstElementChild!.className).toBe("conditions-section layout-column");

        const collapsed = () => ["c1", "c2"].map(id =>
            root.querySelector(`[data-id="${id}"]`)!.classList.contains("collapsed"));
        // c2 has no entries: it starts collapsed and Toggle Descs does not open it.
        expect(collapsed()).toEqual([false, true]);
        const toggleAll = root.querySelector<HTMLButtonElement>(".toggle-descriptions")!;
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([true, true]);
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([false, true]);

        act(() => root.querySelector<HTMLButtonElement>('[data-id="c1"] .toggle-button')!.click());
        expect(collapsed()).toEqual([true, true]);

        teardownSheet();
        expect(mount.childNodes).toHaveLength(0);
    });
});
