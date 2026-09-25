// Scenario 1: the filled sheets show the same values as in the old build,
// field by field and in the same order. Read-only; skipped without the old
// build at config.oldBase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { byGroup, isSubsequence, valueSnapshot, type Values } from "../lib/compare";
import { config, isUp } from "../lib/config";
import { launch, Player } from "../lib/player";
import { expectNoErrors } from "../lib/table";

/**
 * Groups whose old markup also had the hidden fields of the other types of an
 * item (field-hidden): entry fields of every type, armour of non-armour gear,
 * fields of every advancement type, shield fields of non-shields. The new
 * sheet renders a part of them.
 */
const SUBSEQUENCE_GROUPS = new Set(["conditions", "gear", "cybernetics", "experience", "meleeAttacks"]);

/** Old-only fields: the new sheet keeps them in the state without an input. */
const GONE = new Set(["initiative.lastInitiative"]);

describe.skipIf(!(await isUp(config.oldBase)))("1. values match the old build", () => {
    let browser: Browser;
    let current: Player;
    let old: Player;

    beforeAll(async () => {
        browser = await launch();
        current = await Player.create(browser, "new");
        old = await Player.create(browser, "old", { base: config.oldBase });
    });

    afterAll(async () => {
        await browser?.close();
    });

    for (const sheet of config.fullSheets) {
        it(`sheet ${sheet}`, async () => {
            await current.openSheet(config.fullRoom, sheet);
            await old.openSheet(config.fullRoom, sheet, { socket: false });
            const snapshot = await valueSnapshot(current);
            expect(snapshot.length, "fields of a filled sheet").toBeGreaterThan(500);
            const now = byGroup(snapshot);
            const before = byGroup((await valueSnapshot(old)).filter(([path]) => !GONE.has(path)));

            expect([...now.keys()].sort(), "groups").toEqual([...before.keys()].sort());
            for (const [group, values] of now) {
                const oldValues: Values = before.get(group) ?? [];
                if (SUBSEQUENCE_GROUPS.has(group)) {
                    expect(isSubsequence(values, oldValues), `${group}: the new fields are old ones, in order, with their values`).toBe(true);
                } else {
                    expect(values, group).toEqual(oldValues);
                }
            }
            expectNoErrors([current]);
            old.takeErrors();
        });
    }
});
