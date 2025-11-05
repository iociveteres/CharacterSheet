export const HUE_KEY = 'theme_hue';

export function validateHue(v) {
    if (v === null || v === '' || v === undefined) return null;
    // allow "auto" or "unset" to mean no override
    if (v === 'auto' || v === 'unset') return null;
    // parse number and clamp
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    // normalize to 0..360 integer
    let h = Math.round(n) % 361;
    if (h < 0) h += 361;
    if (h > 360) h = h % 361;
    return String(h);
}

export function getHue() {
    // returns string hue or null
    try {
        const v = localStorage.getItem(HUE_KEY);
        if (v !== null) return clampHue(v);
    } catch (e) { }
    // fallback to cookie
    const m = document.cookie.match('(?:^|;)\\s*' + HUE_KEY + '=([^;]+)');
    if (m) return validateHue(decodeURIComponent(m[1]));
    return null;
};
