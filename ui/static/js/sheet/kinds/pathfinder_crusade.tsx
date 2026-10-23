// The Pathfinder Crusade sheet, a fan mod of Black Crusade: the same sheet
// but for its characteristics (Fate for Infamy and Corruption), its skills,
// Magic for Psykana with the Spellcasting of the class in place of the gift,
// the mana casts spend, the spells prepared for the day and the Arts spells
// of half-casters, and no Techno Arcana. Rules: _prd/sheet_kinds.
import { ConditionsControl } from "../blocks/Characteristics";
import { MANA_RULE, ManaBar, ManaRow, StatMana } from "../blocks/Mana";
import { Psykana } from "../blocks/Powers";
import { PREPARED_RULE, PreparedRollRow, PreparedRow } from "../blocks/Prepared";
import { ArtsBar, StatArts } from "../blocks/Arts";
import { Coins } from "../blocks/Coins";
import { PRCapWarning, SpellcastingRow, StatSpellcasting } from "../blocks/Spellcasting";
import { StatBlock, StatPsykana } from "../blocks/StatBlock";
import { attachComputeds } from "../state/computed";
import {
    BASE_CHARACTERISTICS, SKILLS_RIGHT, type PsykanaTerms, type SkillRow, type SpellcastingVariant, type StatSet,
} from "../schema/constants";
import { checkbox, group, number, openSelect, select } from "../schema/spec";
import { coins, mana, sheetSchemaOf, withOwnFields } from "../schema/sheet";
import { manaShortage, payMana } from "../state/mana";
import type { SheetKindDef } from "./kind";
import { AdvancementsTab, CombatTab, GearTab, NavTab, Navigation, PlayerSheetTab, TalentsTab } from "./tabs";

// A row of the left column is named by its key in skill_bonus entries
// (state/skillNames.ts): a renamed skill has a key of its own.
const SKILLS_LEFT: readonly SkillRow[] = [
    { key: "acrobatics", label: "Acrobatics", def: "A" },
    { key: "athletics", label: "Athletics", def: "S" },
    { key: "awareness", label: "Awareness", def: "P" },
    { key: "charm", label: "Charm", def: "F" },
    { key: "command", label: "Command", def: "F" },
    { key: "commerce", label: "Commerce", def: "I" },
    { key: "deceive", label: "Deceive", def: "F" },
    { key: "dodge", label: "Dodge", def: "A" },
    { key: "inquiry", label: "Inquiry", def: "F" },
    { key: "interrogate", label: "Interrogate", def: "W" },
    { key: "intimidate", label: "Intimidate", def: "W" },
    { key: "logic", label: "Logic", def: "I" },
    { key: "medicae", label: "Medicae", def: "I" },
    { key: "navigation_surface", label: "Surface", def: "I", group: "Navigation" },
    { key: "navigation_sea", label: "Sea", def: "I", group: "Navigation" },
    { key: "navigation_planes", label: "Planes", def: "I", group: "Navigation" },
    { key: "operate_surface", label: "Surface", def: "A", group: "Operate" },
    { key: "operate_aeronautica", label: "Aeronautica", def: "A", group: "Operate" },
    { key: "operate_seaship", label: "Seaship", def: "I", group: "Operate" },
    { key: "parry", label: "Parry", def: "WS" },
    { key: "scrutiny", label: "Scrutiny", def: "P" },
    { key: "security", label: "Security", def: "I" },
    { key: "sleight_of_hand", label: "Sleight of Hand", def: "A" },
    { key: "spellcraft", label: "Spellcraft", def: "P" },
    { key: "stealth", label: "Stealth", def: "A" },
    { key: "survival", label: "Survival", def: "P" },
    { key: "tech-use", label: "Tech-Use", def: "I" },
    { key: "use_magic", label: "Use Magic", def: "P" },
];

// The class traits «X Spellcasting» and «X Arts» of the wiki («i создание персонажа › архетипы ›
// <class> › Трейты»). Rules: _prd/sheet_kinds/spellcasting.md.
// The costs of Power Rating: the table of «iii продвижение › таланты › магия › Power Rating».
const SPELLCASTING: readonly SpellcastingVariant[] = [
    {
        key: "arcane", label: "Arcane", way: "pr", test: "I", base: "2×I.b+2×bPR", gift: "Arcane", prepares: true,
        spellCost: 0.5, prCost: { base: 0, perPR: 250 },
    },
    { key: "divine", label: "Divine", way: "pr", test: "W", base: "W.b+I.b+2×bPR", gift: "Bound", prepares: true, prCost: { base: 0, perPR: 300 } },
    {
        key: "spontaneous", label: "Spontaneous", way: "pr", test: "W", base: "W.b+P.b+2×bPR", gift: "Unbound", prepares: false,
        prCost: { base: 0, perPR: 300 },
    },
    { key: "bard", label: "Bard", way: "arts", base: "F.b", prepares: false, pool: "Bardic Focus", classes: ["Bard", "Бард"] },
    { key: "paladin", label: "Paladin", way: "arts", base: "W.b", prepares: false, pool: "Paladin Focus", classes: ["Paladin", "Паладин"] },
    { key: "ranger", label: "Ranger", way: "arts", base: "P.b", prepares: false, pool: "Ranger Focus", classes: ["Ranger", "Следопыт"] },
];

