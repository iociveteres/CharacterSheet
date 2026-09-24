// Synthetic sheets with edge cases for the offline reconciliation, printed as
// JSONL in the format of the sheet dump:
//   node scripts/reconcile/edge-sheets.mjs > edge.jsonl
let n = 0;
const nextId = prefix => `${prefix}-${++n}`;
const grid = (prefix, items, { ghosts = 0, unplaced = 0 } = {}) => {
    const out = { items: {}, layouts: {} };
    items.forEach((item, i) => {
        const id = nextId(prefix);
        out.items[id] = item;
        if (i >= items.length - unplaced) return;
        out.layouts[id] = { colIndex: i % 2, rowIndex: Math.floor(i / 2) };
    });
    for (let i = 0; i < ghosts; i++) out.layouts[nextId(`${prefix}-ghost`)] = { colIndex: 0, rowIndex: 9 + i };
    return out;
};

const rollExtra = { name: "Aim\nbonus", value: -5, enabled: true };

// Every grid with one empty item, and rolls present with zero values.
const empty = () => ({
    conditions: { list: grid("cond", [{ entries: grid("entry", [{}]) }]) },
    customSkills: { list: grid("cs", [{}]) }, notes: { list: grid("note", [{}]) },
    resourceTrackers: { list: grid("rt", [{}]) }, powerShields: { list: grid("ps", [{}]) },
    rangedAttacks: { list: grid("ra", [{ roll: {} }]) },
    meleeAttacks: { list: grid("ma", [{ roll: {}, tabs: grid("mt", [{}]) }]) },
    traits: { list: grid("trait", [{}]) }, talents: { list: grid("talent", [{}]) },
    gear: { list: grid("gear", [{ armour: {}, entries: grid("ge", [{}]) }]) },
    cybernetics: { list: grid("cyb", [{ entries: grid("ce", [{}]) }]) },
    experience: { experienceLog: grid("xp", [{}]) },
    mutations: { list: grid("mut", [{}]) }, mentalDisorders: { list: grid("md", [{}]) },
    diseases: { list: grid("dis", [{}]) },
    psykana: { tabs: grid("pt", [{ powers: grid("pp", [{ roll: {} }]) }]) },
    technoArcana: { tabs: grid("tt", [{ powers: grid("tp", [{ roll: {} }]) }]) },
});

