// WebSocket messages of the room. The Go structs in internal/roomws are not
// exported, so tygo does not see them: these types follow them by hand.
import type { RoomPlayer } from "./payload.gen";

export type RoomRole = RoomPlayer["role"];

// — From the server ———————————————————————

/** The kicked player is disconnected two seconds later. */
export interface KickPlayerMessage {
    type: "kickPlayer";
    eventID: string;
    userID: number;
}

export interface ChangePlayerRoleMessage {
    type: "changePlayerRole";
    eventID: string;
    userID: number;
    role: RoomRole;
}

/** Only the player who asked for the link gets it. */
export interface InviteLinkMessage {
    type: "newInviteLink";
    eventID: string;
    link: string;
    created: string;
    expiresAt: string | null;
    MaxUses: number | null;
}

/** A chat message, to everyone in the room, the sender too. */
export interface ChatMessageMessage {
    type: "chatMessage";
    eventID: string;
    messageId: number;
    userId: number;
    userName: string;
    messageBody: string;
    commandResult?: string;
    characterName?: string;
    created: string;
}

/** The server hands on the gamemaster's request as it is. */
export interface DeleteMessageMessage {
    type: "deleteMessage";
    eventID: string;
    messageId: number;
}

/** A page of earlier messages, only to the player who asked, oldest first. */
export interface ChatHistoryMessage {
    type: "chatHistory";
    eventID: string;
    messagePage: {
        messages: { message: StoredChatMessage; username: string }[] | null;
        hasMore: boolean;
    };
}

/** models.Message. */
export interface StoredChatMessage {
    id: number;
    roomId: number;
    userId: number;
    messageBody: string;
    characterName?: string;
    commandResult?: string;
    createdAt: string;
}

/** A preset changed in another tab of the same player. */
export interface DicePresetUpdatedMessage {
    type: "dicePresetUpdated";
    slotNumber: number;
    diceNotation: string;
}

// — To the server —————————————————————————

export interface ChatMessageRequest {
    type: "chatMessage";
    messageBody: string;
    characterName?: string;
}

/** `offset` counts from the newest message. */
export interface ChatHistoryRequest {
    type: "chatHistory";
    offset: number;
    limit: number;
}

export interface DeleteMessageRequest {
    type: "deleteMessage";
    messageId: number;
}

/** Slots are 1 to 5; an empty notation clears the slot. */
export interface DicePresetRequest {
    type: "dicePresetUpdated";
    slotNumber: number;
    diceNotation: string;
}

/** null means no limit; the server takes maxUses 0 as no limit too. */
export interface NewInviteLinkRequest {
    type: "newInviteLink";
    expiresInDays: number | null;
    maxUses: number | null;
}
