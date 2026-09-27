// The chat's messages grouped for display, and the history of what the player
// sent, which ↑ and ↓ bring back into the input.
import type { ChatMessage } from "./payload.gen";

/** Messages of one player in a row that go under one character name. */
export interface CharacterGroup {
    key: number;
    characterName: string | null;
    messages: ChatMessage[];
}

export interface AuthorGroup {
    key: number;
    userId: number;
    userName: string;
    characters: CharacterGroup[];
}

export interface DayGroup {
    /** The local date, as Date.toDateString writes it. */
    key: string;
    date: Date;
    authors: AuthorGroup[];
}

/**
 * Groups the messages, oldest first, by local day, then by player in a row,
 * then by character. A message without a character stays in the character
 * group before it. A group's key is the id of its first message, so appended
 * messages keep the groups before them.
 */
export function groupChat(messages: ChatMessage[]): DayGroup[] {
    const days: DayGroup[] = [];
    for (const msg of messages) {
        const date = new Date(msg.createdAt);
        if (isNaN(date.getTime())) {
            console.error("Invalid date for message:", msg);
            continue;
        }

        let day = days.at(-1);
        if (day?.key !== date.toDateString()) {
            day = { key: date.toDateString(), date, authors: [] };
            days.push(day);
        }

        let author = day.authors.at(-1);
        if (author?.userId !== msg.userId) {
            author = { key: msg.id, userId: msg.userId, userName: msg.userName, characters: [] };
            day.authors.push(author);
        }

        let character = author.characters.at(-1);
        if (!character || (msg.characterName !== null && msg.characterName !== character.characterName)) {
            character = { key: msg.id, characterName: msg.characterName, messages: [] };
            author.characters.push(character);
        }
        character.messages.push(msg);
    }
    return days;
}

// — Input history ————————————————————————

const HISTORY_LIMIT = 50;

const historyKey = (roomId: number) => `chat_history_room_${roomId}`;

/** What the player sent in the room this browser session, oldest first. */
export function readInputHistory(roomId: number): string[] {
    try {
        const stored = sessionStorage.getItem(historyKey(roomId));
        return stored ? JSON.parse(stored) as string[] : [];
    } catch (err) {
        console.error("Failed to load chat history:", err);
        return [];
    }
}

/** Adds a sent message; the same one twice in a row is kept once. */
export function rememberInput(roomId: number, message: string): void {
    const trimmed = message.trim();
    if (!trimmed) return;
    const history = readInputHistory(roomId);
    if (history.at(-1) === trimmed) return;
    history.push(trimmed);
    try {
        sessionStorage.setItem(historyKey(roomId), JSON.stringify(history.slice(-HISTORY_LIMIT)));
    } catch (err) {
        console.error("Failed to save chat history:", err);
    }
}
