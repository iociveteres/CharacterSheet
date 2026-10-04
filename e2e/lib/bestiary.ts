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
