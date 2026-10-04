// What the /bestiary page does: every request goes from here, and only here
// is its state written.
import { batch } from "@preact/signals";
import * as api from "./api";
import { holdSheet, releaseSheet, sheets } from "../sheet/instance";
import { fetchSheet } from "../sheet/reload";
import type { BestiaryPayload } from "./payload.gen";
import type { CatalogRow, UploadResult } from "./types.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";
import type { ChatMessage } from "../room/payload.gen";
import {
    catalogNext, catalogQuery, catalogRows, catalogSort, catalogTag, center, collections, confirmMessage, creatures,
    creatureSheet, creatureSheetOpen, dialog, openedCollection, query, quota, rolls, rollsCollapsed, selectedCollection,
    selectedCollectionId, selectedCreatureId, setSheetKinds, tagSuggestions, toasts, type Dialog,
} from "./state";

/**
 * Starts the page on collection `initial` of the address: the user's, a
 * subscription, or another user's public one, opened without a subscription.
 */
export async function initBestiary(payload: BestiaryPayload, initial: number | null = null): Promise<void> {
    api.setCsrfToken(payload.csrfToken);
    setSheetKinds(payload.sheetKinds);
    if (initial !== null) {
        try {
            const collection = await api.getCollection(initial);
            if (!collection.own && !collection.subscribed) openedCollection.value = collection;
        } catch (err) {
            // Another user's private collection is a 404, as a gone one is.
            console.error(err);
            showToast("The collection is not shared.");
            initial = null;
        }
    }
    await loadBestiary(initial);
}

function fail(err: unknown): void {
    console.error(err);
    // Another user's collection is gone when its owner makes it private.
    if (err instanceof api.ApiError && err.status === 404 && selectedCollection.value?.own === false) {
        showToast("The collection is no longer shared with you.");
        openedCollection.value = null;
        void loadBestiary();
        return;
    }
    showToast(err instanceof Error ? err.message : String(err));
}

const collectionName = (id: number) => collections.value?.find(c => c.id === id)?.name ?? "";
const creatureName = (id: number) => creatures.value.find(c => c.id === id)?.name ?? "";

// — Collections ———————————————————————————

/** Whether collection `id` can be shown: it is in the list, or opened without a subscription. */
const shown = (id: number | null) => Boolean(collections.value?.some(c => c.id === id)) || openedCollection.value?.id === id;

/**
 * Reads the collections, the quota and the tag suggestions again. Collection
 * `prefer` is selected when it can be shown; when the selected one is gone,
 * the first one.
 */
export async function loadBestiary(prefer: number | null = null): Promise<void> {
    let bestiary;
    try {
        bestiary = await api.getBestiary();
    } catch (err) {
        fail(err);
        return;
    }
    batch(() => {
        collections.value = bestiary.collections;
        quota.value = bestiary.quota;
        tagSuggestions.value = bestiary.tags;
    });
    if (prefer !== null && shown(prefer)) {
        await selectCollection(prefer);
    } else if (!shown(selectedCollectionId.value)) {
        await pickCollection(bestiary.collections[0]?.id ?? null);
    }
}

/** Shows collection `id` in the middle panel. */
export function selectCollection(id: number | null): Promise<void> {
    center.value = "collection";
    return pickCollection(id);
}

function pickCollection(id: number | null): Promise<void> {
    batch(() => {
        // Another user's collection opened without a subscription is kept only while it is shown.
        if (openedCollection.value?.id !== id) openedCollection.value = null;
        selectedCollectionId.value = id;
        query.value = "";
        creatures.value = [];
    });
    // A reload stays on the collection.
    history.replaceState(history.state, "", id === null ? location.pathname : `${location.pathname}?collection=${id}`);
    selectCreature(null);
    return loadCreatures();
}

export async function createCollection(name: string): Promise<void> {
    try {
        const created = await api.createCollection(name);
        closeDialog();
        await loadBestiary();
        await selectCollection(created.id);
    } catch (err) {
        fail(err);
    }
}

