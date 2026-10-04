// Talents: Sprint carried by its handle from the first column to the end of
// the third.
export default {
    file: '8-drag-n-drop',
    kind: 'webm',
    async play(d, out) {
        const { page } = d;
        await d.openSheet('sir-galahad');
        await page.locator('label[for="show-talents"]').click();
        const sprint = page.locator('[data-id="talents-NacNZYHRfKyVrEFTJbD1e"]');
        const last = page.locator('[data-id="talents-1G933NqUTDq_JtSBRqDYv"]');
        const frame = await d.frameOf(d.sheet());
        // The third column grows by the item it takes.
        const item = (await sprint.boundingBox()).height;
        frame.height += Math.ceil(item) + 10;
        // Near a heading the cursor would show its Add button: it rests low.
        d.pos = { x: frame.x + frame.width * .62, y: frame.y + frame.height * .9 };

        return d.record(frame, out, async () => {
            await d.pause(500);
            const to = await last.boundingBox();
            // Counter Attack moves down for the item on the way, and the item goes after
            // it once the cursor goes down over it.
            await d.drag(sprint.locator('.drag-handle').first(), { x: to.x + to.width * .5, y: to.y + to.height + item * .6 });
            await d.pause(400);
            await d.moveTo({ x: frame.x + frame.width * .4, y: frame.y + frame.height * .92 });
            await d.pause(1500);
        });
    },
};
