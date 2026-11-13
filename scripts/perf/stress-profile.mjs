// What --profile and --trace of stress.mjs report: the functions a scenario
// spent its time in, from CDP CPU profiles, and where the main thread's time
// went in a Chrome trace of one action.

import { TraceMap, originalPositionFor, sourceContentFor } from '@jridgewell/trace-mapping';
import { round } from './lib.mjs';

/** Profile nodes that are not the page's work: waiting, V8 outside JS, the root. */
const NOT_WORK = new Set(['(idle)', '(program)', '(root)']);

/**
 * A function's name and place: `fn` alone for V8's own nodes, such as
 * "(garbage collector)", or with `file` and `line` for code.
 * @typedef {{ fn: string, file?: string, line?: number }} Place
 */

/** "fn file:line", or fn for a place without a file. */
export const placeKey = p => (p.file ? `${p.fn} ${p.file}:${p.line}` : p.fn);

/**
 * Self and total time of each function over the CPU profiles of `runs`
 * repeats, in ms per repeat: the `top` of each, and self time summed by file.
 * `locate(callFrame)` gives a node's Place. Recursion counts once in total.
 */
export function profileTops(profiles, runs, locate, top = 20) {
    const self = new Map(), total = new Map(), files = new Map();
    let busy = 0;
    const add = (map, key, ms) => map.set(key, (map.get(key) ?? 0) + ms);
    for (const p of profiles) {
        const nodes = new Map(p.nodes.map(n => [n.id, n]));
        const parent = new Map();
        for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
        const places = new Map();
        const placeOf = id => {
            if (!places.has(id)) places.set(id, locate(nodes.get(id).callFrame));
            return places.get(id);
        };
        // A sample stands for the time up to the next one, as DevTools counts it.
        const times = [];
        let t = p.startTime;
        for (const dt of p.timeDeltas) times.push(t += dt);
        p.samples.forEach((id, i) => {
            const ms = ((times[i + 1] ?? p.endTime) - times[i]) / 1000;
            const place = placeOf(id);
            if (NOT_WORK.has(place.fn) && !place.file) return;
            busy += ms;
            add(self, placeKey(place), ms);
            add(files, place.file ?? place.fn, ms);
            const seen = new Set();
            for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
                const key = placeKey(placeOf(cur));
                if (seen.has(key) || NOT_WORK.has(key)) continue;
                seen.add(key);
                add(total, key, ms);
            }
        });
    }
    const list = (map, n) => [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([fn, ms]) => ({ ms: round(ms / runs), fn }));
    return { runs, profiled: round(busy / runs), self: list(self, top), total: list(total, top), files: list(files, 10) };
}

/**
 * locate for profileTops: code of the bundle at `bundleUrl` is mapped to its
 * sources through `map` (the bundle's source map, as JSON text); other
 * scripts keep their own place. The bundle is minified, so a function's name
 * comes from its source line when the map has none.
 */
export function sourceLocator(bundleUrl, map) {
    const traced = new TraceMap(map);
    const lines = new Map();
    const sourceLine = (source, line) => {
        if (!lines.has(source)) lines.set(source, sourceContentFor(traced, source)?.split('\n') ?? []);
        return lines.get(source)[line - 1] ?? '';
    };
    return frame => {
        // V8's own nodes come in parentheses, "(program)"; functions without a script, such as those of an init script, are put in them.
        if (!frame.url) return { fn: /^\(.*\)$/.test(frame.functionName) ? frame.functionName : `(${frame.functionName || 'native'})` };
        if (frame.url.split('?')[0] !== bundleUrl) {
            return { fn: frame.functionName || '(anonymous)', file: frame.url.split('?')[0].replace(/^.*\//, ''), line: frame.lineNumber + 1 };
        }
        const o = originalPositionFor(traced, { line: frame.lineNumber + 1, column: frame.columnNumber });
        if (!o.source) return { fn: frame.functionName || '(anonymous)', file: bundleUrl.replace(/^.*\//, ''), line: frame.lineNumber + 1 };
        return {
            fn: o.name ?? functionNameAt(sourceLine(o.source, o.line), o.column) ?? '(anonymous)',
            file: shortSource(o.source),
            line: o.line,
        };
    };
}

/** A source of the bundle as AGENTS.md names files: "sheet/core/sync.ts", "node_modules/preact/…". */
export const shortSource = source => source.replace(/^.*?(?=node_modules\/)/, '').replace(/^(\.\.\/)*(ui\/static\/)?js\//, '');

/**
 * The name a function written at `column` of a source line goes by:
 * "function name(", "name(" of a method, "name = (" or "name: (" of an arrow.
 */
export function functionNameAt(line, column) {
    const rest = line.slice(column);
    const declared = /^(?:async\s+)?function\s*\*?\s*([\w$]+)/.exec(rest) ?? /^(?:get |set |async )?([\w$]+)\s*\(/.exec(rest);
    if (declared) return declared[1];
    const assigned = /([\w$]+)\s*[:=]\s*(?:async\s*)?$/.exec(line.slice(0, column));
    return assigned?.[1] ?? null;
}

/** Trace events summed by the trace summary: the frame's style, layout, paint and compositing. */
export const FRAME_EVENTS = ['UpdateLayoutTree', 'Layout', 'Paint', 'PaintArtifactCompositor::Update'];

/**
 * Where the renderer main thread of the page at `url` spent a traced action,
 * ms: busy is the time of its top-level events; totals sums FRAME_EVENTS,
 * counting an event inside one of the same name once; self is the `top`
 * event names by their own time, less the events inside them.
 */
export function traceSummary(events, url, top = 15) {
    const thread = rendererMain(events, url);
    if (!thread) throw new Error(`No renderer main thread of ${url} in the trace`);
    const main = events
        .filter(e => e.ph === 'X' && e.dur !== undefined && e.pid === thread.pid && e.tid === thread.tid)
        .sort((a, b) => a.ts - b.ts || b.dur - a.dur)
        .map(e => ({ name: e.name, ts: e.ts, dur: e.dur, inner: 0 }));
    const self = new Map(), totals = Object.fromEntries(FRAME_EVENTS.map(n => [n, 0]));
    let busy = 0;
    const stack = [];
    for (const e of main) {
        while (stack.length && stack.at(-1).ts + stack.at(-1).dur <= e.ts) stack.pop();
        if (stack.length) stack.at(-1).inner += e.dur;
        else busy += e.dur;
        if (e.name in totals && !stack.some(s => s.name === e.name)) totals[e.name] += e.dur;
        stack.push(e);
    }
    for (const e of main) self.set(e.name, (self.get(e.name) ?? 0) + Math.max(0, e.dur - e.inner));
    const ms = us => round(us / 1000);
    return {
        busy: ms(busy),
        totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, ms(v)])),
        self: [...self].sort((a, b) => b[1] - a[1]).slice(0, top).map(([name, us]) => ({ ms: ms(us), name })),
    };
}

/**
 * The CrRendererMain thread of the process that renders `url`: the trace
 * holds every page of the browser, e.g. the GM's page of remote scenarios.
 */
function rendererMain(events, url) {
    const started = events.find(e => e.name === 'TracingStartedInBrowser');
    const pid = started?.args?.data?.frames?.find(f => f.url === url && !f.parent)?.processId;
    const mains = events.filter(e => e.ph === 'M' && e.name === 'thread_name' && e.args?.name === 'CrRendererMain');
    return mains.find(m => m.pid === pid) ?? null;
}
