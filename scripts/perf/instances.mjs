// How many sheets a page can hold as state without rendering them: the
// encounter of GM mode keeps a sheet per participant (_prd/gm_mode). Builds
// the state of one sheet N times in headless Chrome and times it.
//
//   node scripts/perf/instances.mjs --sheet 59 [--counts 10,30,50] [--runs 5] [--base URL] [--auth FILE] [--json out.json]
//
// "build" is the signal tree and the computeds attached to it; computeds are
// lazy, so "read" adds the first read of what the GM's client sorts by: the
// initiative modifier and the Agility of each sheet.

import { parseArgs } from 'node:util';
import { existsSync, writeFileSync } from 'node:fs';
import * as esbuild from 'esbuild';
import { fail, launch, newPage, stats } from './lib.mjs';

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

// Builds the sheet state the way the page does, one sheet after another: the
// page holds one sheet at a time for now.
const ENTRY = `
import { initState, characterState } from "./ui/static/js/sheet/state/state";
import { kindOf } from "./ui/static/js/sheet/kinds/index";

window.__instances = {
    run(payload, n) {
        const kind = kindOf(payload.kind);
        let t = performance.now();
        const build = [];
        for (let i = 0; i < n; i++) {
            initState(kind, payload.content);
            build.push(performance.now() - t);
            t = performance.now();
        }
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
            initState(kind, payload.content);
            void characterState.initiative.modifier.value;
            void characterState.characteristics.A.calculatedValue.value;
        }
        return { build: build.reduce((a, b) => a + b, 0), buildAndRead: performance.now() - t0 };
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

    const results = {};
    for (const n of counts) {
        const samples = [];
        for (let i = 0; i < runs; i++) samples.push(await page.evaluate(([p, k]) => window.__instances.run(p, k), [payload, n]));
        const build = stats(samples.map(s => s.build));
        const buildAndRead = stats(samples.map(s => s.buildAndRead));
        results[n] = { build, buildAndRead, perSheet: Math.round((build.median / n) * 100) / 100 };
        console.log(`${String(n).padStart(3)} sheets: build ${build.median} ms (p90 ${build.p90}), with the first read ${buildAndRead.median} ms; ${results[n].perSheet} ms a sheet`);
    }
    if (errors.length) fail(`Page errors:\n${errors.join('\n')}`);
    if (opts.json) writeFileSync(opts.json, JSON.stringify({ sheet: opts.sheet, runs, results }, null, 2) + '\n');
} finally {
    await browser.close();
}
