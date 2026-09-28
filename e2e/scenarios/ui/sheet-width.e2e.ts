// The sheet in rooms of different widths: it is 1200px where the room has
// the space, narrows down to 1050px, and starts at the room's left edge below
// that. Its controls cover neither the tabs nor the open tab; no tab runs over
// its width, and the inputs of the attacks' and powers' field rows narrow in
// step. Read-only, on the filled sheets.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright-core";
import { config } from "../../lib/config";
import { launch, NAV_TABS, Player, type NavTab } from "../../lib/player";
import { expectNoErrors } from "../../lib/table";

/** Widest first: the field rows are compared with their widths in the full-width sheet. */
const VIEWPORTS = [1920, 1440, 1280];

const WIDEST = 1200;
const NARROWEST = 1050;

/** Subpixel rounding. */
const TOLERANCE = 1;

/** A text input narrower than this shows next to nothing. */
const MIN_INPUT = 24;

/** How far apart the shares of the inputs of one row may be once it narrows: 31px inputs round to within 2%. */
const STEP_TOLERANCE = 0.05;

/** Inputs of their own width: Balance is 5em whatever the row. */
const FIXED = /\.balance$/;

const TABS = Object.keys(NAV_TABS) as NavTab[];

interface Rect { left: number; right: number; top: number; bottom: number }

interface Sheet {
    /** The box the sheet is centered in (the room without its right panel). */
    room: Rect;
    tabs: Rect;
    labels: Rect[];
    panel: Rect;
    controls: Rect;
    /** How far the open tab's content reaches past its width. */
    panelOverflow: number;
    /** How far the skill tables of the Player Sheet reach into the notes; null on other tabs. */
    skillsOverNotes: number | null;
}

interface Field {
    path: string;
    select: boolean;
    width: number;
    /** A select: the width of its longest option. */
    needed: number;
}

interface FieldRow {
    /** The first input of the row. */
    key: string;
    fields: Field[];
    /** Labels whose text is cut. */
    cutLabels: string[];
    /** Children of the row that overlap the next one or reach past the row. */
    crowded: string[];
}

async function measureSheet(p: Player): Promise<Sheet> {
    return p.page.evaluate(() => {
        const root = window.__e2e.root();
        const rect = (el: Element): Rect => {
            const { left, right, top, bottom } = el.getBoundingClientRect();
            return { left, right, top, bottom };
        };
        const tabs = root.getElementById("navigation-tabs")!;
        const panel = tabs.querySelector<HTMLElement>(":scope > .radiotab:checked + .tablabel + .panel")!;
        const tables = Array.from(panel.querySelectorAll(".skill-list table"), t => t.getBoundingClientRect().right);
        const notes = panel.querySelector("#character-sheet-right-col");
        return {
            room: rect(root.querySelector(".container")!),
            tabs: rect(tabs),
            labels: Array.from(tabs.querySelectorAll(":scope > .tablabel"), rect),
            panel: rect(panel),
            controls: rect(root.querySelector(".controls-block")!),
            panelOverflow: panel.scrollWidth - panel.clientWidth,
            skillsOverNotes: tables.length > 0 && notes ? Math.max(...tables) - notes.getBoundingClientRect().left : null,
        };
    });
}

async function measureFieldRows(p: Player): Promise<FieldRow[]> {
    return p.page.evaluate(() => {
        const { root, pathOf } = window.__e2e;
        const items = ".ranged-attack, .melee-attack, .psychic-power, .tech-power";
        const out: FieldRow[] = [];
        for (const row of Array.from(root().querySelectorAll<HTMLElement>(`:is(${items}) .layout-row:not(.split-header)`))) {
            const box = row.getBoundingClientRect();
            // Closed tabs of a melee attack's profiles and of the powers have no layout.
            if (box.width === 0 || row.closest(".roll-dropdown")) continue;
            const labelled = Array.from(row.children).filter(c => c.matches(".layout-row") && c.querySelector(":scope > label"));
            if (labelled.length === 0) continue;

            const fields: Field[] = [];
            const cutLabels: string[] = [];
            for (const field of labelled) {
                const label = field.querySelector<HTMLElement>(":scope > label")!;
                if (label.scrollWidth > label.clientWidth + 1) cutLabels.push(label.textContent ?? "");
                for (const input of Array.from(field.querySelectorAll<HTMLInputElement | HTMLSelectElement>(":scope > input, :scope > select"))) {
                    const width = input.getBoundingClientRect().width;
                    let needed = 0;
                    if (input.tagName === "SELECT") {
                        const was = input.style.width;
                        input.style.width = "max-content";
                        needed = input.getBoundingClientRect().width;
                        input.style.width = was;
                    }
                    fields.push({ path: pathOf(input), select: input.tagName === "SELECT", width, needed });
                }
            }

            const children = Array.from(row.children).filter(c => c.getBoundingClientRect().width > 0);
            const crowded: string[] = [];
            children.forEach((c, i) => {
                const r = c.getBoundingClientRect();
                const next = children[i + 1]?.getBoundingClientRect();
                if (r.right > box.right + 1 || (next && r.right > next.left + 1)) crowded.push(c.className || c.tagName);
            });
            if (fields.length > 0) out.push({ key: fields[0].path, fields, cutLabels, crowded });
        }
        return out;
    });
}

