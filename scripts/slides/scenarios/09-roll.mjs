// The chat: the command list, the examples of /r in its tooltip, a repeated
// roll typed and sent.
export default {
    file: '9-roll',
    kind: 'webm',
    // The chat is as tall as the window: a lower one makes the slide less narrow.
    viewport: { width: 1920, height: 640 },
    async play(d, out) {
        const { page } = d;
        await d.openSheet('sir-galahad');
        await page.locator('label[for="show-chat"]').click();
        const panel = page.locator('#right-panel');
        const frame = await d.frameOf([panel, page.locator('#room-controls')]);
        d.pos = { x: frame.x + frame.width * .6, y: frame.y + frame.height * .45 };

        return d.record(frame, out, async () => {
            await d.pause(450);
            await d.click(panel.locator('.commands-btn'));
            await d.pause(300);
            await d.moveTo(panel.locator('.command-entry').first());
            await d.pause(2000);
            await d.click(panel.locator('.command-entry').first());
            await d.pause(200);
            await d.type('13x(2d10+25)');
            await d.pause(250);
            await d.click(panel.locator('.send-btn'));
            await d.moveTo({ x: frame.x + frame.width * .6, y: frame.y + frame.height * .76 });
            await d.pause(3000);
        });
    },
};
