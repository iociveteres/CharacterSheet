import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Signal } from "@preact/signals-core";
import { resolvePath } from "../state/sync.js";
import { Checkbox, NumberField, RadioGroup, ReadonlyField, Select, TextArea, TextField, setNumber } from "./fields";
import { Scope } from "./Scope";
import { Copyable } from "./Copyable";
import { loadState, recordingActions, renderBlock, type Rendered, getDataPath } from "./testUtils";

const sig = (path: string) => resolvePath(path) as Signal<unknown>;

let rendered: Rendered | null = null;
const show = (...args: Parameters<typeof renderBlock>) => (rendered = renderBlock(...args));

beforeEach(() => {
    loadState({
        characterInfo: { characterName: "Kharn" },
        conditions: {
            list: {
                items: {
                    c1: { name: "Fury", enabled: true, stacks: 2, entries: { items: { e1: { type: "skill_bonus" } } } },
                },
            },
        },
        rangedAttacks: {
            list: {
                items: {
                    r1: { roll: { aim: { selected: "half" } } },
                    r2: { roll: { aim: { selected: "full" } } },
                },
            },
        },
    });
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
});

describe("TextField", () => {
    it("shows its signal and follows it", () => {
        const { container } = show(<TextField field="characterName" class="long" />, { path: "characterInfo" });
        const input = container.querySelector("input")!;
        expect(input.value).toBe("Kharn");
        expect(input.dataset.id).toBe("characterName");
        expect(input.className).toBe("long");

        sig("characterInfo.characterName").value = "Abaddon";
        expect(input.value).toBe("Abaddon");
    });

    it("sends an edit through the actions", () => {
        const actions = recordingActions();
        const { container } = show(<TextField field="characterName" />, { path: "characterInfo", actions });
        const input = container.querySelector("input")!;
        input.value = "typed";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        expect(actions.scheduled).toEqual([
            [{ type: "change", path: "characterInfo.characterName", change: "typed" }, "characterInfo.characterName"],
        ]);
        expect(sig("characterInfo.characterName").value).toBe("typed");
    });

    it("is read-only when the viewer cannot edit", () => {
        const { container } = show(<TextField field="characterName" />, { path: "characterInfo", canEdit: false });
        expect(container.querySelector("input")!.readOnly).toBe(true);
    });
});

describe("the data-id contract", () => {
    it("nests the data-ids of a field like its state path", () => {
        const { container } = show(
            <Scope dataId="conditions.list.items">
                <Scope dataId="c1" class="condition-item">
                    <TextField field="name" />
                    <Scope dataId="entries.items">
                        <Scope dataId="e1"><Select field="type" options={["char_bonus", "skill_bonus"]} /></Scope>
                    </Scope>
                </Scope>
            </Scope>,
        );
        const name = container.querySelector<HTMLInputElement>('[data-id="name"]')!;
        const type = container.querySelector<HTMLSelectElement>('[data-id="type"]')!;
        expect(getDataPath(name)).toBe("conditions.list.items.c1.name");
        expect(name.value).toBe("Fury");
        expect(getDataPath(type)).toBe("conditions.list.items.c1.entries.items.e1.type");
        expect(type.value).toBe("skill_bonus");
    });
});

describe("NumberField", () => {
    const numberInput = () => {
        const { container } = show(<NumberField field="stacks" />, { path: "conditions.list.items.c1" });
        return container.querySelector("input")!;
    };

    it("shows and follows its signal", () => {
        const input = numberInput();
        expect(input.type).toBe("number");
        expect(input.value).toBe("2");
        sig("conditions.list.items.c1.stacks").value = 5;
        expect(input.value).toBe("5");
    });

    it('keeps "007" that already shows the value', () => {
        const input = numberInput();
        input.value = "007";
        sig("conditions.list.items.c1.stacks").value = 7;
        expect(input.value).toBe("007");

        sig("conditions.list.items.c1.stacks").value = 3;
        expect(input.value).toBe("3");
    });

    it('keeps an unfinished "1."', () => {
        const input = numberInput();
        input.value = "1.";
        // happy-dom, like browsers, reports "1." as bad input.
        expect(input.validity.badInput).toBe(true);
        sig("conditions.list.items.c1.stacks").value = 1;
        expect(input.value).toBe("1.");
        sig("conditions.list.items.c1.stacks").value = 3;
        expect(input.value).toBe("1.");
    });

    it('does not overwrite an unfinished "-"', () => {
        const input = numberInput();
        // What a browser reports while "-" is typed.
        input.value = "";
        Object.defineProperty(input, "validity", { value: { badInput: true }, configurable: true });
        sig("conditions.list.items.c1.stacks").value = 4;
        expect(input.value).toBe("");

        Object.defineProperty(input, "validity", { value: { badInput: false }, configurable: true });
        sig("conditions.list.items.c1.stacks").value = 6;
        expect(input.value).toBe("6");
    });

    it("treats null as 0 and writes into an empty input", () => {
        const input = document.createElement("input");
        input.type = "number";
        setNumber(input, 0);
        expect(input.value).toBe("0");
        setNumber(input, null);
        expect(input.value).toBe("0");
        input.value = "";
        setNumber(input, 12);
        expect(input.value).toBe("12");
    });
});

