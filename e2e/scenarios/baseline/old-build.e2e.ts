// The filled sheets match the old build: the same values field by field and
// in the same order, and on every navigation tab the fields, labels, headings
// and buttons in the same places. Read-only; skipped without the old build at
// config.oldBase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { boxSnapshot, byGroup, isSubsequence, valueSnapshot, type Box, type Values } from "../../lib/compare";
import { config, isUp } from "../../lib/config";
import { launch, NAV_TABS, Player, type NavTab } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

/**
 * Groups whose old markup also had the hidden fields of the other types of an
 * item (field-hidden): entry fields of every type, armour of non-armour gear,
 * fields of every advancement type, shield fields of non-shields. The new
 * sheet renders a part of them.
 */
const SUBSEQUENCE_GROUPS = new Set(["conditions", "gear", "cybernetics", "experience", "meleeAttacks"]);

/** Old-only fields: the new sheet keeps them in the state without an input. */
const GONE = new Set(["initiative.lastInitiative"]);

/** The roll fields of a power: rendered only while its roll dropdown is open, so compared one power at a time. */
const POWER_ROLL = /^(psykana|technoArcana)\.tabs\.items\.[^.]+\.powers\.items\.[^.]+\.roll\./;

/**
 * Since migration 000030 a power is tested on roll.testOption instead of
 * roll.baseSelect; the old build shows its default base and the total of it.
 */
const ROLL_TEST = /\.roll\.(baseSelect|testOption|total)$/;

/**
 * Only in the new build: Power Shields had no add button before, the
 * +10/+20/+30 checkboxes of the left skill table were outside their labels
 * (the old empty labels are dropped from the old snapshot), and the controls
 * had no Stats button.
 */
const NEW_ONLY = [/^button@powerShields\.list\.items:＋Add#/, /^label>skillsLeft\.[^.]+\.plus(10|20|30)#/, /^button@:OpenStats#/];

/** Off by at most this many pixels counts as the same place (subpixel rounding). */
const TOLERANCE = 1;

/**
 * Sides compared in a tab strip: the open tab label keeps its block's side
 * padding instead of the old 5px (f3ca545), so its width and the labels after it differ.
 */
const TAB_STRIP_SIDES = ["y", "h"] as const;
const SIDES = ["x", "y", "w", "h"] as const;

const TABS = Object.keys(NAV_TABS) as NavTab[];

describe.skipIf(!(await isUp(config.oldBase)))("the old build", () => {
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
        describe(`sheet ${sheet}`, () => {
            beforeAll(async () => {
                await current.openSheet(config.fullRoom, sheet);
                await old.openSheet(config.fullRoom, sheet, { socket: false });
            });

            it("values match", async () => {
                const snapshot = await valueSnapshot(current);
                expect(snapshot.length, "fields of a filled sheet").toBeGreaterThan(500);
                const now = byGroup(snapshot);
                const oldSnapshot = (await valueSnapshot(old)).filter(([path]) => !GONE.has(path));
                const before = byGroup(oldSnapshot.filter(([path]) => !POWER_ROLL.test(path)));

                expect([...now.keys()].sort(), "groups").toEqual([...before.keys()].sort());
                for (const [group, values] of now) {
                    const oldValues: Values = before.get(group) ?? [];
                    if (SUBSEQUENCE_GROUPS.has(group)) {
                        expect(isSubsequence(values, oldValues), `${group}: the new fields are old ones, in order, with their values`).toBe(true);
                    } else {
                        expect(values, group).toEqual(oldValues);
                    }
                }

                const oldRolls = oldSnapshot.filter(([path]) => POWER_ROLL.test(path) && !ROLL_TEST.test(path));
                expect(oldRolls.length, "roll fields of the powers").toBeGreaterThan(0);
                for (const power of new Set(oldRolls.map(([path]) => path.split(".roll.")[0]))) {
                    const ofPower = ([path]: [string, unknown]) => path.startsWith(`${power}.roll.`) && !ROLL_TEST.test(path);
                    await current.openRoll(power);
                    expect((await valueSnapshot(current)).filter(ofPower), power).toEqual(oldRolls.filter(ofPower));
                }
                expectNoErrors([current]);
                old.takeErrors();
            });

            describe("geometry matches", () => {
                beforeAll(async () => {
                    // The new sheet narrows in a narrower room; this wide, it is 1200px with the controls beside it, as in the old build.
                    for (const p of [current, old]) await p.page.setViewportSize({ width: 1920, height: 1000 });
                    // The Test Options button is new in the first row of psykana and techno arcana; hidden, the rest lines up.
                    await current.page.evaluate(() => {
                        for (const el of Array.from(window.__e2e.root().querySelectorAll<HTMLElement>(".test-options"))) {
                            el.style.setProperty("display", "none", "important");
                        }
                    });
                    // The old build showed "＋ condition" on sheets the player cannot edit; hidden, the rest lines up.
                    if (!(await current.sheetState()).canEdit) {
                        await old.page.evaluate(() => {
                            for (const b of Array.from(window.__e2e.root().querySelectorAll<HTMLElement>(".add-first-condition"))) {
                                b.style.setProperty("display", "none", "important");
                            }
                        });
                    }
                });

                for (const tab of TABS) {
                    it(tab, async () => {
                        await current.openNavTab(tab);
                        await old.openNavTab(tab);
                        const now = new Map((await boxSnapshot(current)).map(b => [b.key, b]));
                        // The old left skill table had empty check labels next to the checkboxes.
                        const before = new Map((await boxSnapshot(old)).filter(b => !b.emptyCheckLabel).map(b => [b.key, b]));
                        expect(now.size, "visible elements").toBeGreaterThan(20);

                        const moved = (a: Box, b: Box) =>
                            (a.inTabStrip ? TAB_STRIP_SIDES : SIDES).some(k => Math.abs(a[k] - b[k]) > TOLERANCE);
                        const differences = {
                            onlyNew: [...now.keys()].filter(k => !before.has(k) && !NEW_ONLY.some(re => re.test(k))),
                            onlyOld: [...before.keys()].filter(k => !now.has(k)),
                            moved: [...now.values()]
                                .filter(b => before.has(b.key) && moved(b, before.get(b.key)!))
                                .map(b => ({ key: b.key, now: [b.x, b.y, b.w, b.h], old: (({ x, y, w, h }) => [x, y, w, h])(before.get(b.key)!) })),
                        };
                        expect(differences).toEqual({ onlyNew: [], onlyOld: [], moved: [] });
                        expectNoErrors([current]);
                        old.takeErrors();
                    });
                }
            });
        });
    }
});
