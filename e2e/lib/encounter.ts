// GM mode as the gamemaster drives it in the encounter window, and the
// initiative window as everyone sees it (ui/static/js/room/encounter/).
// Scenarios run on the seeded room (`npm run seed`) and delete the encounters
// they create, with their NPCs.
import { expect } from "vitest";
import type { Locator } from "playwright-core";
import type { Player } from "./player";
import { eventually } from "./wait";

export const card = (gm: Player, sheetId: number): Locator => gm.page.locator(`.encounter-card[data-sheet-id="${sheetId}"]`);

const column = (gm: Player, npc: boolean): Locator => gm.page.locator(`.participant-column[data-column="${npc ? "npc" : "players"}"]`);

/** The id of the encounter open in the window; 0 for none. */
export async function openEncounterId(gm: Player): Promise<number> {
    return Number(await gm.page.locator(".encounter-window").getAttribute("data-encounter-id") ?? 0);
}

/** Waits until the server has answered every edit of sheet `sheetId` sent so far: what reads it over HTTP gets it. */
export async function editsStored(p: Player, sheetId: number): Promise<void> {
    const edits = (await p.settledSheetMessages()).filter(m => String(m.sheetID) === String(sheetId));
    for (const e of edits) await p.waitReceived(m => m.type === "response" && m.eventID === e.eventID, `the answer to ${String(e.path)}`);
}

export async function enterGmMode(gm: Player): Promise<void> {
    const button = gm.page.locator(".gm-mode-btn");
    if (!(await button.getAttribute("class"))?.includes("active")) await button.click();
    await gm.page.locator(".encounter-window").waitFor();
}

async function openMenu(gm: Player): Promise<Locator> {
    await gm.page.locator(".encounter-menu-btn").click();
    return gm.page.locator(".initiative-column .encounter-menu");
}

/** Creates an encounter from the window and waits for it to open; returns its id. */
export async function newEncounter(gm: Player): Promise<number> {
    const before = await openEncounterId(gm);
    const create = gm.page.locator(".encounter-create");
    if (await create.count()) await create.click();
    else await (await openMenu(gm)).getByRole("menuitem", { name: "New encounter" }).click();
    return eventually(() => openEncounterId(gm), id => expect(id, "the new encounter is open").not.toBe(before));
}

export async function pickEncounter(gm: Player, id: number): Promise<void> {
    await gm.page.locator(".encounter-picker select").selectOption(String(id));
    await eventually(() => openEncounterId(gm), open => expect(open).toBe(id));
}

/** Deletes an encounter over the socket, without a confirm; waits until the server has. */
export async function deleteEncounter(gm: Player, encounterId: number): Promise<void> {
    await gm.page.evaluate(id => new Promise<void>(resolve => {
        const eventID = crypto.randomUUID();
        const timer = setTimeout(resolve, 5000);
        document.addEventListener("ws:encounterList", e => {
            if ((e as CustomEvent).detail.eventID !== eventID) return;
            clearTimeout(timer);
            resolve();
        });
        document.dispatchEvent(new CustomEvent("room:sendMessage", { detail: JSON.stringify({ type: "encounterDelete", eventID, encounterId: id }) }));
    }), encounterId);
}

/** The sheet ids of the cards of a column. */
async function cardSheets(gm: Player, npc: boolean): Promise<number[]> {
    const ids = await column(gm, npc).locator(".encounter-card").evaluateAll(els => els.map(el => Number((el as HTMLElement).dataset.sheetId)));
    return ids.sort((a, b) => a - b);
}

export async function addSheets(gm: Player, sheetIds: number[]): Promise<void> {
    await gm.page.locator(".encounter-add-sheets").click();
    for (const id of sheetIds) await gm.page.locator(`.encounter-sheet-list input[data-sheet-id="${id}"]`).check();
    await gm.page.locator(".encounter-add-picked").click();
    for (const id of sheetIds) await card(gm, id).waitFor();
}

/** Adds a new NPC and returns the id of its sheet once its card shows its wounds. */
export async function newNpc(gm: Player): Promise<number> {
    const before = await cardSheets(gm, true);
    await gm.page.locator(".encounter-new-npc-btn").click();
    const after = await eventually(() => cardSheets(gm, true), ids => expect(ids.length, "the new NPC").toBe(before.length + 1));
    const id = after.find(id => !before.includes(id))!;
    await card(gm, id).locator(".encounter-wounds-value").filter({ hasNotText: "…" }).waitFor();
    return id;
}

