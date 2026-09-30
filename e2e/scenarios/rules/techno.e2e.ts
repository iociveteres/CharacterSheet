// What the sheet counts for a tech-priest (state/tech.ts, state/cast.ts): the
// maximum and restoration of cognition and energy, the price an activation
// spends, the compensation of a Compensator power, the Processes and the
// compilations of a Litany, the quality of the hardware, and the settings that
// turn them off, for the player who activates and for the other one. A test's
// outcome comes back from the server; Player.answerRoll stands in for it.
import { beforeAll, describe, expect, it } from "vitest";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("techno arcana", () => {
    const t = useTable("techno arcana");
    let surge: string;
    let shield: string;
    let litany: string;

    const compensation = { path: "technoArcana.compensationRoll", sel: ".compensation-toggle" };

    /** Both players show `value` in the field at `path`. */
    async function both(path: string, value: unknown) {
        for (const p of [t.a, t.b]) await p.expectValue(path, value);
    }

    /** B's text of the element `sel` in `path`, null without one; read at once, as a mark may go meanwhile. */
    async function textOf(path: string, sel: string): Promise<string | null> {
        return t.b.page.evaluate(q => window.__e2e.find(q)?.textContent ?? null, { path, sel });
    }

    /** A opens the roll of `power` and clicks its Roll or Activate. */
    async function activate(power: string) {
        const { a } = t;
        await a.openNavTab("techno");
        await a.openRoll(power);
        await a.write(`${power}.roll.testOption`, "test-option-1");
        await a.clearRecords();
        await a.click({ path: `${power}.roll`, sel: '[data-id="rollButton"]' });
    }

    beforeAll(async () => {
        const { a } = t;
        // I.b 4: ⚙ up to 4, 2 a turn.
        await a.write("characteristics.I.value", "45");
        await a.write("characteristics.T.value", "40");
        const implant = await addItem(a, await showGrid(a, grid("cybernetics")));
        await a.write(`${implant}.name`, "Luminen Capacitors");
        await a.write(`${implant}.quality`, "Good");

        const powers = await showGrid(a, grid("techPowers"));
        surge = await addItem(a, powers);
        shield = await addItem(a, powers);
        litany = await addItem(a, powers);
        const edits: [string, unknown][] = [
            ["technoArcana.currentCognition", 4], ["technoArcana.currentEnergy", 1],
            [`${surge}.name`, "Luminen Surge"], [`${surge}.subtypes`, "Атака, Компенсатор (0)"], [`${surge}.price`, "1 ⚙, 2 🗲"],
            [`${surge}.process`, "Нет"], [`${surge}.implants`, "Luminen Capacitors"],
            [`${shield}.name`, "Voltagheist Shield"], [`${shield}.price`, "1 ⚙"], [`${shield}.process`, "½ ⚙(У)"],
            [`${litany}.name`, "Sacred Host"], [`${litany}.subtypes`, "Славословие (2)"], [`${litany}.price`, "1 ⚙"], [`${litany}.process`, "Нет"],
        ];
        for (const [path, value] of edits) await a.write(path, value);
        await a.blockRolls();
    });

    it("the maximum and restoration count the rules while their base is empty, and a typed base for both", async () => {
        const { a } = t;
        await both("technoArcana.cognitionMaxTotal", "4");
        await both("technoArcana.cognitionRestoreTotal", "2");
        await both("technoArcana.energyMaxTotal", "3");
        await both("technoArcana.energyRestoreTotal", "0");

        await a.click({ path: "technoArcana", sel: '.resource-stat:has([data-id="cognitionMaxTotal"]) .mod-toggle' });
        await a.write("technoArcana.cognitionMax.base", "6");
        await both("technoArcana.cognitionMaxTotal", "6");
        // Typed over the maximum, the current cognition is the maximum.
        await a.write("technoArcana.currentCognition", 9);
        await both("technoArcana.currentCognition", "6");
    });

    it("the hardware's quality changes the I of a power's damage", async () => {
        await t.a.openMods(surge, "damage");
        await t.a.write(`${surge}.damage`, "1d10+I.b");
        // I 45 + Good 5: I.b 5.
        await both(`${surge}.damageTotal`, "1d10+5");
    });

    it("an activation spends ⚙ before its test, 🗲 once it succeeds with Fatigue for what is lacking, and offers the compensation", async () => {
        const { a, b } = t;
        await activate(surge);
        await both("technoArcana.currentCognition", "5");
        await a.answerRoll({ success: true });
        await both("technoArcana.currentEnergy", "0");
        await both("fatigue.fatigueCur", "1");
        await eventually(() => b.hasClass(compensation, "attention"), on => expect(on, "B: dot").toBe(true));
    });

    it("the compensation roll gives back one for each Success, the Fatigue first", async () => {
        const { a, b } = t;
        await a.click(compensation);
        await a.clearRecords();
        await a.click({ path: "technoArcana.compensationRoll", sel: '[data-id="rollButton"]' });
        await a.answerRoll({ success: true, degrees: 2 });
        await both("fatigue.fatigueCur", "0");
        await both("technoArcana.currentEnergy", "1");
        await eventually(() => b.hasClass(compensation, "attention"), on => expect(on, "B: dot").toBe(false));
    });

    it("a successful activation holds a power in a Process: B sees the mark and what they cost a turn", async () => {
        await activate(shield);
        await t.a.answerRoll({ success: true });
        await eventually(() => textOf(shield, '[data-id="processPill"] .sustain-text'), text => expect(text).toBe("Process ½ ⚙"));
        await both("technoArcana.processCostTotal", "1 ⚙");
    });

    it("a Litany is rolled only compiled, and its activation uses the compilation", async () => {
        const { a } = t;
        await a.openNavTab("techno");
        await a.openRoll(litany);
        await eventually(() => a.exists({ path: `${litany}.roll`, sel: '[data-id="rollButton"][disabled]' }), off => expect(off).toBe(true));
        await a.click({ path: `${litany}.roll`, sel: '[data-id="compile"]' });
        await eventually(() => textOf(litany, '[data-id="compiledPill"] .sustain-text'), text => expect(text).toBe("Compiled 1 ⚙"));
        await both("technoArcana.processCostTotal", "2 ⚙");

        await activate(litany);
        await a.answerRoll({ success: true });
        await eventually(() => textOf(litany, '[data-id="compiledPill"] .sustain-text'), text => expect(text).toBeNull());
    });

    it("a sheet counts nothing it is told not to", async () => {
        const { a, b } = t;
        await a.click({ path: "settings.technoArcana", sel: ".psykana-settings-toggle" });
        await a.write("settings.technoArcana.price", false);
        await a.write("settings.technoArcana.processes", false);
        await eventually(() => b.exists("technoArcana.processCostTotal"), found => expect(found, "B: cost of the Processes").toBe(false));
        const cognition = await a.read("technoArcana.currentCognition");
        await activate(shield);
        await a.answerRoll({ success: true });
        await a.settledSheetMessages();
        await both("technoArcana.currentCognition", cognition);
    });
});
