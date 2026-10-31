// The melee stance of the sheet (blocks/Stances.tsx): toggles under the
// Melee Attacks heading, hidden until shown; Aggressive adds WS +10 to the
// attacks, Defensive covers a shield's zones in brackets, Palisade dims
// Charge and Run. The other player sees each change live.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../../lib/player";
import type { Roll } from "../../lib/probes";
import { addItem, grid, showGrid, tabIds } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

const GRID = { sel: ".stance-grid" };
const CORNER = { sel: ".stance-corner-button" };
const stance = (key: string) => ({ sel: `.stance-button[data-stance="${key}"]` });

/** The one movement mode of a new sheet. */
const MOVE = "movement.modes.items.mode-1";

describe("melee stances", () => {
    const t = useTable("stances");
    let melee: string;
    let shield: string;

    const text = async (p: Player, q: { sel: string }) => (await p.el(q)).evaluate(el => el.textContent?.trim());

    /** Both players show the stance toggles or not, and the heading's corner says `corner`. */
    async function expectStances(shown: boolean, corner: string) {
        for (const p of [t.a, t.b]) {
            await p.openNavTab("combat");
            await eventually(async () => ({ grid: await p.exists(GRID), corner: await text(p, CORNER) }),
                v => expect(v, `${p.name}: the stances`).toEqual({ grid: shown, corner }));
        }
    }

    /** Both players show `key` as the stance taken. */
    async function taken(key: string) {
        for (const p of [t.a, t.b]) {
            await p.openNavTab("combat");
            await eventually(async () => (await p.el(GRID)).evaluate(g => Array.from(g.querySelectorAll(".stance-button.on")).map(b => (b as HTMLElement).dataset.stance)),
                on => expect(on, `${p.name}: the stance taken`).toEqual([key]));
        }
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.WS.value", "40");
        await a.write("characteristics.A.value", "35");
        melee = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        await a.write(`${melee}.name`, "Chainaxe");
        await a.closeSuggestions();
        await a.blockRolls();
    });

    it("start hidden: Stance ▾ shows the toggles, ▴ hides them, and the sheet keeps it over a reload", async () => {
        const { a } = t;
        await expectStances(false, "Stance ▾");
        await a.click(CORNER);
        await expectStances(true, "▴");
        await taken("standard");

        await a.reload();
        await a.openNavTab("combat");
        expect(await a.exists(GRID), "shown after a reload").toBe(true);

        await a.click(stance("aggressive"));
        await taken("aggressive");
        await a.click(CORNER);
        // Hidden, the heading names the stance taken.
        await expectStances(false, "Aggressive ▾");
        expect(await a.hasClass(CORNER, "current")).toBe(true);

        await a.reload();
        await a.openNavTab("combat");
        expect(await a.exists(GRID), "hidden after a reload").toBe(false);
        expect(await text(a, CORNER)).toBe("Aggressive ▾");

        await a.click(CORNER);
        await expectStances(true, "▴");
        await taken("aggressive");
    });

    /** Opens the attack's roll, reads its total and closes it again. */
    async function attackTotal(p: Player): Promise<number> {
        await p.openRoll(melee);
        const total = Number(await p.read(`${melee}.roll.total`));
        await p.closeDropdowns();
        return total;
    }

    it("Aggressive adds WS +10 to a melee attack's total, for both players, and the roll names it", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click(stance("standard"));
        await taken("standard");
        const standard = await attackTotal(a);
        expect(await attackTotal(b)).toBe(standard);

        await a.click(stance("aggressive"));
        await taken("aggressive");
        for (const p of [a, b]) {
            await eventually(() => attackTotal(p), v => expect(v, `${p.name}: the attack's total`).toBe(standard + 10));
        }

        await a.openRoll(melee);
        await a.clearRecords();
        await a.click(`${melee}.roll.rollButton`);
        const rolls: Roll[] = await a.rolls();
        expect(rolls).toEqual([{ kind: "versus", target: standard + 10, bonusSuccesses: 0, label: "Chainaxe (Aggressive)" }]);
    });

    it("the zones of a shield in brackets cover only in Defensive, and its rolls note no attacks", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        const body = Number(await a.read("armour.body.total"));
        const leftArm = Number(await a.read("armour.leftArm.total"));
        shield = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        await a.write(`${shield}.group`, "primary (shield)");
        await a.write(`${shield}.shield.ap`, 3);
        await a.write(`${shield}.shield.defenseSectors`, "A1+(T)");
        await a.write(`${shield}.shield.equipped`, true);

        const armour = async (bodyTotal: number, note: string) => {
            for (const p of [a, b]) {
                await p.openNavTab("combat");
                await p.expectValue("armour.leftArm.total", String(leftArm + 3));
                await p.expectValue("armour.body.total", String(bodyTotal));
                await eventually(() => p.el(`${shield}.shield.zonesNote`).then(el => el.evaluate(e => e.textContent)),
                    v => expect(v, `${p.name}: the zones note`).toBe(note));
            }
        };
        await armour(body, "(T) only in Defensive stance");

        await a.click(stance("defensive"));
        await taken("defensive");
        await armour(body + 3, "(T) covered: Defensive stance");
        await a.openRoll(melee);
        expect(await text(a, { sel: ".roll-dropdown .no-attacks" })).toBe("No attacks");
        await a.closeDropdowns();

        await a.click(stance("standard"));
        await armour(body, "(T) only in Defensive stance");
        await a.openRoll(melee);
        expect(await a.count({ sel: ".roll-dropdown .no-attacks" })).toBe(0);
        await a.closeDropdowns();
    });

    it("Palisade is dimmed without a spear and dims Charge and Run in the movement table", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        expect(await a.hasClass(stance("palisade"), "unavailable"), "no spear yet").toBe(true);
        const tab = `${melee}.tabs.items.${(await tabIds(a, `${melee}.tabs.items`))[0]}`;
        await a.write(`${tab}.profile`, "spear");
        await eventually(() => a.hasClass(stance("palisade"), "unavailable"), v => expect(v, "with a spear").toBe(false));

        const dimmed = async (p: Player) => {
            const heads = await p.page.evaluate(() => Array.from(window.__e2e.root().querySelectorAll(".movement-table thead th.dimmed")).map(th => th.textContent));
            const cells = [];
            for (const c of ["half", "full", "charge", "run"]) if (await p.hasClass(`${MOVE}.${c}`, "dimmed")) cells.push(c);
            return { heads, cells };
        };
        for (const p of [a, b]) {
            await p.openNavTab("combat");
            expect(await dimmed(p), `${p.name}: in Standard`).toEqual({ heads: [], cells: [] });
        }

        // A dimmed stance is taken all the same: the rules only warn.
        await a.click(stance("palisade"));
        await taken("palisade");
        for (const p of [a, b]) {
            await eventually(() => dimmed(p), v => expect(v, `${p.name}: in Palisade`).toEqual({ heads: ["Charge", "Run"], cells: ["charge", "run"] }));
            // The title of a distance is written when the pointer enters it.
            await (await p.el(`${MOVE}.run`)).hover();
            expect(await p.attr(`${MOVE}.run`, "title"), `${p.name}: why Run is dimmed`).toMatch(/^Palisade stance: no Charge or Run\n/);
        }

        await a.click(stance("standard"));
        for (const p of [a, b]) await eventually(() => dimmed(p), v => expect(v, `${p.name}: back in Standard`).toEqual({ heads: [], cells: [] }));
    });

    it("a stance taken by one player reaches the other live, the hidden heading too", async () => {
        const { a, b } = t;
        await a.openNavTab("combat");
        await a.click(stance("covering"));
        await taken("covering");
        await b.click(stance("defensive"));
        await taken("defensive");

        await b.click(CORNER);
        await expectStances(false, "Defensive ▾");
        await a.click(CORNER);
        await expectStances(true, "▴");
        await a.click(stance("standard"));
        await taken("standard");
        await a.click(CORNER);
        await expectStances(false, "Stance ▾");
        expect(await b.hasClass(CORNER, "current"), "Standard is dimmed").toBe(false);
    });
});
