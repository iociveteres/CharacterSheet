// What comes to the room from outside: the server's messages (ws:<type>, see
// socket.js) and the sheet's events. The handlers only change the state; a
// roll the sheet asks for goes on to the chat. Changes to the character list
// wait while the player drags in it (dragFreeze.ts).
import { chat, dicePresets, folders, inviteLink, me, modals, players, sheets } from "./state";
import { isStaleFolderEcho, rollFromSheet, showToast } from "./actions";
import { isElevated } from "./permissions";
import { DICE_PRESET_SLOTS, rollExactCommand, rollVersusCommand } from "./dice";
import { reorderedFolders, type Sheet } from "./characters";
import { runOrQueue } from "./dragFreeze";
import { displayNameOf } from "./encounter/state";
import type {
    ChangePlayerRoleMessage, ChangeSheetVisibilityMessage, ChatHistoryMessage, ChatMessageMessage, DeleteCharacterMessage,
    DeleteFolderMessage, DeleteMessageMessage, DicePresetUpdatedMessage, FolderCreatedMessage, InviteLinkMessage,
    KickPlayerMessage, MoveSheetToFolderMessage, NewCharacterItemMessage, NewPlayerMessage, ReorderFoldersMessage,
    SheetChangeMessage, SheetRollExact, SheetRollVersus, UpdateFolderMessage,
} from "./messages";
import type { ChatMessage } from "./payload.gen";

// The rolls of the sheets waiting for their message: its eventID → the sheet's requestId.
const sheetRolls = new Map<string, string>();

/** Answers the roll of `eventID` with nothing: its message will not come back. */
function dropSheetRoll(eventID: string): void {
    const requestId = sheetRolls.get(eventID);
    if (requestId === undefined) return;
    sheetRolls.delete(eventID);
    document.dispatchEvent(new CustomEvent("sheet:rollResult", { detail: { requestId, outcome: null, commandResult: null } }));
}

function renameSheet(sheetId: number, name: string): void {
    runOrQueue(() => {
        sheets.value = sheets.value.map(s => s.id === sheetId ? { ...s, name } : s);
    });
}

