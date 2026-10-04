// Power armour picked from the autocomplete fills the item; once equipped, the
// camera closes in on the armour of the Combat tab and the total of the body
// explains itself on hover.
export default {
    file: '11-autocomplete',
    kind: 'webm',
    async play(d, out) {
        const { page } = d;
        await d.openSheet('sir-galahad');
        await page.locator('label[for="show-gear"]').click();
        const sheet = d.sheet();
        const box = await sheet.boundingBox();
        // The upper part of the sheet in the proportions of the slide.
        const frame = { x: box.x, y: box.y, width: box.width, height: Math.round(box.width * 9 / 16) };
        d.pos = { x: frame.x + frame.width * .7, y: frame.y + frame.height * .8 };

        const items = page.locator('#gear .gear-item');
        const armour = page.locator('[data-id="armour"].layout-row');

        return d.record(frame, out, async () => {
            await d.pause(500);
            await d.click(page.locator('#gear .add-button').first());
            await d.pause(250);
            const item = items.nth(1);
            await d.click(item.locator('input').first());
            await d.pause(200);
            await d.type('Mk VII');
            await d.pause(600);
            await d.click(page.locator('.autocomplete-option').filter({ hasText: 'Aquila' }).first());
            await d.pause(1200);
            await d.click(item.locator('label', { hasText: 'Equipped' }).locator('input'));
            await d.pause(450);
            await d.click(page.locator('label[for="show-combat"]'));
            await d.pause(350);
            // Widened to the slide's proportions, the armour would show the edge of the
            // melee attacks beside it: the empty side is on the left.
            const a = await armour.boundingBox();
            const width = a.height * frame.width / frame.height;
            await d.camera({ x: a.x + a.width + 4 - width, y: a.y, width, height: a.height }, { duration: 550 });
            await d.pause(200);
            await d.moveTo(armour.locator('[data-id="body"] .armour-total'));
            await d.pause(3000);
        });
    },
};
