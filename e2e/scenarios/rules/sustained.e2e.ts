// Powers marked sustained by hand under their ⚙ (magic/Sustain.tsx): the PR
// the next cast of another power gets (castCap), the free ones Cycle allows
// by ½I.b▲, and the names in the sustained bar; for the player who marks them
// and for the other one. Casts that sustain are in psykana.e2e.ts.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("sustained powers", () => {
    const t = useTable("sustained");
    const players = () => [t.a, t.b];
    let fire: string;
    let bolt: string;
    let shield: string;

    /** Opens the ⚙ of the power, where it is marked sustained. */
    async function openTraits(p: Player, power: string) {
        await p.openNavTab("psykana");
        if (await p.exists(`${power}.sustain.marked`)) return;
        await p.closeDropdowns();
        await p.click({ path: power, sel: ".power-traits-toggle" });
        await eventually(() => p.exists(`${power}.sustain.marked`), v => expect(v, `${p.name}: ⚙ of ${power}`).toBe(true));
    }

    async function mark(power: string, { free = false } = {}) {
        await openTraits(t.a, power);
        await t.a.write(`${power}.sustain.marked`, true);
        if (free) await t.a.write(`${power}.sustain.free`, true);
        await t.a.closeDropdowns();
    }

    async function unmark(power: string) {
        await openTraits(t.a, power);
        await t.a.write(`${power}.sustain.marked`, false);
        await t.a.closeDropdowns();
    }

    /** The ePR the Max button of the power's roll would set, from its title. */
    async function maxPR(p: Player, power: string): Promise<number> {
        await p.openRoll(power);
        const title = await (await p.el({ path: `${power}.roll`, sel: '[data-id="maxPR"]' })).evaluate(el => el.getAttribute("title") ?? "");
        await p.closeDropdowns();
        return Number(/ePR (-?\d+)/.exec(title)?.[1]);
    }

    /** Both players show `value` as the current PR. */
    async function currentPR(value: string) {
        for (const p of players()) {
            await p.openNavTab("psykana");
            await p.expectValue("psykana.effectivePR", value);
        }
    }

    /** The sustained bar of `p`: each power's name and whether it is free. */
    async function bar(p: Player): Promise<[string, boolean][]> {
        await p.openNavTab("psykana");
        return (await p.el("psykana.sustainedList")).evaluate(el => Array.from(el.querySelectorAll(".sustain-pill"),
            pill => [pill.querySelector(".sustain-name")?.textContent ?? "", (pill.querySelector(".sustain-text")?.textContent ?? "").includes("free")] as [string, boolean]));
    }

    async function freeLimitWarning(p: Player): Promise<string | null> {
        await p.openNavTab("psykana");
        const q = { path: "psykana.sustainedList", sel: '[data-id="freeLimit"]' };
        return (await p.count(q)) ? (await p.el(q)).evaluate(el => el.textContent) : null;
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.W.value", "40");
        // I.b 2: Cycle sustains one power free.
        await a.write("characteristics.I.value", "25");
        const powers = await showGrid(a, grid("psychicPowers"));
        fire = await addItem(a, powers);
        bolt = await addItem(a, powers);
        shield = await addItem(a, powers, 1);
        const edits: [string, unknown][] = [
            ["psykana.basePR", 5],
            [`${fire}.name`, "Firebolt"], [`${fire}.subtypes`, "Цикл (3)"], [`${fire}.sustained`, "Free action"],
            [`${bolt}.name`, "Bolt"], [`${bolt}.subtypes`, "Цикл (3)"], [`${bolt}.sustained`, "Free action"],
            [`${shield}.name`, "Shield"], [`${shield}.sustained`, "Free action"],
        ];
        for (const [path, value] of edits) await a.write(path, value);
        await a.closeSuggestions();
        await t.b.openNavTab("psykana");
    });

    it("a power marked sustained lowers the PR of the next cast of the others, not its own", async () => {
        await mark(fire);
        await currentPR("4");
        for (const p of players()) {
            expect(await maxPR(p, shield), `${p.name}: Max of Shield`).toBe(4);
            // Cast again, it ends its own sustaining first.
            expect(await maxPR(p, fire), `${p.name}: Max of Firebolt`).toBe(5);
        }
        await mark(shield);
        await currentPR("3");
        for (const p of players()) expect(await maxPR(p, bolt), `${p.name}: Max of Bolt`).toBe(3);
    });

    it("unmarked, it gives the PR back", async () => {
        await unmark(shield);
        await unmark(fire);
        await currentPR("5");
        for (const p of players()) expect(await maxPR(p, shield), `${p.name}: Max of Shield`).toBe(5);
    });

    it("Cycle frees at most ½I.b▲: past it a power marked free takes PR, and the bar says why", async () => {
        await mark(fire, { free: true });
        await currentPR("5");
        await mark(bolt, { free: true });
        await currentPR("4");
        for (const p of players()) {
            await eventually(() => bar(p), b => expect(b, `${p.name}: bar`).toEqual([["Firebolt", true], ["Bolt", false]]));
            await eventually(() => freeLimitWarning(p), w => expect(w, `${p.name}: warning with the free limit`).toMatch(/\b1\b.*½I\.b▲/));
            expect(await maxPR(p, shield), `${p.name}: Max of Shield`).toBe(4);
        }
    });

    it("a higher I.b frees both, a lower one takes it back", async () => {
        await t.a.openNavTab("player");
        await t.a.write("characteristics.I.value", "45");
        await currentPR("5");
        for (const p of players()) {
            await eventually(() => bar(p), b => expect(b, `${p.name}: bar`).toEqual([["Firebolt", true], ["Bolt", true]]));
            await eventually(() => freeLimitWarning(p), w => expect(w, `${p.name}: warning`).toBeNull());
        }
        await t.a.openNavTab("player");
        await t.a.write("characteristics.I.value", "25");
        await currentPR("4");
    });

    it("a sustained power renamed is renamed in the bar, for both", async () => {
        await t.a.openNavTab("psykana");
        await t.a.write(`${bolt}.name`, "Lightning");
        await t.a.closeSuggestions();
        for (const p of players()) {
            await eventually(() => bar(p), b => expect(b, `${p.name}: bar`).toEqual([["Firebolt", true], ["Lightning", false]]));
        }
    });
});
