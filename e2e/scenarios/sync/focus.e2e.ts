// A remote edit leaves the focus, the caret and an unfinished
// number where the receiving player has them.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";

interface FocusState {
    focused: boolean;
    value: string;
    start: number | null;
    end: number | null;
    badInput: boolean;
}

async function focusState(p: Player, path: string): Promise<FocusState> {
    return (await p.el(path)).evaluate(el => {
        const input = el as HTMLInputElement;
        const caret = input.type === "number" ? null : input;
        return {
            focused: (input.getRootNode() as ShadowRoot).activeElement === input,
            value: input.value,
            start: caret ? caret.selectionStart : null,
            end: caret ? caret.selectionEnd : null,
            badInput: input.validity.badInput,
        };
    });
}

describe("focus and caret of the receiving player", () => {
    const t = useTable("focus");
    const items: { [grid: string]: [string, string] } = {};

    beforeAll(async () => {
        for (const name of ["conditions", "talents", "gear", "resourceTrackers"]) {
            const path = await showGrid(t.a, grid(name));
            items[name] = [await addItem(t.a, path), await addItem(t.a, path)];
            for (const item of items[name]) await t.a.write(`${item}.name`, "Something");
        }
        await t.b.openNavTab("talents");
        for (const item of items.talents) await t.b.expectValue(`${item}.name`, "Something");
    });

    const NEIGHBOURS: [string, string][] = [["conditions", "stacks"], ["talents", "description"], ["gear", "weight"]];

    for (const [name, neighbour] of NEIGHBOURS) {
        it(`the caret stays in the name of a ${name} item`, async () => {
            const { a, b } = t;
            const [mine, other] = items[name];
            await showGrid(a, grid(name));
            await showGrid(b, grid(name));
            await b.click(`${mine}.name`);
            await (await b.el(`${mine}.name`)).evaluate(el => (el as HTMLInputElement).setSelectionRange(3, 3));
            const before = await focusState(b, `${mine}.name`);
            expect(before).toMatchObject({ focused: true, start: 3, end: 3 });

            const value = neighbour === "description" ? "Remote text" : 3;
            await a.write(`${mine}.${neighbour}`, value);
            await b.expectValue(`${mine}.${neighbour}`, String(value));
            expect(await focusState(b, `${mine}.name`), "after an edit of the same item").toEqual(before);

            await a.write(`${other}.name`, "Other");
            await b.expectValue(`${other}.name`, "Other");
            expect(await focusState(b, `${mine}.name`), "after an edit of another item").toEqual(before);
        });
    }

    // What the input reports for the typed text. Chrome gives "1" for "1.", so that
    // case cannot tell "1." from "1"; "007" shows that the field keeps the text as typed
    // when its own edit comes back as 7.
    const TYPED: [string, { value: string; badInput: boolean }][] = [
        ["-", { value: "", badInput: true }],
        ["1.", { value: "1", badInput: false }],
        ["007", { value: "007", badInput: false }],
    ];

    for (const [typed, shows] of TYPED) {
        it(`a number being typed ("${typed}") stays as typed and survives an edit of another field`, async () => {
            const { a, b } = t;
            const [mine, other] = items.resourceTrackers;
            await a.openNavTab("combat");
            await b.openNavTab("combat");
            await b.click(`${mine}.value`);
            await b.page.keyboard.press("Control+A");
            await b.page.keyboard.press("Backspace");
            await b.page.keyboard.type(typed);
            await b.settledSheetMessages();
            const before = await focusState(b, `${mine}.value`);
            expect(before.focused).toBe(true);
            expect({ value: before.value, badInput: before.badInput }, "the typed text is in the field").toEqual(shows);

            await a.write(`${other}.name`, `Other ${typed}`);
            await b.expectValue(`${other}.name`, `Other ${typed}`);
            await a.write(`${other}.value`, 5);
            await b.expectValue(`${other}.value`, "5");
            expect(await focusState(b, `${mine}.value`)).toEqual(before);
        });
    }
});
