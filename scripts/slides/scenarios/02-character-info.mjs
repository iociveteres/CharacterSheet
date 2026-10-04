// The Player Sheet tab of the showcase sheet, whole.
export default {
    file: '2-character-info',
    kind: 'webp',
    scale: 2,
    viewport: { width: 1920, height: 1400 },
    async play(d, out) {
        await d.openSheet('sir-galahad');
        await d.shot(await d.frameOf(d.sheet()), out);
    },
};