export function listenRemote(): void {
    document.addEventListener("ws:newPlayer", e => {
        const msg = (e as CustomEvent<NewPlayerMessage>).detail;
        runOrQueue(() => {
            if (players.value.some(p => p.id === msg.userID)) return;
            // Everyone joins as a player; the message has no role.
            players.value = [...players.value, { id: msg.userID, name: msg.name, role: "player", joinedAt: msg.joined }];
        });
    });
    document.addEventListener("ws:kickPlayer", e => {
        const msg = (e as CustomEvent<KickPlayerMessage>).detail;
        if (msg.userID === me.value.id) {
            modals.value = { ...modals.value, kicked: true };
            return;
        }
        runOrQueue(() => {
            players.value = players.value.filter(p => p.id !== msg.userID);
            folders.value = folders.value.filter(f => f.ownerId !== msg.userID);
            sheets.value = sheets.value.filter(s => s.ownerId !== msg.userID);
        });
    });
    document.addEventListener("ws:changePlayerRole", e => {
        const msg = (e as CustomEvent<ChangePlayerRoleMessage>).detail;
        runOrQueue(() => {
            players.value = players.value.map(p => p.id === msg.userID ? { ...p, role: msg.role } : p);
            // Modals.tsx hides the invite from a player; closed, it no longer holds the overlay open.
            if (msg.userID === me.value.id && !isElevated(msg.role)) modals.value = { ...modals.value, invite: false };
        });
    });
    document.addEventListener("ws:newInviteLink", e => {
        inviteLink.value = (e as CustomEvent<InviteLinkMessage>).detail.link;
    });
    // socket.js gives up after three reconnects.
    window.addEventListener("ws:connectionLost", () => {
        modals.value = { ...modals.value, connectionLost: true };
    });

    document.addEventListener("ws:chatMessage", e => {
        const msg = (e as CustomEvent<ChatMessageMessage>).detail;
        const requestId = sheetRolls.get(msg.eventID);
        if (requestId !== undefined) {
            sheetRolls.delete(msg.eventID);
            document.dispatchEvent(new CustomEvent("sheet:rollResult", {
                detail: { requestId, outcome: msg.versus ?? null, commandResult: msg.commandResult || null },
            }));
        }
        const message: ChatMessage = {
            id: msg.messageId,
            userId: msg.userId,
            userName: msg.userName,
            messageBody: msg.messageBody,
            commandResult: msg.commandResult || null,
            characterName: msg.characterName || null,
            createdAt: msg.created,
        };
        chat.value = { ...chat.value, messages: [...chat.value.messages, message] };
    });
    document.addEventListener("ws:deleteMessage", e => {
        const { messageId } = (e as CustomEvent<DeleteMessageMessage>).detail;
        chat.value = { ...chat.value, messages: chat.value.messages.filter(m => m.id !== messageId) };
    });
    document.addEventListener("ws:chatHistory", e => {
        const page = (e as CustomEvent<ChatHistoryMessage>).detail.messagePage;
        if (!page.messages?.length) {
            chat.value = { ...chat.value, hasMore: false };
            return;
        }
        // A message that came after the request is on the page and on the screen.
        const shown = new Set(chat.value.messages.map(m => m.id));
        const earlier: ChatMessage[] = page.messages.filter(m => !shown.has(m.message.id)).map(({ message, username }) => ({
            id: message.id,
            userId: message.userId,
            userName: username,
            messageBody: message.messageBody,
            commandResult: message.commandResult || null,
            characterName: message.characterName || null,
            createdAt: message.createdAt,
        }));
        chat.value = { messages: [...earlier, ...chat.value.messages], hasMore: page.hasMore };
    });

    document.addEventListener("ws:newCharacterItem", e => {
        const msg = (e as CustomEvent<NewCharacterItemMessage>).detail;
        runOrQueue(() => {
            if (sheets.value.some(s => s.id === msg.sheetID)) return;
            const sheet: Sheet = {
                id: msg.sheetID,
                ownerId: msg.userID,
                name: msg.name,
                kind: msg.kind,
                // The message has none: a new sheet has the database default.
                visibility: "everyone_can_view",
                folderId: null,
                createdAt: msg.created,
                updatedAt: msg.updated,
            };
            sheets.value = [sheet, ...sheets.value];
        });
    });
    // The sheet bundle closes the sheet if it is open (sheet/main.ts).
    document.addEventListener("ws:deleteCharacter", e => {
        const sheetId = Number((e as CustomEvent<DeleteCharacterMessage>).detail.sheetID);
        runOrQueue(() => {
            sheets.value = sheets.value.filter(s => s.id !== sheetId);
        });
    });
    // The list names every sheet, open or not; the open one also names itself in sheet:nameChanged.
    document.addEventListener("ws:change", e => {
        const msg = (e as CustomEvent<SheetChangeMessage>).detail;
        if (msg.path === "characterInfo.characterName") renameSheet(Number(msg.sheetID), String(msg.change ?? ""));
    });
    document.addEventListener("ws:changeSheetVisibility", e => {
        const msg = (e as CustomEvent<ChangeSheetVisibilityMessage>).detail;
        const sheetId = Number(msg.sheetID);
        runOrQueue(() => {
            sheets.value = sheets.value.map(s => s.id === sheetId ? { ...s, visibility: msg.visibility } : s);
        });
    });
    document.addEventListener("ws:moveSheetToFolder", e => {
        const { sheetId, folderId } = (e as CustomEvent<MoveSheetToFolderMessage>).detail;
        runOrQueue(() => {
            sheets.value = sheets.value.map(s => s.id === sheetId ? { ...s, folderId } : s);
        });
    });

    document.addEventListener("ws:folderCreated", e => {
        const { folderId: id, ownerId, name, visibility, sortOrder } = (e as CustomEvent<FolderCreatedMessage>).detail;
        runOrQueue(() => {
            if (folders.value.some(f => f.id === id)) return;
            folders.value = [...folders.value, { id, ownerId, name, visibility, sortOrder }];
        });
    });
    document.addEventListener("ws:updateFolder", e => {
        const { folderId, name, visibility, eventID } = (e as CustomEvent<UpdateFolderMessage>).detail;
        runOrQueue(() => {
            if (isStaleFolderEcho(folderId, eventID)) return;
            folders.value = folders.value.map(f => f.id === folderId ? { ...f, name, visibility } : f);
        });
    });
    document.addEventListener("ws:deleteFolder", e => {
        const { folderId } = (e as CustomEvent<DeleteFolderMessage>).detail;
        runOrQueue(() => {
            folders.value = folders.value.filter(f => f.id !== folderId);
            sheets.value = sheets.value.map(s => s.folderId === folderId ? { ...s, folderId: null } : s);
        });
    });
    document.addEventListener("ws:reorderFolders", e => {
        const { folderIds } = (e as CustomEvent<ReorderFoldersMessage>).detail;
        runOrQueue(() => {
            folders.value = reorderedFolders(folders.value, folderIds);
        });
    });

    document.addEventListener("ws:dicePresetUpdated", e => {
        const { slotNumber, diceNotation } = (e as CustomEvent<DicePresetUpdatedMessage>).detail;
        if (slotNumber < 1 || slotNumber > DICE_PRESET_SLOTS) return;
        dicePresets.value = dicePresets.value.map((v, i) => i === slotNumber - 1 ? diceNotation : v);
    });

    document.addEventListener("sheet:notice", e => {
        showToast((e as CustomEvent<{ message: string }>).detail.message);
    });
    // The sheet opens asynchronously (sheet/main.ts), after these listeners are in place.
    document.addEventListener("sheet:nameChanged", e => {
        const { sheetID, change } = (e as CustomEvent<{ sheetID: string; change: string }>).detail;
        renameSheet(Number(sheetID), change ?? "");
    });
    // A roll is signed with the name its sheet gives, or of an NPC with the
    // name the gamemaster gave it for the players; the answer goes back by requestId.
    document.addEventListener("sheet:rollVersus", e => {
        const { target, bonusSuccesses, label, requestId, sheetID, characterName } = (e as CustomEvent<SheetRollVersus>).detail;
        const signed = displayNameOf(sheetID) ?? characterName;
        sheetRolls.set(rollFromSheet(rollVersusCommand(target, bonusSuccesses, label), signed), requestId);
    });
    document.addEventListener("sheet:rollExact", e => {
        const { expression, label, requestId, sheetID, characterName } = (e as CustomEvent<SheetRollExact>).detail;
        const signed = displayNameOf(sheetID) ?? characterName;
        sheetRolls.set(rollFromSheet(rollExactCommand(expression, label), signed), requestId);
    });
    // A refused roll gets only the error. The chat message of a roll sent over a
    // socket that closed, or while it was closed, goes to no one: on a new
    // socket nothing that waits comes back.
    document.addEventListener("ws:response", e => {
        const { eventID, OK } = (e as CustomEvent<{ eventID: string; OK: boolean }>).detail;
        if (!OK) dropSheetRoll(eventID);
    });
    for (const type of ["ws:disconnected", "ws:reconnected"]) {
        document.addEventListener(type, () => {
            for (const eventID of [...sheetRolls.keys()]) dropSheetRoll(eventID);
        });
    }
}
