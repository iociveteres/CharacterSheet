import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";
import { effect, type Signal } from "@preact/signals-core";
import { signal } from "@preact/signals";
import { flush, loadState, pickSuggestion, recordingActions, recordingAutocomplete, renderBlock, sheetEnv, type Rendered, getDataPath } from "../components/testUtils";
import { onSheetTeardown, teardownSheet } from "../lifecycle";
import { attachComputeds } from "../state/computed";
import { applyRemoteToState } from "../state/remote";
import { characterState } from "../state/state";
import { resolvePath, updateSignalAtPath } from "../state/sync";
import { resetUiState } from "../state/ui";
import { mountSheet } from "../Sheet";
import { Characteristics, ConditionsControl } from "./Characteristics";
import { Conditions } from "./Conditions";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(path) as Signal<unknown>).value;
const C1 = "conditions.list.items.c1";

/** How many times an effect that reads the entries of every condition, as buildEntryIndex does, has run. */
function readsOfAllEntries(): () => number {
    let runs = 0;
    onSheetTeardown(effect(() => {
        for (const c of Object.values(resolvePath("conditions.list.items") as Record<string, { entries: { items: object } }>)) Object.keys(c.entries.items);
        runs++;
    }));
    return () => runs;
}

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

        expect(field("e1", "name")!.placeholder).toBe("WS, BS or Any -T");
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

    it("reruns what reads the entries of all conditions when entries are created or deleted, locally and remotely", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        const bumps = readsOfAllEntries();
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
        const runs = readsOfAllEntries();
        const before = runs();
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
        expect(runs()).toBeGreaterThan(before);
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

    it("autocompletes the name field from the conditions collection", () => {
        vi.useFakeTimers();
        const autocomplete = recordingAutocomplete();
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions, autocomplete });

        const name = field("c1", "name")!;
        name.value = "Stun";
        name.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(250);
        vi.useRealTimers();
        expect(autocomplete.queries).toMatchObject([{ type: "autocomplete", collection: "conditions", query: "Stun" }]);

        pickSuggestion(autocomplete, name, { name: "Stunned" });
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

describe("Conditions on the sheet", () => {
    it("render in the dropdown of Characteristics and follow Toggle Descs", () => {
        const root = document.body.appendChild(document.createElement("div")).attachShadow({ mode: "open" });
        const Layout = () => (
            <>
                <input class="radiotab" type="radio" name="toggle" defaultChecked /><label class="tablabel" />
                <div class="panel"><Characteristics /></div>
            </>
        );
        act(() => mountSheet(root, sheetEnv(), Layout));

        expect(root.querySelector(".characteristics-dropdown > .layout-column > .conditions-section")).not.toBeNull();

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
        expect(root.childNodes).toHaveLength(0);
    });

    it("open from the controls with the computed and permanent characteristics", async () => {
        attachComputeds(characterState);
        const root = document.body.appendChild(document.createElement("div")).attachShadow({ mode: "open" });
        const Layout = () => (
            <>
                <input class="radiotab" type="radio" name="toggle" defaultChecked /><label class="tablabel" />
                <div class="panel"><Characteristics /></div>
            </>
        );
        act(() => mountSheet(root, sheetEnv(), Layout, ConditionsControl));

        const button = root.querySelector<HTMLButtonElement>(".controls-block > .conditions-control > button")!;
        const panel = () => root.querySelector<HTMLElement>(".controls-dropdown");
        expect(button.textContent).toBe("Open Stats");
        expect(panel()).toBeNull();

        act(() => button.click());
        expect(button.textContent).toBe("Close Stats");
        expect(button.classList.contains("active")).toBe(true);
        const ws = panel()!.querySelector<HTMLInputElement>('.main-characteristics [data-id="WS"] [data-id="calculatedValue"]')!;
        expect(ws.value).toBe("35");
        expect(getDataPath(ws)).toBe("characteristics.WS.calculatedValue");
        expect(panel()!.querySelector(`.conditions-section [data-id="c1"]`)).not.toBeNull();

        // A computed value focuses the permanent value behind it in the same panel.
        act(() => ws.click());
        await flush();
        const perm = panel()!.querySelector('.perm-temp-section [data-id="WS"] [data-id="value"]');
        expect(root.activeElement).toBe(perm);

        // Toggle Descs works on the open panel and keeps it open.
        const c1 = () => panel()!.querySelector(`[data-id="c1"]`)!.classList.contains("collapsed");
        expect(c1()).toBe(false);
        act(() => root.querySelector<HTMLButtonElement>(".toggle-descriptions")!.click());
        expect(c1()).toBe(true);

        act(() => root.querySelector<HTMLElement>(".panel")!.click());
        expect(panel()).toBeNull();
        expect(button.textContent).toBe("Open Stats");

        teardownSheet();
    });

    it("follow Toggle Descs in every place where they are mounted", () => {
        const root = document.body.appendChild(document.createElement("div")).attachShadow({ mode: "open" });
        const second = signal(true);
        const Layout = () => (
            <>
                <input class="radiotab" type="radio" name="toggle" defaultChecked /><label class="tablabel" />
                <div class="panel">
                    <Conditions />
                    {second.value && <Conditions />}
                </div>
            </>
        );
        act(() => mountSheet(root, sheetEnv(), Layout));

        const collapsed = () => Array.from(root.querySelectorAll('[data-id="c1"]'), el => el.classList.contains("collapsed"));
        expect(collapsed()).toEqual([false, false]);
        const toggleAll = root.querySelector<HTMLButtonElement>(".toggle-descriptions")!;
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([true, true]);

        // The copy that stays is still registered when the other one unmounts.
        act(() => { second.value = false; });
        act(() => toggleAll.click());
        expect(collapsed()).toEqual([false]);

        teardownSheet();
    });
});

describe("the rolls of a roll bonus", () => {
    it("picks the rolls in a line under the entry and sends the ticks at their paths", () => {
        loadState({
            ...content(),
            conditions: {
                list: {
                    items: {
                        c1: {
                            name: "Recaf", enabled: true, stacks: 1,
                            entries: {
                                items: {
                                    r1: { type: "roll_bonus", name: "W", rollBonus: "-10" },
                                    s1: { type: "skill_bonus", name: "Dodge", skillBonus: "10" },
                                },
                                layouts: { r1: pos(0, 0), s1: pos(0, 1) },
                            },
                        },
                    },
                    layouts: { c1: pos(0, 0) },
                },
            },
        });
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        const mode = item("r1").querySelector<HTMLSelectElement>('.entry-domains [data-id="domainMode"]')!;
        expect(mode.value).toBe("");
        expect(getDataPath(mode)).toBe(`${C1}.entries.items.r1.domainMode`);
        expect(item("r1").querySelector(".entry-domain-list")).toBeNull();
        expect(item("s1").querySelector(".entry-domains")).toBeNull();

        act(() => {
            mode.value = "only";
            mode.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(value(`${C1}.entries.items.r1.domainMode`)).toBe("only");
        const boxes = Array.from(item("r1").querySelectorAll<HTMLInputElement>(".entry-domain-list input"));
        expect(boxes.map(b => b.dataset.id)).toEqual(["ranged", "melee", "psychic", "techPower", "compensation"]);

        act(() => boxes[1].click());
        expect(getDataPath(boxes[1])).toBe(`${C1}.entries.items.r1.domains.melee`);
        expect(value(`${C1}.entries.items.r1.domains.melee`)).toBe(true);
        expect(actions.scheduled.at(-1)![0]).toEqual({ type: "change", path: `${C1}.entries.items.r1.domains.melee`, change: true });
    });
});

describe("the characteristics an entry names", () => {
    beforeEach(() => attachComputeds(characterState));

    it("counts a characteristic bonus on each characteristic of a list", () => {
        act(() => updateSignalAtPath(`${C1}.entries.items.e1.name`, "ws, BS"));
        // Two stacks of +5 on WS 30, and on BS 0.
        expect(value("characteristics.WS.calculatedValue")).toBe(35);
        expect(value("characteristics.BS.calculatedValue")).toBe(5);
        expect(value("characteristics.T.calculatedValue")).toBe(0);
    });

    it("outlines a name with an unknown token and counts the entry nowhere", () => {
        rendered = renderBlock(<Conditions />);
        const name = () => field("e1", "name")!;
        expect(name().classList.contains("invalid")).toBe(false);

        act(() => updateSignalAtPath(`${C1}.entries.items.e1.name`, "WS, BZ"));
        expect(name().classList.contains("invalid")).toBe(true);
        expect(name().title).toMatch(/^Unknown: BZ\. /);
        expect(value("characteristics.WS.calculatedValue")).toBe(30);

        act(() => updateSignalAtPath(`${C1}.entries.items.e1.name`, "Any -T"));
        expect(name().classList.contains("invalid")).toBe(false);
        expect(value("characteristics.WS.calculatedValue")).toBe(35);
        expect(value("characteristics.T.calculatedValue")).toBe(0);
    });
});

describe("the skill of a skill bonus", () => {
    const skill = () => field("e2", "name")!;
    const options = () => Array.from(item("e2").querySelectorAll(".autocomplete-option"), el => el.textContent);
    const groups = () => Array.from(item("e2").querySelectorAll(".autocomplete-group"), el => el.textContent);
    const type = (text: string) => act(() => {
        skill().value = text;
        skill().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const key = (k: string) => act(() => { skill().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

    it("lists the skills of the sheet in groups on focus and filters them as the player types", () => {
        rendered = renderBlock(<Conditions />);
        expect(item("e2").querySelector(".autocomplete-dropdown")).toBeNull();

        act(() => skill().focus());
        expect(groups()).toEqual(["Skills", "Navigate", "Operate"]);
        expect(options()).toContain("Dodge");
        expect(options()).toContain("Surface");

        type("surf");
        expect(groups()).toEqual(["Navigate", "Operate"]);
        expect(options()).toEqual(["Surface", "Surface"]);

        act(() => skill().blur());
        expect(item("e2").querySelector(".autocomplete-dropdown")).toBeNull();
    });

    it("writes the name the bonus counts under, picked with the pointer or the keyboard", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        act(() => skill().focus());
        type("navig");
        act(() => { item("e2").querySelector(".autocomplete-option")!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });

        expect(value(`${C1}.entries.items.e2.name`)).toBe("Navigate Surface");
        expect(actions.scheduled.at(-1)![0]).toEqual({ type: "change", path: `${C1}.entries.items.e2.name`, change: "Navigate Surface" });
        expect(item("e2").querySelector(".autocomplete-dropdown")).toBeNull();

        type("tech");
        key("ArrowDown");
        key("Enter");
        expect(value(`${C1}.entries.items.e2.name`)).toBe("Tech-Use");

        key("ArrowDown");
        expect(options().length).toBeGreaterThan(20);
        key("Escape");
        expect(item("e2").querySelector(".autocomplete-dropdown")).toBeNull();
    });

    it("dashes a name that no skill of the sheet goes by", () => {
        rendered = renderBlock(<Conditions />);
        expect(skill().classList.contains("unmatched")).toBe(false);

        act(() => updateSignalAtPath(`${C1}.entries.items.e2.name`, "Navigate (Surface)"));
        expect(skill().classList.contains("unmatched")).toBe(true);
        expect(skill().title).toMatch(/^No skill of this name/);

        act(() => updateSignalAtPath(`${C1}.entries.items.e2.name`, "navigate surface"));
        expect(skill().classList.contains("unmatched")).toBe(false);
    });
});

describe("the suggestions of a characteristics name", () => {
    const name = () => field("e1", "name")!;
    const options = () => Array.from(item("e1").querySelectorAll(".autocomplete-option"), el => el.textContent);
    const groups = () => Array.from(item("e1").querySelectorAll(".autocomplete-group"), el => el.textContent);
    const type = (text: string) => act(() => {
        name().value = text;
        name().setSelectionRange(text.length, text.length);
        name().dispatchEvent(new Event("input", { bubbles: true }));
    });
    const key = (k: string) => act(() => { name().dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true })); });

    it("adds a picked characteristic to the name on focus", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Conditions />, { actions });
        act(() => name().focus());
        expect(groups()).toEqual(["All", "Characteristics"]);
        expect(options()).toContain("BS — Ballistic Skill");
        expect(options()).not.toContain("WS — Weapon Skill");

        const bs = Array.from(item("e1").querySelectorAll(".autocomplete-option")).find(el => el.textContent!.startsWith("BS"))!;
        act(() => { bs.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); });
        expect(value(`${C1}.entries.items.e1.name`)).toBe("WS, BS");
        expect(actions.scheduled.at(-1)![0]).toEqual({ type: "change", path: `${C1}.entries.items.e1.name`, change: "WS, BS" });
    });

    it("completes the token being typed, an exclusion after Any", () => {
        rendered = renderBlock(<Conditions />);
        act(() => name().focus());
        type("WS, tou");
        expect(options()).toEqual(["T — Toughness"]);
        key("ArrowDown");
        key("Enter");
        expect(value(`${C1}.entries.items.e1.name`)).toBe("WS, T");

        type("Any t");
        expect(groups()).toEqual(["Leave out"]);
        key("ArrowDown");
        key("Enter");
        expect(value(`${C1}.entries.items.e1.name`)).toBe("Any -T");
    });
});