export const PATHFINDER_CRUSADE_STATS: StatSet = {
    characteristics: [...BASE_CHARACTERISTICS, { key: "Fa", label: "Fate" }],
    skillCharacteristics: ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Fa"],
    skillsLeft: SKILLS_LEFT,
    skillsRight: SKILLS_RIGHT,
    // An Arcane caster cannot push (state/psychic.ts); no class has a Daemonic gift.
    psykanaTypes: ["Arcane", "Bound", "Unbound"],

    // Wiki «v магия › искусства › искусства барда»: what Trade(Bardic) can be.
    skillFamilies: { Bardic: ["Dancer", "Musician", "Orator", "Soothsayer"] },
    spellcasting: SPELLCASTING,
    // The elite archetypes' column of the table.
    prCost: { base: 200, perPR: 300 },
    devotion: false,
    // Wiki «i создание персонажа › склонности».
    aptitudes: [
        { key: "Off", label: "Offence" },
        { key: "Fin", label: "Finesse" },
        { key: "Def", label: "Defence" },
        { key: "Mag", label: "Magic" },
        { key: "Tec", label: "Technology" },
        { key: "Knw", label: "Knowledge" },
        { key: "Soc", label: "Social" },
        { key: "FC", label: "Fieldcraft" },
    ],
};

const keysOf = (way: SpellcastingVariant["way"]) => SPELLCASTING.filter(v => v.way === way).map(v => v.key);

// The wiki's «Природа Дара» is the gift; PR, kick, phenomena and sustaining keep their names.
const PSYKANA_TERMS: PsykanaTerms = {
    psykana: "Magic",
    psykanaType: "Gift",
    power: "spell",
    powers: "spells",
    Power: "Spell",
    Powers: "Spells",
    psychicPower: "Spell",
    psychicPowers: "Spells",
    psyker: "caster",
    psychotest: "Magic test",
};

export function PathfinderCrusade() {
    return (
        <Navigation>
            <PlayerSheetTab />
            <CombatTab points="Fate Points" />
            <TalentsTab />
            <GearTab money={<Coins />} />
            <AdvancementsTab />

            <NavTab id="show-psykana" label={PSYKANA_TERMS.psykana} panelId="psykana" panelClass="psykana">
                <Psykana bar={<><ManaBar /><PreparedRow /></>} ways={<ArtsBar />} spellcasting={<SpellcastingRow />} prCap={<PRCapWarning />} />
            </NavTab>
        </Navigation>
    );
}

export function PathfinderCrusadeStatBlock() {
    return <StatBlock powers={<StatPsykana bar={<StatMana />} ways={<StatArts />} variants={<StatSpellcasting />} />} />;
}

export const pathfinderCrusade: SheetKindDef = {
    schema: withOwnFields(sheetSchemaOf(PATHFINDER_CRUSADE_STATS), {
        // A set of Spellcasting variants, not a list: no order to sync. Arts spells, of
        // half-casters, pay from the Focus of their class (_prd/sheet_kinds/half_casters.md).
        blocks: {
            mana,
            spellcasting: group(Object.fromEntries(SPELLCASTING.map(v => [v.key, checkbox()]))),
            focus: group(Object.fromEntries(keysOf("arts").map(key => [key, mana]))),
            coins,
        },
        psykanaRules: { mana: checkbox({ default: true }), prepared: checkbox({ default: true }) },
        // Prepared for the day by an Arcane or Bound caster (state/prepared.ts). The level of the
        // talent an Arts spell is, its mana cost.
        powerFields: { prepared: checkbox(), level: number() },
        // An Arts spell is tested on a skill, by the characteristic picked or the skill's own ("").
        // A PR spell of a caster of two PR variants casts by the one picked, "" for the first ticked.
        rollFields: {
            skill: openSelect(), characteristic: select(["", ...PATHFINDER_CRUSADE_STATS.skillCharacteristics], ""),
            spellcasting: select(["", ...keysOf("pr")], ""),
        },
    }),
    attachComputeds, Layout: PathfinderCrusade,
    StatBlock: PathfinderCrusadeStatBlock, Controls: ConditionsControl, stats: PATHFINDER_CRUSADE_STATS,
    terms: PSYKANA_TERMS,
    castCost: { rule: MANA_RULE, shortage: manaShortage, pay: payMana, Row: ManaRow },
    preparation: { rule: PREPARED_RULE, Row: PreparedRollRow },
};
