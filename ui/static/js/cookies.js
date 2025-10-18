export function getCookie(name) {
    const m = document.cookie.match('(?:^|; )' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
}

export function setCookie(name, value, maxAgeSeconds) {
    const parts = [
        name + '=' + encodeURIComponent(value),
        'path=/',
        'max-age=' + (maxAgeSeconds || 60 * 60 * 24 * 365),
        'SameSite=Lax'
    ];
    if (location.protocol === 'https:') parts.push('Secure');
    document.cookie = parts.join('; ');
}

export function nowSec() { return Math.floor(Date.now() / 1000); }
