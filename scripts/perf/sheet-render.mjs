// Measures character sheet render time and payload size in headless Chrome.
//
//   node scripts/perf/sheet-render.mjs login   [--base URL]
//   node scripts/perf/sheet-render.mjs measure --room 5 --sheet 64 --other 65 [--runs 5] [--base URL] [--json out.json]
//
// `login` opens a visible Chrome on the login page; sign in by hand and the
// session is saved to --auth (gitignored). `measure` reuses that session.
// Headless pages count as visible, so rAF is not throttled the way it is in a
// background tab.

import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import { writeFileSync, existsSync } from 'node:fs';

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

function fail(msg) {
    console.error(msg);
    process.exit(1);
}

async function login() {
    const browser = await chromium.launch({ channel: 'chrome', headless: false });
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

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const context = await browser.newContext({ storageState: opts.auth, viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));

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

async function openSheet(page, url) {
    const res = await page.goto(url, { waitUntil: 'load' });
    if (new URL(page.url()).pathname.startsWith('/user/login')) {
        fail('Session expired; run "login" again');
    }
    if (!res.ok()) fail(`GET ${url}: ${res.status()}`);
    await page.waitForFunction(() => document.getElementById('charactersheet')?.shadowRoot);
}

// Click a sheet in the room list and time it up to the first frame after init.
function switchSheet(page, sheetId) {
    return page.evaluate(async id => {
        performance.clearResourceTimings();
        let tInserted;
        const inserted = new Promise(resolve => document.addEventListener('charactersheet_inserted', () => {
            tInserted = performance.now();
            resolve();
        }, { once: true }));
        const t0 = performance.now();
        const link = document.querySelector(`a[href="/sheet/view/${id}"]`);
        if (!link) throw new Error(`No link to sheet ${id} in the room list`);
        link.click();
        await inserted;
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const tFrame = performance.now();
        const fetch = performance.getEntriesByType('resource').find(e => e.name.includes(`/sheet/view/${id}`));
        return {
            total: tFrame - t0,
            fetch: fetch.responseEnd - fetch.startTime,
            parseInit: tInserted - fetch.responseEnd,
            frame: tFrame - tInserted,
        };
    }, sheetId);
}

async function payloadSizes(page, context) {
    const urls = await page.evaluate(() => performance.getEntriesByType('resource')
        .map(e => e.name)
        .filter(u => /\.m?js(\?|$)/.test(u)));

    const sheetJs = urls.filter(u => u.includes('/static/js/sheet/'));
    const bodies = [];
    for (const url of sheetJs) {
        bodies.push(await (await context.request.get(url)).body());
    }
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
        otherScripts: urls.filter(u => !u.includes('/static/js/sheet/')).map(u => u.split('?')[0]),
    };
}

function sum(xs) {
    return xs.reduce((a, b) => a + b, 0);
}

function summarize(samples) {
    const out = {};
    for (const key of Object.keys(samples[0])) {
        const xs = samples.map(s => s[key]).filter(v => v != null).sort((a, b) => a - b);
        if (!xs.length) continue;
        out[key] = {
            median: round(xs[Math.floor(xs.length / 2)]),
            min: round(xs[0]),
            max: round(xs[xs.length - 1]),
        };
    }
    return out;
}

function round(x) {
    return Math.round(x * 10) / 10;
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
