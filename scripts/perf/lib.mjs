// What the perf scripts share: Chrome with a saved session, opening and
// switching sheets, CDP metrics and statistics of samples.

import { chromium } from 'playwright-core';
import { createServer } from 'node:net';

export function fail(msg) {
    console.error(msg);
    process.exit(1);
}

/** Headless pages count as visible, so rAF is not throttled the way it is in a background tab. */
export function launch({ headless = true } = {}) {
    return chromium.launch({ channel: 'chrome', headless });
}

/**
 * A page signed in with the session at `auth`, with window.__stress
 * (installStress) and the page errors in `errors`.
 */
export async function newPage(browser, auth) {
    const context = await browser.newContext({ storageState: auth, viewport: { width: 1280, height: 1000 } });
    await context.addInitScript(installStress);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    return { context, page, errors };
}

export async function openSheet(page, url) {
    const res = await page.goto(url, { waitUntil: 'load' });
    if (new URL(page.url()).pathname.startsWith('/user/login')) {
        fail(`Not signed in at ${new URL(url).origin}; run "npm run seed" or "login" again`);
    }
    if (!res.ok()) fail(`GET ${url}: ${res.status()}`);
    await page.waitForFunction(() => document.getElementById('charactersheet')?.shadowRoot);
}

/** Waits until the sheet on the page has rendered `inserted` times and the room's socket is open. */
export function waitForSheet(page, inserted = 1) {
    return page.waitForFunction(n => window.__stress.inserted >= n && window.__stress.socketOpen(), inserted);
}

/** Clicks a sheet in the room list and times it up to the first frame after init. */
export function switchSheet(page, sheetId) {
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

/** A CDP session of the page with the Performance domain on. */
export async function cdpSession(page) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Performance.enable');
    return cdp;
}

/** Main-thread task time of the page so far, ms. ScriptDuration misses style, layout and task overhead. */
export async function taskDuration(cdp) {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find(m => m.name === 'TaskDuration').value * 1000;
}

export function setCpuRate(cdp, rate) {
    return cdp.send('Emulation.setCPUThrottlingRate', { rate });
}

export function freePort() {
    return new Promise((resolve, reject) => {
        const server = createServer();
        server.listen(0, () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
        server.on('error', reject);
    });
}

export function sum(xs) {
    return xs.reduce((a, b) => a + b, 0);
}

export function round(x) {
    return Math.round(x * 10) / 10;
}

/** Median, 90th percentile and range of the samples, rounded to 0.1. */
export function stats(xs) {
    const s = [...xs].sort((a, b) => a - b);
    const at = q => s[Math.min(s.length - 1, Math.floor(q * s.length))];
    return { n: s.length, median: round(at(0.5)), p90: round(at(0.9)), min: round(s[0]), max: round(s[s.length - 1]) };
}

/** stats of every key of the sample objects that has values. */
export function summarize(samples) {
    const out = {};
    for (const key of Object.keys(samples[0])) {
        const xs = samples.map(s => s[key]).filter(v => v != null);
        if (xs.length) out[key] = stats(xs);
    }
    return out;
}

/**
 * window.__stress, installed before the page's scripts: finds sheet elements
 * by their data-id path and times actions on them up to the layout after
 * their render. Playwright serializes it, so it must not reference anything
 * outside itself.
 */
export function installStress() {
    const root = () => {
        const r = document.getElementById('charactersheet')?.shadowRoot;
        if (!r) throw new Error('No sheet on the page');
        return r;
    };

    // The path of the data-ids around an element, as e2e/lib/probes.ts builds it.
    const pathOf = el => {
        const parts = [];
        for (let node = el; node; node = node.parentElement) {
            if (node.dataset?.id) parts.unshift(node.dataset.id);
        }
        const labelId = el.closest('label')?.dataset.id;
        if (labelId && !parts.includes(labelId)) {
            if (parts.length > 0) parts.splice(parts.length - 1, 0, labelId);
            else parts.push(labelId);
        }
        return Array.from(new Set(parts)).join('.');
    };

    /** The element at data-id `path` (the sheet root without it), or match `nth` of `sel` inside it. */
    const find = ({ path, sel, nth = 0 }) => {
        let scope = root();
        if (path) {
            // pathOf of every element is slow on a big sheet; the element's own data-id ends the path.
            scope = Array.from(root().querySelectorAll('[data-id]'))
                .find(el => path.endsWith(el.dataset.id) && pathOf(el) === path);
            if (!scope) throw new Error(`No element at ${path}`);
        }
        if (!sel) return scope;
        const el = scope.querySelectorAll(sel)[nth];
        if (!el) throw new Error(`No ${sel} in ${path ?? 'the sheet'}`);
        return el;
    };

    const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

    /**
     * Preact renders in a microtask, and a render can queue another. Awaiting
     * this many runs them without leaving the task: a timer would let the
     * browser paint a frame first, in some runs and not others.
     */
    const MICROTASK_HOPS = 10;

    /** The action, its renders and the style and layout they need: the work of the task before paint, ms. */
    const sync = async action => {
        const t0 = performance.now();
        action();
        for (let i = 0; i < MICROTASK_HOPS; i++) await null;
        void document.body.offsetHeight;
        return performance.now() - t0;
    };

    /** sync, then the frame after it, so that TaskDuration around the call covers its paint and effects too. */
    const timed = async action => {
        const t = await sync(action);
        await frame();
        return t;
    };

    const sockets = [];
    const NativeWebSocket = window.WebSocket;
    window.WebSocket = class extends NativeWebSocket {
        constructor(...args) {
            super(...args);
            sockets.push(this);
        }
    };

    const stress = {
        /** Sheets inserted so far, counted once their blocks have rendered. */
        inserted: 0,
        socketOpen: () => sockets.some(s => s.readyState === NativeWebSocket.OPEN),
        find,
        frame,
        /** The element the next click or input goes to. */
        target: null,
        original: null,
        pick(q) {
            stress.target = find(q);
            const field = stress.target.matches('input, textarea, select');
            stress.original = field ? stress.target.value : null;
            if (field) stress.target.focus();
        },
        noop: () => timed(() => {}),
        click: () => timed(() => stress.target.click()),
        /** An edit as a keystroke makes it; change comes on blur, in restore. */
        input: value => timed(() => {
            stress.target.value = value;
            stress.target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        }),
        restore() {
            const el = stress.target;
            el.value = stress.original;
            el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
            el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
            el.blur();
        },
        /** Item ids of a grid, in no particular order. */
        itemIds: gridPath => Array.from(find({ path: gridPath }).querySelectorAll(':scope > .layout-column > [data-id]'))
            .map(el => el.dataset.id),
        /**
         * Times of the sheet messages from the server while armed: from the
         * first one of a socket message to the layout after its render, as sync.
         */
        remote: [],
        armed: false,
    };

    // A capture listener on window runs before the sheet's listeners on
    // document. Its microtasks wait for room/socket.js to dispatch the rest of
    // the socket message.
    let pending = false;
    for (const type of ['change', 'batch', 'autocompleteApplied', 'createItem', 'deleteItem', 'positionsChanged', 'moveItemBetweenGrids']) {
        window.addEventListener(`ws:${type}`, async () => {
            if (!stress.armed || pending) return;
            pending = true;
            stress.remote.push(await sync(() => {}));
            pending = false;
        }, { capture: true });
    }

    // The sheet mounts its blocks in a later listener of the same event.
    document.addEventListener('charactersheet_inserted', () => {
        requestAnimationFrame(() => setTimeout(() => {
            stress.inserted++;
            stress.renderedAt = performance.now();
        }, 0));
    });

    window.__stress = stress;
}
