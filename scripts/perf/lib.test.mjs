import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installStress } from './lib.mjs';

/** A host element with an open shadow root holding `html`. */
function host(id, html) {
    const el = document.createElement('div');
    el.id = id;
    el.attachShadow({ mode: 'open' }).innerHTML = html;
    document.body.append(el);
    return el;
}

const card = (name, sheetId, wounds = '12 / 12') =>
    `<div class="encounter-card" data-sheet-id="${sheetId}"><span class="encounter-card-title">${name}</span>`
    + `<span class="encounter-wounds-value">${wounds}</span></div>`;

/** The encounter window with encounter `id` open and these cards in its enemies column. */
function encounterWindow(id, cards) {
    document.body.insertAdjacentHTML('beforeend',
        `<div class="encounter-window" data-encounter-id="${id}"><div class="participant-column">${cards.join('')}</div></div>`);
}

describe('window.__stress', () => {
    let stress;

    beforeEach(() => {
        // Event Timing is Chrome's; what installStress observes does not matter here.
        vi.stubGlobal('PerformanceObserver', class {
            observe() {}
            takeRecords() {
                return [];
            }
        });
        installStress();
        stress = window.__stress;
    });

    afterEach(() => {
        document.body.innerHTML = '';
        vi.unstubAllGlobals();
    });

    describe('find', () => {
        beforeEach(() => {
            host('charactersheet', '<div data-id="fatigue"><input data-id="fatigueCur" class="sheet"></div>');
            host('statblock-sheet', '<div class="stat-block"><div data-id="fatigue"><input data-id="fatigueCur" class="block"></div></div>');
        });

        it('looks in the sheet by default and in the shadow root of root when given', () => {
            expect(stress.find({ path: 'fatigue.fatigueCur' }).className).toBe('sheet');
            expect(stress.find({ root: 'statblock-sheet', path: 'fatigue.fatigueCur' }).className).toBe('block');
            expect(stress.find({ root: 'statblock-sheet', sel: '.stat-block' })).toBeTruthy();
        });

        it('says which root is missing', () => {
            expect(() => stress.find({ root: 'popup-sheet', path: 'fatigue' })).toThrow('No sheet at #popup-sheet');
        });

        it('picks and focuses the field of another root, remembering its value', () => {
            const field = stress.find({ root: 'statblock-sheet', path: 'fatigue.fatigueCur' });
            field.value = '2';
            stress.pick({ root: 'statblock-sheet', path: 'fatigue.fatigueCur' });
            expect(stress.target).toBe(field);
            expect(stress.original).toBe('2');
        });
    });

    describe('the encounter window', () => {
        it('finds a participant by the title of their card', () => {
            encounterWindow(7, [card('Stress Ork 01', 101), card('Stress Ork 02', 102)]);
            expect(stress.participant('Stress Ork 02').dataset.sheetId).toBe('102');
            expect(() => stress.participant('Stress Ork 1')).toThrow('No participant Stress Ork 1');
        });

        it('is loaded when the encounter is open and every card has its wounds', () => {
            encounterWindow(7, [card('Stress Ork 01', 101), card('Stress Ork 02', 102, '…')]);
            expect(stress.encounterLoaded(7)).toBe(false);
            document.querySelector('[data-sheet-id="102"] .encounter-wounds-value').textContent = '12 / 12';
            expect(stress.encounterLoaded(7)).toBe(true);
            expect(stress.encounterLoaded(8)).toBe(false);
        });

        it('is not loaded before the cards come', () => {
            encounterWindow(7, []);
            expect(stress.encounterLoaded(7)).toBe(false);
        });

        it('shows the stat block of a sheet once it has rendered it', () => {
            const block = host('statblock-sheet', '');
            block.dataset.sheetId = '101';
            expect(stress.statBlockShown(101)).toBe(false);
            block.shadowRoot.innerHTML = '<div class="stat-block"></div>';
            expect(stress.statBlockShown(101)).toBe(true);
            expect(stress.statBlockShown(102)).toBe(false);
        });
    });
});