const edge = () => ({
    characterInfo: { characterName: "<b>Name</b> & \"quotes\"\nnext line", archetype: "Ярость ▲", race: "a\r\nb" },
    characteristics: {
        WS: { value: "35", unnatural: "3" }, BS: { value: "abc" }, S: {}, XX: { value: "1" },
    },
    skillsLeft: {
        acrobatics: { characteristic: "" }, athletics: { characteristic: "Foo", plus0: true, miscBonus: -10 },
        dodge: { characteristic: "Cor", plus10: true, plus20: true, difficulty: 45 }, unknown_skill: { plus0: true },
    },
    skillsRight: { "1_linguistics": { name: "Low\nGothic", characteristic: "F" }, "6_trade": { name: "not rendered" } },
    fatigue: { fatigueMode: "", fatigueMax: 3 },
    initiative: { dice: "d10+0", aBonus: true, flatBonus: 2, lastInitiative: 42 },
    size: 7,
    movement: { fullMult: 0, chargeMult: 4, runMult: -1, bonus: 1, moveHalf: 9 },
    armour: { head: { armourValue: 4, extra1Name: "Helm\n", extra1Value: 1 }, toughnessBaseAbsorptionValue: 5, woundsMax: 12 },
    carryWeightAndEncumbrance: { carryWeightBase: 7, carryWeight: 1e21, encumbrance: 3.5 },
    experience: { alignment: "", aptitudes: "WS, T", experienceTotal: 1000, experienceSpent: 400,
        experienceLog: grid("xp", [
            { name: "lvl0", type: "", level: 0 }, { name: "lvl3", type: "skill", level: 3 },
            { name: "lvl7", type: "bogus", level: 7, experienceCost: 250 },
        ], { unplaced: 1 }) },
    psykana: { psykanaType: "x", basePR: 3, effectivePR: 9, tabs: grid("pt", [
        { name: "Biomancy", powers: grid("pp", [
            { name: "no roll" },
            { name: "skill", roll: { baseSelect: "psyniscience", modifier: 10, kickPR: 2, extra1: rollExtra } },
            { name: "caps", roll: { baseSelect: "Psyniscience" } },
            { name: "char", roll: { baseSelect: "Cor", effectivePR: 4 } },
        ]) },
        { name: "Empty tab" },
    ], { ghosts: 1 }) },
    technoArcana: { compensationRoll: { modifier: 2, extra2: rollExtra }, tabs: grid("tt", [
        { name: "Tab", powers: grid("tp", [
            { roll: { baseSelect: "Tech-Use" } }, { roll: { baseSelect: "medicae" } },
            { roll: { baseSelect: "awareness (I)" } }, { roll: { baseSelect: "athletics" } }, { roll: { baseSelect: "Dodge" } },
        ]) },
    ]) },
    conditions: { list: grid("cond", [
        { name: "Fury", enabled: true, stacks: -2, entries: grid("entry", [
            { type: "", name: "WS", bonus: "X" }, { type: "bonus_unnatural", name: "S" },
            { type: "bonus_ap", apType: "", apValue: "2" }, { type: "bonus_ap", apType: "weird" },
        ], { ghosts: 1 }) },
        { name: "No entries", entries: { items: null, layouts: null } },
    ], { ghosts: 2, unplaced: 1 }) },
    customSkills: { list: grid("cs", [{ name: "Custom", characteristic: "" }, { characteristic: "Inf", miscBonus: 5 }]) },
    notes: { list: grid("note", [
        { name: "a\r\nb", description: "\nleading newline" }, { description: "crlf\r\nand\rcr" }, { description: "\n\ntwo" },
    ]) },
    resourceTrackers: { list: grid("rt", [{ name: "Ammo", value: -3 }]) },
    powerShields: { list: grid("ps", [{ nature: "", type: "phase" }]) },
    rangedAttacks: { list: grid("ra", [
        { name: "no roll", class: "Pistol", damageType: "" },
        { name: "roll", class: "long rifle", damageType: "E(El)", roll: {
            aim: { selected: "half", half: 10 }, target: { selected: "bogus" }, range: { selected: "point-blank", pointBlank: 30 },
            rof: { selected: "" }, baseSelect: "acrobatics", extra1: rollExtra } },
        { roll: { baseSelect: "Acrobatics", range: { selected: "pointBlank" } } },
    ]) },
    meleeAttacks: { list: grid("ma", [
        { name: "Axe", group: "", shield: { subtype: "", arm: "", ap: 2, equipped: true },
            tabs: grid("mt", [{ profile: "axe", damageType: "R" }, { profile: "xyz" }, { profile: "" }]),
            roll: { base: { selected: "charge" }, stance: { selected: "defensive" }, rof: { selected: "quick" }, baseSelect: "BS" } },
        { name: "No tabs" },
    ]) },
    traits: { list: grid("trait", [{ name: "T" }], { ghosts: 1 }) },
    gear: { list: grid("gear", [
        { name: "Armour", weight: 1.5, gearType: "armour", carried: true, armour: { ap: { head: "4" }, special: "x\ny", ablativeWounds: "3" },
            entries: grid("ge", [{ type: "movement_bonus", movementBonus: "1" }]) },
        { name: "Junk", weight: -0, gearType: "junk" },
        { weight: 1e-7, gearType: "" },
    ]) },
    cybernetics: { list: grid("cyb", [{ name: "Eye", entries: grid("ce", [{ type: "roll_bonus", rollBonus: "10" }]) }]) },
    mentalDisorders: { insanityPoints: 40, list: grid("md", [{ name: "Fear" }]) },
});

const sheets = [
    { id: 900001, content: {} },
    { id: 900002, content: empty() },
    { id: 900003, content: edge() },
    { id: 900004, kind: "pathfinder_crusade", content: { characterInfo: { characterName: "PF" } } },
];
for (const s of sheets) console.log(JSON.stringify({ kind: "black_crusade", ...s }));
