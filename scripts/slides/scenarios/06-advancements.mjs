// The Advancements tab of the showcase sheet, whole.
export default {
    file: '6-advancements',
    kind: 'webp',
    scale: 2,
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.page.locator('label[for="show-advancements"]').click();
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
