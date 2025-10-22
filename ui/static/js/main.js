import {
	getHue,
	validateHue,
	HUE_KEY,
} from "./theme-init.js"


var navLinks = document.querySelectorAll("nav a");
for (var i = 0; i < navLinks.length; i++) {
	var link = navLinks[i]
	if (link.getAttribute('href') == window.location.pathname) {
		link.classList.add("live");
		break;
	}
}

function getCookie(name) {
	const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
	return m ? decodeURIComponent(m[1]) : null;
}

function setCookie(name, value, maxAgeSeconds) {
	const parts = [
		name + '=' + encodeURIComponent(value),
		'path=/',
		'max-age=' + (maxAgeSeconds || 60 * 60 * 24 * 365),
		'SameSite=Lax'
	];
	if (location.protocol === 'https:') parts.push('Secure');
	document.cookie = parts.join('; ');
}

function nowSec() { return Math.floor(Date.now() / 1000); }

// time zone
(function () {
	const COOKIE_TZ = 'tz';
	const COOKIE_TZ_TS = 'tz_ts';
	const REFRESH_SECONDS = 7 * 24 * 60 * 60; // refresh weekly

	try {
		const clientTz = Intl?.DateTimeFormat?.().resolvedOptions?.().timeZone;
		if (!clientTz) return;

		const storedTz = getCookie(COOKIE_TZ);
		const storedTs = parseInt(getCookie(COOKIE_TZ_TS) || '0', 10);
		const age = nowSec() - (storedTs || 0);

		if (storedTz !== clientTz) {
			setCookie(COOKIE_TZ, clientTz, 60 * 60 * 24 * 365);
			setCookie(COOKIE_TZ_TS, String(nowSec()), 60 * 60 * 24 * 365);
			return;
		}
		if (!storedTs || age > REFRESH_SECONDS) {
			setCookie(COOKIE_TZ_TS, String(nowSec()), 60 * 60 * 24 * 365);
		}
	} catch (e) { }
})();

const MSEC_YEAR = 60 * 60 * 24 * 365;
// theme manager
function setTheme(theme, { persist = true } = {}) {
	const KEY = 'theme';
	const mql = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');

	// theme: 'light' | 'dark' | 'retro' | 'system'
	if (theme === 'system') {
		// apply system immediately
		const sys = (mql && mql.matches) ? 'dark' : 'light';
		document.documentElement.setAttribute('data-theme', sys);
	} else {
		document.documentElement.setAttribute('data-theme', theme);
	}

	if (persist) {
		localStorage.setItem(KEY, theme);
		setCookie(KEY, theme, MSEC_YEAR);
	}
};

const themeSelect = document.getElementById('theme-select');
themeSelect?.addEventListener('change', e => {
	setTheme(themeSelect.value)
});

try {
	const stored = localStorage.getItem('theme');
	themeSelect.value = stored || 'system';
} catch (e) { }


// set CSS var --user-hue (string "0".."360") or clear it when null
// assumes persistLocal(hue) and persistCookie(hue) are available
function setHue(h, { persist = true } = {}) {
	// validateHue treats 'default'/'unset'/null/undefined as null
	const hue = validateHue(h);
	if (hue === null) {
		document.documentElement.style.removeProperty('--user-hue');
	} else {
		document.documentElement.style.setProperty('--user-hue', hue);
	}

	if (persist) {
		// these helper names assumed present in module scope
		localStorage.setItem(HUE_KEY, hue);
		setCookie(HUE_KEY, hue, MSEC_YEAR);
	}
	return hue;
}

function clearHue(opts = {}) {
	return setHue(null, opts);
}


(function () {
	function buildHueGradient(steps = 36) {
		const delta = 360 / steps;
		const stops = [];
		for (let i = 0; i <= steps; i++) {
			const deg = Math.round(i * delta);
			const pos = Math.round((i / steps) * 100);
			stops.push(`hsl(${deg} 100% 50%) ${pos}%`);
		}
		return `linear-gradient(90deg, ${stops.join(', ')})`;
	}

	document.addEventListener('DOMContentLoaded', () => {
		const range = document.getElementById('hue-range');
		const out = document.getElementById('hue-value');
		const autoBtn = document.getElementById('hue-default');
		const preview = document.querySelector('.hue-preview');
		const control = range ? range.closest('.hue-control') : null;

		if (!range || !out || !autoBtn || !preview) return;

		range.style.backgroundImage = buildHueGradient();

		const stored = getHue(); // string or null

		function applyUI(hueStr) {
			if (hueStr === null) {
				control && control.classList.add('default');
				out.textContent = 'default';
				preview.style.background = '';
				range.value = 0;
			} else {
				control && control.classList.remove('default');
				out.textContent = hueStr;
				preview.style.background = `hsl(${hueStr} 100% 50%)`;
				range.value = hueStr;
			}
		}

		// apply stored value to CSS and UI
		if (stored === null) {
			document.documentElement.style.removeProperty('--user-hue');
		} else {
			document.documentElement.style.setProperty('--user-hue', stored);
		}
		applyUI(stored);

		// live feedback while dragging
		range.addEventListener('input', (e) => {
			const val = e.target.value;
			const validated = validateHue(val);
			if (validated !== null) {
				out.textContent = validated;
				preview.style.background = `hsl(${validated} 100% 50%)`;
				// set inline var for immediate preview (not persisted until commit)
				document.documentElement.style.setProperty('--user-hue', validated);
			}
		});

		// commit (persist) on change/commit events
		const commit = () => {
			const validated = validateHue(range.value);
			const hue = validated === null ? null : validated;
			setHue(hue, { persist: true });
			applyUI(hue);
		};
		range.addEventListener('change', commit);
		range.addEventListener('mouseup', commit);
		range.addEventListener('touchend', commit);

		// default button clears override
		autoBtn.addEventListener('click', () => {
			setHue(null, { persist: true });
			applyUI(null);
		});

		autoBtn.addEventListener('keydown', (ev) => {
			if (ev.key === ' ' || ev.key === 'Enter') {
				ev.preventDefault();
				autoBtn.click();
			}
		});
	});
})();
