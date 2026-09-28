// What the rows of a stress run mean: budgets exceeded, growth from Stress M
// to Stress XL, changes between two runs. A row is one scenario on one
// profile at one CPU rate: { scenario, type, profile, cpu, median, p90, … },
// or with error instead of the statistics when the scenario failed.

import { round } from './lib.mjs';
import { BUDGET_CPU, BUDGETS } from './stress-scenarios.mjs';

/** Types whose cost should not depend on the size of the sheet. */
const FLAT = new Set(['input', 'click', 'add', 'delete', 'remote']);

export const GROWTH_WARN = 1.5;

/** A difference below either is noise: timings of the same build differ that much between runs. */
export const NOISE = { ratio: 0.2, ms: 1 };

const sameCase = (a, b) => a.scenario === b.scenario && a.profile === b.profile && a.cpu === b.cpu;

/** Rows over the budget of their type, checked at CPU BUDGET_CPU× only. */
export function budgetViolations(rows) {
    const out = [];
    for (const r of rows) {
        const budget = BUDGETS[r.type];
        if (!budget || r.cpu !== BUDGET_CPU) continue;
        for (const stat of ['median', 'p90']) {
            if (budget[stat] !== undefined && r[stat] > budget[stat]) {
                out.push({ scenario: r.scenario, profile: r.profile, cpu: r.cpu, stat, value: r[stat], budget: budget[stat] });
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

/** The medians of the rows both runs have; change is "slower" or "faster" when it is not noise. */
export function compareRows(before, after) {
    const out = [];
    for (const a of after) {
        const b = before.find(r => sameCase(r, a));
        if (!b || a.error || b.error) continue;
        const delta = round(a.median - b.median);
        const pct = b.median > 0 ? Math.round((delta / b.median) * 100) : null;
        const noise = Math.abs(delta) <= NOISE.ms || Math.abs(delta) <= NOISE.ratio * b.median;
        out.push({
            scenario: a.scenario, profile: a.profile, cpu: a.cpu, before: b.median, after: a.median, delta, pct,
            change: noise ? null : delta > 0 ? 'slower' : 'faster',
        });
    }
    return out;
}
