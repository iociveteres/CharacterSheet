// What the gamemaster does with an encounter, and the order their client
// publishes. The encounter holds the sheets of its participants as instances
// without a view: their initiative, agility and wounds come from them, and
// its edits of them go through their actions like any edit of a sheet.
import { batch, effect } from "@preact/signals";
import { confirm, send, showToast } from "../actions";
import { runOrQueue } from "../dragFreeze";
import { roomId } from "../state";
import { holdOnPage, holdSheet, releaseSheet, replaceSheet, sheets } from "../../sheet/instance";
import { fetchSheet } from "../../sheet/reload";
import type { SheetPayload } from "../../sheet/payload";
import type { SheetKind } from "../../sheet/kinds/kinds.gen";
import type { RoomPayload } from "../payload.gen";
import type { EncounterList, EncounterLoadResult, EncounterState, EncounterVersion, InitiativeView } from "./types.gen";
import type { EncounterPayload, EncounterRequest } from "./messages";
import type { Creature } from "../../bestiary/types.gen";
import { bestiaryFailed, createCreature, openCreaturePicker, reloadCreatures } from "../bestiary/actions";
import { pickedCreatures } from "../bestiary/state";
import { ApiError } from "../../bestiary/api";
import { loadFiles, replaceNpcs } from "./files";
import {
    addSheetsOpen, allSheetsHere, encounter, encounterList, encounterTab, gmMode, grouping, groups, initiativeWindowOpen, notes, participants,
    pendingRemovals, pickedForPreview, popupSheetId, previewed, publishedOrder, selected, sheetOf, shownView, undoableRemovals, type Side,
} from "./state";
import { woundsOf } from "./participants";
import { initiativeExpression, initiativeRollFor } from "../../sheet/state/initiative";

// The eventIDs of the requests sent: a refused one is told as a notice.
const sent = new Set<string>();

function request(msg: EncounterRequest): string {
    const eventID = send(msg);
    sent.add(eventID);
    return eventID;
}

