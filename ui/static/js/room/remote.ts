// What comes to the room from outside: the server's messages (ws:<type>, see
// socket.js) and the sheet's events. The handlers only change the state; a
// roll the sheet asks for goes on to the chat.
// Until a domain moves off Alpine, network.js handles the same message for
// its part, e.g. kickPlayer and changePlayerRole of other players.
import { characterName, chat, dicePresets, inviteLink, me, modals } from "./state";
import { rollFromSheet, showToast } from "./actions";
import { isElevated } from "./permissions";
import { DICE_PRESET_SLOTS, rollExactCommand, rollVersusCommand } from "./dice";
import type {
    ChangePlayerRoleMessage, ChatHistoryMessage, ChatMessageMessage, DeleteMessageMessage, DicePresetUpdatedMessage,
    InviteLinkMessage, KickPlayerMessage,
} from "./messages";
import type { ChatMessage } from "./payload.gen";

export function listenRemote(): void {
    document.addEventListener("ws:kickPlayer", e => {
        const msg = (e as CustomEvent<KickPlayerMessage>).detail;
        if (msg.userID === me.value.id) modals.value = { ...modals.value, kicked: true };
    });
    document.addEventListener("ws:changePlayerRole", e => {
        const msg = (e as CustomEvent<ChangePlayerRoleMessage>).detail;
        if (msg.userID !== me.value.id) return;
        me.value = { ...me.value, role: msg.role };
        // Modals.tsx hides the invite from a player; closed, it no longer holds the overlay open.
        if (!isElevated(msg.role)) modals.value = { ...modals.value, invite: false };
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
        characterName.value = (e as CustomEvent<{ change: string }>).detail.change?.trim() || null;
    });
    document.addEventListener("sheet:closed", () => {
        characterName.value = null;
    });
    document.addEventListener("sheet:rollVersus", e => {
        const { target, bonusSuccesses, label } = (e as CustomEvent<{ target: number; bonusSuccesses: number; label: string }>).detail;
        rollFromSheet(rollVersusCommand(target, bonusSuccesses, label));
    });
    document.addEventListener("sheet:rollExact", e => {
        const { expression, label } = (e as CustomEvent<{ expression: string; label: string }>).detail;
        rollFromSheet(rollExactCommand(expression, label));
    });
}
