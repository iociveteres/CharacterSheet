// The room's requests to the bestiary (bestiary/api.ts): what the "From
// bestiary" window lists, "Save to collection" and "Add variant to bestiary".
import * as api from "../../bestiary/api";
import { showToast } from "../actions";
import { bestiary, creatureFilter, pickedCreatures, savingSheet, variantOf, type CreatureFilter } from "./state";

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
    const { collection, q, tag } = creatureFilter.value;
    try {
        const list = await api.listCreatures({ collection, q: q.trim(), tag });
        if (current === listing) pickedCreatures.value = list;
    } catch (err) {
        bestiaryFailed(err);
    }
}

/** Reads the bestiary and every creature of the user anew, for a window that opens. */
export function openCreaturePicker(): void {
    bestiary.value = null;
    pickedCreatures.value = null;
    creatureFilter.value = { collection: null, q: "", tag: "" };
    void loadBestiary();
    void loadCreatures();
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
