import type { ComponentType } from "preact";
import type { StatSet } from "../schema/constants";
import type { GroupSpec } from "../schema/spec";
import type { SheetSignals } from "../schema/sheet";

/** What a sheet kind has of its own: its fields, what is computed from them and how they are laid out. */
export interface SheetKindDef {
    schema: GroupSpec;
    /** Places the computed outputs into the state built from `schema`. */
    attachComputeds(state: SheetSignals): void;
    Layout: ComponentType;
    /** Its buttons under Delete Mode and Toggle Descs. */
    Controls?: ComponentType;
    /** Its characteristics and skills, which lists of them offer. */
    stats: StatSet;
}
