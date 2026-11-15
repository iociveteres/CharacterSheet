// What the rows of a stress run mean: budgets exceeded, growth from Stress M
// to Stress XL, changes between two runs. A row is one scenario on one
// profile at one CPU rate: { scenario, type, profile, cpu, median, p90, … }
// of sync, with the statistics of task, script, style, layout and frame
// where measured, or with error instead when the scenario failed.

import { round, stats } from './lib.mjs';
import { BUDGET_CPU, BUDGETS } from './stress-scenarios.mjs';

/** Types whose cost should not depend on the size of the sheet. */
const FLAT = new Set(['input', 'click', 'add', 'delete', 'remote', 'remoteGrid']);

export const GROWTH_WARN = 1.5;

/** A difference below either is noise: timings of the same build differ that much between runs. */
export const NOISE = { ratio: 0.2, ms: 1 };

/** Event Timing reports nothing shorter: an action without an entry counts as this. */
export const FRAME_FLOOR = 16;

/** stats of Event Timing durations (null: none reported); under16 is how many had none. */
export function frameStats(samples) {
    return { ...stats(samples.map(x => x ?? FRAME_FLOOR)), under16: samples.filter(x => x === null).length };
}

/** Parts of the main-thread time a row may have, each with its statistics. */
export const MAIN_THREAD = ['task', 'script', 'style', 'layout'];

const sameCase = (a, b) => a.scenario === b.scenario && a.profile === b.profile && a.cpu === b.cpu;

/** Rows over the budget of their type, checked at CPU BUDGET_CPU× only; a row without the metric has none to exceed. */
export function budgetViolations(rows, budgets = BUDGETS) {
    const out = [];
    for (const r of rows) {
        if (!budgets[r.type] || r.cpu !== BUDGET_CPU || r.error) continue;
        for (const [metric, budget] of Object.entries(budgets[r.type])) {
            // sync is the row's own statistics, the other metrics are fields of it.
            const s = metric === 'sync' ? r : r[metric];
            for (const stat of ['median', 'p90']) {
                if (s && budget[stat] !== undefined && s[stat] > budget[stat]) {
                    out.push({ scenario: r.scenario, profile: r.profile, cpu: r.cpu, metric, stat, value: s[stat], budget: budget[stat] });
                }
            }
        }
    }
    return out;
}

/**
 * XL/M of the medians of each scenario and CPU rate. A warning for a type that
 * should not grow, when XL costs over GROWTH_WARN times as much and the
 * difference is not noise; loads grow with the sheet and are only reported.
 */
export function growthOf(rows) {
    const out = [];
    for (const xl of rows.filter(r => r.profile === 'XL')) {
        const m = rows.find(r => sameCase(r, { ...xl, profile: 'M' }));
        if (!m || m.error || xl.error) continue;
        const ratio = m.median > 0 ? round(xl.median / m.median) : null;
        const warn = FLAT.has(xl.type) && ratio !== null && ratio > GROWTH_WARN && xl.median - m.median > NOISE.ms;
        out.push({ scenario: xl.scenario, cpu: xl.cpu, m: m.median, xl: xl.median, ratio, warn });
    }
    return out;
}

/**
 * The medians of sync of the rows both runs have; change is "slower" or
 * "faster" when it is not noise. frame is [before, after] of the frame
 * medians, and parts of task, script, style and layout, when both runs have them.
 */
export function compareRows(before, after) {
    const out = [];
    for (const a of after) {
        const b = before.find(r => sameCase(r, a));
        if (!b || a.error || b.error) continue;
        const delta = round(a.median - b.median);
        const pct = b.median > 0 ? Math.round((delta / b.median) * 100) : null;
        const noise = Math.abs(delta) <= NOISE.ms || Math.abs(delta) <= NOISE.ratio * b.median;
        const parts = Object.fromEntries(MAIN_THREAD.filter(k => a[k] && b[k]).map(k => [k, [b[k].median, a[k].median]]));
        out.push({
            scenario: a.scenario, profile: a.profile, cpu: a.cpu, before: b.median, after: a.median, delta, pct,
            change: noise ? null : delta > 0 ? 'slower' : 'faster',
            frame: a.frame && b.frame ? [b.frame.median, a.frame.median] : null,
            parts: Object.keys(parts).length ? parts : null,
        });
    }
    return out;
}
