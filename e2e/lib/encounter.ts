// GM mode as the gamemaster drives it in the encounter window, and the
// initiative window as everyone sees it (ui/static/js/room/encounter/).
// Scenarios run on the seeded room (`npm run seed`) and delete the encounters
// they create, with their NPCs. The characters are the party of the room, in
// every encounter and after it: a scenario takes out those it added (clearParty).
import { expect } from "vitest";
import type { Locator } from "playwright-core";
import type { Player } from "./player";
import { eventually } from "./wait";
import { bestiary, listCollections, type Creature } from "./bestiary";

export const card = (gm: Player, sheetId: number): Locator => gm.page.locator(`.encounter-card[data-sheet-id="${sheetId}"]`);

export type Side = "party" | "enemies";

export const column = (gm: Player, side: Side): Locator => gm.page.locator(`.participant-column[data-column="${side}"]`);

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

/** The sheet ids of the cards of a column, in the order shown. */
export async function columnSheets(gm: Player, side: Side): Promise<number[]> {
    return column(gm, side).locator(".encounter-card").evaluateAll(els => els.map(el => Number((el as HTMLElement).dataset.sheetId)));
}

export async function addSheets(gm: Player, sheetIds: number[]): Promise<void> {
    await gm.page.locator(".encounter-add-sheets").click();
    for (const id of sheetIds) await gm.page.locator(`.encounter-sheet-list input[data-sheet-id="${id}"]`).check();
    await gm.page.locator(".encounter-add-picked").click();
    for (const id of sheetIds) await card(gm, id).waitFor();
}

/** The name of the NPC newNpc adds, alone of its kind in the encounter; a second one makes it "New creature 1". */
export const BLANK_NPC = "New creature";

/**
 * Adds a blank NPC no creature is the source of, as another user's encounter
 * file brings it, and returns the id of its sheet once its card shows its
 * wounds: a new creature of the gamemaster's default collection is added and
 * deleted.
 */
export async function newNpc(gm: Player): Promise<number> {
    const before = await columnSheets(gm, "enemies");
    const encounterId = await openEncounterId(gm);
    const collection = (await listCollections(gm.page)).find(c => c.own && c.default)!.id;
    const creature = (await bestiary<Creature>(gm.page, "POST", `/bestiary/collections/${collection}/creatures`, { kind: "black_crusade" })).id;
    try {
        await gm.page.evaluate(([encounterId, creatureId]) => document.dispatchEvent(new CustomEvent("room:sendMessage", {
            detail: JSON.stringify({ type: "encounterAddCreature", eventID: crypto.randomUUID(), encounterId, creatureId, count: 1 }),
        })), [encounterId, creature] as const);
        const after = await eventually(() => columnSheets(gm, "enemies"), ids => expect(ids.length, "the new NPC").toBe(before.length + 1));
        const id = after.find(id => !before.includes(id))!;
        await card(gm, id).locator(".encounter-wounds-value").filter({ hasNotText: "…" }).waitFor();
        return id;
    } finally {
        await bestiary(gm.page, "DELETE", `/bestiary/creatures/${creature}`);
    }
}

/** Groups the participants of `sheetIds`, all in column `side`. */
export async function group(gm: Player, side: Side, sheetIds: number[]): Promise<void> {
    await column(gm, side).locator(".encounter-group").click();
    for (const id of sheetIds) await card(gm, id).locator(".encounter-pick").check();
    await column(gm, side).locator(".encounter-group").click();
    await eventually(
        () => card(gm, sheetIds[0]).evaluate(el => el.closest(".encounter-group-frame")?.querySelectorAll(".encounter-card").length ?? 0),
        n => expect(n, "the group").toBe(sheetIds.length));
}

