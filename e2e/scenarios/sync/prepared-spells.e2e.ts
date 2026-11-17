// The spells a Pathfinder Crusade caster prepares: the bookmark of a spell
// and Unprepare All reach the other player and survive a reload.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("prepared spells", () => {
    const t = useTable("prepared spells", { kind: "pathfinder_crusade" });
    let spell = "";

    const prepared = (p: Player, on: boolean) =>
        eventually(() => p.hasClass(`${spell}.prepared`, "active"), shown => expect(shown, `${p.name}: ${spell} prepared`).toBe(on));
    const counted = async (p: Player, text: string) =>
        eventually(async () => (await p.el("preparedSpells.preparedCount")).evaluate(el => el.textContent),
            shown => expect(shown, `${p.name}: the prepared spells`).toBe(text));

    beforeAll(async () => {
        const { a } = t;
        // An Arcane caster with I.b 3 and no base PR: 3 spells a day.
        await a.openNavTab("player");
        await a.write("characteristics.I.value", "30");
        await a.openSpellcasting();
        await a.click("spellcasting.arcane");
        await a.closeDropdowns();
        spell = await addItem(a, await showGrid(a, grid("psychicPowers")));
        await a.write(`${spell}.name`, "Bolt");
    });

    // B opened the sheet from the room list, so only A, on the sheet's own URL, reloads.
    it("a spell prepared on one screen is prepared on the other, and after a reload", async () => {
        const { a, b } = t;
        await b.openNavTab("psykana");
        await prepared(b, false);
        await counted(b, "Prepared Spells: 0 / 3");

        await b.click(`${spell}.prepared`);
        await prepared(a, true);
        await counted(a, "Prepared Spells: 1 / 3");

        await a.reload();
        await a.openNavTab("psykana");
        await prepared(a, true);
    });

    it("Unprepare All on one screen unprepares the spells on the other, and after a reload", async () => {
        const { a, b } = t;
        await a.click("preparedSpells.unprepareAll");
        await prepared(b, false);
        await counted(b, "Prepared Spells: 0 / 3");

        await a.reload();
        await a.openNavTab("psykana");
        await prepared(a, false);
    });
});
