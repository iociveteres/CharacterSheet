// How many sheets a page can hold as instances without rendering them: the
// encounter of GM mode keeps one per participant (_prd/gm_mode). Creates N
// instances of one full sheet side by side in headless Chrome and measures
// them.
//
//   node scripts/perf/instances.mjs --sheet 59 [--counts 10,30,50] [--runs 5] [--base URL] [--auth FILE] [--json out.json]
//
// build   creating the N instances: the signal tree and the computeds of each
//         (computeds are lazy, so nothing is computed yet);
// read    the first read of what the GM's client sorts by: the initiative
//         modifier and the Agility of each sheet;
// heap    what the N instances hold, after garbage collection, and per sheet;
// remote  applying one remote edit of Agility to one of them, as network.ts
//         does, with the initiative modifier read again.

import { parseArgs } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { fail, launch, newPage, round, stats } from './lib.mjs';

const { values: opts } = parseArgs({
    options: {
        base: { type: 'string', default: 'http://localhost:4002' },
        auth: { type: 'string', default: 'scripts/perf/.auth.json' },
        sheet: { type: 'string' },
        counts: { type: 'string', default: '10,30,50' },
        runs: { type: 'string', default: '5' },
        json: { type: 'string' },
    },
});
if (!opts.sheet) fail('--sheet is required');
if (!existsSync(opts.auth)) fail(`No session at ${opts.auth}; run "node scripts/perf/sheet-render.mjs login" first`);
const base = opts.base.replace(/\/$/, '');
const counts = opts.counts.split(',').map(Number);
const runs = Number(opts.runs);
const EDITS = 200;

const ENTRY = `
import { createSheetInstance } from "./ui/static/js/sheet/instance";

let held = [];

window.__instances = {
    create(payload, n) {
        const t0 = performance.now();
        for (let i = 0; i < n; i++) held.push(createSheetInstance({ ...payload, sheetId: "perf-" + i }));
        const build = performance.now() - t0;
        const t1 = performance.now();
        for (const s of held) {
            void s.state.initiative.modifier.value;
            void s.state.characteristics.A.calculatedValue.value;
        }
        return { build, read: performance.now() - t1 };
    },
    remote(edits) {
        const t0 = performance.now();
        for (let i = 0; i < edits; i++) {
            const s = held[i % held.length];
            document.dispatchEvent(new CustomEvent("ws:change", { detail: {
                type: "change", eventID: "perf", sheetID: s.sheetId, path: "characteristics.A.value", change: String(30 + (i % 20)),
            } }));
            void s.state.initiative.modifier.value;
        }
        return (performance.now() - t0) / edits;
    },
    dispose() {
        for (const s of held) s.dispose();
        held = [];
    },
};
`;

const bundle = await esbuild.build({
    stdin: { contents: ENTRY, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2022',
    minify: true,
    jsx: 'automatic',
    jsxImportSource: 'preact',
    define: { __DEV__: 'false' },
    logLevel: 'error',
});

const browser = await launch();
try {
    const { page, errors } = await newPage(browser, opts.auth);
    const res = await page.request.get(`${base}/sheet/view/${opts.sheet}`, { headers: { Accept: 'application/json' } });
    if (!res.ok()) fail(`GET /sheet/view/${opts.sheet}: ${res.status()}`);
    const payload = await res.json();
    console.log(`Sheet ${opts.sheet} (${payload.kind}): ${JSON.stringify(payload.content).length} bytes of content`);

    // A blank page has no Content Security Policy to refuse the inline bundle.
    await page.goto('about:blank');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const cdp = await page.context().newCDPSession(page);
    const heap = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return (await cdp.send('Runtime.getHeapUsage')).usedSize / 1024 / 1024;
    };

    const results = {};
    for (const n of counts) {
        const samples = [];
        for (let i = 0; i < runs; i++) {
            const before = await heap();
            const { build, read } = await page.evaluate(([p, k]) => window.__instances.create(p, k), [payload, n]);
            const held = (await heap()) - before;
            const remote = await page.evaluate(e => window.__instances.remote(e), EDITS);
            await page.evaluate(() => window.__instances.dispose());
            samples.push({ build, read, heap: held, remote: remote * 1000 });
        }
        const s = key => stats(samples.map(x => x[key]));
        const r = results[n] = { build: s('build'), read: s('read'), heapMB: s('heap'), remoteUs: s('remote') };
        console.log(`${String(n).padStart(3)} sheets: build ${r.build.median} ms (${round(r.build.median / n)} a sheet), `
            + `read ${r.read.median} ms, heap ${r.heapMB.median} MB (${round(r.heapMB.median / n)} a sheet), `
            + `remote edit ${r.remoteUs.median} µs`);
    }
    if (errors.length) fail(`Page errors:\n${errors.join('\n')}`);
    if (opts.json) writeFileSync(opts.json, JSON.stringify({ sheet: opts.sheet, runs, edits: EDITS, results }, null, 2) + '\n');
} finally {
    await browser.close();
}
