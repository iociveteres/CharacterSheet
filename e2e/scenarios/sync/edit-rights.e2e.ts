// Edit rights that change while the sheet is open: the owner lets everyone
// edit the sheet, then only view it, and the other member who has it open
// gets the controls of every card and loses them without a reload. Needs
// E2E_VIEWER_AUTH, another member of the test room (sync/read-only.e2e.ts).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { config } from "../../lib/config";
import { launch, NAV_TABS, Player, type NavTab } from "../../lib/player";
import { addItem, addTab, grid, showGrid } from "../../lib/sheet";
import { createSheet, deleteSheet, expectNoErrors, setVisibility } from "../../lib/table";
import { eventually } from "../../lib/wait";

const GRID_NAMES = ["notes", "conditions", "rangedAttacks", "talents", "gear", "mutations"];
const CONTROLS = [".add-button", ".delete-button", ".drag-handle"];

describe.skipIf(!config.viewerAuth)("edit rights changed on an open sheet", () => {
    let browser: Browser;
    let owner: Player;
    let v: Player;
    let sheet = 0;
    const items = new Map<string, string>();

    beforeAll(async () => {
        browser = await launch();
        owner = await Player.create(browser, "Owner");
        await owner.openRoom(config.room);
        sheet = await createSheet(owner);
        await owner.openSheet(config.room, sheet);
        await owner.write("characterInfo.characterName", "e2e edit rights");
        for (const name of GRID_NAMES) items.set(name, await addItem(owner, await showGrid(owner, grid(name))));
        await owner.openNavTab("psykana");
        await addTab(owner, "psykana.tabs.items");
        await owner.settledSheetMessages();
        await setVisibility(owner, sheet, "everyone_can_view");
        v = await Player.create(browser, "Viewer", { auth: config.viewerAuth });
        await v.openSheet(config.room, sheet);
    });

    afterAll(async () => {
        try {
            if (owner && sheet) {
                await owner.openRoom(config.room);
                await deleteSheet(owner, sheet);
            }
        } finally {
            await browser?.close();
        }
    });

    /** Per control, how many the viewer has on every navigation tab, each opened with a click. */
    async function controls(): Promise<{ [sel: string]: number }> {
        const out: { [sel: string]: number } = Object.fromEntries(CONTROLS.map(sel => [sel, 0]));
        for (const tab of Object.keys(NAV_TABS) as NavTab[]) {
            await v.openNavTab(tab);
            for (const sel of CONTROLS) out[sel] += await v.count({ sel });
        }
        return out;
    }

    /** Whether the viewer has the add button of every grid and the delete button of every card. */
    async function controlsOfEveryGrid(): Promise<{ [name: string]: [boolean, boolean] }> {
        const out: { [name: string]: [boolean, boolean] } = {};
        for (const name of GRID_NAMES) {
            const path = await showGrid(v, grid(name));
            out[name] = [
                await v.count({ path, sel: ":scope > .layout-column > .add-slot > .add-button" }) > 0,
                await v.count({ path: items.get(name)!, sel: ":scope > .split-header .delete-button, :scope > .delete-button" }) > 0,
            ];
        }
        return out;
    }

    const all = (value: [boolean, boolean]) => Object.fromEntries(GRID_NAMES.map(name => [name, value]));

    it("a viewer has no add, delete or drag control on any tab", async () => {
        expect((await v.sheetState()).canEdit).toBe(false);
        expect(await controls()).toEqual(Object.fromEntries(CONTROLS.map(sel => [sel, 0])));
    });

    it("everyone_can_edit gives the viewer the controls of every grid and card without a reload", async () => {
        await setVisibility(owner, sheet, "everyone_can_edit");
        await v.waitReceived(m => m.type === "changeSheetVisibility" && m.visibility === "everyone_can_edit", "the visibility change");
        await eventually(() => controlsOfEveryGrid(), c => expect(c, "add and delete buttons").toEqual(all([true, true])));
        await v.openNavTab("psykana");
        expect(await v.count({ path: "psykana.tabs.items", sel: ":scope > .add-tab-btn" }), "＋ tab of Psykana").toBe(1);
        // And the fields take edits.
        await v.openNavTab("player");
        await v.write("characterInfo.race", "e2e granted");
        await owner.openNavTab("player");
        await owner.expectValue("characterInfo.race", "e2e granted");
        expectNoErrors([owner, v]);
    });

    it("everyone_can_view takes them away again without a reload", async () => {
        await setVisibility(owner, sheet, "everyone_can_view");
        await v.waitReceived(m => m.type === "changeSheetVisibility" && m.visibility === "everyone_can_view", "the visibility change");
        await eventually(() => controlsOfEveryGrid(), c => expect(c, "add and delete buttons").toEqual(all([false, false])));
        await eventually(() => controls(), c => expect(c).toEqual(Object.fromEntries(CONTROLS.map(sel => [sel, 0]))));
        expectNoErrors([owner, v]);
    });
});