describe("Checkbox, TextArea and Select", () => {
    it("show their signals and lock when the viewer cannot edit", () => {
        const { container } = show(
            <Scope dataId="c1">
                <Checkbox field="enabled" class="custom" />
                <Select field="nope" options={["a"]} />
            </Scope>,
            { path: "conditions.list.items", canEdit: false },
        );
        const box = container.querySelector<HTMLInputElement>('[data-id="enabled"]')!;
        expect(box.checked).toBe(true);
        expect(box.disabled).toBe(true);
        sig("conditions.list.items.c1.enabled").value = false;
        expect(box.checked).toBe(false);
        expect(container.querySelector("select")!.disabled).toBe(true);
    });

    it("renders select options and a textarea", () => {
        loadState({ notes: { list: { items: { n1: { description: "line\nline" } } } } });
        const { container } = show(<TextArea field="description" class="split-description" />, { path: "notes.list.items.n1" });
        expect(container.querySelector("textarea")!.value).toBe("line\nline");
    });
});

describe("RadioGroup", () => {
    it("checks the option of its signal and names the group by path", () => {
        const aim = (id: string) => (
            <Scope dataId={id}><Scope dataId="roll"><Scope dataId="aim">
                <RadioGroup field="selected" options={[{ value: "no", label: "No" }, { value: "half", label: "Half" }, { value: "full", label: "Full" }]} />
            </Scope></Scope></Scope>
        );
        const { container } = show(<>{aim("r1")}{aim("r2")}</>, { path: "rangedAttacks.list.items" });

        const radios = (id: string) => Array.from(container.querySelectorAll<HTMLInputElement>(`[data-id="${id}"] input[type=radio]`));
        expect(radios("r1").map(r => r.checked)).toEqual([false, true, false]);
        expect(radios("r2").map(r => r.checked)).toEqual([false, false, true]);
        expect(radios("r1")[0].name).toBe("rangedAttacks.list.items.r1.roll.aim.selected");
        expect(radios("r1")[0].name).not.toBe(radios("r2")[0].name);
        expect(radios("r1")[0].parentElement!.tagName).toBe("LABEL");

        sig("rangedAttacks.list.items.r1.roll.aim.selected").value = "no";
        expect(radios("r1").map(r => r.checked)).toEqual([true, false, false]);
    });
});

describe("ReadonlyField", () => {
    it("shows a computed value and cannot be focused or tabbed to", () => {
        const { container } = show(<ReadonlyField field="characterName" class="short" />, { path: "characterInfo" });
        const input = container.querySelector("input")!;
        expect(input.readOnly).toBe(true);
        expect(input.tabIndex).toBe(-1);
        expect(input.className).toBe("uneditable short");
        expect(input.value).toBe("Kharn");

        const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        input.dispatchEvent(down);
        expect(down.defaultPrevented).toBe(true);
    });
});

describe("Copyable", () => {
    it("copies its text and marks itself copied", async () => {
        const writeText = vi.fn(() => Promise.resolve());
        Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
        const { container } = show(<Copyable>▲</Copyable>);
        const el = container.querySelector(".copyable")!;
        el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
        await Promise.resolve();
        expect(writeText).toHaveBeenCalledWith("▲");
        expect(el.classList.contains("copied")).toBe(true);
    });
});
