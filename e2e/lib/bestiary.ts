// The bestiary as the scenarios reach it: its HTTP API from a page, and the
// notices of the room and the bestiary page.
import { expect } from "vitest";
import type { Page } from "playwright-core";
import { eventually } from "./wait";

export interface Collection {
    id: number; name: string; owner: string; creatures: number; own: boolean; visibility: "private" | "public"; default: boolean; subscribed: boolean;
}
export interface Creature { id: number; name: string; collectionId: number; sourceLabel: string | null }

/** A request to the bestiary from `page`, with the CSRF token of the room or the bestiary page. */
export function bestiary<T>(page: Page, method: string, url: string, body?: unknown): Promise<T> {
    return page.evaluate(async ([method, url, body]) => {
        const state = document.getElementById("room-state") ?? document.getElementById("bestiary-state");
        const token = (JSON.parse(state!.textContent!) as { csrfToken: string }).csrfToken;
        const headers: Record<string, string> = { "X-CSRF-Token": token, Accept: "application/json" };
        if (body !== undefined) headers["Content-Type"] = "application/json";
        const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
        if (!res.ok) throw new Error(`${method} ${url}: ${res.status}`);
        return res.status === 204 ? null : res.json();
    }, [method, url, body] as const) as Promise<T>;
}

/**
 * Makes creature `name` in collection `collectionId` as the page's user
 * would: sheet `sheetId` exported and uploaded under that name, or a blank
 * sheet. Returns its id.
 */
export async function uploadCreature(page: Page, collectionId: number, name: string, sheetId: number | null = null): Promise<number> {
    await page.evaluate(async ([collectionId, name, sheetId]) => {
        const state = document.getElementById("room-state") ?? document.getElementById("bestiary-state");
        const token = (JSON.parse(state!.textContent!) as { csrfToken: string }).csrfToken;
        const sheet = sheetId === null
            ? { sheetKind: "black_crusade" }
            : await (await fetch(`/sheet/export/${sheetId}`)).json() as { characterInfo?: object };
        const file = { ...sheet, characterInfo: { ...(sheet as { characterInfo?: object }).characterInfo, characterName: name } };
        const form = new FormData();
        form.append("files", new File([JSON.stringify(file)], "creature.json", { type: "application/json" }));
        const res = await fetch(`/bestiary/collections/${collectionId}/upload`, { method: "POST", headers: { "X-CSRF-Token": token }, body: form });
        const [result] = res.ok ? await res.json() as { added: number; message?: string }[] : [];
        if (!result?.added) throw new Error(`upload of ${name}: ${res.status} ${result?.message ?? ""}`);
    }, [collectionId, name, sheetId] as const);
    const creatures = await bestiary<Creature[]>(page, "GET", `/bestiary/creatures?collection=${collectionId}`);
    return Math.max(...creatures.filter(c => c.name === name).map(c => c.id));
}

/** The user's collections and their subscriptions, as the bestiary page lists them. */
export const listCollections = async (page: Page) =>
    (await bestiary<{ collections: Collection[] }>(page, "GET", "/bestiary/collections")).collections;

/** Deletes the user's own collections whose names start with `prefix`: what a failed run left. */
export async function deleteCollections(page: Page, prefix: string): Promise<void> {
    for (const c of await listCollections(page)) {
        if (c.own && c.name.startsWith(prefix)) await bestiary(page, "DELETE", `/bestiary/collections/${c.id}`);
    }
}

/** Waits for a notice of the room or the bestiary page. */
export async function expectToast(page: Page, text: string): Promise<void> {
    await eventually(() => page.locator(".toasts > .toast").allTextContents(), toasts => expect(toasts.map(t => t.trim())).toContain(text));
}
