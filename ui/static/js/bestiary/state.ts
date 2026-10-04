// The state of the /bestiary page. Components read it; only actions.ts writes it.
import { computed, signal } from "@preact/signals";
import type { SheetInstance } from "../sheet/instance";
import type { ChatMessage, RoomSheetKind } from "../room/payload.gen";
import type { BestiaryCollection, CatalogRow, Creature, Quota, TagSuggestions } from "./types.gen";
import { sectionOf, type Section } from "./sections";

/** A modal the page shows over itself; each asks for one thing. */
export type Dialog =
    | { type: "newCollection" }
    | { type: "collection"; field: "name" | "description" | "tags"; id: number }
    | { type: "creature"; field: "name" | "tags"; id: number }
    | { type: "copy" | "move"; id: number };

export interface Toast {
    id: number;
    message: string;
}

/**
 * The user's collections, the default one first, then the last changed; then
 * their subscriptions, the last made first; null until they come.
 */
export const collections = signal<BestiaryCollection[] | null>(null);
const inSection = (section: Section) => computed(() => collections.value?.filter(c => sectionOf(c) === section) ?? []);
export const ownCollections = inSection("own");
export const subscribedCollections = inSection("subscribed");
/**
 * Another user's public collection shown in the middle panel without a
 * subscription: opened from the catalog or by its address, it is not in the list.
 */
export const openedCollection = signal<BestiaryCollection | null>(null);
export const quota = signal<Quota | null>(null);
export const tagSuggestions = signal<TagSuggestions>({ collections: [], creatures: [] });

/** What the middle panel shows: the selected collection or the catalog of public ones. */
export const center = signal<"collection" | "catalog">("collection");

export const selectedCollectionId = signal<number | null>(null);
export const selectedCollection = computed(() => {
    const id = selectedCollectionId.value;
    return collections.value?.find(c => c.id === id) ?? (openedCollection.value?.id === id ? openedCollection.value : null);
});

/** The creatures of the selected collection with `query` in their names. */
export const creatures = signal<Creature[]>([]);
export const query = signal("");

export const selectedCreatureId = signal<number | null>(null);
export const selectedCreature = computed(() =>
    creatures.value.find(c => c.id === selectedCreatureId.value) ?? null);
/**
 * The sheet of the selected creature once it is read: the user edits their
 * own creature, and only reads and rolls another user's.
 */
export const creatureSheet = signal<SheetInstance | null>(null);
/** Whether the full sheet of the creature is open over the page. */
export const creatureSheetOpen = signal(false);

/** The search of the catalog and what it found; `more` is whether a next page is there. */
export const catalogQuery = signal("");
export const catalogTag = signal("");
export const catalogSort = signal<"new" | "old">("new");
export const catalogRows = signal<CatalogRow[] | null>(null);
/** The cursor of the catalog's next page; null on the last. */
export const catalogNext = signal<string | null>(null);

/** The last rolls of the page, oldest first: the server sends them to this tab only. */
export const rolls = signal<ChatMessage[]>([]);
export const rollsCollapsed = signal(false);

export const dialog = signal<Dialog | null>(null);
export const confirmMessage = signal<string | null>(null);
export const toasts = signal<Toast[]>([]);

export let sheetKinds: RoomSheetKind[] = [];

export function setSheetKinds(kinds: RoomSheetKind[]): void {
    sheetKinds = kinds;
}

/** The name of a kind the user reads, e.g. "Black Crusade". */
export const kindLabel = (kind: string) => sheetKinds.find(k => k.kind === kind)?.label ?? kind;
