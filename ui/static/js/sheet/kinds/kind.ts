import type { ComponentType } from "preact";
import type { PsykanaTerms, StatSet } from "../schema/constants";
import type { GroupSpec } from "../schema/spec";
import type { SheetSignals } from "../schema/sheet";
import type { Rule } from "../blocks/BlockSettings";
import type { SheetOps } from "../state/actions";

/** What a cast costs in a kind that charges for it: the mana of Pathfinder Crusade. */
export interface CastCost {
    /** Its rule under the ⚙ of the psykana heading, a flag of settings.psykana. */
    rule: Rule;
    /** Why a cast at `pr` cannot be paid, as the title of its roll; null when it can or the sheet does not count it. */
    shortage(state: SheetSignals, pr: number): string | null;
    /** Pays a cast at `pr` while the sheet counts it. */
    pay(sheet: Pick<SheetOps, "state" | "actions">, pr: number): void;
    /** What a cast at `pr` costs, a row of its roll. */
    Row: ComponentType<{ pr: number }>;
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
}
