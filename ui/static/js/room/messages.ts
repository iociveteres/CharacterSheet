// WebSocket messages of the room. The Go structs in internal/roomws are not
// exported, so tygo does not see them: these types follow them by hand.
import type { RoomPlayer, RoomSheet } from "./payload.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";

export type RoomRole = RoomPlayer["role"];
export type Visibility = RoomSheet["visibility"];

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
    /** What a single d100 test came to; only live messages carry it. */
    versus?: VersusOutcome;
    characterName?: string;
    created: string;
}

/** internal/commands VersusOutcome. */
export interface VersusOutcome {
    roll: number;
    target: number;
    success: boolean;
    /** Successes on a success, fails on a failure. */
    degrees: number;
    crit: boolean;
    /** 11, 22 … 99 and 100 of a plain d100. */
    doubles: boolean;
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

/** A new sheet, created in the room or imported. */
export interface NewCharacterItemMessage {
    type: "newCharacterItem";
    eventID: string;
    userID: number;
    sheetID: number;
    name: string;
    kind: SheetKind;
    updated: string;
    created: string;
}

/** An edit of a sheet field; the room reads the character's name from it. */
export interface SheetChangeMessage {
    type: "change";
    eventID: string;
    sheetID: string;
    path: string;
    change: unknown;
}

export interface FolderCreatedMessage {
    type: "folderCreated";
    eventID: string;
    folderId: number;
    ownerId: number;
    name: string;
    visibility: Visibility;
    sortOrder: number;
    createdAt: string;
}

/** The server hands on these requests as they are, with their eventID. */
export type DeleteCharacterMessage = DeleteCharacterRequest & { eventID: string };
export type ChangeSheetVisibilityMessage = ChangeSheetVisibilityRequest & { eventID: string };
export type UpdateFolderMessage = UpdateFolderRequest & { eventID: string };
export type DeleteFolderMessage = DeleteFolderRequest & { eventID: string };
/** Only to the others: the sender's page has the order already. */
export type ReorderFoldersMessage = ReorderFoldersRequest & { eventID: string };
export type MoveSheetToFolderMessage = MoveSheetToFolderRequest & { eventID: string };

export interface NewPlayerMessage {
    type: "newPlayer";
    eventID: string;
    userID: number;
    name: string;
    joined: string;
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

export interface NewCharacterRequest {
    type: "newCharacter";
    kind: SheetKind;
}

export interface DeleteCharacterRequest {
    type: "deleteCharacter";
    sheetID: string;
}

export interface ChangeSheetVisibilityRequest {
    type: "changeSheetVisibility";
    sheetID: string;
    visibility: Visibility;
}

export interface CreateFolderRequest {
    type: "createFolder";
    name: string;
    visibility: Visibility;
}

/** The server wants 1 to 100 characters in the name. */
export interface UpdateFolderRequest {
    type: "updateFolder";
    folderId: number;
    name: string;
    visibility: Visibility;
}

export interface DeleteFolderRequest {
    type: "deleteFolder";
    folderId: number;
}

/** All of my folders, in their new order. */
export interface ReorderFoldersRequest {
    type: "reorderFolders";
    folderIds: number[];
}

/** folderId null takes the sheet out of its folder. */
export interface MoveSheetToFolderRequest {
    type: "moveSheetToFolder";
    sheetId: number;
    folderId: number | null;
}

export interface KickPlayerRequest {
    type: "kickPlayer";
    userID: number;
}

/** The server sends it on to the others only. */
export interface ChangePlayerRoleRequest {
    type: "changePlayerRole";
    userID: number;
    role: RoomRole;
}

// — Events of the sheet ———————————————————

/** What a roll of a sheet (sheet/rollEvents.ts) carries besides its dice. */
interface SheetRoll {
    /** Answered with sheet:rollResult under it once the chat message is back. */
    requestId: string;
    sheetID: string;
    /** The name the roll is signed with; null for none. */
    characterName: string | null;
    label: string;
}

/** sheet:rollVersus: a d100 test. */
export interface SheetRollVersus extends SheetRoll {
    target: number;
    bonusSuccesses: number;
}

/** sheet:rollExact: a dice expression. */
export interface SheetRollExact extends SheetRoll {
    expression: string;
}
