// The room's requests to the bestiary (bestiary/api.ts): what the "Add
// monsters" tab lists, "Save to collection" and "Add variant to bestiary".
import { batch } from "@preact/signals";
import * as api from "../../bestiary/api";
import type { Bestiary, Creature } from "../../bestiary/types.gen";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import { showToast } from "../actions";
import { bestiary, creatureFilter, pickedCreatures, pickerReading, savingSheet, variantOf, type CreatureFilter } from "./state";

/** What the user reads of a refused request; a quota error says how much is taken. */
export function bestiaryFailed(err: unknown): void {
    console.error(err);
    if (err instanceof api.ApiError && err.code === "quota") showToast(`Not enough room: ${err.message}`);
    else showToast(err instanceof Error ? err.message : String(err));
}

export async function loadBestiary(): Promise<void> {
    try {
        bestiary.value = await api.getBestiary();
    } catch (err) {
        bestiaryFailed(err);
    }
}

// The answer to the latest filter only: an earlier one may come later.
let listing = 0;

async function loadCreatures(): Promise<void> {
    const current = ++listing;
    const { collection, q } = creatureFilter.value;
    try {
        const list = await api.listCreatures({ collection, q: q.trim() });
        if (current === listing) pickedCreatures.value = list;
    } catch (err) {
        bestiaryFailed(err);
    }
}

// The first opening picks the user's first collection; the later ones, the collection left.
let pickerOpened = false;
// The latest opening only ends the reading: the tab may be left and opened again meanwhile.
let openings = 0;

/**
 * Reads the bestiary anew, then the creatures of the collection left the
 * last time, or at first of the user's first collection, the default one, or
 * of every collection when they have none. What was read the last time stays
 * until both are read, and they are shown at once: the tab does not go blank
 * nor show the collections without their creatures.
 */
export async function openCreaturePicker(): Promise<void> {
    const current = ++listing;
    const open = ++openings;
    clearTimeout(searchTimer);
    const { collection: left, q } = creatureFilter.peek();
    batch(() => {
        pickerReading.value = true;
        // The text searched is not kept, nor the creatures it found.
        if (q) {
            creatureFilter.value = { collection: left, q: "" };
            pickedCreatures.value = null;
        }
    });
    let data: Bestiary | null = null;
    let list: Creature[] | null = null;
    let collection = left;
    try {
        data = await api.getBestiary();
        // A collection gone meanwhile, deleted or unsubscribed, is left for the first one.
        if (!pickerOpened || (left !== null && !data.collections.some(c => c.id === left))) {
            collection = data.collections.find(c => c.own)?.id ?? null;
        }
        pickerOpened = true;
        // A filter picked meanwhile reads its creatures itself.
        if (current === listing) list = await api.listCreatures({ collection, q: "" });
    } catch (err) {
        bestiaryFailed(err);
    } finally {
        batch(() => {
            if (open === openings) pickerReading.value = false;
            if (data) bestiary.value = data;
            if (list && current === listing) {
                creatureFilter.value = { collection, q: "" };
                pickedCreatures.value = list;
            }
        });
    }
}

/** Makes a blank creature of the kind in the user's collection and lists it; null when refused. */
export async function createCreature(collectionId: number, kind: SheetKind): Promise<Creature | null> {
    let created;
    try {
        created = await api.createCreature(collectionId, kind);
    } catch (err) {
        bestiaryFailed(err);
        return null;
    }
    // A search could hide the new creature from the list.
    clearTimeout(searchTimer);
    creatureFilter.value = { ...creatureFilter.value, q: "" };
    await reloadCreatures();
    return created;
}

/** Reads the collections and the creatures of the filter again. */
export async function reloadCreatures(): Promise<void> {
    await Promise.all([loadBestiary(), loadCreatures()]);
}

const SEARCH_DELAY_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

/** Narrows the creatures; typed text waits a moment before it is asked for. */
export function filterCreatures(change: Partial<CreatureFilter>): void {
    creatureFilter.value = { ...creatureFilter.value, ...change };
    clearTimeout(searchTimer);
    if (change.q === undefined) void loadCreatures();
    else searchTimer = setTimeout(() => void loadCreatures(), SEARCH_DELAY_MS);
}

// — Save to collection —————————————————————

export function openSaveToCollection(sheetId: number, name: string): void {
    savingSheet.value = { sheetId, name };
    bestiary.value = null;
    void loadBestiary();
}

export function closeSaveToCollection(): void {
    savingSheet.value = null;
}

/** Copies the sheet into a collection of the user, or into a new one. */
export async function saveToCollection(target: api.CollectionTarget): Promise<void> {
    const sheet = savingSheet.value;
    if (!sheet) return;
    savingSheet.value = null;
    const name = "newCollection" in target
        ? target.newCollection
        : bestiary.value?.collections.find(c => c.id === target.collectionId)?.name;
    try {
        await api.saveToCollection(sheet.sheetId, target);
        showToast(`"${sheet.name}" saved to ${name}`);
    } catch (err) {
        bestiaryFailed(err);
    }
}

// — Add variant to bestiary ————————————————

/** Asks the name of a variant of NPC `sheetId`, copied from creature `creatureName`. */
export function openAddVariant(sheetId: number, name: string, creatureName: string): void {
    variantOf.value = { sheetId, name, creatureName };
    // The collection the variant goes to is named in the notice.
    bestiary.value = null;
    void loadBestiary();
}

export function closeAddVariant(): void {
    variantOf.value = null;
}

/**
 * Copies the NPC next to its creature as a creature named `name`. The
 * server sends the encounter, where the NPC's source is now the variant.
 */
export async function addVariant(name: string): Promise<void> {
    const npc = variantOf.value;
    if (!npc) return;
    variantOf.value = null;
    try {
        const creature = await api.addVariant(npc.sheetId, name.trim());
        const collection = bestiary.value?.collections.find(c => c.id === creature.collectionId)?.name ?? "the bestiary";
        showToast(`"${creature.name}" added to ${collection}`);
    } catch (err) {
        bestiaryFailed(err);
    }
}
