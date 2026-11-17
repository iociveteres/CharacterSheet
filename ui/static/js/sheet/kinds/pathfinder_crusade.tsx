// The Pathfinder Crusade sheet, a fan mod of Black Crusade: the same sheet
// but for its characteristics (Fate for Infamy and Corruption), its skills,
// Magic for Psykana with the Spellcasting of the class in place of the gift,
// the mana casts spend, the spells prepared for the day and the Arts spells
// of half-casters, the materials of gear items, and no Techno Arcana.
// Rules: _prd/sheet_kinds, _prd/item_materials.
import { t } from "../../i18n";
import { ConditionsControl } from "../conditions/ConditionsControl";
import { MANA_RULE, ManaBar, ManaRow, StatMana } from "../magic/Mana";
import { Psykana } from "../magic/Powers";
import { PREPARED_RULE, PreparedRollRow, PreparedRow } from "../magic/Prepared";
import { ArtsBar, StatArts } from "../magic/Arts";
import { Coins } from "../gear/Coins";
import { Enchantments } from "../gear/Enchantments";
import { BrokenFlag, MaterialRow } from "../gear/Materials";
import { PRCapWarning, SpellcastingRow, StatSpellcasting } from "../magic/Spellcasting";
import { StatBlock, StatPsykana } from "../statblock/StatBlock";
import { attachComputeds } from "./computed";
import {
    BASE_CHARACTERISTICS, SKILLS_RIGHT, type PsykanaTerms, type SkillRow, type SpellcastingVariant, type StatSet,
} from "../schema/constants";
import { checkbox, group, number, openSelect, select } from "../schema/spec";
import { coins, gearMaterialFields, mana, sheetSchemaOf, withOwnFields } from "../schema/sheet";
import { manaShortage, payMana } from "../magic/manaRules";
import type { SheetKindDef } from "./kind";
import { AdvancementsTab, CombatTab, GearTab, NavTab, Navigation, PlayerSheetTab, TalentsTab } from "./tabs";

