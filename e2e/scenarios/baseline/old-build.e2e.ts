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

/** New fields: the quality of gear and implants, which tech powers read (state/hardware.ts). */
const NEW_FIELDS = /^(gear|cybernetics)\.list\.items\.[^.]+\.quality$/;

/**
 * Counted from the powers marked sustained while the sheet counts them
 * (state/psychic.ts), typed in the old build: not compared.
 */
const COUNTED = new Set(["psykana.sustainedPowers", "psykana.effectivePR"]);

/**
 * Since migration 000031 the maximums and restoration of cognition and energy
 * are stats with a base and modifiers (ResourceField.tsx), four fields where
 * the old build had three numbers, which read 0 since the migration; the cost
 * of the Processes is new there too. The fields and the rows of the Techno
 * Arcana bar are not compared.
 */
const TECHNO_BAR = /technoArcana\.(currentCognition|currentEnergy|maxCognition|restoreCognition|maxEnergy|(cognition|energy)(Max|Restore)Total|compensationRoll|processCostTotal)\b/;

/** New in the roll dropdowns: the Sustain row of a psychic power; the X, Fatigue and Process of a tech power's price. */
const NEW_ROLL_FIELDS = /\.roll\.(sustainChoice\.|x$|energyAsFatigue$|holdInProcess$)/;

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

/**
 * The damage and penetration of attacks and powers show their total
 * with modifiers (blocks/ModdedField.tsx) where the old build had the field,
 * and Sustained Powers is counted (sustainedCount) while the sheet counts
 * sustained powers: compared as the old fields.
 */
