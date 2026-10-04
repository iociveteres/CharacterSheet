// Records the slides of the landing page (ui/html/pages/home.html) in the light
// and the dark theme, from the scenarios in ./scenarios. Every take starts from
// the showcase seed (cmd/seedtest -showcase), so the next re-shoot after the
// interface changes is a run of this script.
//
//   npm run slides [-- --only 2,9] [--theme dark] [--base http://localhost:4005]
//
// Needs a server with fixed rolls, built bundle included:
//
//   go run ./cmd/web -addr :4005 -dev -roll-seed 40000   (BASE_URL=http://localhost:4005)
//
// ffmpeg in PATH and the exported showcase sheets in scripts/slides/fixtures.

import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Director, installOverlay } from './director.mjs';

const { values: opts } = parseArgs({
    options: {
        base: { type: 'string', default: 'http://localhost:4005' },
        only: { type: 'string', default: '' },
        theme: { type: 'string', default: '' },
        out: { type: 'string', default: 'ui/static/img/slides' },
        fixtures: { type: 'string', default: 'scripts/slides/fixtures' },
        // Overrides the scenarios' device pixel ratio, to try one.
        scale: { type: 'string', default: '' },
    },
});
const base = opts.base.replace(/\/$/, '');
const HERE = 'scripts/slides';
const TAKES = join(HERE, '.takes');
const themes = opts.theme ? [opts.theme] : ['light', 'dark'];
const only = opts.only ? opts.only.split(',').map(s => s.trim()) : [];

const scenarios = [];
for (const name of readdirSync(join(HERE, 'scenarios')).filter(f => f.endsWith('.mjs')).sort((a, b) => parseInt(a) - parseInt(b))) {
    const scenario = (await import(pathToFileURL(join(HERE, 'scenarios', name)).href)).default;
    if (!only.length || only.includes(scenario.file.split('-')[0])) scenarios.push(scenario);
}
if (!scenarios.length) throw new Error(`No scenario matches --only ${opts.only}`);

try {
    await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) });
} catch {
    console.error(`No server at ${base}; start it with -roll-seed (see the top of this file).`);
    process.exit(1);
}

/** The director on the showcase room. */
class Showcase extends Director {
    constructor(page, { showcase, ...rest }) {
        super(page, rest);
        this.showcase = showcase;
    }

    /** Opens the room on the sheet of the fixture `name` and waits until it settles. */
    async openSheet(name) {
        const id = this.showcase.sheets[name];
        if (!id) throw new Error(`No showcase sheet ${name}: put ${name}.json into ${opts.fixtures}`);
        await this.page.goto(`${base}/room/sheet/view/${this.showcase.roomId}/${id}`);
        await this.page.locator('#navigation-tabs').waitFor();
        await this.page.evaluate(() => document.fonts.ready);
        await this.page.waitForLoadState('networkidle');
    }

    /** Opens the showcase room, or the one without sheets, and waits until it settles. */
    async openRoom({ empty = false } = {}) {
        await this.page.goto(`${base}/room/view/${empty ? this.showcase.emptyRoomId : this.showcase.roomId}`);
        await this.page.locator('#characters').waitFor();
        await this.page.evaluate(() => document.fonts.ready);
        await this.page.waitForLoadState('networkidle');
    }

    /** Opens the bestiary on the showcase collection `name` and waits until it settles. */
    async openBestiary(name) {
        await this.page.goto(`${base}/bestiary?collection=${this.showcase.collections[name]}`);
        await this.page.locator('.bestiary-creature-table').waitFor();
        await this.page.evaluate(() => document.fonts.ready);
        await this.page.waitForLoadState('networkidle');
    }

    /** The sheet with its navigation tabs. */
    sheet() {
        return this.page.locator('#navigation-tabs');
    }
}

mkdirSync(TAKES, { recursive: true });
const seedtest = join(TAKES, process.platform === 'win32' ? 'seedtest.exe' : 'seedtest');
execFileSync('go', ['build', '-o', seedtest, './cmd/seedtest'], { stdio: 'inherit' });
const seed = () => JSON.parse(execFileSync(seedtest, ['-showcase', opts.fixtures], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const auth = await signIn(seed());
    for (const scenario of scenarios) {
        for (const theme of themes) {
            const showcase = seed();
            const scale = Number(opts.scale) || scenario.scale || 1;
            const context = await browser.newContext({
                storageState: auth,
                viewport: scenario.viewport ?? { width: 1920, height: 1080 },
                deviceScaleFactor: scale,
                colorScheme: theme,
                // The page's CSP refuses the inline style of the cursor and tooltip overlay.
                bypassCSP: true,
            });
            // The page reads the theme from localStorage, the server from the cookie (base.html).
            await context.addCookies([{ name: 'theme', value: theme, url: base }]);
            await context.addInitScript(t => {
                try {
                    localStorage.setItem('theme', t);
                    localStorage.removeItem('theme_hue');
                } catch { }
            }, theme);
            await context.addInitScript(installOverlay);
            const page = await context.newPage();
            // An exception in the overlay's animation frame would only stop the cursor.
            page.on('pageerror', e => console.error(`${scenario.file} (${theme}): ${e.stack ?? e}`));
            const d = new Showcase(page, { theme, scale, takes: TAKES, showcase });
            const out = join(opts.out, `${scenario.file}-${theme}.${scenario.kind}`);
            try {
                const result = await scenario.play(d, out);
                report(scenario, out, result);
            } catch (e) {
                const shot = join(TAKES, `${scenario.file}-${theme}-failed.png`);
                await page.screenshot({ path: shot }).catch(() => { });
                console.error(`${scenario.file} (${theme}) failed, the page as it was: ${shot}`);
                throw e;
            } finally {
                await context.close();
            }
        }
    }
} finally {
    await browser.close();
}

async function signIn(showcase) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${base}/user/login`);
    await page.fill('input[name=email]', showcase.user.email);
    await page.fill('input[name=password]', showcase.password);
    await Promise.all([page.waitForNavigation(), page.click('input[type=submit]')]);
    if (new URL(page.url()).pathname.startsWith('/user/login')) throw new Error(`${showcase.user.email} could not sign in at ${base}`);
    const state = await context.storageState();
    await context.close();
    return state;
}

/** Prints what was made; for a video, warns if the slide moves on before it ends. */
function report(scenario, out, result) {
    if (scenario.kind !== 'webm') {
        console.log(`${out}`);
        return;
    }
    const seconds = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out], { encoding: 'utf8' }));
    const html = readFileSync('ui/html/pages/home.html', 'utf8');
    const slide = html.split('<div class="slide').find(chunk => chunk.includes(`${scenario.file}-`));
    const shown = Number(slide?.match(/data-duration="(\d+)"/)?.[1] ?? 4000) / 1000;
    console.log(`${out}: ${seconds.toFixed(1)} s, ${result.frames} frames, ${result.fps.toFixed(0)} fps in motion`);
    if (slide && shown < seconds) console.warn(`  home.html shows it for ${shown} s: set data-duration="${Math.ceil(seconds * 2) * 500}"`);
}
