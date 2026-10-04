// The bestiary's HTTP API (internal/webapp/bestiary.go): the /bestiary page
// and the room's "From bestiary" window send the same requests.
import type { Bestiary, BestiaryCollection, CatalogPage, Creature, UploadResult } from "./types.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";

let csrfToken = "";

/** The page's CSRF token, which every request sends in X-CSRF-Token (noSurf checks the changes). */
export function setCsrfToken(token: string): void {
    csrfToken = token;
}

/** A request the server did not take. A quota error carries the server's text and the code "quota". */
export class ApiError extends Error {
    constructor(readonly status: number, readonly code: string, message: string) {
        super(message);
    }
}

const STATUS_TEXT: Record<number, string> = {
    400: "The server did not take the request.",
    403: "That is not yours.",
    404: "It is gone: reload the page.",
};

async function apiError(res: Response): Promise<ApiError> {
    // Only a quota error has a body of its own; the rest are plain status text.
    if (res.headers.get("Content-Type")?.startsWith("application/json")) {
        const body = await res.json() as { code: string; message: string };
        return new ApiError(res.status, body.code, body.message);
    }
    return new ApiError(res.status, "", STATUS_TEXT[res.status] ?? `The request failed: ${res.status}.`);
}

/** A request to the server with the page's CSRF token; a FormData body goes as it is, any other as JSON. */
export async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: "application/json", "X-CSRF-Token": csrfToken };
    const init: RequestInit = { method, headers };
    if (body instanceof FormData) {
        init.body = body;
    } else if (body !== undefined) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
    }
    const res = await fetch(url, init);
    if (!res.ok) throw await apiError(res);
    return res.status === 204 ? undefined as T : await res.json() as T;
}

export type Visibility = BestiaryCollection["visibility"];

export interface CollectionEdit {
    name?: string;
    description?: string;
    tags?: string[];
    visibility?: Visibility;
}

export interface CreatureEdit {
    name?: string;
    tags?: string[];
}

export interface CatalogFilter {
    q: string;
    tag: string;
    sort: "new" | "old";
    /** The cursor of the page after the one before; null for the first page. */
    after: string | null;
}

/** Where a copy goes: a collection of the user, or a new one the server makes with the copy. */
export type CollectionTarget = { collectionId: number } | { newCollection: string };

export interface CreatureFilter {
    collection?: number | null;
    q?: string;
    tag?: string;
}

/** The collections, the quota and the tag suggestions. */
export const getBestiary = () => request<Bestiary>("GET", "/bestiary/collections");

export const createCollection = (name: string) =>
    request<BestiaryCollection>("POST", "/bestiary/collections", { name });

export const updateCollection = (id: number, edit: CollectionEdit) =>
    request<BestiaryCollection>("PATCH", `/bestiary/collections/${id}`, edit);

export const deleteCollection = (id: number) => request<void>("DELETE", `/bestiary/collections/${id}`);

export const collectionExportUrl = (id: number) => `/bestiary/collections/${id}/export`;

/** Another user's public collection, or one of the user's. */
export const getCollection = (id: number) => request<BestiaryCollection>("GET", `/bestiary/collections/${id}`);

/** Puts another user's public collection into the user's list; it comes back with `subscribed`. */
export const subscribe = (id: number) => request<BestiaryCollection>("PUT", `/bestiary/subscriptions/${id}`);

export const unsubscribe = (id: number) => request<void>("DELETE", `/bestiary/subscriptions/${id}`);

/** A blank creature of the kind in the user's collection. */
export const createCreature = (collectionId: number, kind: SheetKind) =>
    request<Creature>("POST", `/bestiary/collections/${collectionId}/creatures`, { kind });

export function getCatalog({ q, tag, sort, after }: CatalogFilter): Promise<CatalogPage> {
    const params = new URLSearchParams({ sort });
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    if (after) params.set("after", after);
    return request<CatalogPage>("GET", `/bestiary/catalog?${params}`);
}

/** Adds the creatures of exported sheets and collections; the server stops at the first file over the quota. */
export function uploadFiles(collectionId: number, files: File[]): Promise<UploadResult[]> {
    const form = new FormData();
    for (const file of files) form.append("files", file);
    return request<UploadResult[]>("POST", `/bestiary/collections/${collectionId}/upload`, form);
}

export function listCreatures({ collection, q, tag }: CreatureFilter): Promise<Creature[]> {
    const params = new URLSearchParams();
    if (collection) params.set("collection", String(collection));
    if (q) params.set("q", q);
    if (tag) params.set("tag", tag);
    const query = params.toString();
    return request<Creature[]>("GET", `/bestiary/creatures${query ? `?${query}` : ""}`);
}

export const updateCreature = (id: number, edit: CreatureEdit) =>
    request<Creature>("PATCH", `/bestiary/creatures/${id}`, edit);

export const deleteCreature = (id: number) => request<void>("DELETE", `/bestiary/creatures/${id}`);

export const copyCreature = (id: number, target: CollectionTarget) =>
    request<Creature>("POST", `/bestiary/creatures/${id}/copy`, target);

export const moveCreature = (id: number, collectionId: number) =>
    request<Creature>("POST", `/bestiary/creatures/${id}/move`, { collectionId });

export const creatureExportUrl = (id: number) => `/sheet/export/${id}`;

/** Copies a sheet of a room or an NPC into the user's collection. */
export const saveToCollection = (sheetId: number, target: CollectionTarget) =>
    request<Creature>("POST", "/bestiary/save", { sheetId, ...target });

/** Copies an NPC next to its creature as a new one, which becomes the NPC's source; an empty name is the NPC's. */
export const addVariant = (sheetId: number, name: string) =>
    request<Creature>("POST", "/bestiary/add-variant", { sheetId, name });
