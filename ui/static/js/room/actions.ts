// Local actions of the room: they change the state and send what the server
// has to know. The islands call them.
import {
    characterName, chat, confirmMessage, csrfToken, dicePresets, diceSettings, folders, me, modals, players, roomId, sheets,
    toasts, type Modals,
} from "./state";
import type {
    ChangePlayerRoleRequest, ChangeSheetVisibilityRequest, ChatHistoryRequest, ChatMessageRequest, CreateFolderRequest,
    DeleteCharacterRequest, DeleteFolderRequest, DeleteMessageRequest, DicePresetRequest, KickPlayerRequest,
    MoveSheetToFolderRequest, NewCharacterRequest, NewInviteLinkRequest, ReorderFoldersRequest, RoomRole,
    UpdateFolderRequest, Visibility,
} from "./messages";
import type { SheetKind } from "../sheet/kinds/kinds.gen";
import { rememberInput } from "./chat";
import { playerFolders, reorderedFolders, sheetName } from "./characters";
import { presetRollCommand, saveDiceSettings, standardRollCommand, type DiceSettings } from "./dice";

/** Sends `msg` over the room's socket (socket.js) with a fresh eventID. */
function send(msg: object): void {
    const detail = JSON.stringify({ ...msg, eventID: crypto.randomUUID() });
    document.dispatchEvent(new CustomEvent("room:sendMessage", { detail }));
}

function setModal(name: keyof Modals, open: boolean): void {
    modals.value = { ...modals.value, [name]: open };
}

// — Confirm ———————————————————————————————

let resolveConfirm: ((ok: boolean) => void) | null = null;

/** Asks `message` in the confirm modal; true when the player pressed OK. */
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

// — Modals ————————————————————————————————

export function openInviteModal(): void {
    setModal("invite", true);
}

export function openImportModal(): void {
    setModal("import", true);
}

/** Cancel and Esc: an open confirm is answered no, otherwise invite and import close. */
export function closeModal(): void {
    if (confirmMessage.value !== null) {
        answerConfirm(false);
        return;
    }
    modals.value = { ...modals.value, invite: false, import: false };
}

export function createInviteLink(expiresInDays: number | null, maxUses: number | null): void {
    const request: NewInviteLinkRequest = { type: "newInviteLink", expiresInDays, maxUses };
    send(request);
}

/** Uploads an exported sheet into the room; the server announces it as newCharacterItem. */
export async function importSheet(file: File | undefined): Promise<void> {
    if (!file) {
        await confirm("Please select a file to import");
        return;
    }
    const form = new FormData();
    form.append("csrf_token", csrfToken);
    form.append("room_id", String(roomId));
    form.append("sheet_file", file);
    try {
        const response = await fetch("/sheet/import", { method: "POST", body: form });
        if (response.ok) {
            setModal("import", false);
        } else {
            await confirm("Failed to import character sheet. Please check the file and try again.");
        }
    } catch (err) {
        console.error("Import error:", err);
        await confirm("An error occurred while importing the character sheet.");
    }
}

// — Toasts ————————————————————————————————

const TOAST_MS = 5000;
let lastToastId = 0;

/** A short notice at the top of the page for five seconds. */
export function showToast(message: string): void {
    // The same notice again replaces the shown one, so it stays its full time.
    const id = ++lastToastId;
    toasts.value = [...toasts.value.filter(t => t.message !== message), { id, message }];
    setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
    }, TOAST_MS);
}

// — Chat ——————————————————————————————————

/**
 * Sends a chat message, signed with `character` when given. The input is the
 * chat's own: a roll goes past it and leaves a draft there.
 */
export function sendChat(messageBody: string, character: string | null = null): void {
    const request: ChatMessageRequest = { type: "chatMessage", messageBody, ...(character ? { characterName: character } : {}) };
    send(request);
    rememberInput(roomId, messageBody);
}

/** Gamemasters only; the server answers everyone with deleteMessage. */
export function deleteMessage(messageId: number): void {
    const request: DeleteMessageRequest = { type: "deleteMessage", messageId };
    send(request);
}

export function loadEarlierMessages(): void {
    if (!chat.value.hasMore) return;
    // The server counts the offset from the newest message, and the chat holds
    // every message from the newest one back.
    const request: ChatHistoryRequest = { type: "chatHistory", offset: chat.value.messages.length, limit: 50 };
    send(request);
}

// — Dice ——————————————————————————————————

function setDiceSettings(change: Partial<DiceSettings>): void {
    diceSettings.value = { ...diceSettings.value, ...change };
    saveDiceSettings(roomId, diceSettings.value);
}

export function setDiceAmount(amount: number): void {
    setDiceSettings({ amount });
}

export function setDiceModifier(modifier: number): void {
    setDiceSettings({ modifier });
}

export function setRollAgainst(index: number, value: string): void {
    setDiceSettings({ rollAgainst: diceSettings.value.rollAgainst.map((v, i) => i === index ? value : v) });
}

/** Checks target `index`, or unchecks it when it is the checked one. */
export function toggleRollAgainst(index: number): void {
    setDiceSettings({ selected: diceSettings.value.selected === index ? null : index });
}

const PRESET_DEBOUNCE_MS = 500;
const presetTimers = new Map<number, ReturnType<typeof setTimeout>>();

/** Changes preset `index` at once and tells the server when the player stops typing. */
export function setDicePreset(index: number, notation: string): void {
    dicePresets.value = dicePresets.value.map((v, i) => i === index ? notation : v);
    clearTimeout(presetTimers.get(index));
    presetTimers.set(index, setTimeout(() => {
        presetTimers.delete(index);
        const request: DicePresetRequest = { type: "dicePresetUpdated", slotNumber: index + 1, diceNotation: notation.trim() };
        send(request);
    }, PRESET_DEBOUNCE_MS));
}

