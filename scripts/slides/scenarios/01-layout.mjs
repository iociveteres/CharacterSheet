// An empty room: a new character, its sheet opened from the list, its name
// typed in, and the card in the list following the name.
export default {
    file: '1-layout',
    kind: 'webm',
    async play(d, out) {
        const { page } = d;
        // The sheet is not there yet: its place is taken from the showcase room.
        await d.openSheet('sir-galahad');
        const left = (await d.sheet().boundingBox()).x;
        await d.openRoom({ empty: true });
        const view = page.viewportSize();
        const frame = await d.frameOf(page.locator('#right-panel-wrapper'));
        frame.width += frame.x - (left - 12);
        frame.x = left - 12;
        d.pos = { x: view.width * .55, y: view.height * .45 };

        const name = page.locator('#character_info input[data-id="characterName"]');
        return d.record(frame, out, async () => {
            await d.pause(500);
            await d.click(page.getByRole('button', { name: 'New character' }));
            await d.pause(600);
            await d.click(page.locator('.character-sheet-entry a').first());
            await name.waitFor();
            await d.pause(500);
            await d.click(name);
            await page.keyboard.press('Control+A');
            await d.pause(250);
            await d.type('Sir Galahad');
            await d.pause(400);
            // Under the card, where it draws the eye and shows no tooltip.
            const card = await page.locator('.character-sheet-entry').first().boundingBox();
            await d.moveTo({ x: card.x + card.width * .45, y: card.y + card.height + 60 });
            await d.pause(2000);
        });
    },
};
