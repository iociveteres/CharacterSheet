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

(function () {
    const KEY = 'theme'; // localStorage key & cookie name
    function readStored() {
        try { return localStorage.getItem(KEY); } catch (e) { }
        // fallback to cookie so SSR can read it on next request
        const m = document.cookie.match('(?:^|;)\\s*' + KEY + '=([^;]+)');
        return m ? decodeURIComponent(m[1]) : null;
    }

    const stored = readStored(); // 'light'|'dark'|'retro'|'system'|null
    const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
    const systemIsDark = mql && mql.matches;
    // If stored === 'system' or not stored -> adopt system preference
    const initial = (stored === 'system' || !stored) ? (systemIsDark ? 'dark' : 'light') : stored;
    document.documentElement.setAttribute('data-theme', initial);
    // expose minimal API for page JS (defined early so other scripts can use it)
    window.__THEME_INIT = { stored, initial, hasStored: !!stored };
})();

(function () {
    const raw = getHue();
    const hue = validateHue(raw);
    if (hue !== null) {
        document.documentElement.style.setProperty('--user-hue', hue);
        window.__USER_HUE_INIT = { stored: raw, hue };
    } else {
        window.__USER_HUE_INIT = { stored: raw, hue: null };
    }
})();
