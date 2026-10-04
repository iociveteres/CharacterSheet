// The rolls of the sheets on the /bestiary page (sheet/rollEvents.ts). The
// server rolls the command the room would post to its chat, stores nothing
// and answers this tab only (roll in internal/roomws/bestiary.go); the answer
// goes back to the sheet and into the page's roll feed.
import { rollExactCommand, rollVersusCommand } from "../room/dice";
import type { SheetRollExact, SheetRollVersus, VersusOutcome } from "../room/messages";
import { sendToRoom } from "../sheet/network";
import { addRoll } from "./actions";

/** What the server answers a roll with: a chat message nobody else sees. */
export interface RollResultMessage {
    type: "rollResult";
    eventID: string;
    messageBody: string;
    commandResult: string;
    versus?: VersusOutcome;
    characterName?: string;
    created: string;
}

// The rolls on their way: eventID → the sheet's requestId.
const waiting = new Map<string, string>();
let lastRollId = 0;

function answer(requestId: string, outcome: VersusOutcome | null, commandResult: string | null): void {
    document.dispatchEvent(new CustomEvent("sheet:rollResult", { detail: { requestId, outcome, commandResult } }));
}

/** Answers the roll of `eventID` with nothing: its result will not come. */
function dropRoll(eventID: string): void {
    const requestId = waiting.get(eventID);
    if (requestId === undefined) return;
    waiting.delete(eventID);
    answer(requestId, null, null);
}

function roll(command: string, characterName: string | null, requestId: string): void {
    const eventID = crypto.randomUUID();
    if (!sendToRoom(JSON.stringify({ type: "roll", eventID, messageBody: command, characterName }))) {
        answer(requestId, null, null);
        return;
    }
    waiting.set(eventID, requestId);
}

export function listenRolls(): void {
    document.addEventListener("sheet:rollVersus", e => {
        const { target, bonusSuccesses, label, requestId, characterName } = (e as CustomEvent<SheetRollVersus>).detail;
        roll(rollVersusCommand(target, bonusSuccesses, label), characterName, requestId);
    });
    document.addEventListener("sheet:rollExact", e => {
        const { expression, label, requestId, characterName } = (e as CustomEvent<SheetRollExact>).detail;
        roll(rollExactCommand(expression, label), characterName, requestId);
    });
    document.addEventListener("ws:rollResult", e => {
        const msg = (e as CustomEvent<RollResultMessage>).detail;
        const requestId = waiting.get(msg.eventID);
        if (requestId === undefined) return;
        waiting.delete(msg.eventID);
        addRoll({
            id: ++lastRollId,
            userId: 0,
            userName: "",
            messageBody: msg.messageBody,
            commandResult: msg.commandResult || null,
            characterName: msg.characterName || null,
            createdAt: msg.created,
        });
        answer(requestId, msg.versus ?? null, msg.commandResult || null);
    });
    // A refused roll gets only the error; one sent over a socket that closed
    // is answered on no socket.
    document.addEventListener("ws:response", e => {
        const { eventID, OK } = (e as CustomEvent<{ eventID: string; OK: boolean }>).detail;
        if (!OK) dropRoll(eventID);
    });
    for (const type of ["ws:disconnected", "ws:reconnected"]) {
        document.addEventListener(type, () => {
            for (const eventID of [...waiting.keys()]) dropRoll(eventID);
        });
    }
}
