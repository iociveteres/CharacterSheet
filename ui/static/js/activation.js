const form = document.getElementById('activateForm');
if (!form) throw new Error('activation: form not found');

const btn = document.getElementById('activateBtn');

(async function () {
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        // Disable UI
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Activating…';
        }
        // Show a simple status area (replace form content)
        const status = document.createElement('div');
        status.textContent = 'Activating your account…';
        form.parentNode.insertBefore(status, form);
        form.style.display = 'none';

        try {
            // Collect form data as application/x-www-form-urlencoded
            const fd = new FormData(form);
            // prefer to send the form body so server sees token in body
            const body = new URLSearchParams();
            for (const [k, v] of fd.entries()) body.append(k, v);

            const res = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body.toString(),
                credentials: 'same-origin' // include cookies
            });

            // If server redirected to login (common), follow it by setting location.
            // fetch follows redirects but won't change window location, so use res.url.
            if (res.redirected) {
                window.location = res.url;
                return;
            }

            if (res.ok) {
                // assume server redirects or returns OK; navigate to login or show success
                window.location = '/user/login';
                return;
            }
        } catch (err) {
            // status.textContent = 'Network error: ' + err.message;
            // if (btn) { btn.disabled = false; btn.textContent = 'Activate account'; }
            // form.style.display = '';
        }
    });

    form.dispatchEvent(new Event('submit', { cancelable: true }));
})();

document.addEventListener('DOMContentLoaded', () => {
    // find the activation form by the token input
    const tokenInput = document.querySelector('form input[name="token"]');
    if (!tokenInput) return;

    const form = tokenInput.closest('form');
    if (!form) return;

    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submit) return;

    const setDone = () => {
        if (submit.tagName === 'INPUT') {
            submit.value = 'Done!';
        } else {
            submit.textContent = 'Done!';
        }
        submit.disabled = true;
        submit.setAttribute('aria-busy', 'true');
    };

    submit.addEventListener('click', () => {
        if (!submit.disabled) setDone();
    });

    form.addEventListener('submit', () => {
        if (!submit.disabled) setDone();
    });
});