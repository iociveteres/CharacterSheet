// What the sheet counts for a psyker (state/psychic.ts): the PR of a cast in
// the damage of a power, sustained powers in the Current PR, free Cycle
// casts, the phenomena of the last cast, and the settings that turn them off,
// for the player who casts and for the other one. A test's outcome comes back
// from the server; Player.answerRoll stands in for it where it must not be
// random.
import { beforeAll, describe, expect, it } from "vitest";
import { addItem, grid, showGrid } from "../../lib/sheet";
import { useTable } from "../../lib/table";
import { eventually } from "../../lib/wait";

describe("psykana", () => {
    const t = useTable("psykana");
    let fire: string;
    let shield: string;

    const toggle = { path: "psykana", sel: '[data-id="phenomenaToggle"]' };

    /** Both players show `value` in the field at `path`. */
    async function both(path: string, value: unknown) {
        for (const p of [t.a, t.b]) await p.expectValue(path, value);
    }

    async function pillOf(power: string): Promise<string | null> {
        const q = { path: power, sel: '[data-id="sustainPill"] .sustain-text' };
        return (await t.b.exists(q)) ? (await t.b.el(q)).evaluate(el => el.textContent) : null;
    }

    /** A casts `power` at the current PR with `kick`, choosing to sustain it and free by Cycle. */
    async function cast(power: string, { kick = 0, sustain = true, free = true } = {}) {
        const { a } = t;
        await a.openNavTab("psykana");
        await a.openRoll(power);
        await a.write(`${power}.roll.testOption`, "test-option-1");
        await a.click({ path: `${power}.roll`, sel: '[data-id="maxPR"]' });
        await a.write(`${power}.roll.kickPR`, kick);
        if (await a.exists(`${power}.roll.sustainChoice.sustain`)) await a.write(`${power}.roll.sustainChoice.sustain`, sustain);
        if (await a.exists(`${power}.roll.sustainChoice.free`)) await a.write(`${power}.roll.sustainChoice.free`, free);
        await a.clearRecords();
        await a.click({ path: `${power}.roll`, sel: '[data-id="rollButton"]' });
    }

    beforeAll(async () => {
        const { a } = t;
        await a.openNavTab("player");
        await a.write("characteristics.W.value", "40");
        // I.b 4: Cycle sustains two powers free.
        await a.write("characteristics.I.value", "45");
        const powers = await showGrid(a, grid("psychicPowers"));
        fire = await addItem(a, powers);
        shield = await addItem(a, powers);
        const edits: [string, unknown][] = [
            ["psykana.psykanaType", "Unbound"], ["psykana.basePR", 5], ["psykana.maxPush", 3],
            [`${fire}.name`, "Firebolt"], [`${fire}.subtypes`, "Призыв, Цикл (5)"], [`${fire}.sustained`, "Free action"],
            [`${shield}.name`, "Shield"], [`${shield}.sustained`, "Free action"],
        ];
        for (const [path, value] of edits) await a.write(path, value);
        await a.blockRolls();
        await t.b.openNavTab("psykana");
    });

    it("a psyker's sheet says once what it counts, until A dismisses it for both", async () => {
        for (const p of [t.a, t.b]) {
            await eventually(() => p.exists("settings.psykanaNotice"), found => expect(found, `${p.name}: notice`).toBe(true));
        }
        await t.a.click({ path: "settings.psykanaNotice", sel: "button" });
        await eventually(() => t.b.exists("settings.psykanaNotice"), found => expect(found, "B: notice").toBe(false));
    });

    it("the damage and penetration of a power count the PR of its cast, the current PR before one", async () => {
        const { a } = t;
        // A power shows its damage expanded.
        await a.setCollapsed(fire, false);
        await a.openMods(fire, "damage");
        await a.write(`${fire}.damage`, "1d10+2×PR");
        await a.openMods(fire, "pen");
        await a.write(`${fire}.pen`, "PR");
        await both(`${fire}.damageTotal`, "1d10+10");
        await both(`${fire}.penTotal`, "5");
    });

    it("a test that succeeds sustains the power: B sees the mark and the Current PR, a reload keeps them", async () => {
        await cast(fire, { free: false });
        await t.a.answerRoll({ success: true });
        await both("psykana.effectivePR", "4");
        await both("psykana.sustainedCount", "1");
        await eventually(() => pillOf(fire), text => expect(text).toBe("Sustained PR 5"));
        await both(`${fire}.damageTotal`, "1d10+10");

        await t.a.reload();
        await t.a.openNavTab("psykana");
        await t.a.expectValue("psykana.effectivePR", "4");
        // A reload forgets the block, and a real test would sustain at random.
        await t.a.blockRolls();
    });

    it("a test that fails leaves the power as it was", async () => {
        await cast(shield);
        await t.a.answerRoll({ success: false, roll: 90 });
        await t.a.settledSheetMessages();
        await both("psykana.sustainedCount", "1");
        expect(await pillOf(shield)).toBeNull();
    });

    it("a Cycle power cast at ePR X or more is sustained free, in place of its cast before", async () => {
        await cast(fire, { free: true });
        await t.a.answerRoll({ success: true });
        await both("psykana.effectivePR", "5");
        await eventually(() => pillOf(fire), text => expect(text).toBe("Sustained PR 5 · free"));
    });

    it("a pushed cast calls for phenomena: B sees the dot, A rolls them with the kick and the sustained powers", async () => {
        const { a, b } = t;
        await cast(fire, { kick: 2, sustain: false });
        await eventually(() => b.hasClass(toggle, "attention"), on => expect(on, "B: dot").toBe(true));

        await a.click(toggle);
        const text = async (id: string) => (await a.el({ path: "psykana", sel: `[data-id="${id}"]` })).evaluate(el => el.textContent);
        expect(await text("phenomenaNote")).toBe("Pushed, phenomena are certain.");
        // Unbound: +5 per point of kick; Firebolt is sustained.
        expect([await text("nature"), await text("sustained"), await text("phenomenaTotal")]).toEqual(["+10", "+10", "1d100+20"]);

        await a.clearRecords();
        await a.click({ path: "psykana", sel: '[data-id="rollPhenomena"]' });
        expect(await a.rolls()).toEqual([{ kind: "exact", expression: "1d100+20", label: "Phenomena, Firebolt, +2 kick" }]);
        await eventually(() => b.hasClass(toggle, "attention"), on => expect(on, "B: dot").toBe(false));
    });

    it("Discard stops the call for phenomena without a roll", async () => {
        const { a, b } = t;
        await cast(fire, { kick: 1, sustain: false });
        await eventually(() => b.hasClass(toggle, "attention"), on => expect(on, "B: dot").toBe(true));
        await a.click(toggle);
        await a.clearRecords();
        await a.click({ path: "psykana", sel: '[data-id="discardPhenomena"]' });
        await eventually(() => b.hasClass(toggle, "attention"), on => expect(on, "B: dot").toBe(false));
        expect(await a.rolls()).toEqual([]);
    });

    it("the ✕ of a power in the bar ends its sustaining for both", async () => {
        const { a } = t;
        const pills = (p: typeof a) => p.count({ path: "psykana.sustainedList", sel: ".sustain-pill" });
        expect(await pills(a)).toBe(1);
        await a.click({ path: "psykana.sustainedList", sel: '[data-id="dropSustain"]' });
        for (const p of [a, t.b]) await eventually(() => pills(p), n => expect(n, `${p.name}: marks in the bar`).toBe(0));
        await eventually(() => pillOf(fire), text => expect(text).toBeNull());
    });

    it("the server answers a real test with what it came to", async () => {
        const { a } = t;
        await a.blockRolls(false);
        await cast(shield, { sustain: false });
        const [roll] = await a.rolls();
        const message = await a.waitReceived(m => m.type === "chatMessage" && !!m.versus, "the test's message");
        expect(message.versus).toMatchObject({ target: roll.kind === "versus" ? roll.target : NaN });
        await eventually(() => a.rollResults(), results => expect(results.map(r => r.outcome)).toEqual([message.versus]));
        await a.blockRolls();
    });

    it("a sheet counts nothing it is told not to", async () => {
        const { a, b } = t;
        await a.click({ path: "psykana", sel: ".block-settings-toggle" });
        await a.write("settings.psykana.sustained", false);
        await a.write("settings.psykana.phenomena", false);
        await eventually(() => b.exists(toggle), found => expect(found, "B: Phenomena").toBe(false));
        await eventually(() => b.exists("psykana.sustainedList"), found => expect(found, "B: sustained list").toBe(false));
        await b.write("psykana.sustainedPowers", 2);
        await both("psykana.effectivePR", "3");
    });
});
