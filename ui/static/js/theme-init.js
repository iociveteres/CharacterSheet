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