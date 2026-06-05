import { getRoot } from "../utils.js";
import { characterState } from "../state/state.js";
import { computed, effect } from "https://cdn.jsdelivr.net/npm/@preact/signals-core@1.5.0/dist/signals-core.module.js";
import { calculateCharacteristicBase } from "../system.js";
import { Dropdown } from "../elementsLayout.js";
import { updateSignalAtPath } from "../state/sync.js";

const BONUS_FIELDS = [
    { key: 'WS', id: 'wsBonus' },
    { key: 'BS', id: 'bsBonus' },
    { key: 'S', id: 'sBonus' },
    { key: 'T', id: 'tBonus' },
    { key: 'A', id: 'aBonus' },
    { key: 'I', id: 'iBonus' },
    { key: 'P', id: 'pBonus' },
    { key: 'W', id: 'wBonus' },
    { key: 'F', id: 'fBonus' },
    { key: 'Cor', id: 'corBonus' },
    { key: 'Inf', id: 'infBonus' },
];

function parseDiceBonus(diceStr) {
    const s = (diceStr ?? '').trim();
    const m = s.match(/^([0-9]*d[0-9]+)\s*([+-]\s*\d+)?$/i);
    if (!m) return { dice: s || 'd10', bonus: 0 };
    return {
        dice: m[1],
        bonus: m[2] ? parseInt(m[2].replace(/\s/g, ''), 10) : 0
    };
}

function buildModifierComputed(ini) {
    return computed(() => {
        const { bonus: diceBonus } = parseDiceBonus(ini.dice?.value);

        let charTotal = 0;
        for (const { key, id } of BONUS_FIELDS) {
            if (!ini[id]?.value) continue;
            const char = characterState.characteristics?.[key];
            if (!char) continue;
            charTotal += calculateCharacteristicBase(
                char.calculatedValue?.value ?? 0,
                char.calculatedUnnatural?.value ?? 0
            );
        }

        return charTotal + (Number(ini.flatBonus?.value) || 0) + diceBonus;
    });
}

export function initInitiative() {
    const root = getRoot();
    if (!root) return;

    const wrapper = root.querySelector('.initiative-wrapper');
    if (!wrapper) return;

    const ini = characterState.initiative;
    if (!ini) return;

    const modifierComputed = buildModifierComputed(ini);

    _initDropdown(root, wrapper);
    _initComputed(root, wrapper, ini, modifierComputed);
    _initRollResult(root, ini, modifierComputed);
}

function _initDropdown(root, wrapper) {
    const dropdown = new Dropdown({
        container: wrapper,
        toggleSelector: '.initiative-dropdown-toggle',
        dropdownSelector: '.initiative-dropdown',
        onOpen: () => wrapper.querySelector('.initiative-dropdown-toggle').textContent = '▲',
        onClose: () => wrapper.querySelector('.initiative-dropdown-toggle').textContent = '▼',
    });

    root.getElementById('initiativeRoll').addEventListener('click', () => dropdown.open());
}

function _initComputed(root, wrapper, ini, modifierComputed) {
    // Roll expression for the click-to-roll handler
    ini.initiative = computed(() => {
        const { dice } = parseDiceBonus(ini.dice?.value);
        const total = modifierComputed.value;
        if (total === 0) return dice;
        if (total > 0) return `${dice}+${total}`;
        return `${dice}${total}`;
    });

    const rollInput = root.getElementById('initiativeRoll');
    const lastInitiativeDisplay = root.getElementById('lastInitiativeDisplay');

    // Seed signal from server-rendered hidden input
    const seedInput = root.querySelector('[data-id="initiative"] input[data-id="lastInitiative"]');
    const seedValue = parseInt(seedInput?.value, 10);
    if (seedValue && ini.lastInitiative) {
        ini.lastInitiative.value = seedValue;
    }

    // initiativeRoll always shows the roll expression
    effect(() => {
        rollInput.value = ini.initiative.value;
    });

    // lastInitiativeDisplay shows raw + current modifiers, updates reactively
    effect(() => {
        const raw = Number(ini.lastInitiative?.value) || 0;
        if (!raw) return;

        const mod = modifierComputed.value;
        const total = raw + mod;
        const titleText = `Roll: ${raw}, Modifiers: ${mod >= 0 ? '+' : ''}${mod}, Total: ${total}`;
        const resultWrapper = root.getElementById('initiativeResult');

        if (lastInitiativeDisplay) {
            lastInitiativeDisplay.textContent = String(total);
        }
        if (resultWrapper) {
            resultWrapper.title = titleText;
        }
    });
}

function _initRollResult(root, ini, modifierComputed) {
    const wrapper = root.getElementById('initiativeResult');
    if (!wrapper) return;

    if (Number(ini.lastInitiative?.value)) {
        wrapper.classList.add('has-result');
    }
    const pendingRolls = new Set();

    document.addEventListener('sheet:rollExact', (e) => {
        const { label } = e.detail ?? {};
        if (label !== 'Initiative') return;
        const charName = _getCharacterName(root);
        if (charName) pendingRolls.add(charName);
    });

    document.addEventListener('ws:chatMessage', (e) => {
        const { characterName, commandResult } = e.detail ?? {};
        if (!characterName || !commandResult) return;
        if (!pendingRolls.has(characterName)) return;

        const totalMatch = commandResult.match(/=\s*(-?\d+)\s*$/);
        if (!totalMatch) return;

        const total = parseInt(totalMatch[1], 10);
        const rawRoll = total - modifierComputed.value;
        pendingRolls.delete(characterName);

        wrapper.classList.add('has-result');

        _syncLastInitiative(root, rawRoll, ini);
    });
}

function _syncLastInitiative(root, rawRoll, ini) {
    const path = 'initiative.lastInitiative';
    const sheetID = document.getElementById('charactersheet')?.dataset?.sheetId;

    updateSignalAtPath(path, rawRoll);

    document.dispatchEvent(new CustomEvent('room:sendMessage', {
        detail: JSON.stringify({
            type: 'change',
            eventID: crypto.randomUUID(),
            sheetID,
            version: 0,
            path,
            change: rawRoll,
        })
    }));
}

function _getCharacterName(root) {
    return root
        ?.querySelector('input[data-id="characterName"]')
        ?.value?.trim() || null;
}