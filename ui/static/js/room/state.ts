// The room's state in signals. Only remote.ts and actions.ts write them; the
// islands (islands.tsx) render them.
// Not signals-core: this import hooks signals into Preact for the islands.
import { computed, signal } from "@preact/signals";
import type { ChatMessage, RoomCommand, RoomPayload, RoomSheetKind } from "./payload.gen";
import type { Viewer } from "./permissions";
import { groupChat } from "./chat";
import { DICE_PRESET_SLOTS, readDiceSettings, type DiceSettings } from "./dice";
import { listCharacters, type Folder, type Player, type Sheet } from "./characters";
import { readPanelVisible } from "./panel";

export interface Modals {
    invite: boolean;
    import: boolean;
    kicked: boolean;
    connectionLost: boolean;
}

export interface Chat {
    /** Oldest first. */
    messages: ChatMessage[];
    /** Whether the server has messages before the first one here. */
    hasMore: boolean;
}

export interface Toast {
    id: number;
    message: string;
}

/** Me first. */
export const players = signal<Player[]>([]);
/** The folders of all players; playerFolders orders them. */
export const folders = signal<Folder[]>([]);
/** The sheets of all players in the order the server sent them; new ones come first. */
export const sheets = signal<Sheet[]>([]);
/** The user of the page: the first player. */
export const me = computed<Viewer>(() => {
    const first = players.value[0];
    return first ? { id: first.id, role: first.role } : { id: 0, role: "player" };
});
export const characterList = computed(() => listCharacters(players.value, folders.value, sheets.value, me.value));

export const inviteLink = signal("");
export const modals = signal<Modals>({ invite: false, import: false, kicked: false, connectionLost: false });
/** The question of the open confirm; null when it is closed. */
export const confirmMessage = signal<string | null>(null);
export const toasts = signal<Toast[]>([]);

export const chat = signal<Chat>({ messages: [], hasMore: false });
export const chatGroups = computed(() => groupChat(chat.value.messages));

export const diceSettings = signal<DiceSettings>({ amount: 1, modifier: 0, rollAgainst: ["", "", "", ""], selected: null });
/** The player's own rolls in the roller, slot 1 first; "" is an empty slot. */
export const dicePresets = signal<string[]>(Array(DICE_PRESET_SLOTS).fill(""));

/** Whether the right panel with the chat, characters and players is shown. */
export const rightPanelVisible = signal(true);

// What the page was rendered with and never changes.
export let roomId = 0;
export let csrfToken = "";
export let commands: RoomCommand[] = [];
export let sheetKinds: RoomSheetKind[] = [];

/** Reads the room the server put into the page as #room-state (templates.RoomPayload). */
export function readRoomPayload(): RoomPayload {
    return JSON.parse(document.getElementById("room-state")!.textContent!) as RoomPayload;
}

export function initRoomState(payload: RoomPayload): void {
    players.value = payload.players.map(({ folders, sheets, ...player }) => player);
    folders.value = payload.players.flatMap(p => p.folders.map(f => ({ ...f, ownerId: p.id })));
    sheets.value = payload.players.flatMap(p => p.sheets.map(s => ({ ...s, ownerId: p.id })));
    inviteLink.value = payload.inviteLink;
    roomId = payload.roomId;
    csrfToken = payload.csrfToken;
    commands = payload.commands;
    sheetKinds = payload.sheetKinds;
    chat.value = { messages: payload.chat.messages, hasMore: payload.chat.hasMore };
    diceSettings.value = readDiceSettings(payload.roomId);
    const presets: string[] = Array(DICE_PRESET_SLOTS).fill("");
    for (const { slot, notation } of payload.dicePresets) {
        if (slot >= 1 && slot <= DICE_PRESET_SLOTS) presets[slot - 1] = notation;
    }
    dicePresets.value = presets;
    rightPanelVisible.value = readPanelVisible();
}
