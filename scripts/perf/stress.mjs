// Stress test of the sheet: the cost of typing, clicks and remote edits on
// the stress sheets of the seed room (cmd/seedtest/stress.go) against the
// budgets, its growth from Stress M to Stress XL, and a comparison of builds.
// Scenarios are in stress-scenarios.mjs.
//
//   npm run seed                                   once: the room, the sheets, the sessions
//   npm run perf:stress [-- options]               measure the server at --base
//   npm run perf:stress -- --ref main              the same, alternating with a build of main
//   npm run perf:stress -- compare before.json after.json
//
// Options:
//   --base URL        the server under test (web-local / web-dev); default: the base of .seed.json
//   --profiles M,XL   --cpu 1,4   CPU throttling rates
//   --runs 30         repeats of input and click scenarios; loads, adds, deletes and
//                     remote edits repeat at most RUNS of their type
//   --only REGEX      scenarios whose name matches
//   --json out.json   the results; with --ref also out.ref.json for the other build
//   --strict          exit 1 when a budget is exceeded
//   --ref REF         builds REF in a temporary worktree and runs it on a free port
//
// An action is timed in the page, in one task: the action, the renders it
// queues as microtasks and the forced style and layout, without paint. The
// budgets apply to that time at CPU 4×. The main-thread TaskDuration of CDP
// around the action and the frame after it, with paint and effects, goes into
// the JSON as "task". Remote edits are timed the same way from the socket
// message; loads up to the first frame after the sheet's init. Headless Chrome
// only: the built-in browser pane throttles requestAnimationFrame. The typed
// values are restored after each scenario; "npm run seed" gives fresh stress
// sheets.

import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, rmdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import {
    cdpSession, fail, freePort, launch, newPage, openSheet, setCpuRate, stats, switchSheet, taskDuration, waitForSheet,
} from './lib.mjs';
import { ADD_BUTTON, BUDGET_CPU, BUDGETS, DELETE_BUTTON, SCENARIOS } from './stress-scenarios.mjs';
import { budgetViolations, compareRows, growthOf, GROWTH_WARN, NOISE } from './stress-report.mjs';

const { positionals, values: opts } = parseArgs({
    allowPositionals: true,
    options: {
        base: { type: 'string' },
        seed: { type: 'string', default: 'scripts/perf/.seed.json' },
        profiles: { type: 'string', default: 'M,XL' },
        cpu: { type: 'string', default: '1,4' },
        runs: { type: 'string', default: '30' },
        only: { type: 'string' },
        json: { type: 'string' },
        strict: { type: 'boolean', default: false },
        ref: { type: 'string' },
    },
});

/** Repeats of the slow scenario types, at most --runs. */
const RUNS = { load: 8, add: 10, delete: 10, remote: 10 };

const NAV_TABS = {
    player: 'show-player-sheet',
    combat: 'show-combat',
    talents: 'show-talents',
    gear: 'show-gear',
    advancements: 'show-advancements',
    psykana: 'show-psykana',
    techno: 'show-techno-arcana',
};

const TYPED = 'the quick brown fox jumps over the lazy dog '.repeat(4);

/** Waits for edits in their 200 ms debounce to go out. */
const DEBOUNCE_FLUSH = 400;

/** The page keeps working for a while after the sheet has rendered; that must not land in a measurement. */
const SETTLE_AFTER_LOAD = 1500;

