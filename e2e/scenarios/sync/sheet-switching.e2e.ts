// Switching sheets in the room leaves nothing of the previous
// sheets behind: one message per edit, for the current sheet only.
import { describe, expect, it } from "vitest";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";

describe("switching sheets", () => {
    const t = useTable("switching", { count: 3 });

    it("after switching back and forth, an edit, a create and a delete send one message each for the current sheet", async () => {
        const { b } = t;
        const [x, y, z] = t.sheets;
        for (const sheet of [y, x, z, x]) {
            await b.switchTo(sheet);
            expect(await b.sheetId()).toBe(sheet);
        }

        await b.clearRecords();
        await b.write("characterInfo.archetype", "Switcher");
        const edit = await b.settledSheetMessages();
        expect(edit.map(m => [m.type, m.sheetID])).toEqual([["change", String(x)]]);

        const path = await showGrid(b, grid("talents"));
        await b.clearRecords();
        const created = await b.add(path, 0);
        // An add also sends the whole layout (createAtEnd in sheet/components/columns.ts).
        expect((await b.settledSheetMessages()).map(m => [m.type, m.sheetID])).toEqual([["createItem", String(x)], ["positionsChanged", String(x)]]);

        await b.clearRecords();
        await b.remove(`${path}.${created.itemId}`);
        expect((await b.settledSheetMessages()).map(m => [m.type, m.sheetID])).toEqual([["deleteItem", String(x)]]);
    });

    it("edits of the sheet A has open do not reach the other sheet B has open", async () => {
        const { a, b } = t;
        const [x, y] = t.sheets;
        await b.switchTo(y);
        await b.write("characterInfo.characterName", "e2e switching, other sheet");
        await b.settledSheetMessages();
        await b.clearRecords();

        await a.write("characterInfo.characterName", "e2e switching, edited by A");
        await a.write("characteristics.WS.value", "55");
        await b.waitReceived(m => m.type === "change" && m.sheetID === String(x) && m.path === "characteristics.WS.value", "A's edit of the other sheet");
        await b.page.waitForTimeout(300);
        expect(await b.sheetId()).toBe(y);
        expect(await b.read("characterInfo.characterName")).toBe("e2e switching, other sheet");
        expect(await b.read("characteristics.WS.value")).toBe("");

        await b.switchTo(x);
        await b.expectValue("characterInfo.characterName", "e2e switching, edited by A");
        await b.expectValue("characteristics.WS.value", "55");
    });

    it("one typed letter in a name after three sheet switches sends one autocomplete query", async () => {
        const { b } = t;
        const [x, y] = t.sheets;
        for (const sheet of [y, x, y]) await b.switchTo(sheet);
        const item = await addItem(b, await showGrid(b, grid("talents")));
        await b.click(`${item}.name`);
        await b.clearRecords();
        await b.page.keyboard.type("C");
        await b.waitSent(m => m.type === "autocomplete", "the query");
        await b.page.waitForTimeout(600);
        expect((await b.sent("autocomplete")).map(m => m.query)).toEqual(["C"]);
    });
});