export function rollStandardDice(sides: number): void {
    sendChat(standardRollCommand(sides, diceSettings.value));
}

export function rollPreset(index: number): void {
    const command = presetRollCommand(dicePresets.value[index]);
    if (command) sendChat(command);
}

/** A roll the sheet asks for, signed with the open character. */
export function rollFromSheet(command: string): void {
    sendChat(command, characterName.value);
}

// — Characters ————————————————————————————

export function createCharacter(kind: SheetKind): void {
    const request: NewCharacterRequest = { type: "newCharacter", kind };
    send(request);
}

export async function deleteCharacter(sheetId: number): Promise<void> {
    const sheet = sheets.value.find(s => s.id === sheetId);
    if (!sheet || !await confirm(`Delete ${sheetName(sheet)}?`)) return;
    const request: DeleteCharacterRequest = { type: "deleteCharacter", sheetID: String(sheetId) };
    send(request);
}

export function changeSheetVisibility(sheetId: number, visibility: Visibility): void {
    sheets.value = sheets.value.map(s => s.id === sheetId ? { ...s, visibility } : s);
    const request: ChangeSheetVisibilityRequest = { type: "changeSheetVisibility", sheetID: String(sheetId), visibility };
    send(request);
}

export function exportCharacter(sheetId: number): void {
    const sheet = sheets.value.find(s => s.id === sheetId);
    const a = document.createElement("a");
    a.href = `/sheet/export/${sheetId}`;
    a.download = `character_${sheet?.name ?? ""}_${sheetId}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
}

/** Takes the sheet out of its folder with `folderId` null. */
export function moveSheetToFolder(sheetId: number, folderId: number | null): void {
    const sheet = sheets.value.find(s => s.id === sheetId);
    if (!sheet || sheet.folderId === folderId) return;
    // The folder may have gone while the sheet was dragged.
    if (folderId !== null && !folders.value.some(f => f.id === folderId)) return;
    sheets.value = sheets.value.map(s => s.id === sheetId ? { ...s, folderId } : s);
    const request: MoveSheetToFolderRequest = { type: "moveSheetToFolder", sheetId, folderId };
    send(request);
}

// — Folders ———————————————————————————————

export function createFolder(): void {
    const request: CreateFolderRequest = { type: "createFolder", name: "New Folder", visibility: "everyone_can_view" };
    send(request);
}

function sendFolder(folderId: number, name: string, visibility: Visibility): void {
    folders.value = folders.value.map(f => f.id === folderId ? { ...f, name, visibility } : f);
    const request: UpdateFolderRequest = { type: "updateFolder", folderId, name, visibility };
    send(request);
}

const FOLDER_NAME_DEBOUNCE_MS = 500;
const renameTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Renames the folder when the player stops typing. The state takes the name
 * only then: the server sends every rename back, and had the state taken
 * each keystroke, an earlier name coming back would overwrite the input
 * while the player is still typing.
 */
export function renameFolder(folderId: number, name: string): void {
    clearTimeout(renameTimers.get(folderId));
    renameTimers.set(folderId, setTimeout(() => {
        renameTimers.delete(folderId);
        const folder = folders.value.find(f => f.id === folderId);
        if (folder) sendFolder(folderId, name, folder.visibility);
    }, FOLDER_NAME_DEBOUNCE_MS));
}

export function changeFolderVisibility(folderId: number, visibility: Visibility): void {
    const folder = folders.value.find(f => f.id === folderId);
    if (folder) sendFolder(folderId, folder.name, visibility);
}

/** Asks first; the sheets in the folder go out of it. */
export async function deleteFolder(folderId: number): Promise<void> {
    const folder = folders.value.find(f => f.id === folderId);
    if (!folder) return;
    const inside = sheets.value.filter(s => s.folderId === folderId).length;
    let question = `Delete folder "${folder.name}"?`;
    if (inside > 0) question += `\n\n${inside} character sheet(s) will be moved to the default area.`;
    if (!await confirm(question)) return;
    const request: DeleteFolderRequest = { type: "deleteFolder", folderId };
    send(request);
}

/**
 * Puts my folders in the order the player dropped them. Folders created
 * while they dragged, which are not in `dropped`, go last.
 */
export function reorderFolders(dropped: readonly number[]): void {
    const mine = playerFolders(folders.value, me.value.id);
    const ids = dropped.filter(id => mine.some(f => f.id === id));
    for (const f of mine) {
        if (!ids.includes(f.id)) ids.push(f.id);
    }
    if (ids.every((id, i) => mine[i].id === id)) return;
    // The server sends the order to the others only.
    folders.value = reorderedFolders(folders.value, ids);
    const request: ReorderFoldersRequest = { type: "reorderFolders", folderIds: ids };
    send(request);
}

// — Players ———————————————————————————————

export async function kickPlayer(userId: number): Promise<void> {
    const player = players.value.find(p => p.id === userId);
    if (!player || !await confirm(`Kick ${player.name}?`)) return;
    const request: KickPlayerRequest = { type: "kickPlayer", userID: userId };
    send(request);
}

/** Gamemasters only; the server sends the change to the others only. */
export function changePlayerRole(userId: number, role: RoomRole): void {
    players.value = players.value.map(p => p.id === userId ? { ...p, role } : p);
    const request: ChangePlayerRoleRequest = { type: "changePlayerRole", userID: userId, role };
    send(request);
}
