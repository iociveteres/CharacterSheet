import type { ComponentType } from "preact";
import type { PsykanaTerms, StatSet } from "../schema/constants";
import type { StateKind } from "../core/state";
import type { CastCost, GearItemParts, Preparation } from "../components/kindParts";

/** What a sheet kind has of its own: its fields, what is computed from them and how they are laid out. */
export interface SheetKindDef extends StateKind {
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
    gearItemParts?: GearItemParts;
}
