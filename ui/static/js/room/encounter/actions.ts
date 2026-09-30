// What the gamemaster does with an encounter, and the order their client
// publishes. The encounter holds the sheets of its participants as instances
// without a view: their initiative, agility and wounds come from them, and
// its edits of them go through their actions like any edit of a sheet.
import { effect } from "@preact/signals";
import { confirm, send, showToast } from "../actions";
import { roomId } from "../state";
import { holdSheet, releaseSheet, sheets } from "../../sheet/instance";
import { fetchSheet } from "../../sheet/reload";
import type { SheetPayload } from "../../sheet/payload";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import type { RoomPayload } from "../payload.gen";
import type { EncounterList, EncounterState, InitiativeView } from "./types.gen";
import type { EncounterPayload, EncounterRequest } from "./messages";
import {
    addSheetsOpen, allSheetsHere, encounter, encounterList, gmMode, grouping, groups, initiativeWindowOpen, popupSheetId,
    publishedOrder, selected, sheetOf, shownView,
} from "./state";
import { initiativeExpression, rollFor, woundsOf } from "./participants";

// The eventIDs of the requests sent: a refused one is told as a notice.
const sent = new Set<string>();

function request(msg: EncounterRequest): string {
    const eventID = send(msg);
    sent.add(eventID);
    return eventID;
}

/** Forgets the request of `eventID`; whether it was sent from here. */
export function answered(eventID: string): boolean {
    return sent.delete(eventID);
}

// — Persisted per viewer ——————————————————

function readFlag(key: string): boolean {
    try {
        return localStorage.getItem(`${key}:${roomId}`) === "true";
    } catch {
        return false;
    }
}

function saveFlag(key: string, on: boolean): void {
    try {
        localStorage.setItem(`${key}:${roomId}`, String(on));
    } catch {
        // storage can be unavailable
    }
}

// — The sheets of the participants —————————

/** The sheets the encounter holds, by id. */
const held = new Set<string>();

function hold(payload: SheetPayload): void {
    if (held.has(payload.sheetId)) return;
    held.add(payload.sheetId);
    holdSheet(payload);
}

function releaseAllBut(keep: ReadonlySet<string>): void {
    for (const sheetId of [...held]) {
        if (keep.has(sheetId)) continue;
        held.delete(sheetId);
        releaseSheet(sheetId);
    }
}

const sheetIdsOf = (state: EncounterState | null) => new Set(state?.participants.map(p => String(p.sheetId)) ?? []);

/**
 * Takes the new state of the open encounter: the sheets of new participants
 * are fetched, those of the ones gone let go, and what pointed at them closes.
 */
export function applyEncounter(state: EncounterState): void {
    encounter.value = state;
    const ids = sheetIdsOf(state);
    const participantIds = new Set(state.participants.map(p => p.id));
    if (selected.value !== null && !participantIds.has(selected.value)) selected.value = null;
    if (grouping.value) grouping.value = { ...grouping.value, picked: grouping.value.picked.filter(id => participantIds.has(id)) };
    if (popupSheetId.value !== null && !ids.has(popupSheetId.value)) popupSheetId.value = null;
    releaseAllBut(ids);
    for (const sheetId of ids) {
        if (held.has(sheetId)) continue;
        fetchSheet(sheetId)
            .then(payload => {
                if (sheetIdsOf(encounter.peek()).has(sheetId)) hold(payload);
            })
            .catch(err => console.error(err));
    }
}

function closeEncounter(): void {
    encounter.value = null;
    selected.value = null;
    grouping.value = null;
    popupSheetId.value = null;
    releaseAllBut(new Set());
}

// A later pick wins over a response still on its way.
let opening = 0;

/** Opens encounter `id` with the sheets of its participants (GET /encounter/:id). */
export async function openEncounter(id: number): Promise<void> {
    const current = ++opening;
    try {
        const res = await fetch(`/encounter/${id}`, { headers: { Accept: "application/json" } });
        if (!res.ok) throw new Error(`Encounter ${id}: ${res.status}`);
        const payload = await res.json() as EncounterPayload;
        if (current !== opening) return;
        for (const sheet of payload.sheets) hold(sheet);
        if (encounter.peek()?.id !== id) {
            selected.value = null;
            grouping.value = null;
        }
        applyEncounter(payload.encounter);
    } catch (err) {
        console.error(err);
        if (current === opening) showToast("The encounter could not be opened.");
    }
}