/** Groups the participants of `sheetIds`, all in one column. */
export async function group(gm: Player, npc: boolean, sheetIds: number[]): Promise<void> {
    await column(gm, npc).locator(".encounter-group").click();
    for (const id of sheetIds) await card(gm, id).locator(".encounter-pick").check();
    await column(gm, npc).locator(".encounter-group").click();
    await eventually(
        () => card(gm, sheetIds[0]).evaluate(el => el.closest(".encounter-group-frame")?.querySelectorAll(".encounter-card").length ?? 0),
        n => expect(n, "the group").toBe(sheetIds.length));
}

export async function setDisplayName(gm: Player, sheetId: number, name: string): Promise<void> {
    await card(gm, sheetId).locator(".encounter-npc-menu-btn").click();
    await card(gm, sheetId).locator(".encounter-display-name").fill(name);
    await card(gm, sheetId).locator(".encounter-display-name-save").click();
    await card(gm, sheetId).locator(".encounter-card-shown-as").filter({ hasText: name }).waitFor();
}

export async function renameSheet(gm: Player, sheetId: number, name: string): Promise<void> {
    await openPopup(gm, sheetId);
    const field = gm.page.locator('#popup-sheet [data-id="characterName"]').first();
    await field.fill(name);
    await closePopup(gm);
    await card(gm, sheetId).locator(".encounter-card-title").filter({ hasText: name }).waitFor();
}

export async function showToPlayers(gm: Player): Promise<void> {
    await (await openMenu(gm)).locator(".encounter-show").click();
    await gm.waitReceived(m => m.type === "initiativeView", "the shown view");
}

export async function resetInitiative(gm: Player): Promise<void> {
    await (await openMenu(gm)).getByRole("menuitem", { name: "Reset initiative" }).click();
    await gm.page.locator("#confirm-modal button", { hasText: "OK" }).click();
}

/** Types an initiative into the row of the group of `sheetId`. */
export async function typeInitiative(gm: Player, rowIndex: number, value: number): Promise<void> {
    const row = gm.page.locator(".initiative-column .encounter-order-row").nth(rowIndex);
    await row.locator(".encounter-order-value").click();
    await row.locator(".encounter-order-input").fill(String(value));
    await row.locator(".encounter-order-input").press("Enter");
}

export async function openPopup(gm: Player, sheetId: number): Promise<void> {
    await card(gm, sheetId).locator(".encounter-open-sheet").click();
    await gm.page.locator('#popup-sheet [data-id="characterName"]').first().waitFor();
}

export async function closePopup(gm: Player): Promise<void> {
    await gm.page.locator(".sheet-popup-close").click();
    await gm.page.locator(".sheet-popup").waitFor({ state: "detached" });
}

/** The turn order in the gamemaster's first column: [name, value] rows, the current one marked with "*". */
export async function gmOrder(gm: Player): Promise<string[][]> {
    return gm.page.locator(".initiative-column .encounter-order-row").evaluateAll(rows => rows.map(r => [
        (r.classList.contains("current") ? "*" : "") + (r.querySelector(".encounter-order-name")?.textContent ?? ""),
        r.querySelector(".encounter-order-value")?.textContent ?? "",
    ]));
}

export async function gmRound(gm: Player): Promise<number> {
    return Number(await gm.page.locator(".encounter-round b").textContent());
}

export async function openInitiativeWindow(p: Player): Promise<void> {
    await p.page.locator(".initiative-btn").click();
    await p.page.locator(".initiative-window").waitFor();
}

/** The initiative window: its title and [name, value] rows, the current one marked with "*". */
export async function initiativeWindow(p: Player): Promise<{ title: string; rows: string[][] }> {
    const w = p.page.locator(".initiative-window");
    return {
        title: (await w.locator(".initiative-window-title").textContent()) ?? "",
        rows: await w.locator(".encounter-order-row").evaluateAll(rows => rows.map(r => [
            (r.classList.contains("current") ? "*" : "") + (r.querySelector(".encounter-order-name")?.textContent ?? ""),
            r.lastElementChild?.textContent ?? "",
        ])),
    };
}
