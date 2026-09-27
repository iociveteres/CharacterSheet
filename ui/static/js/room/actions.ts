// Local actions of the room: they change the state and send what the server
// has to know. The islands and the Alpine part of the room call them.
import { characterName, chat, confirmMessage, csrfToken, dicePresets, diceSettings, modals, roomId, toasts, type Modals } from "./state";
import type {
    ChatHistoryRequest, ChatMessageRequest, DeleteMessageRequest, DicePresetRequest, NewInviteLinkRequest,
} from "./messages";
import { rememberInput } from "./chat";
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
