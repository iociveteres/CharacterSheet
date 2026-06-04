import { getRoot } from "../utils.js";

/**
 * Displays the most recent initiative roll result for this character sheet.
 *
 * Flow:
 *   1. sheet:rollExact fires (label === 'Initiative') → mark pending + capture characterName
 *   2. ws:chatMessage arrives with matching characterName + non-null commandResult → update display
 */
export function initInitiativeResult() {
    const root = getRoot();
    if (!root) return;

    const wrapper = root.getElementById('initiativeResult');
    if (!wrapper) return;
    const span = wrapper.querySelector('.initiative-value');

    // characterName → true when that character has a pending initiative roll
    const pendingRolls = new Set();

    document.addEventListener('sheet:rollExact', (e) => {
        const { label } = e.detail ?? {};
        if (label !== 'Initiative') return;

        const charName = getCharacterName();
        if (!charName) return;

        pendingRolls.add(charName);
    });

    document.addEventListener('ws:chatMessage', (e) => {
        const msg = e.detail ?? {};
        const { characterName, commandResult } = msg;

        if (!characterName || !commandResult) return;
        if (!pendingRolls.has(characterName)) return;

        // commandResult is a plain string, e.g. "d10+0:\n9 + 0 = 9"
        // Extract the number after the last "="
        const match = commandResult.match(/=\s*(-?\d+)\s*$/);
        if (!match) return;

        pendingRolls.delete(characterName);
        wrapper.classList.add('has-result');
        span.textContent = match[1];
    });
}

function getCharacterName() {
    return getRoot()
        ?.querySelector('input[data-id="characterName"]')
        ?.value?.trim() || null;
}