const asOldField = (key: string) =>
    key.replace(/\.(damage|pen)Total(?=#|$)/, ".$1").replace(/\bpsykana\.sustainedCount\b/, "psykana.sustainedPowers");

/** A damage or penetration as its total writes the dice: "d10+2" is "1d10+2". */
const asTotal = ([path, value]: [string, unknown]): [string, unknown] =>
    /\.(damage|pen)$/.test(path) && typeof value === "string"
        ? [path, value.replace(/(^|[^\w])d(\d)/g, (_, before, sides) => `${before}1d${sides}`)]
        : [path, value];

/** The Psykana and Techno Arcana headings are as wide as their text, for the ⚙ right of them; the old ones spanned the block. */
const TEXT_WIDE = /^h2@:(Psykana|TechnoArcana)#/;

/**
 * What the new build adds and the comparison hides: the ⚙ of modifiers and of
 * a power, the psykana settings, notice, phenomena roll and sustained powers,
 * the quality of gear and implants.
 */
const NEW_UI = ".mod-toggle, .power-traits, .psykana-settings, .psykana-notice, .phenomena-roll, .sustained-list, .sustain-pill, .quality-select";

/** Off by at most this many pixels counts as the same place (subpixel rounding). */
const TOLERANCE = 1;

/**
 * Sides compared in a tab strip and in the field rows of attacks and powers.
 * The open tab label keeps its block's side padding instead of the old 5px
 * (f3ca545), so its width and the labels after it differ; the inputs of a field
 * row share its width in fixed proportions, unlike in the old build, and
 * fieldRowDifferences compares the rows instead.
 */
const VERTICAL_SIDES = ["y", "h"] as const;
const SIDES = ["x", "y", "w", "h"] as const;

/** The fields of attacks and powers and their labels. */
const FIELD_ROW = /^(field:|label[@>])(rangedAttacks|meleeAttacks|psykana|technoArcana)\./;

/** The item or profile tab of a field row element: the path of a label, the path of a field without its name. */
function ownerOf(key: string): string {
    const path = key.replace(/^(field:|label@)/, "").replace(/[:#].*$/, "");
    return key.startsWith("field:") ? path.slice(0, path.lastIndexOf(".")) : path;
}

/**
 * How the field rows of attacks and powers differ from the old build, the
 * widths of their fields aside: a row that starts or ends elsewhere, its
 * fields and labels in another order, or overlapping.
 */
function fieldRowDifferences(now: Map<string, Box>, before: Map<string, Box>): string[] {
    const owners = new Map<string, Box[]>();
    for (const b of now.values()) {
        // A label with its field inside covers the field; the tab strip is compared by itself.
        if (!FIELD_ROW.test(b.key) || b.key.startsWith("label>") || b.inTabStrip || !before.has(b.key)) continue;
        const owner = ownerOf(b.key);
        // The psykana bar reads Current PR where it read Effective PR, so its centred row is narrower.
        if (owner === "psykana") continue;
        owners.set(owner, [...(owners.get(owner) ?? []), b]);
    }
    const middle = (b: Box) => b.y + b.h / 2;
    const out: string[] = [];
    for (const boxes of owners.values()) {
        // A label and its input share a middle, not a top.
        const rows: Box[][] = [];
        for (const b of boxes.sort((a, b) => middle(a) - middle(b))) {
            const row = rows.at(-1);
            if (row && middle(b) - middle(row[0]) <= 2) row.push(b);
            else rows.push([b]);
        }
        for (const row of rows) {
            const inNew = [...row].sort((a, b) => a.x - b.x);
            const old = [...row].map(b => before.get(b.key)!).sort((a, b) => a.x - b.x);
            const keys = inNew.map(b => b.key);
            const first = inNew[0], last = inNew.at(-1)!;
            if (Math.abs(first.x - old[0].x) > TOLERANCE || Math.abs(last.x + last.w - (old.at(-1)!.x + old.at(-1)!.w)) > TOLERANCE) {
                out.push(`row of ${first.key}: spans ${first.x}..${last.x + last.w}, was ${old[0].x}..${old.at(-1)!.x + old.at(-1)!.w}`);
            }
            if (keys.join() !== old.map(b => b.key).join()) out.push(`row of ${first.key}: order ${keys.join(", ")}, was ${old.map(b => b.key).join(", ")}`);
            inNew.slice(1).forEach((b, i) => {
                if (inNew[i].x + inNew[i].w > b.x + TOLERANCE) out.push(`${inNew[i].key} overlaps ${b.key}`);
            });
        }
    }
    return out;
}

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
                const snapshot = (await valueSnapshot(current))
                    .map(([path, value]): [string, unknown] => asTotal([asOldField(path), value]))
                    .filter(([path]) => !COUNTED.has(path) && !TECHNO_BAR.test(path) && !NEW_FIELDS.test(path));
                expect(snapshot.length, "fields of a filled sheet").toBeGreaterThan(500);
                const now = byGroup(snapshot);
                const oldSnapshot = (await valueSnapshot(old))
                    .filter(([path]) => !GONE.has(path) && !COUNTED.has(path) && !TECHNO_BAR.test(path)).map(asTotal);
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
                    const newRolls = (await valueSnapshot(current)).filter(([path]) => ofPower([path, null]) && !NEW_ROLL_FIELDS.test(path));
                    expect(newRolls, power).toEqual(oldRolls.filter(ofPower));
                }
                expectNoErrors([current]);
                old.takeErrors();
            });

            describe("geometry matches", () => {
                beforeAll(async () => {
                    // The new sheet narrows in a narrower room; this wide, it is 1200px with the controls beside it, as in the old build.
                    for (const p of [current, old]) await p.page.setViewportSize({ width: 1920, height: 1000 });
                    // The Test Options button is new in the first row of psykana and techno arcana; hidden, the rest lines up.
                    await current.page.evaluate(newUi => {
                        for (const el of Array.from(window.__e2e.root().querySelectorAll<HTMLElement>(`.test-options, ${newUi}`))) {
                            el.style.setProperty("display", "none", "important");
                        }
                    }, NEW_UI);
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
                        const boxes = await boxSnapshot(current);
                        expect(boxes.length, "visible elements").toBeGreaterThan(20);
                        const now = new Map(boxes.map(b => ({ ...b, key: asOldField(b.key) }))
                            .filter(b => !TECHNO_BAR.test(b.key)).map(b => [b.key, b]));
                        // The old left skill table had empty check labels next to the checkboxes.
                        const before = new Map((await boxSnapshot(old)).filter(b => !b.emptyCheckLabel && !TECHNO_BAR.test(b.key)).map(b => [b.key, b]));

                        const moved = (a: Box, b: Box) =>
                            (a.inTabStrip || FIELD_ROW.test(a.key) || TEXT_WIDE.test(a.key) ? VERTICAL_SIDES : SIDES).some(k => Math.abs(a[k] - b[k]) > TOLERANCE);
                        const differences = {
                            onlyNew: [...now.keys()].filter(k => !before.has(k) && !NEW_ONLY.some(re => re.test(k))),
                            onlyOld: [...before.keys()].filter(k => !now.has(k)),
                            moved: [...now.values()]
                                .filter(b => before.has(b.key) && moved(b, before.get(b.key)!))
                                .map(b => ({ key: b.key, now: [b.x, b.y, b.w, b.h], old: (({ x, y, w, h }) => [x, y, w, h])(before.get(b.key)!) })),
                            fieldRows: fieldRowDifferences(now, before),
                        };
                        expect(differences).toEqual({ onlyNew: [], onlyOld: [], moved: [], fieldRows: [] });
                        expectNoErrors([current]);
                        old.takeErrors();
                    });
                }
            });
        });
    }
});
