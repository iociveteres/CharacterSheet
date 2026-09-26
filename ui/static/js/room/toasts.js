// Short notices at the top of the room page. The sheet sends them as
// sheet:notice (ui/static/js/sheet/main.ts).
const TOAST_MS = 5000;

let lastId = 0;

export const toastsMixin = {
    toasts: [],

    setupToasts() {
        document.addEventListener('sheet:notice', (e) => this.showToast(e.detail.message));
    },

    showToast(message) {
        // The same notice again replaces the shown one, so it stays its full time.
        const id = ++lastId;
        this.toasts = [...this.toasts.filter(t => t.message !== message), { id, message }];
        setTimeout(() => {
            this.toasts = this.toasts.filter(t => t.id !== id);
        }, TOAST_MS);
    },
};