export async function editCollection(id: number, edit: api.CollectionEdit): Promise<void> {
    try {
        await api.updateCollection(id, edit);
        closeDialog();
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

export async function deleteCollection(id: number): Promise<void> {
    const collection = collections.value?.find(c => c.id === id);
    if (!collection) return;
    const what = collection.creatures === 1 ? "its creature" : `its ${collection.creatures} creatures`;
    if (!await confirm(`Delete the collection "${collection.name}" and ${what}?`)) return;
    try {
        await api.deleteCollection(id);
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

/** Makes the collection public, after asking, or private again; the default one stays private. */
export async function setVisibility(id: number, visibility: api.Visibility): Promise<void> {
    if (visibility === "public"
        && !await confirm(`Make "${collectionName(id)}" public? Everyone will see it in the catalog and may subscribe to it.`)) return;
    try {
        await api.updateCollection(id, { visibility });
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

/** Puts another user's public collection into "Subscriptions"; the middle panel stays as it is. */
export async function subscribe(id: number): Promise<void> {
    let collection;
    try {
        collection = await api.subscribe(id);
    } catch (err) {
        fail(err);
        return;
    }
    if (openedCollection.value?.id === id) openedCollection.value = collection;
    await loadBestiary();
}

/** Takes the collection out of "Subscriptions"; open in the middle panel, it stays open there. */
export async function unsubscribe(id: number): Promise<void> {
    const collection = selectedCollection.value?.id === id ? selectedCollection.value : null;
    try {
        await api.unsubscribe(id);
    } catch (err) {
        fail(err);
        return;
    }
    if (collection) openedCollection.value = { ...collection, subscribed: false };
    await loadBestiary();
}

// — Catalog ———————————————————————————————

/** Shows the catalog of public collections in the middle panel. */
export function openCatalog(): Promise<void> {
    center.value = "catalog";
    return loadCatalog();
}

// The answer to the latest search only, as with the creatures.
let catalogRequest = 0;

/** Reads the first page of the catalog for the search, or the next page with `more`. */
export async function loadCatalog(more = false): Promise<void> {
    const request = ++catalogRequest;
    const after = more ? catalogNext.value : null;
    let page;
    try {
        page = await api.getCatalog({ q: catalogQuery.value.trim(), tag: catalogTag.value.trim(), sort: catalogSort.value, after });
    } catch (err) {
        fail(err);
        return;
    }
    if (request !== catalogRequest) return;
    batch(() => {
        catalogRows.value = more ? [...catalogRows.value ?? [], ...page.rows] : page.rows;
        catalogNext.value = page.next;
    });
}

let catalogTimer: ReturnType<typeof setTimeout> | undefined;

export function setCatalogSearch(search: { q?: string; tag?: string; sort?: "new" | "old" }): void {
    batch(() => {
        if (search.q !== undefined) catalogQuery.value = search.q;
        if (search.tag !== undefined) catalogTag.value = search.tag;
        if (search.sort !== undefined) catalogSort.value = search.sort;
    });
    clearTimeout(catalogTimer);
    catalogTimer = setTimeout(() => void loadCatalog(), SEARCH_DELAY_MS);
}

/** Opens a collection of the catalog in the middle panel; one not in the list is read without a subscription. */
export async function openFromCatalog(row: CatalogRow): Promise<void> {
    if (!shown(row.id)) {
        try {
            openedCollection.value = await api.getCollection(row.id);
        } catch (err) {
            fail(err);
            return;
        }
    }
    await selectCollection(row.id);
}

function uploadLine({ file, added, error, message }: UploadResult): string {
    if (error === "quota") return `${file}: ${message ?? "over the quota"}`;
    if (error) return `${file}: not a sheet or a collection`;
    return `${file}: ${added === 1 ? "1 creature" : `${added} creatures`}`;
}

/** Uploads exported sheets and collections into the collection and says how each file went. */
export async function uploadFiles(collectionId: number, files: File[]): Promise<void> {
    if (!files.length) return;
    try {
        const results = await api.uploadFiles(collectionId, files);
        // The server stops at the first file over the quota: the rest were not tried.
        const tried = new Set(results.map(r => r.file));
        const skipped = files.filter(f => !tried.has(f.name)).map(f => `${f.name}: not uploaded`);
        showToast([...results.map(uploadLine), ...skipped].join("\n"));
    } catch (err) {
        fail(err);
    }
    await loadBestiary();
    if (selectedCollectionId.value === collectionId) await loadCreatures();
}

// — Creatures —————————————————————————————

// The answer to the latest request only: an earlier one may come later.
let creaturesRequest = 0;

/** Reads the creatures of the selected collection with the query in their names. */
export async function loadCreatures(): Promise<void> {
    const request = ++creaturesRequest;
    const collection = selectedCollectionId.value;
    if (collection === null) {
        creatures.value = [];
        return;
    }
    let list;
    try {
        list = await api.listCreatures({ collection, q: query.value.trim() });
    } catch (err) {
        fail(err);
        return;
    }
    if (request !== creaturesRequest) return;
    creatures.value = list;
    if (!list.some(c => c.id === selectedCreatureId.value)) selectCreature(null);
}

const SEARCH_DELAY_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

export function setQuery(text: string): void {
    query.value = text;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => void loadCreatures(), SEARCH_DELAY_MS);
}

/** Shows the creature's stat block; with `open`, also its full sheet over the page once it is read. */
export function selectCreature(id: number | null, open = false): void {
    if (id === selectedCreatureId.value) {
        if (open) openCreatureSheet();
        return;
    }
    batch(() => {
        selectedCreatureId.value = id;
        creatureSheetOpen.value = false;
    });
    void showCreatureSheet(id, open);
}

// The sheet the page holds for the stat block and the full sheet of the selected creature.
let heldSheetId: string | null = null;

async function showCreatureSheet(id: number | null, open: boolean): Promise<void> {
    if (heldSheetId) releaseSheet(heldSheetId);
    heldSheetId = null;
    creatureSheet.value = null;
    if (id === null) return;
    let payload;
    try {
        payload = await fetchSheet(String(id));
    } catch (err) {
        fail(err);
        return;
    }
    // Another creature was picked meanwhile, or this one shown by a later read.
    if (selectedCreatureId.value !== id || heldSheetId) return;
    // The server lets the owner edit it; the edits go over the page's socket.
    const sheet = holdSheet(payload);
    heldSheetId = payload.sheetId;
    batch(() => {
        creatureSheet.value = sheet;
        if (open) creatureSheetOpen.value = true;
    });
}

/** Opens the full sheet of the selected creature over the page once it is read. */
export function openCreatureSheet(): void {
    if (creatureSheet.value) creatureSheetOpen.value = true;
}

export function closeCreatureSheet(): void {
    creatureSheetOpen.value = false;
}

/** The sheet of the creature was read again (sheet/reload.ts): the views move to the new instance. */
export function creatureSheetReplaced(sheetId: string): void {
    if (sheetId === heldSheetId) creatureSheet.value = sheets.get(sheetId) ?? null;
}

/** The name of the creature changed in its sheet, here or in another tab: the list and the header follow. */
export function creatureNamed(id: number, name: string): void {
    if (!creatures.value.some(c => c.id === id && c.name !== name)) return;
    creatures.value = creatures.value.map(c => c.id === id ? { ...c, name } : c);
}

/** The creatures were deleted in another tab, or with their collection. */
export async function creaturesDeleted(ids: number[]): Promise<void> {
    if (selectedCreatureId.value !== null && ids.includes(selectedCreatureId.value)) selectCreature(null);
    creatures.value = creatures.value.filter(c => !ids.includes(c.id));
    // The counts of the collections, and the collection itself, may be gone.
    await loadBestiary();
}

/**
 * The sheet of the creature could not be read again (sheet/reload.ts): it
 * may be gone. The lists are read again; a creature gone from them is no
 * longer selected.
 */
export async function creatureSheetFailed(sheetId: string, message: string): Promise<void> {
    if (sheetId !== heldSheetId) return;
    showToast(`The creature could not be read: ${message}`);
    await Promise.all([loadBestiary(), loadCreatures()]);
}

/** Makes a blank creature of the kind in the user's collection, selects it and opens its sheet to fill in. */
export async function newCreature(collectionId: number, kind: SheetKind): Promise<void> {
    let created;
    try {
        created = await api.createCreature(collectionId, kind);
    } catch (err) {
        fail(err);
        return;
    }
    // A search could hide the new creature from the list.
    query.value = "";
    await Promise.all([loadBestiary(), loadCreatures()]);
    if (selectedCollectionId.value === collectionId) selectCreature(created.id, true);
}

export async function editCreature(id: number, edit: api.CreatureEdit): Promise<void> {
    try {
        await api.updateCreature(id, edit);
        closeDialog();
        // The sheet learns its new name over the socket, as the user's other tabs do.
        await Promise.all([loadBestiary(), loadCreatures()]);
    } catch (err) {
        fail(err);
    }
}

/** Copies the creature into a collection of the user, or into a new one. */
export async function copyCreature(id: number, target: api.CollectionTarget): Promise<void> {
    const to = "newCollection" in target ? target.newCollection : collectionName(target.collectionId);
    try {
        await api.copyCreature(id, target);
        closeDialog();
        showToast(`"${creatureName(id)}" copied to ${to}`);
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

export async function moveCreature(id: number, collectionId: number): Promise<void> {
    try {
        await api.moveCreature(id, collectionId);
        closeDialog();
        showToast(`"${creatureName(id)}" moved to ${collectionName(collectionId)}`);
        if (selectedCreatureId.value === id) selectCreature(null);
        creatures.value = creatures.value.filter(c => c.id !== id);
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

export async function deleteCreature(id: number): Promise<void> {
    if (!await confirm(`Delete "${creatureName(id)}"?`)) return;
    try {
        await api.deleteCreature(id);
        if (selectedCreatureId.value === id) selectCreature(null);
        creatures.value = creatures.value.filter(c => c.id !== id);
        await loadBestiary();
    } catch (err) {
        fail(err);
    }
}

// — Dialogs ———————————————————————————————

export function openDialog(d: Dialog): void {
    dialog.value = d;
}

export function closeDialog(): void {
    dialog.value = null;
}

let resolveConfirm: ((ok: boolean) => void) | null = null;

/** Asks `message` in the confirm modal; true when the user pressed OK. */
export function confirm(message: string): Promise<boolean> {
    // A question nobody answered is a no.
    resolveConfirm?.(false);
    confirmMessage.value = message;
    return new Promise(resolve => {
        resolveConfirm = resolve;
    });
}

export function answerConfirm(ok: boolean): void {
    const resolve = resolveConfirm;
    resolveConfirm = null;
    confirmMessage.value = null;
    resolve?.(ok);
}

// — Rolls ——————————————————————————————————

const MAX_ROLLS = 20;

/** Puts a roll the server answered at the end of the feed, which keeps the last 20. */
export function addRoll(roll: ChatMessage): void {
    batch(() => {
        rolls.value = [...rolls.value, roll].slice(-MAX_ROLLS);
        // A new roll shows itself.
        rollsCollapsed.value = false;
    });
}

export function toggleRolls(): void {
    rollsCollapsed.value = !rollsCollapsed.value;
}

// — Toasts ————————————————————————————————

const TOAST_MS = 6000;
let lastToastId = 0;

/** A short notice at the top of the page for a few seconds. */
export function showToast(message: string): void {
    const id = ++lastToastId;
    toasts.value = [...toasts.value.filter(t => t.message !== message), { id, message }];
    setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
    }, TOAST_MS);
}
