// Seeds the test room (cmd/seedtest) and signs every seeded user in, so that
// scripts can act as any room role without a manual login.
//
//   npm run seed [-- --base URL]
//
// Writes, next to the perf session (all gitignored):
//   scripts/perf/.auth-<key>.json  session of a user: gm, moderator, player, player2, outsider
//   scripts/perf/.seed.json        the room id and the users with their session files
// Run it again after a test that kicked someone or changed roles.

import { chromium } from 'playwright-core';
import { parseArgs } from 'node:util';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const { values: opts } = parseArgs({
    options: {
        base: { type: 'string', default: 'http://localhost:4002' },
        dir: { type: 'string', default: 'scripts/perf' },
    },
});
const base = opts.base.replace(/\/$/, '');

const seed = JSON.parse(execFileSync('go', ['run', './cmd/seedtest'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }));
console.log(`Seeded room ${seed.roomId}: ${base}/room/view/${seed.roomId}`);

try {
    await fetch(`${base}/ping`, { signal: AbortSignal.timeout(2000) });
} catch {
    console.error(`No server at ${base}; start it (launch config web-dev) and run again to sign the users in.`);
    process.exit(1);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const users = [];
try {
    for (const user of seed.users) {
        const auth = `${opts.dir}/.auth-${user.key}.json`;
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${base}/user/login`);
        await page.fill('input[name=email]', user.email);
        await page.fill('input[name=password]', seed.password);
        await Promise.all([page.waitForNavigation(), page.click('input[type=submit]')]);
        if (new URL(page.url()).pathname.startsWith('/user/login')) {
            throw new Error(`${user.email} could not sign in at ${base}`);
        }
        await context.storageState({ path: auth });
        await context.close();
        users.push({ ...user, auth });
        console.log(`${user.key}: ${auth}`);
    }
} finally {
    await browser.close();
}

writeFileSync(`${opts.dir}/.seed.json`, JSON.stringify({ base, roomId: seed.roomId, users }, null, 2) + '\n');
