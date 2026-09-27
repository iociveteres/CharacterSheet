// The room's state in signals. Only remote.ts and actions.ts write them; the
// islands (islands.tsx) render them. Parts of the room still on Alpine keep
// their state in the Alpine store (store.js).
// Not signals-core: this import hooks signals into Preact for the islands.
import { computed, signal } from "@preact/signals";
import type { ChatMessage, RoomCommand, RoomPayload } from "./payload.gen";
import type { RoomRole } from "./messages";
import { groupChat } from "./chat";
import { DICE_PRESET_SLOTS, readDiceSettings, type DiceSettings } from "./dice";

export interface Me {
    id: number;
    role: RoomRole;
}

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

export const me = signal<Me>({ id: 0, role: "player" });
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
/** The name of the open character, which signs rolls; null without a sheet or a name. */
export const characterName = signal<string | null>(null);

// What the page was rendered with and never changes.
export let roomId = 0;
export let csrfToken = "";
export let commands: RoomCommand[] = [];

/** Reads the room the server put into the page as #room-state (templates.RoomPayload). */
export function readRoomPayload(): RoomPayload {
    return JSON.parse(document.getElementById("room-state")!.textContent!) as RoomPayload;
}

export function initRoomState(payload: RoomPayload): void {
    const [first] = payload.players;
    me.value = { id: first.id, role: first.role };
    inviteLink.value = payload.inviteLink;
    roomId = payload.roomId;
    csrfToken = payload.csrfToken;
    commands = payload.commands;
    chat.value = { messages: payload.chat.messages, hasMore: payload.chat.hasMore };
    diceSettings.value = readDiceSettings(payload.roomId);
    const presets: string[] = Array(DICE_PRESET_SLOTS).fill("");
    for (const { slot, notation } of payload.dicePresets) {
        if (slot >= 1 && slot <= DICE_PRESET_SLOTS) presets[slot - 1] = notation;
    }
    dicePresets.value = presets;
}
