// Computed values follow the fields they depend on, for the
// player who edits and for the other one.
import { describe, expect, it } from "vitest";
import type { ArmourPart, NavTab, Player } from "../../lib/player";
import type { Query } from "../../lib/probes";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("computed values", () => {
    const t = useTable("computed");
    const players = () => [t.a, t.b];

    /** What a player opens to see a field. */
    type Open = (p: Player) => Promise<void>;
    const tab = (name: NavTab): Open => p => p.openNavTab(name);
    const part = (name: ArmourPart): Open => p => p.openArmourPart(name);
    const compensation: Open = p => p.openCompensation();

    /** Both players open what shows the field at `path` and show `value` in it. */
    async function both(open: Open, path: string, value: string) {
        for (const p of players()) {
            await open(p);
            await p.expectValue(path, value);
        }
    }

    /** Both players open what shows the element and have `value` from `read` of it. */
    async function bothEl<T>(open: Open, q: Query, read: (el: Element) => T, value: T) {
        for (const p of players()) {
            await open(p);
            await eventually(async () => (await p.el(q)).evaluate(read), v => expect(v, `${p.name}: ${JSON.stringify(q)}`).toEqual(value));
        }
    }

    const initiativeRoll = (value: string) => bothEl(tab("combat"), { sel: "#initiativeRoll" }, el => (el as HTMLInputElement).value, value);
    const fatigueIndicator = (text: string, active: boolean) => bothEl(tab("combat"), { path: "fatigue.fatigueIndicator" },
        el => [el.textContent, el.classList.contains("fatigue-active")], [text, active]);
    const armourFieldHidden = (name: ArmourPart, hidden: boolean) => bothEl(part(name), { path: `armour.${name}.armourValue` },
        el => el.closest("label")!.classList.contains("field-hidden"), hidden);

    it("a characteristic feeds skills, initiative, movement, armour and the compensation roll", async () => {
        const { a } = t;
        // New sheets roll initiative on A.b; WS.b instead makes the chain visible.
        await a.openInitiative();
        await a.write("initiative.aBonus", false);
        await a.write("initiative.wsBonus", true);
        for (const [ws, t10, ag] of [[40, 30, 30], [50, 40, 40]]) {
            await a.openNavTab("player");
            await a.write("characteristics.WS.value", String(ws));
            await a.write("characteristics.T.value", String(t10));
            await a.write("characteristics.A.value", String(ag));
            await both(tab("player"), "skillsLeft.parry.difficulty", String(ws - 20));
            await initiativeRoll(`d10+${ws / 10}`);
            await both(tab("combat"), "movement.moveHalf", String(ag / 10));
            await both(tab("combat"), "armour.toughnessBaseAbsorptionValue", String(t10 / 10));
            await both(tab("combat"), "armour.body.total", String(t10 / 10));
            await both(compensation, "technoArcana.compensationRoll.total", String(t10));
        }
        await a.openNavTab("player");
        await a.write("characteristics.WS.unnatural", "2");
        await initiativeRoll("d10+7");
    });

    it("fatigue lowers the value rolls use and shows in the indicator", async () => {
        const { a } = t;
        await fatigueIndicator("Not affected", false);
        await a.write("fatigue.fatigueCur", 1);
        await both(tab("player"), "skillsLeft.parry.difficulty", "20");
        await fatigueIndicator("Taking −10 to affected rolls", true);
        await a.write("fatigue.fatigueMax", 1);
        await fatigueIndicator("Unconscious", true);
        await a.write("fatigue.fatigueMode", "mental");
        await both(tab("player"), "skillsLeft.parry.difficulty", "30");
        await a.openNavTab("combat");
        await a.write("fatigue.fatigueCur", 0);
        await fatigueIndicator("Not affected", false);
    });

    it("size changes movement", async () => {
        await t.a.openNavTab("combat");
        await t.a.write("size", "2");
        await both(tab("combat"), "movement.moveHalf", "6");
        await both(tab("combat"), "movement.moveFull", "12");
        await t.a.write("size", "-1");
        await both(tab("combat"), "movement.moveHalf", "3");
    });

    it("worn armour gear replaces the part's armour and hides its Armour field", async () => {
        const { a } = t;
        await a.openArmourPart("head");
        await a.write("armour.head.armourValue", 2);
        await both(tab("combat"), "armour.head.sum", "2");
        await armourFieldHidden("head", false);
        const item = await addItem(a, await showGrid(a, grid("gear")));
        await a.write(`${item}.gearType`, "armour");
        await a.write(`${item}.armour.ap.head`, "5");
        await a.write(`${item}.armour.ap.torso`, "-");
        await both(tab("combat"), "armour.head.sum", "2");

        await a.openNavTab("gear");
        await a.write(`${item}.equipped`, true);
        await both(tab("combat"), "armour.head.sum", "5");
        await armourFieldHidden("head", true);
        await armourFieldHidden("body", false);
        await a.openNavTab("gear");
        await a.write(`${item}.equipped`, false);
        await both(tab("combat"), "armour.head.sum", "2");
        await armourFieldHidden("head", false);
    });

    it("an equipped melee shield adds its AP to the parts it covers", async () => {
        const { a } = t;
        await a.openNavTab("combat");
        const before = Number(await a.read("armour.body.total"));
        const leftArm = Number(await a.read("armour.leftArm.total"));
        const item = await addItem(a, await showGrid(a, grid("meleeAttacks")));
        await a.write(`${item}.group`, "primary (shield)");
        await a.write(`${item}.shield.ap`, 3);
        await a.write(`${item}.shield.defenseSectors`, "T+A1");
        await both(tab("combat"), "armour.body.total", String(before));
        await a.write(`${item}.shield.equipped`, true);
        await both(tab("combat"), "armour.body.total", String(before + 3));
        await both(tab("combat"), "armour.leftArm.total", String(leftArm + 3));
        await a.write(`${item}.shield.arm`, "right");
        await both(tab("combat"), "armour.leftArm.total", String(leftArm));
        await a.write(`${item}.group`, "primary");
        await both(tab("combat"), "armour.body.total", String(before));
    });

    it("experience: an advancement's cost, spent and remaining XP", async () => {
        const { a } = t;
        await a.openNavTab("advancements");
        await a.write("experience.experienceTotal", 1000);
        const item = await addItem(a, await showGrid(a, grid("experienceLog")));
        await a.write(`${item}.type`, "characteristic");
        await a.write(`${item}.level`, "3");
        await both(tab("advancements"), `${item}.computedCost`, "750");
        await both(tab("advancements"), "experience.experienceSpent", "750");
        await both(tab("advancements"), "experience.experienceRemaining", "250");
        await a.write(`${item}.level`, "1");
        await both(tab("advancements"), "experience.experienceSpent", "250");
        await both(tab("advancements"), "experience.experienceRemaining", "750");
        await a.write(`${item}.type`, "other");
        await a.write(`${item}.experienceCost`, 100);
        await both(tab("advancements"), "experience.experienceRemaining", "900");
    });

    it("carry weight follows its base; encumbrance sums the carried gear", async () => {
        const { a } = t;
        await a.openNavTab("gear");
        await a.write("carryWeightAndEncumbrance.carryWeightBase", 5);
        await both(tab("gear"), "carryWeightAndEncumbrance.carryWeight", "27");
        await both(tab("gear"), "carryWeightAndEncumbrance.liftWeight", "54");
        await both(tab("gear"), "carryWeightAndEncumbrance.pushWeight", "108");

        const path = await showGrid(a, grid("gear"));
        const first = await addItem(a, path);
        const second = await addItem(a, path, 1);
        await a.write(`${first}.weight`, 2.5);
        await a.write(`${second}.weight`, 1.25);
        await both(tab("gear"), "carryWeightAndEncumbrance.encumbrance", "3.75");
        await a.write(`${second}.carried`, false);
        await both(tab("gear"), "carryWeightAndEncumbrance.encumbrance", "2.5");
    });

    it("every player shows the same computed values after a reload", async () => {
        const fields: [Open, string][] = [
            [tab("player"), "skillsLeft.parry.difficulty"], [tab("combat"), "movement.moveHalf"],
            [tab("combat"), "armour.head.sum"], [tab("combat"), "armour.body.total"],
            [tab("advancements"), "experience.experienceRemaining"], [tab("gear"), "carryWeightAndEncumbrance.encumbrance"],
            [compensation, "technoArcana.compensationRoll.total"],
        ];
        const values = async (p: Player) => {
            const out: unknown[] = [];
            for (const [open, path] of fields) {
                await open(p);
                out.push(await p.read(path));
            }
            return out;
        };
        const expected = await values(t.a);
        await t.a.reload();
        expect(await values(t.a)).toEqual(expected);
        expect(await values(t.b)).toEqual(expected);
    });
});
