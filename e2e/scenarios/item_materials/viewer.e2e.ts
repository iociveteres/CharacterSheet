// The gm's Pathfinder Crusade sheet of the seeded room, which the player may
// only view: the material, gem, enchantments and the link the gm makes show
// for the player without anything to change them. Runs on the seeded room
// (`npm run seed`, which makes the sheet anew); a run adds items to it.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { seed } from "../../lib/config";
import {
    addEnchantment, addGear, chips, enchantmentsOf, expectEffects, expectText, levelChips, pickMaterial, pickSuggestion,
} from "../../lib/gear";
import { launch, Player } from "../../lib/player";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { expectNoErrors } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("a viewer of a Pathfinder Crusade sheet", () => {
    const room = seed().roomId;
    const sheet = seed().kindSheets.pathfinder_crusade;
    let browser: Browser;
    let gm: Player;
    let v: Player;
    let sword = "";
    let flaming = "";
    let plain = "";
    let attack = "";

    beforeAll(async () => {
        browser = await launch();
        gm = await Player.create(browser, "GM", { role: "gm" });
        v = await Player.create(browser, "Viewer", { role: "player" });
        await gm.openSheet(room, sheet);
        await v.openSheet(room, sheet);
        expect((await v.sheetState()).canEdit, "the player only views the gm's sheet").toBe(false);

        sword = await addGear(gm, "Longs", "Longsword");
        await pickMaterial(gm, sword, "Mith", "Mithral");
        await (await gm.el(`${sword}.inlay`)).selectOption("Onyx");
        flaming = await addEnchantment(gm, sword, "Flam", "Flaming");
        await gm.click({ path: flaming, sel: ".level-chip", text: "3" });
        plain = await addGear(gm, "Longs", "Longsword");
        attack = await addItem(gm, await showGrid(gm, grid("meleeAttacks")));
        await gm.click(`${attack}.name`);
        await gm.page.keyboard.type("Longs");
        await pickSuggestion(gm, "Longsword | Mithral · Flaming 3", "In Gear");
        await gm.waitReceived(m => m.type === "autocompleteApplied" && m.path === attack, "the attack applied");
        await gm.settledSheetMessages();
    });

    afterEach(() => expectNoErrors([gm, v].filter(Boolean)));

    afterAll(async () => {
        await browser?.close();
    });

    it("sees the material, gem and effects, nothing to edit them with", async () => {
        await v.openNavTab("gear");
        await v.setCollapsed(sword, false);
        await v.expectValue(`${sword}.material.name`, "Mithral");
        await v.expectValue(`${sword}.inlay`, "Onyx");
        await expectEffects(v, sword, ["wt ×0.5", "Pen +1 in the attacks linked to the item", "Dur 2", "Cap ×1", "+20 Max.A"]);
        await expectText(v, { path: enchantmentsOf(sword), sel: ".ench-cap" }, "3/10");
        for (const field of ["material.name", "inlay", "broken"]) {
            expect(await (await v.el(`${sword}.${field}`)).isEditable(), `${field} editable`).toBe(false);
        }
        // An item without a material or gem has no row of them for a viewer.
        await v.setCollapsed(plain, false);
        expect(await v.exists(`${plain}.material.name`), "Material of a plain item").toBe(false);
        // Nor the ＋ of what it lacks.
        expect(await v.exists(`${plain}.addLine`), "add line of a plain item").toBe(false);
    });

    it("opens an enchantment, whose level chips are disabled, and adds none", async () => {
        await v.openNavTab("gear");
        await v.setCollapsed(sword, false);
        expect(await v.count({ path: enchantmentsOf(sword), sel: ".add-mod, .mod-delete" }), "＋ and ✖").toBe(0);
        await v.click({ path: enchantmentsOf(sword), sel: ".mod-chip-name" });
        await eventually(() => levelChips(v, flaming), c => expect(c, "levels").toEqual(["1", "[3]", "7", "12"]));
        expect(await chips(v, enchantmentsOf(sword))).toEqual(["[Flaming 3]"]);
        expect(await (await v.el({ path: flaming, sel: ".level-chip", nth: 0 })).isDisabled(), "level chip").toBe(true);
        await v.expectValue(`${flaming}.special`, "Flame (d10)");
    });

    it("sees the attack's link and its chip, without ＋ attack", async () => {
        await v.openNavTab("gear");
        await v.setCollapsed(sword, false);
        await expectText(v, { path: `${sword}.attacks`, sel: ".attack-chip" }, "⚔ Longsword");
        expect(await v.exists(`${sword}.attacks.addAttack`), "＋ attack").toBe(false);
        // A weapon without attacks has no row for a viewer.
        await v.setCollapsed(plain, false);
        expect(await v.exists(`${plain}.attacks`), "Attacks of the plain item").toBe(false);

        await v.openNavTab("combat");
        await expectText(v, `${attack}.linkMark`, "· gear");
        const tab = `${attack}.tabs.items.${(await tabIds(v, `${attack}.tabs.items`))[0]}`;
        await v.expectValue(`${tab}.penTotal`, "1");
        await expectText(v, `${tab}.itemProperties`, "+ Flame (d10)");
    });
});
