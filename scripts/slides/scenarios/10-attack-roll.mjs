// Combat with the chat beside it: the roll of the Greatbow opened from its
// name, full aim and short range picked, rolled, and the result in the chat.
export default {
    file: '10-attack-roll',
    kind: 'webm',
    async play(d, out) {
        const { page } = d;
        await d.openSheet('sir-galahad');
        await page.locator('label[for="show-chat"]').click();
        await page.locator('label[for="show-combat"]').click();
        const frame = await d.frameOf([d.sheet(), page.locator('#right-panel-wrapper')]);
        d.pos = { x: frame.x + frame.width * .42, y: frame.y + frame.height * .3 };

        const bow = page.locator('#ranged-attack .ranged-attack').first();
        const option = (column, text) => bow.locator(`.roll-column.${column} .radio-option label`, { hasText: text });
        return d.record(frame, out, async () => {
            await d.pause(500);
            await d.click(bow.locator('label.rollable', { hasText: 'Name:' }));
            await d.pause(500);
            await d.click(option('aim', 'Full'));
            await d.pause(300);
            await d.click(option('range', 'Short'));
            await d.pause(400);
            await d.click(bow.locator('[data-id="rollButton"]'));
            await d.pause(300);
            await d.moveTo({ x: frame.x + frame.width * .62, y: frame.y + frame.height * .3 });
            await d.pause(2500);
        });
    },
};
