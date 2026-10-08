// What scripts/perf/stress.mjs measures, one action per line. Item ids are
// those of the stress sheets (cmd/seedtest/stress.go); M has the same items
// as XL, so every line runs on both.
//
//   tab     navigation tab the action happens on: the element is visible, as for a player
//   open    a toggle clicked first (unless .active) and again after, e.g. a dropdown with the field
//   path    data-id path of the element, sel a selector inside it (or in the sheet)
//
// Types:
//   load    how: "direct" opens the sheet's URL, "switch" clicks it in the room list
//   input   keystrokes into the field at path; number: true types numbers
//   click   a click on the element; undo clicks it again (or undo) unmeasured
//   add     a click on "＋ Add" of grid; the new item is deleted unmeasured
//   delete  in Delete Mode, a click on the delete button of an item added to grid
//   remote  the GM edits the field at path (or adds and deletes an item of grid);
//           the time the sheet takes to apply each message
//   noop    an empty action: the overhead of the method itself

/** Budgets of the median and p90, ms, at CPU BUDGET_CPU×. */
export const BUDGETS = {
    input: { median: 10, p90: 16 },
    click: { median: 100 },
    add: { median: 100 },
    delete: { median: 100 },
    remote: { median: 10 },
};

export const BUDGET_CPU = 4;

const psyPower = 'psykana.tabs.items.psy-tab-01.powers.items.psy-power-01';
const ownControl = cls => `:scope > .split-header ${cls}, :scope > ${cls}`;

export const SCENARIOS = [
    { name: 'no-op', type: 'noop' },

    { name: 'direct open', type: 'load', how: 'direct' },
    { name: 'switch in the room', type: 'load', how: 'switch' },

    { name: 'characterName', type: 'input', tab: 'player', path: 'characterInfo.characterName' },
    { name: 'characteristic WS', type: 'input', tab: 'player', open: '.char-dropdown-toggle', path: 'characteristics.WS.value', number: true },
    { name: 'left skill misc bonus', type: 'input', tab: 'player', path: 'skillsLeft.awareness.miscBonus', number: true },
    { name: 'right skill with option', type: 'input', tab: 'player', path: 'skillsRight.1_common_lore.name' },
    { name: 'right skill without options', type: 'input', tab: 'player', path: 'skillsRight.5_forbidden_lore.name' },
    { name: 'custom skill with option', type: 'input', tab: 'player', path: 'customSkills.list.items.custom-skill-01.name' },
    { name: 'custom skill without options', type: 'input', tab: 'player', path: 'customSkills.list.items.custom-skill-10.name' },
    { name: 'note description', type: 'input', tab: 'player', path: 'notes.list.items.note-01.description' },
    { name: 'psychic power name', type: 'input', tab: 'psykana', path: `${psyPower}.name` },
    { name: 'gear name', type: 'input', tab: 'gear', path: 'gear.list.items.gear-01.name' },

    { name: 'psychic power roll', type: 'click', tab: 'psykana', path: psyPower, sel: ':scope > .split-header .rollable' },
    { name: 'ranged attack roll', type: 'click', tab: 'combat', path: 'rangedAttacks.list.items.ranged-01', sel: ':scope > .split-header .rollable' },
    { name: 'psykana Test Options', type: 'click', tab: 'psykana', path: 'psykana', sel: '.block-settings-toggle' },
    { name: 'tab Psykana', type: 'click', tab: 'player', sel: 'label[for="show-psykana"]', undo: { sel: 'label[for="show-player-sheet"]' } },
    { name: 'tab Gear', type: 'click', tab: 'player', sel: 'label[for="show-gear"]', undo: { sel: 'label[for="show-player-sheet"]' } },
    { name: 'tab Combat', type: 'click', tab: 'player', sel: 'label[for="show-combat"]', undo: { sel: 'label[for="show-player-sheet"]' } },
    { name: 'Delete Mode', type: 'click', tab: 'gear', sel: '#toggle-delete-mode' },
    { name: 'Toggle Descs on Gear', type: 'click', tab: 'gear', sel: '#toggle-descriptions' },
    { name: 'collapse a gear item', type: 'click', tab: 'gear', path: 'gear.list.items.gear-01', sel: ownControl('.toggle-button') },
    { name: 'add gear', type: 'add', tab: 'gear', grid: 'gear.list.items' },
    { name: 'delete gear', type: 'delete', tab: 'gear', grid: 'gear.list.items' },
    { name: 'add psychic power', type: 'add', tab: 'psykana', grid: 'psykana.tabs.items.psy-tab-01.powers.items' },
    { name: 'delete psychic power', type: 'delete', tab: 'psykana', grid: 'psykana.tabs.items.psy-tab-01.powers.items' },

    { name: 'remote characterName', type: 'remote', tab: 'player', path: 'characterInfo.characterName' },
    { name: 'remote characteristic WS', type: 'remote', tab: 'player', path: 'characteristics.WS.value', number: true },
    { name: 'remote custom skill name', type: 'remote', tab: 'player', path: 'customSkills.list.items.custom-skill-01.name' },
    { name: 'remote psychic power name', type: 'remote', tab: 'psykana', path: `${psyPower}.name` },
    { name: 'remote add and delete gear', type: 'remote', tab: 'gear', grid: 'gear.list.items' },
];

/** "＋ Add" of a grid, and the delete button of an item: CSS shows it in Delete Mode only, a DOM click works anyway. */
export const ADD_BUTTON = ':scope > .layout-column > .add-slot > .add-button';
export const DELETE_BUTTON = ownControl('.delete-button');
