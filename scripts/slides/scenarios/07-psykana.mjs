// The Psykana tab of the showcase sheet, whole.
export default {
    file: '7-psykana',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.page.locator('label[for="show-psykana"]').click();
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
