// The room's state in signals. Only remote.ts and actions.ts write them; the
// islands (islands.tsx) render them. Parts of the room still on Alpine keep
// their state in the Alpine store (store.js).
// Not signals-core: this import hooks signals into Preact for the islands.
import { signal } from "@preact/signals";
import type { RoomPayload } from "./payload.gen";
import type { RoomRole } from "./messages";

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

// What the page was rendered with and never changes.
export let roomId = 0;
export let csrfToken = "";

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
}
