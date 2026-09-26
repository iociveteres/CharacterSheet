// A sheet the player cannot edit is read-only for them. With
// E2E_VIEWER_AUTH (another member of the test room, saved by
// `node scripts/perf/sheet-render.mjs login --base <base> --auth <file>`) a
// fresh sheet is shared with that user; without it the signed-in user reads
// config.readOnlySheet, a sheet of someone else they may only view.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { config } from "../../lib/config";
import { launch, Player } from "../../lib/player";
import { addItem, addTab, grid, GRIDS, showGrid } from "../../lib/sheet";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("read-only sheet", () => {
    let browser: Browser;
    let owner: Player | undefined;
    let v: Player;
    let fresh = 0;

    beforeAll(async () => {
        browser = await launch();
        if (config.viewerAuth) {
            owner = await Player.create(browser, "Owner");
            await owner.openRoom(config.room);
            fresh = await createSheet(owner);
            await owner.openSheet(config.room, fresh);
            await owner.write("characterInfo.characterName", "e2e read-only");
            const talent = await addItem(owner, await showGrid(owner, grid("talents")));
            await owner.write(`${talent}.description`, "Something to show");
            for (const name of ["conditions", "gear", "meleeAttacks", "psychicPowers"]) await addItem(owner, await showGrid(owner, grid(name)));
            await addTab(owner, "technoArcana.tabs.items");
            await owner.settledSheetMessages();
            await setVisibility(owner, fresh, "everyone_can_view");
            v = await Player.create(browser, "Viewer", { auth: config.viewerAuth });
            await v.openSheet(config.room, fresh);
        } else {
            v = await Player.create(browser, "Viewer");
            await v.openSheet(...config.readOnlySheet);
        }
        await v.blockRolls();
    });

    afterAll(async () => {
        try {
            if (owner && fresh) {
                await owner.openRoom(config.room);
                await deleteSheet(owner, fresh);
            }
        } finally {
            await browser?.close();
        }
    });

    it("the viewer may not edit", async () => {
        expect((await v.sheetState()).canEdit, "choose a sheet the user cannot edit").toBe(false);
    });

    it("has no add, delete or drag controls", async () => {
        for (const sel of [".add-button", ".delete-button", ".drag-handle", ".add-tab-btn", ".add-first-condition"]) {
            expect(await v.count({ sel }), sel).toBe(0);
        }
    });

    it("every field is read-only or disabled", async () => {
        const editable = await v.page.evaluate(() => Array.from(window.__e2e.root().querySelectorAll("input[data-id], select[data-id], textarea[data-id]"))
            .filter(el => !(el as HTMLInputElement).readOnly && !(el as HTMLInputElement).disabled)
            .map(el => window.__e2e.pathOf(el)));
        expect(editable).toEqual([]);
    });

    it("typing sends nothing", async () => {
        await v.openNavTab("player");
        const before = await v.read("characterInfo.characterName");
        await v.clearRecords();
        // A read-only field still takes the focus; typing into it changes nothing.
        await (await v.el("characterInfo.characterName")).focus();
        await v.page.keyboard.type("xyz");
        await v.page.keyboard.press("Enter");
        expect(await v.settledSheetMessages()).toEqual([]);
        expect(await v.read("characterInfo.characterName")).toBe(before);
    });

    it("items still collapse and expand", async () => {
        let item: string | undefined;
        for (const g of GRIDS.filter(g => !g.powers && g.itemClass === "item-with-description")) {
            const first = (await v.layout(g.path)).flat()[0];
            if (first) {
                item = `${g.path}.${first}`;
                await showGrid(v, g);
                break;
            }
        }
        expect(item, "an item with a description on the sheet").toBeDefined();
        const collapsed = await v.isCollapsed(item!);
        await v.setCollapsed(item!, !collapsed);
        await v.setCollapsed(item!, collapsed);
    });

    it("rolls still work", async () => {
        await v.openNavTab("player");
        const target = Number(await v.read("characteristics.WS.calculatedValue"));
        const unnatural = Number(await v.read("characteristics.WS.calculatedUnnatural")) || 0;
        await v.clearRecords();
        await v.click({ path: "characteristics.WS", sel: "label.rollable" });
        await eventually(() => v.rolls(), r => expect(r).toEqual([
            { kind: "versus", target, bonusSuccesses: Math.floor(unnatural / 2), label: "Weapon Skill" },
        ]));
        expectNoErrors([v, ...(owner ? [owner] : [])]);
    });
});