async function main() {
    if (!existsSync(opts.seed)) fail(`No ${opts.seed}; run "npm run seed" first`);
    const seed = JSON.parse(readFileSync(opts.seed, 'utf8'));
    if (!seed.stressSheets) fail(`${opts.seed} has no stress sheets; run "npm run seed" again`);
    const player = seed.users.find(u => u.key === 'player');
    const gm = seed.users.find(u => u.key === 'gm');
    const base = (opts.base ?? seed.base).replace(/\/$/, '');

    const profiles = opts.profiles.split(',');
    for (const p of profiles) if (!seed.stressSheets[p]) fail(`No stress sheet ${p} in ${opts.seed}`);
    const cpus = opts.cpu.split(',').map(Number);
    const only = opts.only ? new RegExp(opts.only, 'i') : null;
    const scenarios = SCENARIOS.filter(s => !only || only.test(s.name));
    if (!scenarios.length) fail(`No scenario matches ${opts.only}`);

    const builds = [{ label: 'current', base }];
    let ref = null;
    try {
        if (opts.ref) {
            process.once('SIGINT', async () => {
                await ref?.stop();
                process.exit(130);
            });
            ref = await startRef(opts.ref);
            builds.unshift({ label: ref.label, base: ref.base });
        }
        for (const b of builds) {
            if (!(await isUp(b.base))) throw new Error(`No server at ${b.base}; start web-local or web-dev, or pass --base`);
        }

        const browser = await launch();
        try {
            for (const b of builds) {
                Object.assign(b, await newPage(browser, player.auth), { gmAuth: gm.auth, browser, rows: [], open: null });
                b.cdp = await cdpSession(b.page);
            }
            const ctx = { roomId: seed.roomId, otherSheet: player.sheetId };
            let turn = 0;
            for (const profile of profiles) {
                const sheetId = seed.stressSheets[profile];
                for (const cpu of cpus) {
                    for (const s of scenarios) {
                        // Alternating which build goes first spreads the drift of the machine over both.
                        const order = turn++ % 2 ? [...builds].reverse() : builds;
                        for (const b of order) {
                            if (process.stdout.isTTY) process.stdout.write(`\r${b.label} ${profile} ${cpu}× ${s.name}`.padEnd(70));
                            b.rows.push(await runScenario(b, s, { ...ctx, profile, sheetId, cpu }).catch(e => {
                                // E.g. an element the other build does not have; the page is opened afresh.
                                b.open = null;
                                return { scenario: s.name, type: s.type, profile, cpu, error: e.message.split('\n')[0] };
                            }));
                        }
                    }
                }
            }
            if (process.stdout.isTTY) process.stdout.write('\r'.padEnd(71) + '\r');
        } finally {
            await browser.close();
        }

        const results = builds.map(b => result(b, seed, profiles, cpus));
        for (const r of results) printResult(r);
        if (ref) printCompare(results[0], results[1]);

        if (opts.json) {
            writeFileSync(opts.json, JSON.stringify(results.at(-1), null, 2));
            if (ref) writeFileSync(opts.json.replace(/(\.json)?$/, '.ref.json'), JSON.stringify(results[0], null, 2));
        }
        if (opts.strict && results.at(-1).violations.length) process.exitCode = 1;
    } finally {
        await ref?.stop();
    }
}