/** When the gamemaster comes in: the encounter shown to the players, else the one changed last. */
function openFirst(list: EncounterList): void {
    const id = list.shownEncounterId ?? list.encounters[0]?.id;
    if (id !== undefined) void openEncounter(id);
}

export function setEncounterList(list: EncounterList): void {
    encounterList.value = list;
    const open = encounter.peek();
    if (open && !list.encounters.some(e => e.id === open.id)) {
        closeEncounter();
        openFirst(list);
    }
}

export function setShownView(view: InitiativeView | null): void {
    shownView.value = view;
}

// — The window ————————————————————————————

export function toggleGmMode(): void {
    gmMode.value = !gmMode.value;
    saveFlag("gmMode", gmMode.value);
}

export function toggleInitiativeWindow(): void {
    initiativeWindowOpen.value = !initiativeWindowOpen.value;
    saveFlag("initiativeWindow", initiativeWindowOpen.value);
}

export function selectParticipant(participantId: number): void {
    selected.value = participantId;
}

export function openPopup(sheetId: number): void {
    popupSheetId.value = String(sheetId);
}

export function closePopup(): void {
    popupSheetId.value = null;
}

export function setAddSheetsOpen(open: boolean): void {
    addSheetsOpen.value = open;
}

// — The encounter —————————————————————————

// Encounters the gamemaster creates, opened once the server has them.
const creating = new Set<string>();

/** Whether the state is of an encounter created from here, to open. */
export function isCreated(eventID: string): boolean {
    return creating.delete(eventID);
}

export function createEncounter(): void {
    const count = encounterList.value?.encounters.length ?? 0;
    creating.add(request({ type: "encounterCreate", name: `Encounter ${count + 1}` }));
}

function openId(): number | null {
    return encounter.value?.id ?? null;
}

export function pickEncounter(id: number): void {
    if (id !== openId()) void openEncounter(id);
}

export function renameEncounter(name: string): void {
    const encounterId = openId();
    if (encounterId === null || !name.trim()) return;
    request({ type: "encounterRename", encounterId, name: name.trim() });
}

export async function deleteEncounter(): Promise<void> {
    const state = encounter.value;
    if (!state || !await confirm(`Delete encounter "${state.name}"?\n\nIts NPCs are deleted with it.`)) return;
    request({ type: "encounterDelete", encounterId: state.id });
}

/**
 * Shows the open encounter to the players, or hides it when it is shown. The
 * list knows which one is: the state of an encounter hidden is not sent again.
 */
export function toggleShown(): void {
    const id = openId();
    if (id === null) return;
    request({ type: "encounterShow", encounterId: encounterList.value?.shownEncounterId === id ? null : id });
}

export function nextTurn(): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterNext", encounterId });
}

/**
 * Clears the initiative of every participant, the characters' too, and starts
 * the first round with no turn. The sheets are cleared with their own edits,
 * so the open ones see it at once.
 */
export async function resetInitiative(): Promise<void> {
    const state = encounter.value;
    if (!state || !await confirm("Reset the initiative of everyone in the encounter?")) return;
    for (const p of state.participants) {
        const sheet = sheetOf(p.sheetId);
        if (sheet?.canEdit && Number(sheet.state.initiative?.lastInitiative?.peek())) {
            sheet.actions.change("initiative.lastInitiative", 0);
        }
    }
    request({ type: "encounterResetInitiative", encounterId: state.id });
}

/**
 * Writes an initiative of `total` the gamemaster typed into the sheet whose
 * value the group takes (or who would roll for it); null clears it.
 */
export function setInitiative(groupId: number, total: number | null): void {
    const sheet = groups.value.find(g => g.id === groupId)?.leader?.sheet;
    if (!sheet?.canEdit) return;
    sheet.actions.change("initiative.lastInitiative", total === null ? 0 : rollFor(sheet, total));
}

// The rolls for NPCs on their way.
const rolling = new Set<string>();

/** Rolls for every group of NPCs and every NPC that has not rolled: one chat message under the names the players see. */
export function rollForNpcs(): void {
    const encounterId = openId();
    if (encounterId === null) return;
    const rolls = groups.value
        .filter(g => g.npc && g.value === null && g.leader?.sheet)
        .map(g => ({ sheetId: g.leader!.participant.sheetId, name: g.playersLabel, expression: initiativeExpression(g.leader!.sheet!) }))
        .filter(r => r.expression);
    if (!rolls.length) {
        showToast("Every NPC has its initiative.");
        return;
    }
    rolling.add(request({ type: "encounterRollInitiative", encounterId, rolls }));
}