const intersects = (a: Rect, b: Rect) =>
    a.left < b.right - TOLERANCE && b.left < a.right - TOLERANCE && a.top < b.bottom - TOLERANCE && b.top < a.bottom - TOLERANCE;

describe("the sheet in rooms of different widths", () => {
    let browser: Browser;
    let p: Player;

    beforeAll(async () => {
        browser = await launch();
        p = await Player.create(browser, "Reader");
    });

    afterAll(async () => {
        await browser?.close();
    });

    for (const sheet of config.fullSheets) {
        describe(`sheet ${sheet}`, () => {
            /** Input widths in the full-width sheet, by path. */
            const fullWidth = new Map<string, number>();
            let rows = 0;

            beforeAll(async () => {
                await p.page.setViewportSize({ width: VIEWPORTS[0], height: 1000 });
                await p.openSheet(config.fullRoom, sheet);
            });

            for (const viewport of VIEWPORTS) {
                it(`${viewport}px`, async () => {
                    await p.page.setViewportSize({ width: viewport, height: 1000 });

                    for (const tab of TABS) {
                        await p.openNavTab(tab);
                        const s = await measureSheet(p);
                        const room = s.room.right - s.room.left;
                        const width = s.tabs.right - s.tabs.left;
                        const expected = Math.min(WIDEST, Math.max(NARROWEST, room));
                        expect(Math.abs(width - expected), `${tab}: sheet width ${width} in a ${room}px room`).toBeLessThanOrEqual(TOLERANCE);
                        if (width <= room) {
                            expect(Math.abs((s.tabs.left - s.room.left) - (s.room.right - s.tabs.right)), `${tab}: centered`).toBeLessThanOrEqual(TOLERANCE);
                        } else {
                            expect(Math.abs(s.tabs.left - s.room.left), `${tab}: starts at the room's edge`).toBeLessThanOrEqual(TOLERANCE);
                        }

                        expect(intersects(s.controls, s.panel), `${tab}: the controls cover the open tab`).toBe(false);
                        expect(s.labels.filter(l => intersects(s.controls, l)).length, `${tab}: tab labels under the controls`).toBe(0);
                        expect(s.controls.right, `${tab}: the controls reach past the sheet and the room`)
                            .toBeLessThanOrEqual(Math.max(s.room.right, s.tabs.right) + TOLERANCE);

                        expect(s.panelOverflow, `${tab}: content past the tab's width`).toBeLessThanOrEqual(TOLERANCE);
                        if (s.skillsOverNotes !== null) expect(s.skillsOverNotes, "skill tables over the notes").toBeLessThanOrEqual(TOLERANCE);

                        for (const row of await measureFieldRows(p)) {
                            rows++;
                            expect(row.cutLabels, `${row.key}: cut labels`).toEqual([]);
                            expect(row.crowded, `${row.key}: overlapping fields`).toEqual([]);
                            for (const f of row.fields) {
                                if (f.select) expect(f.width, `${f.path}: narrower than its longest option`).toBeGreaterThanOrEqual(f.needed - TOLERANCE);
                                else expect(f.width, `${f.path}: width`).toBeGreaterThanOrEqual(MIN_INPUT);
                            }

                            const shrinking = row.fields.filter(f => !f.select && !FIXED.test(f.path));
                            if (viewport === VIEWPORTS[0]) {
                                for (const f of row.fields) fullWidth.set(f.path, f.width);
                                continue;
                            }
                            for (const f of row.fields.filter(f => !shrinking.includes(f))) {
                                expect(Math.abs(f.width - fullWidth.get(f.path)!), `${f.path}: a field of its own width`).toBeLessThanOrEqual(TOLERANCE);
                            }
                            const shares = shrinking.map(f => f.width / fullWidth.get(f.path)!);
                            if (shares.length > 1) {
                                expect(Math.max(...shares) - Math.min(...shares), `${row.key}: inputs narrow in step (${shares.map(x => x.toFixed(2)).join(", ")})`)
                                    .toBeLessThanOrEqual(STEP_TOLERANCE);
                            }
                        }
                    }
                    expect(rows, "field rows of attacks and powers").toBeGreaterThan(0);
                    expectNoErrors([p]);
                });
            }
        });
    }
});
