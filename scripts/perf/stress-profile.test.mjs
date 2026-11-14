import { transformSync } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { functionNameAt, profileTops, sourceLocator, traceSummary } from './stress-profile.mjs';

/** A CDP profile from [node id, function, parent id] and samples 1 ms apart. */
function cpuProfile(nodes, samples) {
    const all = nodes.map(([id, functionName]) => ({ id, callFrame: { functionName, url: '' }, children: [] }));
    for (const [id, , parent] of nodes) if (parent) all.find(n => n.id === parent).children.push(id);
    return { nodes: all, startTime: 0, endTime: samples.length * 1000, samples, timeDeltas: samples.map((_, i) => (i ? 1000 : 0)) };
}

const byName = frame => ({ fn: frame.functionName, file: frame.functionName.startsWith('(') ? undefined : 'a.ts', line: 1 });

describe('profileTops', () => {
    const tree = [[1, '(root)'], [2, 'render', 1], [3, 'diff', 2], [4, '(idle)', 1], [5, '(program)', 1]];

    it('sums self and total time per repeat, without idle time', () => {
        const p = cpuProfile(tree, [3, 3, 2, 4, 4, 5]);
        const tops = profileTops([p, p], 2, byName);
        expect(tops.profiled).toBe(3);
        expect(tops.self).toEqual([{ ms: 2, fn: 'diff a.ts:1' }, { ms: 1, fn: 'render a.ts:1' }]);
        expect(tops.total).toEqual([{ ms: 3, fn: 'render a.ts:1' }, { ms: 2, fn: 'diff a.ts:1' }]);
        expect(tops.files).toEqual([{ ms: 3, fn: 'a.ts' }]);
    });

    it('counts a recursive function once in total', () => {
        const p = cpuProfile([[1, '(root)'], [2, 'diff', 1], [3, 'diff', 2]], [3, 3]);
        expect(profileTops([p], 1, frame => ({ fn: frame.functionName, file: 'a.ts', line: 1 })).total)
            .toContainEqual({ ms: 2, fn: 'diff a.ts:1' });
    });
});

describe('sourceLocator', () => {
    it('names a minified function after its source and line', () => {
        const source = 'export const unused = 1;\n\nexport function buildEntryIndex(state) {\n    return state.size + 1;\n}\n';
        const out = transformSync(source, { loader: 'ts', minify: true, sourcemap: 'external', sourcefile: '../js/sheet/kinds/computed.ts', format: 'esm' });
        const lines = out.code.split('\n');
        const line = lines.findIndex(l => l.includes('function'));
        const column = lines[line].indexOf('function');
        const locate = sourceLocator('http://x/static/dist/room.js', out.map);
        expect(locate({ url: 'http://x/static/dist/room.js?v=1', functionName: 'o', lineNumber: line, columnNumber: column }))
            .toEqual({ fn: 'buildEntryIndex', file: 'sheet/kinds/computed.ts', line: 3 });
        expect(locate({ url: '', functionName: '(garbage collector)', lineNumber: -1, columnNumber: -1 })).toEqual({ fn: '(garbage collector)' });
        expect(locate({ url: '', functionName: 'sync', lineNumber: 0, columnNumber: 0 })).toEqual({ fn: '(sync)' });
    });
});

describe('functionNameAt', () => {
    it('finds the name of a declared, a method or an assigned function', () => {
        expect(functionNameAt('export function collectEntries(state, type) {', 7)).toBe('collectEntries');
        expect(functionNameAt('    async save(path) {', 4)).toBe('save');
        expect(functionNameAt('const talentNames = (state) => {', 20)).toBe('talentNames');
        expect(functionNameAt('    }, [a, b]);', 4)).toBe(null);
    });
});

describe('traceSummary', () => {
    const meta = (pid, tid, name) => ({ ph: 'M', name: 'thread_name', pid, tid, args: { name } });
    const x = (name, ts, dur, pid = 1, tid = 10) => ({ ph: 'X', name, ts, dur, pid, tid });
    const events = [
        { name: 'TracingStartedInBrowser', args: { data: { frames: [{ url: 'http://x/room', processId: 1 }, { url: 'http://x/room', processId: 2, parent: 'f' }] } } },
        meta(1, 10, 'CrRendererMain'), meta(2, 20, 'CrRendererMain'),
        x('RunTask', 0, 10_000), x('Layout', 1000, 3000), x('Layout', 2000, 1000), x('Paint', 5000, 2000),
        x('RunTask', 20_000, 4000), x('PaintArtifactCompositor::Update', 20_000, 4000),
        x('RunTask', 0, 50_000, 2, 20),
    ];

    it('sums the frame events of the page main thread, nested ones once', () => {
        expect(traceSummary(events, 'http://x/room')).toEqual({
            busy: 14,
            totals: { UpdateLayoutTree: 0, Layout: 3, Paint: 2, 'PaintArtifactCompositor::Update': 4 },
            self: [
                { ms: 5, name: 'RunTask' },
                { ms: 4, name: 'PaintArtifactCompositor::Update' },
                { ms: 3, name: 'Layout' },
                { ms: 2, name: 'Paint' },
            ],
        });
    });

    it('fails without the page in the trace', () => {
        expect(() => traceSummary(events, 'http://x/other')).toThrow(/No renderer main thread/);
    });
});
