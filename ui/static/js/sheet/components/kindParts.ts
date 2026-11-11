// What a sheet kind plugs into the shared blocks through the sheet context
// (SheetEnv in context.ts). The types live below the topics that implement
// them, so that the context and the kinds name them without importing a topic.
import type { ComponentType } from "preact";
import type { SheetSignals } from "../schema/sheet";
import type { SheetOps } from "../core/actions";

/** A flag of a block's settings under the ⚙ of its heading (rolls/BlockSettings.tsx). */
export interface Rule {
    field: string;
    label: string;
    title: string;
}

/** Whether the line that adds one is open: the item holds it, as its ＋ of an empty row is outside the row (gear/Gear.tsx). */
export interface Adding {
    adding: boolean;
    setAdding: (adding: boolean) => void;
}

/** The pool a spell casts with: PR spells "mana", Arts spells the Focus of their class, "focus.bard". */
export type ManaPool = "mana" | `focus.${string}`;

/**
 * What a cast costs in a kind that charges for it: the mana of Pathfinder
 * Crusade, a cast by PR its PR from the mana, an Arts one its Level from
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

/** The spells of the day, in a kind whose casters prepare them (magic/Prepared.tsx); which do is StatSet.spellcasting. */
export interface Preparation {
    /** Its rule under the ⚙ of the psykana heading, a flag of settings.psykana. */
    rule: Rule;
    /** What the roll of the spell at `path` says of its preparation. */
    Row: ComponentType<{ path: string }>;
}

/** What a gear item of the kind has besides the shared fields: the material and enchantments of Pathfinder Crusade. */
export interface GearItemParts {
    /** In the row of Type, Carried and Equipped of the item at `path`. */
    Flags: ComponentType<{ path: string }>;
    /** Right under that row; `open` shows it on an item that has none by default (its ＋ material). */
    Material: ComponentType<{ path: string; open: boolean; setOpen: (open: boolean) => void }>;
    /** Before the mods of armour or a weapon, else after Material; rendered where the enclosing path is the item's. */
    Enchantments: ComponentType<{ path: string } & Adding>;
}
