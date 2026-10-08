// The Pathfinder Crusade sheet, a fan mod of Black Crusade: the same sheet
// but for its characteristics (Fate for Infamy and Corruption), its skills,
// Magic for Psykana and no Techno Arcana. Rules: _prd/sheet_kinds.
import { ConditionsControl } from "../blocks/Characteristics";
import { Psykana } from "../blocks/Powers";
import { StatBlock, StatPsykana } from "../blocks/StatBlock";
import { attachComputeds } from "../state/computed";
import { BASE_CHARACTERISTICS, SKILLS_RIGHT, type PsykanaTerms, type SkillRow, type StatSet } from "../schema/constants";
import { sheetSchemaOf } from "../schema/sheet";
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

export const PATHFINDER_CRUSADE_STATS: StatSet = {
    characteristics: [...BASE_CHARACTERISTICS, { key: "Fa", label: "Fate" }],
    skillCharacteristics: ["WS", "BS", "S", "T", "A", "P", "I", "W", "F", "Fa"],
    skillsLeft: SKILLS_LEFT,
    skillsRight: SKILLS_RIGHT,
    // An Arcane caster cannot push (state/psychic.ts).
    psykanaTypes: ["Arcane", "Bound", "Unbound", "Daemonic"],
};

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
            <CombatTab points="Fame Points" />
            <TalentsTab />
            <GearTab />
            <AdvancementsTab />

            <NavTab id="show-psykana" label={PSYKANA_TERMS.psykana} panelId="psykana" panelClass="psykana">
                <Psykana />
            </NavTab>
        </Navigation>
    );
}

export function PathfinderCrusadeStatBlock() {
    return <StatBlock powers={<StatPsykana />} />;
}

export const pathfinderCrusade: SheetKindDef = {
    schema: sheetSchemaOf(PATHFINDER_CRUSADE_STATS), attachComputeds, Layout: PathfinderCrusade,
    StatBlock: PathfinderCrusadeStatBlock, Controls: ConditionsControl, stats: PATHFINDER_CRUSADE_STATS,
    terms: PSYKANA_TERMS,
};
