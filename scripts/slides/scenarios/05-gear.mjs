// The Gear tab of the showcase sheet, whole.
export default {
    file: '5-gear',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.page.locator('label[for="show-gear"]').click();
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
