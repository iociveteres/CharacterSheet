// The Talents tab of the showcase sheet, whole.
export default {
    file: '4-talents',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.page.locator('label[for="show-talents"]').click();
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
