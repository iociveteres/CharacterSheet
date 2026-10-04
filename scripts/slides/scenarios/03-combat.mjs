// The Combat tab of the showcase sheet, whole.
export default {
    file: '3-combat',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.page.locator('label[for="show-combat"]').click();
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