/** Keeps the totals of a roll for NPCs in their sheets, as a sheet keeps its own roll. */
export function takeInitiativeTotals(eventID: string, totals: { sheetId: number; total: number }[]): void {
    if (!rolling.delete(eventID)) return;
    for (const { sheetId, total } of totals) {
        const sheet = sheets.get(String(sheetId));
        if (sheet?.canEdit) sheet.actions.change("initiative.lastInitiative", rollFor(sheet, total));
    }
}

// — Participants ——————————————————————————

export function addSheets(sheetIds: number[]): void {
    const encounterId = openId();
    addSheetsOpen.value = false;
    if (encounterId !== null && sheetIds.length) request({ type: "encounterAddSheets", encounterId, sheetIds });
}

export function newNpc(kind: SheetKind): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterNewNpc", encounterId, kind });
}

export function duplicateNpc(participantId: number, count: number): void {
    const encounterId = openId();
    if (encounterId !== null && count >= 1) request({ type: "encounterDuplicate", encounterId, participantId, count });
}

export async function removeParticipant(participantId: number): Promise<void> {
    const state = encounter.value;
    const p = state?.participants.find(p => p.id === participantId);
    if (!state || !p) return;
    const name = sheetOf(p.sheetId)?.state.characterInfo?.characterName?.peek() || p.name;
    if (p.npc && !await confirm(`Remove ${name} from the encounter?\n\nThe NPC is deleted.`)) return;
    request({ type: "encounterRemove", encounterId: state.id, participantIds: [participantId] });
}

export function setDisplayName(participantId: number, name: string): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterSetDisplayName", encounterId, participantId, name });
}

/** Starts picking the participants of a column for a group, or groups the picked ones. */
export function toggleGrouping(npc: boolean): void {
    const current = grouping.value;
    if (!current || current.npc !== npc) {
        grouping.value = { npc, picked: [] };
        return;
    }
    grouping.value = null;
    const encounterId = openId();
    if (encounterId !== null && current.picked.length >= 2) {
        request({ type: "encounterGroup", encounterId, participantIds: current.picked, name: "" });
    }
}

export function togglePicked(participantId: number): void {
    const current = grouping.value;
    if (!current) return;
    const picked = current.picked.includes(participantId)
        ? current.picked.filter(id => id !== participantId)
        : [...current.picked, participantId];
    grouping.value = { ...current, picked };
}

export function ungroup(groupId: number): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterUngroup", encounterId, groupId });
}

/** Wounds healed (+1) or taken (−1), as an edit of the sheet's damage. */
export function changeWounds(participantId: number, heal: number): void {
    const p = encounter.value?.participants.find(p => p.id === participantId);
    const sheet = p && sheetOf(p.sheetId);
    if (!sheet?.canEdit) return;
    sheet.actions.change("armour.woundsCur", Math.max(0, woundsOf(sheet).taken - heal));
}

// — Publishing the order ——————————————————

const PUBLISH_MS = 250;
let published = "";
let publishTimer: ReturnType<typeof setTimeout> | undefined;

/**
 * Sends the order and the players' view of it whenever they differ from what
 * the server has: the values of the sheets, their agility or the groups
 * changed. The server keeps it and shows it to the players.
 */
function publishOrder(): void {
    effect(() => {
        const state = encounter.value;
        if (!state || !allSheetsHere.value) return;
        const { positions, view } = publishedOrder.value;
        const sameOrder = state.groups.every((g, i) => positions[g.id] === i);
        if (sameOrder && JSON.stringify(view) === JSON.stringify(state.initiativeView)) return;
        const key = JSON.stringify([state.id, positions, view]);
        if (key === published) return;
        clearTimeout(publishTimer);
        publishTimer = setTimeout(() => {
            published = key;
            request({ type: "encounterOrder", encounterId: state.id, positions, view });
        }, PUBLISH_MS);
    });
}

/** Sets the encounter up from the room page: the gamemaster opens one, everyone sees the shown order. */
export function initEncounter(payload: RoomPayload): void {
    shownView.value = payload.initiativeView;
    initiativeWindowOpen.value = readFlag("initiativeWindow");
    if (!payload.encounters) return;
    encounterList.value = payload.encounters;
    gmMode.value = readFlag("gmMode");
    openFirst(payload.encounters);
    publishOrder();
}

/** After a reconnect the open encounter is read again: what changed meanwhile never arrived. */
export function reopenEncounter(): void {
    const id = openId();
    if (id !== null) void openEncounter(id);
}
