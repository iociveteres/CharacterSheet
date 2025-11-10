document.addEventListener('DOMContentLoaded', () => {
    // Find activation form (has token input)
    const tokenInput = document.querySelector('form input[name="token"]');
    if (!tokenInput) return;

    const form = tokenInput.closest('form');
    if (!form) return;

    const submit = form.querySelector('button[type="submit"], input[type="submit"]');
    if (!submit) return;

    // Check if form should auto-submit via data attribute
    const shouldAutoSubmit = form.dataset.autoSubmit === 'true';

    // Handle form submission
    form.addEventListener('submit', async (ev) => {
        ev.preventDefault();

        // Disable button and update text
        submit.disabled = true;
        const originalText = submit.textContent || submit.value;

        const processingText = shouldAutoSubmit ? 'Activating…' : 'Sending…';
        if (submit.tagName === 'INPUT') {
            submit.value = processingText;
        } else {
            submit.textContent = processingText;
        }

        try {
            // Collect form data
            const fd = new FormData(form);
            const body = new URLSearchParams();
            for (const [k, v] of fd.entries()) body.append(k, v);

            const res = await fetch(form.action, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: body.toString(),
                credentials: 'same-origin'
            });

            // Handle redirect or success
            if (res.redirected) {
                window.location = res.url;
                return;
            }

            if (res.ok) {
                if (shouldAutoSubmit) {
                    window.location = '/user/login';
                } else {
                    if (submit.tagName === 'INPUT') {
                        submit.value = 'Sent!';
                    } else {
                        submit.textContent = 'Sent!';
                    }
                }
                return;
            }

            throw new Error('Request failed');

        } catch (err) {
            console.error('Form error:', err);
            submit.disabled = false;
            if (submit.tagName === 'INPUT') {
                submit.value = originalText;
            } else {
                submit.textContent = originalText;
            }
        }
    });

    // Auto-submit only if data-auto-submit="true"
    if (shouldAutoSubmit) {
        form.requestSubmit();
    }
});