import type { ComponentType } from "preact";
import type { PsykanaTerms, StatSet } from "../schema/constants";
import type { GroupSpec } from "../schema/spec";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "../blocks/BlockSettings";
import type { SheetOps } from "../state/actions";
import type { ManaPool } from "../state/mana";

/**
 * What a cast costs in a kind that charges for it: the mana of Pathfinder
 * Crusade, a cast by PR its PR from the mana, a Sorcery one its Level from
 * the Focus of its class.
 */
export interface CastCost {
    /** Its rule under the ⚙ of the psykana heading, a flag of settings.psykana. */
    rule: Rule;
    /** Why a cast that costs `cost` from `pool` cannot be paid, as the title of its roll; null when it can or the sheet does not count it. */
    shortage(state: SheetSignals, cost: number, pool?: ManaPool): string | null;
    /** Pays `cost` from `pool` while the sheet counts it. */
    pay(sheet: Pick<SheetOps, "state" | "actions">, cost: number, pool?: ManaPool): void;
    /** What a cast costs of `pool`, a row of its roll. */
    Row: ComponentType<{ cost: number; pool?: ManaPool }>;
}

/** The spells of the day, in a kind whose casters prepare them (blocks/Prepared.tsx); which do is StatSet.spellcasting. */
export interface Preparation {
    /** Its rule under the ⚙ of the psykana heading, a flag of settings.psykana. */
    rule: Rule;
    /** What the roll of the spell at `path` says of its preparation. */
    Row: ComponentType<{ path: string }>;
}

/** What a sheet kind has of its own: its fields, what is computed from them and how they are laid out. */
export interface SheetKindDef {
    schema: GroupSpec;
    /** Places the computed outputs into the state built from `schema`. */
    attachComputeds(state: SheetSignals): void;
    Layout: ComponentType;
    /** The sheet short, in the encounter window of GM mode. */
    StatBlock: ComponentType;
    /** Its buttons under Delete Mode and Toggle Descs. */
    Controls?: ComponentType;
    /** Its characteristics and skills, which lists of them offer. */
    stats: StatSet;
    /** What it calls its psykana and powers. */
    terms: PsykanaTerms;
    castCost?: CastCost;
    preparation?: Preparation;
}
