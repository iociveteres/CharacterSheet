// A bard of Pathfinder Crusade casting a Sorcery spell (state/sorcery.ts):
// the spell typed Sorcery (Bard) takes the PR rows away, its cast on a skill
// spends the Bardic Focus and sustains it, and the other player sees it all,
// after a reload too. A test's outcome comes back from the server;
// Player.answerRoll stands in for it.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("sorcery", () => {
    const t = useTable("sorcery", { kind: "pathfinder_crusade" });
    let spell = "";

    const text = (p: Player, q: { path: string; sel: string }) => p.el(q).then(el => el.evaluate(e => e.textContent));
    const chip = () => ({ path: spell, sel: '[data-id="sorceryChip"]' });
    const pill = () => ({ path: spell, sel: '[data-id="sustainPill"]' });

    beforeAll(async () => {
        const { a } = t;
        // F 40, Deceive +10: the test is 50, the Max 2.
        await a.openNavTab("player");
        await a.write("characteristics.F.value", "40");
        await a.write("skillsLeft.deceive.plus0", true);
        await a.write("skillsLeft.deceive.plus10", true);

        spell = await addItem(a, await showGrid(a, grid("psychicPowers")));
        await a.write(`${spell}.name`, "Delude");
        await a.setCollapsed(spell, false);
        await a.write(`${spell}.sustained`, "Free action");
        await a.write(`${spell}.subtypes`, "Illusion, Sorcery (Bard)");
        await a.write(`${spell}.level`, 1);
        // The Bardic Focus shows with the type; its maximum is the bard's F.b, 4, the current Focus is typed up to it.
        await a.click({ path: "focus.bard", sel: ".resource-stat .mod-toggle" });
        await a.write("focus.bard.max.base", "F.b");
        await a.closeDropdowns();
        await a.expectValue("focus.bard.maxTotal", "4");
        await a.write("focus.bard.current", 3);
        await a.blockRolls();
        await t.b.openNavTab("psykana");
    });

    it("a spell typed Sorcery takes the PR rows away and shows its chip and the Sorcery row on both screens", async () => {
        for (const p of [t.a, t.b]) {
            await eventually(() => p.exists("psykana.basePR"), shown => expect(shown, `${p.name}: PR rows`).toBe(false));
            await eventually(() => p.exists("mana.current"), shown => expect(shown, `${p.name}: PR mana`).toBe(false));
            await p.expectValue("focus.bard.current", "3");
            await eventually(() => text(p, chip()), shown => expect(shown, `${p.name}: chip`).toBe("Bard, 1 Focus"));
        }
    });

    it("a cast on its skill spends the Bardic Focus and sustains it for B, and a reload keeps them", async () => {
        const { a, b } = t;
        await a.openRoll(spell);
        await a.write(`${spell}.roll.skill`, "deceive");
        await a.click({ path: `${spell}.roll`, sel: '[data-id="maxPR"]' });
        await a.expectValue(`${spell}.roll.effectivePR`, "2");
        await a.expectValue(`${spell}.roll.total`, "50");
        await a.clearRecords();
        await a.click({ path: `${spell}.roll`, sel: '[data-id="rollButton"]' });
        expect((await a.rolls()).at(-1)).toMatchObject({ kind: "versus", target: 50, label: "Delude, 2 ePR" });
        await a.answerRoll({ success: true });

        for (const p of [a, b]) {
            await p.expectValue("focus.bard.current", "2");
            await eventually(() => p.exists(pill()), shown => expect(shown, `${p.name}: sustained`).toBe(true));
            await eventually(() => p.el("sorcerySustained").then(el => el.evaluate(e => e.textContent)),
                shown => expect(shown, `${p.name}: sustained count`).toBe("Sorcery sustained: 1 / 1"));
        }

        await a.reload();
        await a.openNavTab("psykana");
        await a.expectValue("focus.bard.current", "2");
        await eventually(() => a.exists(pill()), shown => expect(shown, "A: sustained after a reload").toBe(true));
        expect(await a.exists("psykana.basePR")).toBe(false);
    });
});
