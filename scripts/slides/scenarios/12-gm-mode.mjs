// The gamemaster's screen: daemonettes and a cultist added to the encounter
// from the bestiary, their initiative rolled into the order of the party, the
// stat block of one opened and its claws rolled, the results in the chat.
export default {
    file: '12-gm-mode',
    kind: 'webm',
    async play(d, out) {
        const { page } = d;
        await d.openRoom();
        await page.locator('label[for="show-chat"]').click();
        await page.locator('.gm-mode-btn').click();
        await page.locator('.encounter-window').waitFor();
        await page.waitForLoadState('networkidle');
        const frame = await d.frameOf([page.locator('.encounter-window'), page.locator('#right-panel-wrapper')]);
        d.pos = { x: frame.x + frame.width * .45, y: frame.y + frame.height * .4 };

        const creature = name => page.locator('.encounter-creature', { hasText: name }).locator('.encounter-add-creature');
        const search = page.getByPlaceholder('Search creatures');
        const statBlock = page.locator('.stat-attack', { hasText: 'Pincer Claws' });
        return d.record(frame, out, async () => {
            await d.pause(250);
            await d.click(page.locator('.encounter-tab[data-tab="monsters"]'));
            await d.pause(200);
            await d.click(page.locator(`.encounter-collection[data-collection-id="${d.showcase.collections['DoomBC: Хаос']}"]`));
            await d.pause(200);
            await d.click(search);
            await d.type('Демон', { delay: 60 });
            await d.pause(200);
            await d.click(creature('Демонетка'));
            for (let i = 0; i < 2; i++) {
                await d.pause(200);
                await d.click();
            }
            await d.pause(200);
            await d.click(search);
            await page.keyboard.press('Control+A');
            await d.type('Культ', { delay: 60 });
            await d.pause(200);
            await d.click(creature('Культист Фанатик'));
            await d.pause(250);
            await d.click(page.locator('.encounter-tab[data-tab="combat"]'));
            await d.pause(200);
            await d.click(page.getByRole('button', { name: 'Roll for NPCs' }));
            await d.pause(700);
            await d.click(page.locator('.participant-column[data-column="enemies"] .encounter-card-title', { hasText: 'Демонетка 1' }));
            await d.pause(250);
            await d.click(statBlock.locator('.stat-attack-name > label.rollable'));
            await d.pause(250);
            await d.click(statBlock.locator('.roll-column.base .radio-option label', { hasText: 'Charge' }));
            await d.pause(200);
            await d.click(statBlock.locator('[data-id="rollButton"]'));
            await d.pause(250);
            await d.moveTo({ x: frame.x + frame.width * .8, y: frame.y + frame.height * .45 });
            await d.pause(1600);
        });
    },
};