// A row of the left column is named by its key in skill_bonus entries
// (characteristics/skillNames.ts): a renamed skill has a key of its own.
const SKILLS_LEFT: readonly SkillRow[] = [
    { key: "acrobatics", name: "Acrobatics", label: t("sheet.termsSkills.skill.acrobatics"), def: "A" },
    { key: "athletics", name: "Athletics", label: t("sheet.termsSkills.skill.athletics"), def: "S" },
    { key: "awareness", name: "Awareness", label: t("sheet.termsSkills.skill.awareness"), def: "P" },
    { key: "charm", name: "Charm", label: t("sheet.termsSkills.skill.charm"), def: "F" },
    { key: "command", name: "Command", label: t("sheet.termsSkills.skill.command"), def: "F" },
    { key: "commerce", name: "Commerce", label: t("sheet.termsSkills.skill.commerce"), def: "I" },
    { key: "deceive", name: "Deceive", label: t("sheet.termsSkills.skill.deceive"), def: "F" },
    { key: "dodge", name: "Dodge", label: t("sheet.termsSkills.skill.dodge"), def: "A" },
    { key: "inquiry", name: "Inquiry", label: t("sheet.termsSkills.skill.inquiry"), def: "F" },
    { key: "interrogate", name: "Interrogate", label: t("sheet.termsPf.skill.interrogate"), def: "W" },
    { key: "intimidate", name: "Intimidate", label: t("sheet.termsSkills.skill.intimidate"), def: "W" },
    { key: "logic", name: "Logic", label: t("sheet.termsSkills.skill.logic"), def: "I" },
    { key: "medicae", name: "Medicae", label: t("sheet.termsSkills.skill.medicae"), def: "I" },
    {
        key: "navigation_surface", name: "Surface", label: t("sheet.termsPf.skill.navigationSurface"), def: "I",
        group: "Navigation", groupLabel: t("sheet.termsPf.skillGroup.navigation"),
    },
    {
        key: "navigation_sea", name: "Sea", label: t("sheet.termsPf.skill.navigationSea"), def: "I",
        group: "Navigation", groupLabel: t("sheet.termsPf.skillGroup.navigation"),
    },
    {
        key: "navigation_planes", name: "Planes", label: t("sheet.termsPf.skill.navigationPlanes"), def: "I",
        group: "Navigation", groupLabel: t("sheet.termsPf.skillGroup.navigation"),
    },
    {
        key: "operate_surface", name: "Surface", label: t("sheet.termsSkills.skill.operateSurface"), def: "A",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    {
        key: "operate_aeronautica", name: "Aeronautica", label: t("sheet.termsSkills.skill.operateAeronautica"), def: "A",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    {
        key: "operate_seaship", name: "Seaship", label: t("sheet.termsPf.skill.operateSeaship"), def: "I",
        group: "Operate", groupLabel: t("sheet.termsSkills.skillGroup.operate"),
    },
    { key: "parry", name: "Parry", label: t("sheet.termsSkills.skill.parry"), def: "WS" },
    { key: "scrutiny", name: "Scrutiny", label: t("sheet.termsSkills.skill.scrutiny"), def: "P" },
    { key: "security", name: "Security", label: t("sheet.termsSkills.skill.security"), def: "I" },
    { key: "sleight_of_hand", name: "Sleight of Hand", label: t("sheet.termsSkills.skill.sleightOfHand"), def: "A" },
    { key: "spellcraft", name: "Spellcraft", label: t("sheet.termsPf.skill.spellcraft"), def: "P" },
    { key: "stealth", name: "Stealth", label: t("sheet.termsSkills.skill.stealth"), def: "A" },
    { key: "survival", name: "Survival", label: t("sheet.termsSkills.skill.survival"), def: "P" },
    { key: "tech-use", name: "Tech-Use", label: t("sheet.termsSkills.skill.techUse"), def: "I" },
    { key: "use_magic", name: "Use Magic", label: t("sheet.termsPf.skill.useMagic"), def: "P" },
];

// The class traits «X Spellcasting» and «X Arts» of the wiki («i создание персонажа › архетипы ›
// <class> › Трейты»). Rules: _prd/sheet_kinds/spellcasting.md.
// The costs of Power Rating: the table of «iii продвижение › таланты › магия › Power Rating».
const SPELLCASTING: readonly SpellcastingVariant[] = [
    {
        key: "arcane", label: t("sheet.termsPf.spellcasting.arcane.short"), trait: t("sheet.termsPf.spellcasting.arcane"),
        way: "pr", test: "I", base: "2×I.b+2×bPR", gift: "Arcane", prepares: true, spellCost: 0.5, prCost: { base: 0, perPR: 250 },
    },
    {
        key: "divine", label: t("sheet.termsPf.spellcasting.divine.short"), trait: t("sheet.termsPf.spellcasting.divine"),
        way: "pr", test: "W", base: "W.b+I.b+2×bPR", gift: "Bound", prepares: true, prCost: { base: 0, perPR: 300 },
    },
    {
        key: "spontaneous", label: t("sheet.termsPf.spellcasting.spontaneous.short"), trait: t("sheet.termsPf.spellcasting.spontaneous"),
        way: "pr", test: "W", base: "W.b+P.b+2×bPR", gift: "Unbound", prepares: false, prCost: { base: 0, perPR: 300 },
    },
    {
        key: "bard", label: t("sheet.termsPf.class.bard"), trait: t("sheet.termsPf.spellcasting.bard"),
        way: "arts", base: "F.b", prepares: false, pool: t("sheet.termsPf.focus.bard"), classes: ["Bard", "Бард"],
    },
    {
        key: "paladin", label: t("sheet.termsPf.class.paladin"), trait: t("sheet.termsPf.spellcasting.paladin"),
        way: "arts", base: "W.b", prepares: false, pool: t("sheet.termsPf.focus.paladin"), classes: ["Paladin", "Паладин"],
    },
    {
        key: "ranger", label: t("sheet.termsPf.class.ranger"), trait: t("sheet.termsPf.spellcasting.ranger"),
        way: "arts", base: "P.b", prepares: false, pool: t("sheet.termsPf.focus.ranger"), classes: ["Ranger", "Следопыт"],
    },
];

export const PATHFINDER_CRUSADE_STATS: StatSet = {
    characteristics: [...BASE_CHARACTERISTICS, { key: "Fa", label: t("sheet.termsPf.characteristic.fa") }],
    skillCharacteristics: ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Fa"],
    skillsLeft: SKILLS_LEFT,
    skillsRight: SKILLS_RIGHT,
    // An Arcane caster cannot push (magic/psychic.ts); no class has a Daemonic gift.
    psykanaTypes: [
        { value: "Arcane", label: t("sheet.termsPf.gift.arcane") },
        { value: "Bound", label: t("sheet.termsPowers.psykanaType.bound") },
        { value: "Unbound", label: t("sheet.termsPowers.psykanaType.unbound") },
    ],

    // Wiki «v магия › искусства › искусства барда»: what Trade(Bardic) can be.
    skillFamilies: { Bardic: ["Dancer", "Musician", "Orator", "Soothsayer"] },
    spellcasting: SPELLCASTING,
    // The elite archetypes' column of the table.
    prCost: { base: 200, perPR: 300 },
    devotion: false,
    // Its tables write Reload in half-actions, ½ for one (weapons/reloadRules.ts).
    reloadUnit: 1,
    // Wiki «ii механика › критические эффекты»: cold, positive and negative energy. Its crit table
    // of cold is headed E(Co), the spells and damage rows write E(Cl).
    damageTypes: ["I", "I(Cr)", "R", "X", "X(Fr)", "E", "E(El)", "E(Ls)", "E(Fl)", "E(Cl)", "E(Pos)", "E(Neg)", "C", "C(Tx)"],
    // Wiki «iii продвижение › трейты», Natural Weapons; Natural Weapons entries of melee.json.
    naturalWeapons: [
        { name: "Fists", ru: "Кулаки" },
        { name: "Claws", ru: "Когти" },
        { name: "Scythes", ru: "Косы" },
        { name: "Tentacles", ru: "Щупальца" },
        { name: "Horns", ru: "Рога" },
        { name: "Bite", ru: "Укус" },
        { name: "Hooves", ru: "Копыта" },
    ],
    // Wiki «i создание персонажа › склонности».
    aptitudes: [
        { key: "Off", label: t("sheet.terms.aptitude.off") },
        { key: "Fin", label: t("sheet.terms.aptitude.fin") },
        { key: "Def", label: t("sheet.terms.aptitude.def") },
        { key: "Mag", label: t("sheet.termsPf.aptitude.mag") },
        { key: "Tec", label: t("sheet.termsPf.aptitude.tec") },
        { key: "Knw", label: t("sheet.terms.aptitude.knw") },
        { key: "Soc", label: t("sheet.terms.aptitude.soc") },
        { key: "FC", label: t("sheet.terms.aptitude.fc") },
    ],
};

const keysOf = (way: SpellcastingVariant["way"]) => SPELLCASTING.filter(v => v.way === way).map(v => v.key);

// The wiki's «Природа Дара» is the gift; PR, kick, phenomena and sustaining keep their names.
// The words of the dictionary are lowercase, as in a sentence: a heading takes a capital here.
const SPELL = t("sheet.termsPf.psykana.power");
const SPELLS = t("sheet.termsPf.psykana.powers");
const PSYKANA_TERMS: PsykanaTerms = {
    psykana: t("sheet.termsPf.psykana.psykana"),
    psykanaType: t("sheet.termsPf.psykana.psykanaType"),
    psychicPower: SPELL[0].toUpperCase() + SPELL.slice(1),
    psychicPowers: SPELLS[0].toUpperCase() + SPELLS.slice(1),
    psychotest: t("sheet.termsPf.psykana.psychotest"),
    unknownPower: t("sheet.magicPf.psykana.unknownPower"),
    noPRLeft: t("sheet.magicPf.psykana.noPRLeft"),
    powerTraitsTitle: t("sheet.magicPf.psykana.powerTraitsTitle"),
    phenomenaModTitle: t("sheet.magicPf.psykana.phenomenaModTitle"),
    ignoresSustained: t("sheet.magicPf.psykana.ignoresSustained"),
    sustainedPowers: t("sheet.magicPf.psykana.sustainedPowers"),
    sustainedCountedTitle: t("sheet.magicPf.psykana.sustainedCountedTitle"),
    noCastYet: t("sheet.magicPf.psykana.noCastYet"),
    sustainPenaltyTitle: t("sheet.magicPf.psykana.sustainPenaltyTitle"),
    setUnderGearTitle: t("sheet.magicPf.psykana.setUnderGearTitle"),
    marksSustainedTitle: t("sheet.magicPf.psykana.marksSustainedTitle"),
    sustainedRuleTitle: t("sheet.magicPf.psykana.sustainedRuleTitle"),
    cycleRuleTitle: t("sheet.magicPf.psykana.cycleRuleTitle"),
    phenomenaRuleTitle: t("sheet.magicPf.psykana.phenomenaRuleTitle"),
    headingTitle: t("sheet.magicPf.psykana.headingTitle"),
    countsNotice: t("sheet.magicPf.psykana.countsNotice"),
    typedSustainedNotice: typed => t("sheet.magicPf.psykana.typedSustainedNotice", { typed }),
    currentPRTitle: t("sheet.magicPf.psykana.currentPRTitle"),
};

export function PathfinderCrusade() {
    return (
        <Navigation>
            <PlayerSheetTab />
            <CombatTab points={t("sheet.termsPf.quantity.fatePoints")} />
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
        // Prepared for the day by an Arcane or Bound caster (magic/preparedRules.ts). The level of the
        // talent an Arts spell is, its mana cost.
        powerFields: { prepared: checkbox(), level: number() },
        // An Arts spell is tested on a skill, by the characteristic picked or the skill's own ("").
        // A PR spell of a caster of two PR variants casts by the one picked, "" for the first ticked.
        rollFields: {
            skill: openSelect(), characteristic: select(["", ...PATHFINDER_CRUSADE_STATS.skillCharacteristics], ""),
            spellcasting: select(["", ...keysOf("pr")], ""),
        },
        gearFields: gearMaterialFields,
    }),
    attachComputeds, Layout: PathfinderCrusade,
    StatBlock: PathfinderCrusadeStatBlock, Controls: ConditionsControl, stats: PATHFINDER_CRUSADE_STATS,
    terms: PSYKANA_TERMS,
    castCost: { rule: MANA_RULE, shortage: manaShortage, pay: payMana, Row: ManaRow },
    preparation: { rule: PREPARED_RULE, Row: PreparedRollRow },
    gearItemParts: { Flags: BrokenFlag, Material: MaterialRow, Enchantments },
};
