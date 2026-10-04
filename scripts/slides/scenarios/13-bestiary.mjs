// The bestiary: the showcase collection of Chaos with the stat block of the
// daemonette open, and a collection of another user among the subscriptions.
export default {
    file: '13-bestiary',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        const { page } = d;
        await d.openBestiary('DoomBC: Хаос');
        await page.locator('.bestiary-creature-table tr', { hasText: 'Демонетка' }).click();
        await page.locator('.bestiary-creature-view .bestiary-title', { hasText: 'Демонетка' }).waitFor();
        await page.waitForLoadState('networkidle');
        await d.shot(await d.frameOf(page.locator('#bestiary')), out);
    },
};
