// Scenario 2: on every navigation tab the fields, labels, headings and
// buttons of the filled sheets are where the old build has them. Read-only;
// skipped without the old build at config.oldBase.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { boxSnapshot, type Box } from "../lib/compare";
import { config, isUp } from "../lib/config";
import { launch, NAV_TABS, Player, type NavTab } from "../lib/player";
import { expectNoErrors } from "../lib/table";

/**
 * Only in the new build: Power Shields had no add button before, and the
 * +10/+20/+30 checkboxes of the left skill table were outside their labels
 * (the old empty labels are dropped from the old snapshot).
 */
const NEW_ONLY = [/^button@powerShields\.list\.items:＋Add#/, /^label>skillsLeft\.[^.]+\.plus(10|20|30)#/];

/** Off by at most this many pixels counts as the same place (subpixel rounding). */
const TOLERANCE = 1;

const TABS = Object.keys(NAV_TABS) as NavTab[];

describe.skipIf(!(await isUp(config.oldBase)))("2. geometry matches the old build", () => {
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

                    const moved = (a: Box, b: Box) => ["x", "y", "w", "h"].some(k => Math.abs(a[k as "x"] - b[k as "x"]) > TOLERANCE);
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
    }
});
