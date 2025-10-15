var navLinks = document.querySelectorAll("nav a");
for (var i = 0; i < navLinks.length; i++) {
	var link = navLinks[i]
	if (link.getAttribute('href') == window.location.pathname) {
		link.classList.add("live");
		break;
	}
}

(function () {
	const COOKIE_TZ = 'tz';
	const COOKIE_TZ_TS = 'tz_ts';
	const REFRESH_SECONDS = 7 * 24 * 60 * 60; // refresh weekly

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
	} catch (e) {}
})();