async function isUp(base) {
    try {
        return (await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {
        return false;
    }
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

async function runScenario(b, s, ctx) {
    const runs = Math.min(Number(opts.runs), RUNS[s.type] ?? Infinity);
    const row = { scenario: s.name, type: s.type, profile: ctx.profile, cpu: ctx.cpu };
    if (s.type === 'load') {
        const wall = await measureLoad(b, s, ctx, runs);
        return { ...row, metric: 'wall', ...stats(wall) };
    }

    await ensureSheet(b, ctx);
    await prepare(b.page, s);
    if (s.type === 'remote') {
        const sync = await measureRemote(b, s, ctx, runs);
        await cleanUp(b.page, s);
        return { ...row, metric: 'sync', ...stats(sync) };
    }
    const { sync, task } = await MEASURE[s.type](b, s, runs);
    await cleanUp(b.page, s);
    return { ...row, metric: 'sync', ...stats(sync), task: stats(task) };
}

/** The stress sheet open on the build's page, at the CPU rate of the run. */
async function ensureSheet(b, ctx) {
    const key = `${ctx.sheetId}@${ctx.cpu}`;
    if (b.open === key) return;
    if (b.open?.split('@')[0] !== String(ctx.sheetId)) {
        await openSheet(b.page, `${b.base}/room/sheet/view/${ctx.roomId}/${ctx.sheetId}`);
        await waitForSheet(b.page);
        await sleep(SETTLE_AFTER_LOAD);
    }
    await setCpuRate(b.cdp, ctx.cpu);
    b.open = key;
}

async function prepare(page, s) {
    if (s.tab) {
        await page.evaluate(id => {
            const radio = window.__stress.find({ sel: `#${id}` });
            if (!radio.checked) window.__stress.find({ sel: `label[for="${id}"]` }).click();
        }, NAV_TABS[s.tab]);
    }
    if (s.open) await page.evaluate(sel => {
        const toggle = window.__stress.find({ sel });
        if (!toggle.classList.contains('active')) toggle.click();
    }, s.open);
    await page.evaluate(() => window.__stress.frame());
}

async function cleanUp(page, s) {
    if (s.open) await page.evaluate(sel => {
        const toggle = window.__stress.find({ sel });
        if (toggle.classList.contains('active')) toggle.click();
    }, s.open);
    await page.evaluate(() => window.__stress.frame());
}

/**
 * Runs `act` `runs` times, each after a frame, and returns what it measured
 * in the page (sync) and the TaskDuration around it (task).
 */
async function sampleTasks(b, runs, act, { before, after } = {}) {
    const sync = [], task = [];
    for (let i = 0; i < runs; i++) {
        if (before) await before(i);
        await b.page.evaluate(() => window.__stress.frame());
        const t0 = await taskDuration(b.cdp);
        sync.push(await act(i));
        task.push(await taskDuration(b.cdp) - t0);
        if (after) await after(i);
    }
    return { sync, task };
}

/** The value of keystroke i into a field that held `original`. */
const typed = (s, original, i) => (s.number ? String(20 + (i * 7) % 50) : original + TYPED.slice(0, i + 1));

/** Clicks "＋ Add" of the grid unmeasured and returns the new item's id. */
async function addItem(page, grid) {
    const before = new Set(await page.evaluate(g => window.__stress.itemIds(g), grid));
    await page.evaluate(q => window.__stress.pick(q), { path: grid, sel: ADD_BUTTON });
    await page.evaluate(() => window.__stress.click());
    await page.evaluate(() => window.__stress.frame());
    const added = (await page.evaluate(g => window.__stress.itemIds(g), grid)).filter(id => !before.has(id));
    if (added.length !== 1) throw new Error(`Adding to ${grid} made ${added.length} items`);
    return added[0];
}

async function setDeleteMode(page, on) {
    await page.evaluate(on => {
        const container = window.__stress.find({ sel: '.container' });
        if (container.classList.contains('deletion-mode') !== on) window.__stress.find({ sel: '#toggle-delete-mode' }).click();
    }, on);
}

const MEASURE = {
    noop: (b, s, runs) => sampleTasks(b, runs, () => b.page.evaluate(() => window.__stress.noop())),

    async input(b, s, runs) {
        await b.page.evaluate(q => window.__stress.pick(q), { path: s.path });
        const original = await b.page.evaluate(() => window.__stress.original);
        const sample = await sampleTasks(b, runs, i => b.page.evaluate(v => window.__stress.input(v), typed(s, original, i)));
        await b.page.evaluate(() => window.__stress.restore());
        await sleep(DEBOUNCE_FLUSH);
        return sample;
    },

    click: (b, s, runs) => sampleTasks(b, runs, () => b.page.evaluate(() => window.__stress.click()), {
        before: () => b.page.evaluate(q => window.__stress.pick(q), { path: s.path, sel: s.sel }),
        after: async () => {
            await b.page.evaluate(q => window.__stress.pick(q), s.undo ?? { path: s.path, sel: s.sel });
            await b.page.evaluate(() => window.__stress.click());
        },
    }),

    async add(b, s, runs) {
        let before;
        const sample = await sampleTasks(b, runs, () => b.page.evaluate(() => window.__stress.click()), {
            before: async () => {
                before = new Set(await b.page.evaluate(g => window.__stress.itemIds(g), s.grid));
                await b.page.evaluate(q => window.__stress.pick(q), { path: s.grid, sel: ADD_BUTTON });
            },
            after: async () => {
                await b.page.evaluate(() => window.__stress.frame());
                const added = (await b.page.evaluate(g => window.__stress.itemIds(g), s.grid)).filter(id => !before.has(id));
                // The layout the add sends goes out after a debounce; deleting before it would race it.
                await sleep(DEBOUNCE_FLUSH);
                for (const id of added) {
                    await b.page.evaluate(q => window.__stress.pick(q), { path: `${s.grid}.${id}`, sel: DELETE_BUTTON });
                    await b.page.evaluate(() => window.__stress.click());
                }
            },
        });
        await sleep(DEBOUNCE_FLUSH);
        return sample;
    },

    async delete(b, s, runs) {
        await setDeleteMode(b.page, true);
        const sample = await sampleTasks(b, runs, () => b.page.evaluate(() => window.__stress.click()), {
            before: async () => {
                const id = await addItem(b.page, s.grid);
                await sleep(DEBOUNCE_FLUSH);
                await b.page.evaluate(q => window.__stress.pick(q), { path: `${s.grid}.${id}`, sel: DELETE_BUTTON });
            },
        });
        await setDeleteMode(b.page, false);
        await sleep(DEBOUNCE_FLUSH);
        return sample;
    },
};

async function measureLoad(b, s, ctx, runs) {
    const url = `${b.base}/room/sheet/view/${ctx.roomId}/${ctx.sheetId}`;
    const wall = [];
    if (s.how === 'direct') {
        // Throttling set on the page's target stays through its navigations.
        await setCpuRate(b.cdp, ctx.cpu);
        // The first load fills the HTTP cache, as a returning player has it.
        for (let i = -1; i < runs; i++) {
            await openSheet(b.page, url);
            await waitForSheet(b.page);
            const t = await b.page.evaluate(() => window.__stress.renderedAt);
            if (i >= 0) wall.push(t);
        }
    } else {
        await ensureSheet(b, ctx);
        for (let i = -1; i < runs; i++) {
            await switchSheet(b.page, ctx.otherSheet);
            const { total } = await switchSheet(b.page, ctx.sheetId);
            if (i >= 0) wall.push(total);
        }
    }
    await sleep(SETTLE_AFTER_LOAD);
    b.open = `${ctx.sheetId}@${ctx.cpu}`;
    return wall;
}

/** The GM's page on the same sheet, unthrottled: the second player whose edits the measured page applies. */
async function gmPage(b, ctx) {
    if (!b.gm) b.gm = await newPage(b.browser, b.gmAuth);
    if (b.gm.open !== ctx.sheetId) {
        await openSheet(b.gm.page, `${b.base}/room/sheet/view/${ctx.roomId}/${ctx.sheetId}`);
        await waitForSheet(b.gm.page);
        await sleep(SETTLE_AFTER_LOAD);
        b.gm.open = ctx.sheetId;
    }
    return b.gm.page;
}

async function measureRemote(b, s, ctx, runs) {
    const gm = await gmPage(b, ctx);
    const received = () => b.page.evaluate(() => window.__stress.remote.length);
    const waitReceived = n => b.page.waitForFunction(n => window.__stress.remote.length >= n, n, { timeout: 10_000 });
    await b.page.evaluate(() => {
        window.__stress.remote.length = 0;
        window.__stress.armed = true;
    });
    try {
        if (s.grid) {
            for (let i = 0; i < runs; i++) {
                const id = await addItem(gm, s.grid);
                await waitReceived((await received()) + 1);
                await sleep(DEBOUNCE_FLUSH);
                const n = await received();
                await gm.evaluate(q => window.__stress.pick(q), { path: `${s.grid}.${id}`, sel: DELETE_BUTTON });
                await gm.evaluate(() => window.__stress.click());
                await waitReceived(n + 1);
                await sleep(DEBOUNCE_FLUSH);
            }
        } else {
            await gm.evaluate(q => window.__stress.pick(q), { path: s.path });
            const original = await gm.evaluate(() => window.__stress.original);
            for (let i = 0; i < runs; i++) {
                const n = await received();
                await gm.evaluate(v => window.__stress.input(v), typed(s, original, i));
                await waitReceived(n + 1);
            }
            await gm.evaluate(() => window.__stress.restore());
            await sleep(DEBOUNCE_FLUSH);
        }
        return await b.page.evaluate(() => [...window.__stress.remote]);
    } finally {
        await b.page.evaluate(() => { window.__stress.armed = false; });
    }
}

// ─── Results ─────────────────────────────────────────────────────────────────

function git(...args) {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function result(b, seed, profiles, cpus) {
    const commit = b.label === 'current'
        ? git('rev-parse', '--short', 'HEAD') + (git('status', '--porcelain') ? '+dirty' : '')
        : b.label;
    return {
        date: new Date().toISOString(),
        build: commit,
        base: b.base,
        sheets: Object.fromEntries(profiles.map(p => [p, seed.stressSheets[p]])),
        cpus,
        runs: Number(opts.runs),
        budgets: { cpu: BUDGET_CPU, ...BUDGETS },
        rows: b.rows,
        violations: budgetViolations(b.rows),
        growth: growthOf(b.rows),
        pageErrors: [...new Set(b.errors)],
    };
}

const fmt = (x, width = 6) => (x === undefined || x === null ? '–' : String(x)).padStart(width);

function printResult(r) {
    console.log(`\nBuild ${r.build} at ${r.base}, sheets ${Object.entries(r.sheets).map(([p, id]) => `${p}=${id}`).join(' ')}`);
    console.log('ms, median / p90 of the task up to layout, without paint; loads: up to the first frame');
    const profiles = Object.keys(r.sheets);
    for (const cpu of r.cpus) {
        console.log(`\nCPU ${cpu}×`);
        console.log(`  ${'scenario'.padEnd(34)}${profiles.map(p => p.padStart(16)).join('')}   XL/M`);
        const names = [...new Set(r.rows.filter(x => x.cpu === cpu).map(x => x.scenario))];
        for (const name of names) {
            const cells = profiles.map(p => {
                const x = r.rows.find(y => y.scenario === name && y.profile === p && y.cpu === cpu);
                if (!x) return fmt('', 16);
                if (x.error) return 'error '.padStart(16);
                const over = r.violations.some(v => v.scenario === name && v.profile === p && v.cpu === cpu);
                return `${fmt(x.median)} / ${fmt(x.p90)}${over ? '!' : ' '}`.padStart(16);
            });
            const g = r.growth.find(y => y.scenario === name && y.cpu === cpu);
            console.log(`  ${name.padEnd(34)}${cells.join('')}   ${g ? fmt(g.ratio, 4) + (g.warn ? ' ↑' : '') : ''}`);
        }
    }
    if (r.violations.length) {
        console.log(`\nOver budget at CPU ${r.budgets.cpu}× (!):`);
        for (const v of r.violations) console.log(`  ${v.scenario} ${v.profile}: ${v.stat} ${v.value} > ${v.budget}`);
    }
    const warnings = r.growth.filter(g => g.warn);
    if (warnings.length) {
        console.log(`\nGrows with the sheet, XL/M > ${GROWTH_WARN} (↑):`);
        for (const g of warnings) console.log(`  ${g.scenario} ${g.cpu}×: ${g.m} → ${g.xl} ms`);
    }
    const failed = r.rows.filter(x => x.error);
    if (failed.length) {
        console.log('\nFailed scenarios:');
        for (const x of failed) console.log(`  ${x.scenario} ${x.profile} ${x.cpu}×: ${x.error}`);
    }
    if (r.pageErrors.length) console.log(`\nPage errors:\n  ${r.pageErrors.join('\n  ')}`);
}

function printCompare(before, after) {
    console.log(`
${before.build} → ${after.build}, medians in ms; * marks a change over ${NOISE.ratio * 100}% and ${NOISE.ms} ms`);
    console.log(`  ${'scenario'.padEnd(34)}${'profile'.padStart(8)}${'cpu'.padStart(5)}${'before'.padStart(9)}${'after'.padStart(9)}${'Δ'.padStart(9)}${'Δ%'.padStart(7)}`);
    for (const c of compareRows(before.rows, after.rows)) {
        const signed = x => (x > 0 ? `+${x}` : x);
        console.log(`  ${c.scenario.padEnd(34)}${c.profile.padStart(8)}${(c.cpu + '×').padStart(5)}${fmt(c.before, 9)}${fmt(c.after, 9)}`
            + `${fmt(signed(c.delta), 9)}${fmt(c.pct === null ? null : `${signed(c.pct)}%`, 7)}${c.change ? ` * ${c.change}` : ''}`);
    }
}

// ─── The other build ─────────────────────────────────────────────────────────

/**
 * Builds `ref` in a temporary worktree and starts it on a free port against
 * the same database, with this checkout's .env. stop() undoes all of it.
 */
async function startRef(ref) {
    const repo = git('rev-parse', '--show-toplevel');
    const sha = git('rev-parse', '--verify', `${ref}^{commit}`);
    const label = `${ref} (${sha.slice(0, 7)})`;

    const newMigrations = git('diff', '--name-only', '--diff-filter=A', sha, 'HEAD', '--', 'migrations');
    if (newMigrations) {
        console.warn(`Warning: migrations newer than ${ref}; the old build reads the current database:\n  ${newMigrations.split('\n').join('\n  ')}`);
    }

    const dir = mkdtempSync(join(tmpdir(), 'cs-stress-'));
    const nodeModules = join(dir, 'node_modules');
    let server = null;
    const stop = async () => {
        if (server && server.exitCode === null) {
            const exited = new Promise(r => server.once('exit', r));
            server.kill();
            await exited;
        }
        // The junction goes first: removing the worktree through it could delete the real node_modules.
        if (existsSync(nodeModules)) {
            try {
                unlinkSync(nodeModules);
            } catch {
                rmdirSync(nodeModules);
            }
        }
        for (let attempt = 0; ; attempt++) {
            try {
                git('worktree', 'remove', '--force', dir);
                break;
            } catch (e) {
                // Windows holds the binary a moment after the process exits.
                if (attempt >= 5) {
                    console.warn(`Could not remove the worktree ${dir}: ${e.message}`);
                    break;
                }
                await sleep(1000);
            }
        }
    };

    try {
        console.log(`Building ${label} in ${dir}`);
        git('worktree', 'add', '--detach', dir, sha);
        symlinkSync(join(repo, 'node_modules'), nodeModules, 'junction');
        // Game data comes from a private repo and is not in git; go:embed needs it.
        const assets = join('internal', 'gamedata', 'assets');
        if (existsSync(join(repo, assets))) cpSync(join(repo, assets), join(dir, assets), { recursive: true });
        execFileSync('node', ['scripts/build.mjs'], { cwd: dir, stdio: 'inherit' });
        const exe = join(dir, process.platform === 'win32' ? 'cs-stress-ref.exe' : 'cs-stress-ref');
        execFileSync('go', ['build', '-o', exe, './cmd/web'], { cwd: dir, stdio: 'inherit' });

        const port = await freePort();
        const base = `http://localhost:${port}`;
        // The WebSocket accepts only the Origin of BASE_URL.
        server = spawn(exe, ['-addr', `:${port}`], {
            cwd: repo,
            env: { ...process.env, BASE_URL: base },
            stdio: ['ignore', 'ignore', 'inherit'],
        });
        for (let i = 0; !(await isUp(base)); i++) {
            if (server.exitCode !== null || i > 60) throw new Error(`${label} did not start at ${base}`);
            await sleep(500);
        }
        return { label, base, stop };
    } catch (e) {
        await stop();
        throw e;
    }
}

// Last: main uses the constants and functions above.
if (positionals[0] === 'compare') {
    if (positionals.length !== 3) fail('usage: stress.mjs compare before.json after.json');
    const [before, after] = positionals.slice(1).map(f => JSON.parse(readFileSync(f, 'utf8')));
    printCompare(before, after);
} else if (positionals.length === 0) {
    await main();
} else {
    fail(`unknown command ${positionals[0]}`);
}
