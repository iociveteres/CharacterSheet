// The user's bestiary as the room uses it: the "From bestiary" window of the
// encounter, "Save to collection" and "Add variant to bestiary". Only
// bestiary/actions.ts writes it.
import { signal } from "@preact/signals";
import type { Bestiary, Creature } from "../../bestiary/types.gen";

/** The collections, quota and tag suggestions, read when a window opens; null on the way. */
export const bestiary = signal<Bestiary | null>(null);

export interface CreatureFilter {
    /** null is every collection. */
    collection: number | null;
    q: string;
    tag: string;
}

export const creatureFilter = signal<CreatureFilter>({ collection: null, q: "", tag: "" });
/** The creatures of the filter; null on the way. */
export const pickedCreatures = signal<Creature[] | null>(null);

/** The sheet "Save to collection" is open for. */
export const savingSheet = signal<{ sheetId: number; name: string } | null>(null);

/** The NPC "Add variant to bestiary" is open for, with the creature it was copied from. */
export const variantOf = signal<{ sheetId: number; name: string; creatureName: string } | null>(null);
