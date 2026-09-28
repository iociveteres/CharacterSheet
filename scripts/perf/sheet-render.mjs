// Measures character sheet render time and payload size in headless Chrome.
//
//   node scripts/perf/sheet-render.mjs login   [--base URL]
//   node scripts/perf/sheet-render.mjs measure --room 5 --sheet 64 --other 65 [--runs 5] [--base URL] [--json out.json]
//
// `login` opens a visible Chrome on the login page; sign in by hand and the
// session is saved to --auth (gitignored). `measure` reuses that session.
// Headless pages count as visible, so rAF is not throttled the way it is in a
// background tab.

import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { writeFileSync, existsSync } from 'node:fs';
import { fail, launch, newPage, openSheet, sum, summarize, switchSheet } from './lib.mjs';

const { positionals, values: opts } = parseArgs({
    allowPositionals: true,
    options: {
        base: { type: 'string', default: 'http://localhost:4001' },
        auth: { type: 'string', default: 'scripts/perf/.auth.json' },
        room: { type: 'string' },
        sheet: { type: 'string' },
        other: { type: 'string' },
        runs: { type: 'string', default: '5' },
        json: { type: 'string' },
    },
});

const command = positionals[0];
const base = opts.base.replace(/\/$/, '');

if (command === 'login') {
    await login();
} else if (command === 'measure') {
    for (const key of ['room', 'sheet', 'other']) {
        if (!opts[key]) fail(`--${key} is required`);
    }
    await measure();
} else {
    fail('usage: sheet-render.mjs login|measure [options]');
}

async function login() {
    const browser = await launch({ headless: false });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/user/login`);
    console.log('Sign in in the opened window; waiting up to 5 minutes...');
    await page.waitForURL(url => !url.pathname.startsWith('/user/login'), { timeout: 5 * 60_000 });
    await context.storageState({ path: opts.auth });
    console.log(`Session saved to ${opts.auth}`);
    await browser.close();
}

async function measure() {
    if (!existsSync(opts.auth)) fail(`No session at ${opts.auth}; run "login" first`);
    const runs = Number(opts.runs);
    const sheetUrl = `${base}/room/sheet/view/${opts.room}/${opts.sheet}`;

    const browser = await launch();
    const { context, page, errors: pageErrors } = await newPage(browser, opts.auth);

    // Warm the HTTP cache once, as a returning player would have it.
    await openSheet(page, sheetUrl);

    const direct = [];
    for (let i = 0; i < runs; i++) {
        await openSheet(page, sheetUrl);
        direct.push(await page.evaluate(() => {
            const n = performance.getEntriesByType('navigation')[0];
            const fcp = performance.getEntriesByName('first-contentful-paint')[0];
            return {
                dclEnd: n.domContentLoadedEventEnd,
                dclHandler: n.domContentLoadedEventEnd - n.domContentLoadedEventStart,
                fcp: fcp ? fcp.startTime : null,
                load: n.loadEventEnd,
            };
        }));
    }

    const sizes = await payloadSizes(page, context);

    const switches = [];
    for (let i = 0; i < runs; i++) {
        await switchSheet(page, opts.other);
        switches.push(await switchSheet(page, opts.sheet));
    }

    await browser.close();

    const result = {
        date: new Date().toISOString(),
        base, room: opts.room, sheet: opts.sheet, other: opts.other, runs,
        direct: summarize(direct),
        switch: summarize(switches),
        sizes,
        pageErrors,
    };
    print(result);
    if (opts.json) writeFileSync(opts.json, JSON.stringify(result, null, 2));
}

async function payloadSizes(page, context) {
    const urls = await page.evaluate(() => performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => /\.m?js(\?|$)/.test(u)));

    // Unbundled modules before stage 0, dist/sheet.js after it, dist/room.js
    // (the room and the sheet) since stage 0 of the room.
    const isSheetJs = u => u.includes('/static/js/sheet/') || u.includes('/static/dist/');
    const sheetJs = urls.filter(isSheetJs);
    const bodies = [];
    for (const url of sheetJs) {
        bodies.push(await (await context.request.get(url)).body());
    }
    // What a switch fetches: the HTML fragment before stage 5, the sheet JSON since.
    const fragment = await (await context.request.get(`${base}/sheet/view/${opts.sheet}`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest' },
    })).body();

    return {
        sheetJs: {
            files: bodies.length,
            raw: sum(bodies.map(b => b.length)),
            gzipPerFile: sum(bodies.map(b => gzipSync(b, { level: 6 }).length)),
            gzipConcat: gzipSync(Buffer.concat(bodies), { level: 6 }).length,
        },
        fragment: { raw: fragment.length, gzip: gzipSync(fragment, { level: 6 }).length },
        otherScripts: urls.filter(u => !isSheetJs(u)).map(u => u.split('?')[0]),
    };
}

function print(r) {
    const row = (name, s) => `  ${name.padEnd(12)} ${String(s.median).padStart(7)} ms  (${s.min}–${s.max})`;
    console.log(`Sheet ${r.sheet} in room ${r.room}, ${r.runs} runs, median (min–max)`);
    console.log('Direct load');
    for (const [k, s] of Object.entries(r.direct)) console.log(row(k, s));
    console.log(`Switch ${r.other} → ${r.sheet}`);
    for (const [k, s] of Object.entries(r.switch)) console.log(row(k, s));
    const js = r.sizes.sheetJs;
    console.log(`Sheet JS: ${js.files} files, ${js.raw} B, gzip ${js.gzipConcat} B as one file (${js.gzipPerFile} B per file)`);
    console.log(`Sheet fragment: ${r.sizes.fragment.raw} B, gzip ${r.sizes.fragment.gzip} B`);
    if (r.pageErrors.length) console.log(`Page errors:\n  ${r.pageErrors.join('\n  ')}`);
}
