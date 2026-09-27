import Alpine from '@alpinejs/csp';
import './socket.js';

// The part of the room still on Alpine: the right panel's toggle. room/main.ts
// starts Alpine after it.
export function registerRoom() {
    Alpine.data('roomComponent', function () {
        return {
            rightPanelVisible: true,

            init() {
                // Disable transitions during initial load
                document.body.classList.add('no-transitions');
                this.$nextTick(() => {
                    setTimeout(() => {
                        document.body.classList.remove('no-transitions');
                    }, 100);
                });

                try {
                    this.rightPanelVisible = localStorage.getItem('rightPanelVisible') !== 'false';
                } catch {
                    // storage can be unavailable
                }
            },

            toggleRightPanel() {
                this.rightPanelVisible = !this.rightPanelVisible;

                try {
                    localStorage.setItem('rightPanelVisible', this.rightPanelVisible);
                } catch (e) {
                }
            }
        };
    });
}
