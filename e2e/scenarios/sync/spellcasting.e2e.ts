// A bard-wizard of Pathfinder Crusade (state/spellcasting.ts): ticking
// Arcane and Bard on one screen shows the other the PR rows with the mana
// Arcane gives and the Bardic Focus, a new spell is tested on Cast, I for
// Arcane, and a bard spell pays from the Bardic Focus, not the mana. A
// test's outcome comes back from the server; Player.answerRoll stands in for it.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("spellcasting", () => {
    const t = useTable("spellcasting", { kind: "pathfinder_crusade" });
    let bolt = "";
    let delude = "";

    /** The variants ticked, as the button of the Spellcasting row lists them. */
    const ticked = (p: Player, labels: string) =>
        eventually(async () => (await p.el("spellcasting.picker")).evaluate(el => el.textContent), shown => expect(shown, `${p.name}: Spellcasting`).toBe(labels));
    const testShown = (p: Player, spell: string) => p.el({ path: `${spell}.roll`, sel: '[data-id="testOption"]' })
        .then(el => el.evaluate(s => (s as HTMLSelectElement).options[(s as HTMLSelectElement).selectedIndex]?.text));

    beforeAll(async () => {
        const { a } = t;
        // I 40 and no base PR: the Arcane mana is 2×I.b+2×bPR, 8. F 40: the Bardic Focus is F.b, 4. Deceive +10.
        await a.openNavTab("player");
        await a.write("characteristics.I.value", "40");
        await a.write("characteristics.F.value", "40");
        await a.write("skillsLeft.deceive.plus0", true);
        await a.write("skillsLeft.deceive.plus10", true);

        await a.openSpellcasting();
        await a.click("spellcasting.arcane");
        await a.click("spellcasting.bard");
        await a.closeDropdowns();
        const powers = await showGrid(a, grid("psychicPowers"));
        bolt = await addItem(a, powers);
        await a.write(`${bolt}.name`, "Bolt");
        delude = await addItem(a, powers);
        await a.write(`${delude}.name`, "Delude");
        await a.setCollapsed(delude, false);
        await a.write(`${delude}.subtypes`, "Arts (Bard)");
        await a.write(`${delude}.level`, 1);
        await a.write("focus.bard.current", 3);
        await a.write("mana.current", 5);
        await a.blockRolls();
        await t.b.openNavTab("psykana");
    });

    it("Arcane and Bard ticked on one screen show the other both rows, with the bases they give", async () => {
        const { b } = t;
        await ticked(b, "Arcane, Bard");
        await eventually(() => b.exists("psykana.basePR"), shown => expect(shown, "B: PR rows").toBe(true));
        await b.expectValue("mana.maxTotal", "8");
        await b.expectValue("mana.current", "5");
        await b.expectValue("focus.bard.maxTotal", "4");
        await b.expectValue("focus.bard.current", "3");
        expect(await b.exists("focus.ranger.current")).toBe(false);
    });

    it("a new spell is tested on Cast, I for Arcane, on the other screen too", async () => {
        const { b } = t;
        await b.openRoll(bolt);
        await eventually(() => testShown(b, bolt), shown => expect(shown, "B: the test of Bolt").toBe("Cast (I)"));
        await b.expectValue(`${bolt}.roll.total`, "40");
        await b.closeDropdowns();
    });

    it("a bard spell pays from the Bardic Focus, and the mana stays", async () => {
        const { a, b } = t;
        await a.openRoll(delude);
        await a.write(`${delude}.roll.skill`, "deceive");
        await a.click({ path: `${delude}.roll`, sel: '[data-id="maxPR"]' });
        await a.clearRecords();
        await a.click({ path: `${delude}.roll`, sel: '[data-id="rollButton"]' });
        expect((await a.rolls()).at(-1)).toMatchObject({ kind: "versus", target: 50 });
        await a.answerRoll({ success: true });

        for (const p of [a, b]) {
            await p.expectValue("focus.bard.current", "2");
            await p.expectValue("mana.current", "5");
        }
    });
});
