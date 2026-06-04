import { effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { characterState } from "../state/state.js";
import { getRoot } from "../utils.js"

export function fatigueIndicator() {
    const indicator = getRoot().querySelector('[data-id="fatigueIndicator"]');
    if (indicator) {
        effect(() => {
            const cur = Number(characterState.fatigue?.fatigueCur?.value) || 0;
            const threshold = Number(characterState.fatigue?.fatigueMax?.value) || 0;

            if (cur <= 0) {
                indicator.textContent = 'Not affected';
                indicator.className = 'fatigue-indicator';
            } else if (threshold > 0 && cur >= threshold) {
                indicator.textContent = 'Unconscious';
                indicator.className = 'fatigue-indicator fatigue-active';
            } else {
                indicator.textContent = `Taking −10 to affected rolls`;
                indicator.className = 'fatigue-indicator fatigue-active';
            }
        });
    }
}