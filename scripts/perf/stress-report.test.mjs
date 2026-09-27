import { describe, expect, it } from 'vitest';
import { budgetViolations, compareRows, growthOf } from './stress-report.mjs';

const row = (scenario, type, profile, cpu, median, p90 = median) => ({ scenario, type, profile, cpu, median, p90 });

describe('budgetViolations', () => {
    it('checks the median and p90 at CPU 4× only', () => {
        const rows = [
            row('name', 'input', 'M', 4, 12, 20),
            row('name', 'input', 'M', 1, 12, 20),
            row('roll', 'click', 'XL', 4, 90, 150),
            row('open', 'load', 'XL', 4, 900),
        ];
        expect(budgetViolations(rows)).toEqual([
            { scenario: 'name', profile: 'M', cpu: 4, stat: 'median', value: 12, budget: 10 },
            { scenario: 'name', profile: 'M', cpu: 4, stat: 'p90', value: 20, budget: 16 },
        ]);
    });
});

describe('growthOf', () => {
    it('warns when an action costs over 1.5 times as much on XL', () => {
        const rows = [row('name', 'input', 'M', 4, 2), row('name', 'input', 'XL', 4, 8)];
        expect(growthOf(rows)).toEqual([{ scenario: 'name', cpu: 4, m: 2, xl: 8, ratio: 4, warn: true }]);
    });

    it('does not warn about a difference within the noise', () => {
        const rows = [row('name', 'input', 'M', 4, 0.4), row('name', 'input', 'XL', 4, 1.2)];
        expect(growthOf(rows)[0].warn).toBe(false);
    });

    it('reports loads without a warning', () => {
        const rows = [row('open', 'load', 'M', 4, 100), row('open', 'load', 'XL', 4, 400)];
        expect(growthOf(rows)[0]).toMatchObject({ ratio: 4, warn: false });
    });

    it('pairs rows of the same CPU rate', () => {
        const rows = [row('name', 'input', 'M', 1, 1), row('name', 'input', 'M', 4, 4), row('name', 'input', 'XL', 4, 5)];
        expect(growthOf(rows)).toEqual([{ scenario: 'name', cpu: 4, m: 4, xl: 5, ratio: 1.3, warn: false }]);
    });
});

describe('compareRows', () => {
    it('marks changes over 20% and 1 ms', () => {
        const before = [row('a', 'input', 'M', 4, 10), row('b', 'input', 'M', 4, 2), row('c', 'input', 'M', 4, 10), row('d', 'input', 'M', 4, 40)];
        const after = [row('a', 'input', 'M', 4, 15), row('b', 'input', 'M', 4, 2.9), row('c', 'input', 'M', 4, 11.5), row('d', 'input', 'M', 4, 20)];
        expect(compareRows(before, after).map(c => [c.scenario, c.delta, c.pct, c.change])).toEqual([
            ['a', 5, 50, 'slower'],
            ['b', 0.9, 45, null],
            ['c', 1.5, 15, null],
            ['d', -20, -50, 'faster'],
        ]);
    });

    it('skips rows only one run has', () => {
        expect(compareRows([row('a', 'input', 'M', 4, 1)], [row('a', 'input', 'XL', 4, 1)])).toEqual([]);
    });

    it('skips scenarios that failed in either run', () => {
        const failed = { scenario: 'a', type: 'click', profile: 'M', cpu: 4, error: 'No .test-options-toggle' };
        expect(compareRows([failed], [row('a', 'click', 'M', 4, 20)])).toEqual([]);
        expect(compareRows([row('a', 'click', 'M', 4, 20)], [failed])).toEqual([]);
    });
});
