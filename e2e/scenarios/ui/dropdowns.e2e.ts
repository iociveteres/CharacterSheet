// Dropdowns open where the player clicks and close on a click
// outside them, but not on the sheet's control buttons.
import { beforeAll, describe, expect, it } from "vitest";
import type { Query } from "../../lib/probes";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("dropdowns", () => {
    const t = useTable("dropdowns");
    let ranged = "";

    beforeAll(async () => {
        ranged = await addItem(t.a, await showGrid(t.a, grid("rangedAttacks")));
    });

    const visible = (q: Query) => t.a.count({ ...q, sel: `${q.sel ?? ""}.visible` });
    async function expectOpen(q: Query, open: boolean, what: string) {
        await eventually(() => visible(q), n => expect(n, what).toBe(open ? 1 : 0));
    }

    async function expectFocus(path: string) {
        const focused = () => t.a.page.evaluate(() => {
            const el = window.__e2e.root().activeElement;
            return el ? window.__e2e.pathOf(el) : null;
        });
        await eventually(focused, p => expect(p, "focused").toBe(path));
    }

    it("characteristics: a computed value opens the dropdown at its permanent value", async () => {
        const { a } = t;
        const dropdown = { sel: ".characteristics-dropdown" };
        await a.openNavTab("player");
        await a.click("characteristics.WS.calculatedValue");
        await expectOpen(dropdown, true, "opened by the value");
        await expectFocus("characteristics.WS.value");

        await a.click({ sel: "h2", text: "Character Information" });
        await expectOpen(dropdown, false, "closed by a click outside");

        await a.click("characteristics.T.calculatedUnnatural");
        await expectOpen(dropdown, true, "opened by the unnatural");
        await expectFocus("characteristics.T.unnatural");
        await a.click({ sel: "#toggle-delete-mode" });
        await a.click({ sel: "#toggle-delete-mode" });
        await a.click({ sel: "#toggle-descriptions" });
        await expectOpen(dropdown, true, "the control buttons keep it open");
        await a.click({ sel: ".char-dropdown-toggle" });
        await expectOpen(dropdown, false, "closed by its toggle");
    });

    it("body parts: one open at a time, a click outside the parts closes it", async () => {
        const { a } = t;
        const dropdown = { sel: ".body-part .armour-extra-dropdown" };
        await a.openNavTab("combat");
        // Dropdowns hang down over the row below, so the parts of one row.
        await a.click({ path: "armour.leftArm", sel: ".armour-extra-toggle" });
        await expectOpen({ path: "armour.leftArm", sel: ".armour-extra-dropdown" }, true, "left arm");
        await a.click({ path: "armour.rightArm", sel: ".armour-extra-toggle" });
        await expectOpen({ path: "armour.rightArm", sel: ".armour-extra-dropdown" }, true, "right arm");
        await expectOpen(dropdown, true, "only one of them");
        await a.click({ path: "armour.leftArm", sel: ".armour-extra-toggle" });
        await expectOpen({ path: "armour.leftArm", sel: ".armour-extra-dropdown" }, true, "left arm again");
        await expectOpen(dropdown, true, "only one of them");
        await a.click({ sel: "h3", text: "Wounds" });
        await expectOpen(dropdown, false, "closed by a click outside the parts");
    });

    it("initiative: a click on the roll field opens it, a click outside closes it", async () => {
        const { a } = t;
        const dropdown = { sel: ".initiative-dropdown" };
        await a.openNavTab("combat");
        await a.click({ sel: "#initiativeRoll" });
        await expectOpen(dropdown, true, "opened by the roll field");
        await a.click({ sel: "h3", text: "Movement" });
        await expectOpen(dropdown, false, "closed by a click outside");
    });

    it("roll dropdowns close on a click outside their item", async () => {
        const { a } = t;
        const dropdown = { path: ranged, sel: ".roll-dropdown" };
        await a.openNavTab("combat");
        await a.click({ path: ranged, sel: ":scope > .split-header .rollable" });
        await expectOpen(dropdown, true, "opened by the Name label");
        await a.click(`${ranged}.roll.aim.half`);
        await expectOpen(dropdown, true, "a click inside keeps it open");
        // The dropdown hangs down over what is below the attack.
        await a.click({ sel: "h3", text: "Ranged Attacks" });
        await expectOpen(dropdown, false, "closed by a click outside");
    });
});