/** Drags the card of `sheetId` by its title to the end of column `side`; waits until the server has moved it. */
export async function dragToColumn(gm: Player, sheetId: number, side: Side): Promise<void> {
    const body = column(gm, side).locator(".encounter-column-body").first();
    const box = (await body.boundingBox())!;
    const sent = (await gm.sent("encounterMove")).length;
    await card(gm, sheetId).locator(".encounter-card-title").dragTo(body, { targetPosition: { x: box.width / 2, y: box.height - 4 } });
    const [move] = (await eventually(() => gm.sent("encounterMove"), all => expect(all.length, "the move").toBe(sent + 1))).slice(sent);
    await gm.waitReceived(m => m.eventID === move.eventID, "the answer to the move");
    await column(gm, side).locator(`.encounter-card[data-sheet-id="${sheetId}"]`).waitFor();
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

/** Shows the open encounter to the players, unless it is shown already (the button toggles). */
export async function showToPlayers(gm: Player): Promise<void> {
    const show = gm.page.locator(".encounter-initiative .encounter-show");
    if (await show.getAttribute("aria-pressed") !== "true") await show.click();
    await gm.waitReceived(m => m.type === "initiativeView", "the shown view");
    await gm.page.locator('.encounter-initiative .encounter-show[aria-pressed="true"]').waitFor();
}

export async function resetInitiative(gm: Player): Promise<void> {
    await gm.page.locator(".encounter-initiative .encounter-reset").click();
}

/**
 * Removes the NPC of `sheetId` with its × and the "Undo" of the Deleted card
 * in its place, or without undoing: then waits until the server has deleted
 * it, 5 s later.
 */
export async function removeNpc(gm: Player, sheetId: number, { undo = false } = {}): Promise<void> {
    const sent = (await gm.sent("encounterRemove")).length;
    await card(gm, sheetId).locator(".encounter-remove").click();
    await card(gm, sheetId).waitFor({ state: "detached" });
    const deleted = gm.page.locator(`.encounter-card-deleted[data-sheet-id="${sheetId}"]`);
    if (undo) {
        await deleted.locator(".encounter-undo").click();
        await card(gm, sheetId).waitFor();
        return;
    }
    const [remove] = (await eventually(() => gm.sent("encounterRemove"), all => expect(all.length, "the removal").toBe(sent + 1), 10_000)).slice(sent);
    await gm.waitReceived(m => m.eventID === remove.eventID, "the answer to the removal");
}

export async function openTab(gm: Player, tab: "combat" | "monsters"): Promise<void> {
    await gm.page.locator(`.encounter-tab[data-tab="${tab}"]`).click();
    await gm.page.locator(`.encounter-tab[data-tab="${tab}"][aria-selected="true"]`).waitFor();
}

/** Adds `count` copies of a creature of collection `collectionId` with the button of its row in "Add monsters", and goes back to the combat. */
export async function addCreature(gm: Player, collectionId: number, creatureId: number, count: number): Promise<void> {
    await openTab(gm, "monsters");
    await gm.page.locator(`.encounter-collection[data-collection-id="${collectionId}"]`).click();
    const add = gm.page.locator(`.encounter-creature[data-creature-id="${creatureId}"] .encounter-add-creature`);
    for (let i = 0; i < count; i++) await add.click();
    await openTab(gm, "combat");
}

/** Takes every character out of the party of the room, from both columns; opens an encounter for that while none is. */
export async function clearParty(gm: Player): Promise<void> {
    const scratch = await openEncounterId(gm) ? 0 : await newEncounter(gm);
    // Only an NPC has the menu.
    const cards = gm.page.locator(".participant-column .encounter-card:not(:has(.encounter-npc-menu-btn))");
    for (let n = await cards.count(); n > 0; n--) {
        await cards.first().locator(".encounter-remove").click();
        await eventually(() => cards.count(), left => expect(left, "the party").toBe(n - 1));
    }
    if (scratch) await deleteEncounter(gm, scratch);
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
    // One read: title and rows read apart could come from renders before and after the view arrives.
    return p.page.locator(".initiative-window").evaluate(w => ({
        title: w.querySelector(".initiative-window-title")?.textContent ?? "",
        rows: [...w.querySelectorAll(".encounter-order-row")].map(r => [
            (r.classList.contains("current") ? "*" : "") + (r.querySelector(".encounter-order-name")?.textContent ?? ""),
            r.lastElementChild?.textContent ?? "",
        ]),
    }));
}
