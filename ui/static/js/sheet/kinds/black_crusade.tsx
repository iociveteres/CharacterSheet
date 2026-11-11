// The Black Crusade sheet: its schema, its computeds, the layout
// (navigation tabs, headings and blocks), its stat block and its buttons in
// the controls.
import { ConditionsControl } from "../conditions/ConditionsControl";
import { Psykana } from "../magic/Powers";
import { TechnoArcana } from "../tech/TechnoArcana";
import { StatBlock, StatPsykana, StatTechnoArcana } from "../statblock/StatBlock";
import { attachComputeds } from "./computed";
import { BLACK_CRUSADE_PSYKANA_TERMS, BLACK_CRUSADE_STATS } from "../schema/constants";
import { sheetSchema } from "../schema/sheet";
import type { SheetKindDef } from "./kind";
import { AdvancementsTab, CombatTab, GearTab, NavTab, Navigation, PlayerSheetTab, TalentsTab } from "./tabs";

export function BlackCrusade() {
    return (
        <Navigation>
            <PlayerSheetTab />
            <CombatTab points="Infamy Points" />
            <TalentsTab />
            <GearTab />
            <AdvancementsTab />

            <NavTab id="show-psykana" label="Psykana" panelId="psykana" panelClass="psykana">
                <Psykana />
            </NavTab>

            <NavTab id="show-techno-arcana" label="Techno Arcana" panelId="techno-arcana" panelClass="techno-arcana">
                <TechnoArcana />
            </NavTab>
        </Navigation>
    );
}

export function BlackCrusadeStatBlock() {
    return <StatBlock powers={<><StatPsykana /><StatTechnoArcana /></>} />;
}

export const blackCrusade: SheetKindDef = {
    schema: sheetSchema, attachComputeds, Layout: BlackCrusade, StatBlock: BlackCrusadeStatBlock, Controls: ConditionsControl,
    stats: BLACK_CRUSADE_STATS, terms: BLACK_CRUSADE_PSYKANA_TERMS,
    // Casts cost no mana, casters prepare no spells, gear items have only the shared fields.
    castCost: null, preparation: null, gearItemParts: null,
};