/** Forgets the request of `eventID`; whether it was sent from here. */
export function answered(eventID: string): boolean {
    const removed = removing.get(eventID);
    if (removed !== undefined) {
        removing.delete(eventID);
        pendingRemovals.value = pendingRemovals.value.filter(id => id !== removed);
    }
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
 * are held, read from the server unless they are on the page already, those of
 * the ones gone let go, and what pointed at them closes.
 */
export function applyEncounter(state: EncounterState): void {
    // The server dropped the view (a file replaced the NPCs, the gamemaster left the
    // encounter): the order goes again, even unchanged.
    if (state.initiativeView === null) published = "";
    encounter.value = state;
    const ids = sheetIdsOf(state);
    const participantIds = new Set(state.participants.map(p => p.id));
    if (selected.value !== null && !participantIds.has(selected.value)) selected.value = null;
    if (grouping.value) grouping.value = { ...grouping.value, picked: grouping.value.picked.filter(id => participantIds.has(id)) };
    if (popupSheetId.value !== null && !ids.has(popupSheetId.value)) popupSheetId.value = null;
    releaseAllBut(ids);
    for (const sheetId of ids) {
        if (held.has(sheetId)) continue;
        if (holdOnPage(sheetId)) {
            held.add(sheetId);
            continue;
        }
        fetchSheet(sheetId)
            .then(payload => {
                if (sheetIdsOf(encounter.peek()).has(sheetId)) hold(payload);
            })
            .catch(err => console.error(err));
    }
}

function closeEncounter(): void {
    setEncounterTab("combat");
    encounter.value = null;
    notes.value = "";
    selected.value = null;
    grouping.value = null;
    popupSheetId.value = null;
    releaseAllBut(new Set());
}

// A later pick wins over a response still on its way.
let opening = 0;

/**
 * Encounter `id` with the sheets of its participants not on the page: those
 * that are come from the page (applyEncounter), where the socket keeps them
 * current, and a reconnect reads them again (sheet/reload.ts).
 */
async function readEncounter(id: number): Promise<EncounterPayload> {
    const have = [...sheets.keys()].join(",");
    const res = await fetch(`/encounter/${id}${have ? `?have=${have}` : ""}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`Encounter ${id}: ${res.status}`);
    return await res.json() as EncounterPayload;
}

/** Opens encounter `id` with the sheets of its participants (GET /encounter/:id). */
export async function openEncounter(id: number): Promise<void> {
    const current = ++opening;
    leaveShown(id);
    try {
        const payload = await readEncounter(id);
        if (current !== opening) return;
        for (const sheet of payload.sheets) hold(sheet);
        if (encounter.peek()?.id !== id) {
            selected.value = null;
            grouping.value = null;
        }
        notes.value = payload.notes;
        applyEncounter(payload.encounter);
    } catch (err) {
        console.error(err);
        if (current === opening) showToast("The encounter could not be opened.");
    }
}

/**
 * Reads the open encounter again when a change of the party reached it and
 * its state went to the tab that made the change only: that tab had another
 * encounter open. What came over the socket meanwhile, newer, stays.
 */
export function takeEncountersChanged(versions: EncounterVersion[]): void {
    const open = encounter.peek();
    const reached = open && versions.find(v => v.id === open.id);
    if (!reached || reached.version <= open.version) return;
    const id = open.id;
    readEncounter(id)
        .then(payload => runOrQueue(() => {
            const current = encounter.peek();
            if (current?.id !== id || payload.encounter.version <= current.version) return;
            for (const sheet of payload.sheets) hold(sheet);
            notes.value = payload.notes;
            applyEncounter(payload.encounter);
        }))
        .catch(err => console.error(err));
}

/**
 * Opening another encounter than the shown one takes its order away from the
 * players, until the gamemaster opens it again and their client publishes it.
 */
function leaveShown(id: number): void {
    const shownId = encounterList.peek()?.shownEncounterId ?? null;
    if (shownId === null || shownId === id || !shownView.peek()) return;
    // An order of the shown one on its way would bring it back.
    clearTimeout(publishTimer);
    request({ type: "encounterDropView", encounterId: shownId });
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
    setEncounterTab("combat");
}

/**
 * GM mode and a sheet of the room are not on screen together: a sheet opened
 * from the list takes the place of the window. The encounter stays open.
 */
export function leaveGmMode(): void {
    if (!gmMode.value) return;
    gmMode.value = false;
    saveFlag("gmMode", false);
    setEncounterTab("combat");
}

export function toggleInitiativeWindow(): void {
    initiativeWindowOpen.value = !initiativeWindowOpen.value;
    saveFlag("initiativeWindow", initiativeWindowOpen.value);
}

export function selectParticipant(participantId: number): void {
    closePreview();
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

// — Add monsters ——————————————————————————

/** "Add monsters" reads the user's creatures anew each time it opens; leaving it lets the preview go. */
export function setEncounterTab(tab: "combat" | "monsters"): void {
    if (encounterTab.peek() === tab) return;
    encounterTab.value = tab;
    if (tab === "monsters") void openCreaturePicker();
    else closePreview();
}

// The sheet of the creature previewed, held while it is shown; a later preview wins over a read on its way.
let previewSheet: string | null = null;
let previewing = 0;

/**
 * Shows creature `creature` in the fourth column in place of the participant
 * picked once its sheet is read: until then the column keeps what it shows,
 * not to flash empty in between.
 */
export function previewCreature(creature: Creature): void {
    if (pickedForPreview.peek() === creature.id) return;
    const current = ++previewing;
    pickedForPreview.value = creature.id;
    if (previewed.peek()?.id === creature.id) return;
    fetchSheet(String(creature.id))
        .then(payload => {
            if (current !== previewing) return;
            holdSheet(payload);
            if (previewSheet !== null) releaseSheet(previewSheet);
            previewSheet = payload.sheetId;
            batch(() => {
                previewed.value = creature;
                selected.value = null;
            });
        })
        .catch(err => {
            console.error(err);
            if (current !== previewing) return;
            pickedForPreview.value = previewed.peek()?.id ?? null;
            showToast(`"${creature.name}" could not be read.`);
        });
}

/** Makes a blank creature in the gamemaster's collection and previews it, to fill in on the bestiary page. */
export async function newCreature(collectionId: number, kind: SheetKind): Promise<void> {
    const created = await createCreature(collectionId, kind);
    if (created && encounterTab.peek() === "monsters") previewCreature(created);
}

/**
 * Reads "Add monsters" and its preview again: "Edit in bestiary ↗" changes
 * the creature in another tab, and the room's socket brings no edits of
 * creatures. A creature gone meanwhile leaves the preview.
 */
export async function refreshMonsters(): Promise<void> {
    if (encounterTab.peek() !== "monsters") return;
    const current = previewing;
    const sheetId = previewSheet;
    await reloadCreatures();
    if (current !== previewing || sheetId === null) return;
    const fresh = pickedCreatures.peek()?.find(c => c.id === previewed.peek()?.id);
    if (fresh) previewed.value = fresh;
    try {
        const payload = await fetchSheet(sheetId);
        if (current === previewing) replaceSheet(payload);
    } catch (err) {
        console.error(err);
        if (current === previewing) closePreview();
    }
}

export function closePreview(): void {
    previewing++;
    batch(() => {
        previewed.value = null;
        pickedForPreview.value = null;
    });
    if (previewSheet !== null) releaseSheet(previewSheet);
    previewSheet = null;
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

/**
 * Passes the turn on. The NPCs removed and waiting for Undo go first, so the
 * turn never lands on one the window hides; when the group whose turn it is
 * goes that way, its removal passes the turn itself.
 */
export function nextTurn(): void {
    const state = encounter.value;
    if (!state) return;
    commitRemovals(state.id);
    const gone = new Set(pendingRemovals.value);
    const current = groups.value.find(g => g.id === state.currentGroupId);
    if (current?.members.every(m => gone.has(m.participant.id))) return;
    request({ type: "encounterNext", encounterId: state.id });
}

/**
 * Takes the turn back. The NPCs waiting for Undo go first, as for Next: when
 * the current group goes that way, its removal passes the turn on, and this
 * brings it back to the group before.
 */
export function prevTurn(): void {
    const state = encounter.value;
    if (!state) return;
    commitRemovals(state.id);
    request({ type: "encounterPrev", encounterId: state.id });
}

function commitRemovals(encounterId: number): void {
    for (const [participantId, pending] of removalTimers) {
        if (pending.encounterId === encounterId) commitRemoval(participantId);
    }
}

/**
 * Clears the initiative of every participant, the characters' too, and starts
 * the first round with no turn. The sheets are cleared with their own edits,
 * so the open ones see it at once.
 */
export function resetInitiative(): void {
    const state = encounter.value;
    if (!state) return;
    for (const p of state.participants) {
        const sheet = sheetOf(p.sheetId);
        if (sheet?.canEdit && Number(sheet.state.initiative?.lastInitiative?.peek())) {
            sheet.actions.change("initiative.lastInitiative", 0);
        }
    }
    request({ type: "encounterResetInitiative", encounterId: state.id });
}

const DESCRIBE_MS = 800;
// The notes typed and not sent yet, with the encounter they are of.
let describing: { encounterId: number; text: string } | null = null;
let describeTimer: ReturnType<typeof setTimeout> | undefined;

/** The gamemaster's notes of the open encounter, sent once the typing pauses. */
export function describeEncounter(text: string): void {
    const encounterId = openId();
    if (encounterId === null) return;
    if (describing && describing.encounterId !== encounterId) sendDescription();
    describing = { encounterId, text };
    clearTimeout(describeTimer);
    describeTimer = setTimeout(sendDescription, DESCRIBE_MS);
}

/** Sends the notes typed at once, when there are any: the field lost its focus. */
export function sendDescription(): void {
    clearTimeout(describeTimer);
    if (!describing) return;
    const { encounterId, text } = describing;
    describing = null;
    if (openId() === encounterId) notes.value = text;
    request({ type: "encounterDescribe", encounterId, description: text });
}

/** The notes another tab of the gamemaster typed. */
export function takeNotes(encounterId: number, text: string): void {
    if (openId() === encounterId) notes.value = text;
}

/**
 * Writes an initiative of `total` the gamemaster typed into the sheet whose
 * value the group takes (or who would roll for it); null clears it.
 */
export function setInitiative(groupId: number, total: number | null): void {
    const sheet = groups.value.find(g => g.id === groupId)?.leader?.sheet;
    if (!sheet?.canEdit) return;
    sheet.actions.change("initiative.lastInitiative", total === null ? 0 : initiativeRollFor(sheet.state, total));
}

// The rolls for NPCs on their way.
const rolling = new Set<string>();

/** Rolls for every group of NPCs and every NPC that has not rolled: one chat message under the names the players see. */
export function rollForNpcs(): void {
    const encounterId = openId();
    if (encounterId === null) return;
    // An NPC waiting for Undo is not rolled for: its roll would reach the chat.
    const gone = new Set(pendingRemovals.value);
    const rolls = groups.value
        .filter(g => g.npc && g.value === null && g.leader?.sheet && !gone.has(g.leader.participant.id))
        .map(g => ({ sheetId: g.leader!.participant.sheetId, name: g.playersLabel, expression: initiativeExpression(g.leader!.sheet!.state) }))
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
        if (sheet?.canEdit) sheet.actions.change("initiative.lastInitiative", initiativeRollFor(sheet.state, total));
    }
}

// — Files ———————————————————————————————————

const npcCount = (n: number) => n === 1 ? "1 NPC" : `${n} NPCs`;

function loadLine({ file, name, npcs, error, message }: EncounterLoadResult): string {
    if (error === "quota") return `${file}: not enough room: ${message ?? "over the quota"}`;
    if (error) return `${file}: not an encounter file`;
    return `${file}: "${name}", ${npcCount(npcs)}`;
}

/**
 * Makes a new encounter of each file and says how each went. The open one
 * stays open: the new ones come into the picker with the list the server sends.
 */
export async function loadEncounterFiles(files: File[]): Promise<void> {
    if (!files.length) return;
    try {
        const results = await loadFiles(roomId, files);
        // The server stops at the first file over the quota: the rest were not tried.
        const skipped = files.slice(results.length).map(f => `${f.name}: not uploaded`);
        showToast([...results.map(loadLine), ...skipped].join("\n"));
    } catch (err) {
        bestiaryFailed(err);
    }
}

/** Puts the NPCs of the file in place of those of the open encounter, once the gamemaster agrees; the characters stay. */
export async function replaceNpcsFromFile(file: File): Promise<void> {
    const state = encounter.value;
    if (!state) return;
    const npcs = state.participants.filter(p => p.npc).length;
    if (!await confirm(`Replace the ${npcCount(npcs)} of "${state.name}" with the NPCs of ${file.name}?\n\nCharacters stay.`)) return;
    try {
        const next = await replaceNpcs(state.id, file);
        // The room's socket brings this state too, and may have brought a newer one first.
        const open = encounter.peek();
        if (open?.id === next.id && next.version > open.version) applyEncounter(next);
    } catch (err) {
        if (err instanceof ApiError && err.status === 400) showToast(`${file.name}: not an encounter file`);
        else bestiaryFailed(err);
    }
}

// — Participants ——————————————————————————

/** Sheets of the room into its party, which every encounter of the room has. */
export function addSheets(sheetIds: number[]): void {
    addSheetsOpen.value = false;
    if (sheetIds.length) request({ type: "partyAdd", encounterId: openId(), sheetIds });
}

/** `count` copies of creature `creatureId` of the gamemaster's bestiary, each in a group of its own. */
export function addCreature(creatureId: number, count: number): void {
    const encounterId = openId();
    if (encounterId !== null && count >= 1) request({ type: "encounterAddCreature", encounterId, creatureId, count });
}

export function duplicateNpc(participantId: number, count: number): void {
    const encounterId = openId();
    if (encounterId !== null && count >= 1) request({ type: "encounterDuplicate", encounterId, participantId, count });
}

const REMOVE_MS = 5000;
// The timers of the NPCs removed and not gone yet, and the requests of those
// gone, by eventID: each stays out of the order until the server answers.
const removalTimers = new Map<number, { encounterId: number; timer: ReturnType<typeof setTimeout> }>();
const removing = new Map<string, number>();

/**
 * A character leaves the party at once. An NPC, deleted with its removal,
 * goes after five seconds, its card meanwhile a "Deleted" one with Undo; a
 * tab closed before then keeps it.
 */
export function removeParticipant(participantId: number): void {
    const state = encounter.value;
    const p = participants.value.find(p => p.participant.id === participantId);
    if (!state || !p) return;
    if (!p.participant.npc) {
        request({ type: "encounterRemove", encounterId: state.id, participantIds: [participantId] });
        return;
    }
    if (removalTimers.has(participantId)) return;
    // Sent with the encounter it is of, even when another one is open by then.
    const timer = setTimeout(() => commitRemoval(participantId), REMOVE_MS);
    removalTimers.set(participantId, { encounterId: state.id, timer });
    pendingRemovals.value = [...pendingRemovals.value, participantId];
    undoableRemovals.value = [...undoableRemovals.value, participantId];
    if (selected.value === participantId) selected.value = null;
}

/** Sends the removal of an NPC waiting for Undo; its card is gone, and it stays out of the order until the server answers. */
function commitRemoval(participantId: number): void {
    const pending = removalTimers.get(participantId);
    if (!pending) return;
    clearTimeout(pending.timer);
    removalTimers.delete(participantId);
    undoableRemovals.value = undoableRemovals.value.filter(id => id !== participantId);
    const eventID = request({ type: "encounterRemove", encounterId: pending.encounterId, participantIds: [participantId] });
    removing.set(eventID, participantId);
}

export function undoRemoval(participantId: number): void {
    const pending = removalTimers.get(participantId);
    if (!pending) return;
    clearTimeout(pending.timer);
    removalTimers.delete(participantId);
    pendingRemovals.value = pendingRemovals.value.filter(id => id !== participantId);
    undoableRemovals.value = undoableRemovals.value.filter(id => id !== participantId);
}

export function setDisplayName(participantId: number, name: string): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterSetDisplayName", encounterId, participantId, name });
}

/** Starts picking the participants of a column for a group, or groups the picked ones. */
export function toggleGrouping(side: Side): void {
    const current = grouping.value;
    if (!current || current.side !== side) {
        grouping.value = { side, picked: [] };
        return;
    }
    grouping.value = null;
    const encounterId = openId();
    if (encounterId !== null && current.picked.length >= 2) {
        request({ type: "encounterGroup", encounterId, participantIds: current.picked, name: "" });
    }
}

/** Whether participant `participantId` can join those picked: a group has characters or NPCs, never both. */
export function canPick(participantId: number): boolean {
    const current = grouping.value;
    const all = encounter.value?.participants ?? [];
    const p = all.find(p => p.id === participantId);
    if (!current || p?.side !== current.side) return false;
    const first = all.find(f => f.id === current.picked[0]);
    return !first || first.npc === p.npc;
}

export function togglePicked(participantId: number): void {
    const current = grouping.value;
    if (!current || !canPick(participantId)) return;
    const picked = current.picked.includes(participantId)
        ? current.picked.filter(id => id !== participantId)
        : [...current.picked, participantId];
    grouping.value = { ...current, picked };
}

export function ungroup(groupId: number): void {
    const encounterId = openId();
    if (encounterId !== null) request({ type: "encounterUngroup", encounterId, groupId });
}

/** Puts the participant into the other column; one of a group leaves it. */
export function moveParticipant(participantId: number, side: Side): void {
    const encounterId = openId();
    const p = encounter.value?.participants.find(p => p.id === participantId);
    if (encounterId !== null && p && p.side !== side) request({ type: "encounterMove", encounterId, participantId, side });
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
