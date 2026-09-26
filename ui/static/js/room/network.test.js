import { describe, expect, it } from "vitest";
import { createRoomStore } from "./store.js";
import { chatMixin } from "./chat.js";

describe("a remote folder reorder", () => {
    it("reorders the folders of their owner", () => {
        const room = createRoomStore();
        room.currentUser = { id: 1, folders: [{ id: 10, sortOrder: 0 }, { id: 11, sortOrder: 1 }], sheets: [] };
        room.otherPlayers = [{ id: 2, folders: [{ id: 20, sortOrder: 0 }, { id: 21, sortOrder: 1 }, { id: 22, sortOrder: 2 }], sheets: [] }];

        room.handleReorderFolders({ type: "reorderFolders", folderIds: [22, 20, 21] });

        expect(room.otherPlayers[0].folders.map(f => f.id)).toEqual([22, 20, 21]);
        expect(room.currentUser.folders.map(f => f.id)).toEqual([10, 11]);
    });
});

// The server's chat, newest first as GetMessagePage counts the offset.
function chatServer(count) {
    const messages = [];
    const post = () => {
        const id = messages.length + 1;
        messages.push({ id, userId: 1, username: "GM", messageBody: `m${id}`, createdAt: "2026-09-27T10:00:00Z" });
        return { type: "chatMessage", messageId: id, userId: 1, userName: "GM", messageBody: `m${id}`, created: "2026-09-27T10:00:00Z" };
    };
    const page = (offset, limit) => {
        const newestFirst = [...messages].reverse();
        return {
            messages: newestFirst.slice(offset, offset + limit).reverse().map(({ username, ...message }) => ({ message, username })),
            hasMore: newestFirst.length > offset + limit,
        };
    };
    for (let i = 0; i < count; i++) post();
    return { post, page };
}

describe("loading earlier chat messages", () => {
    it("continues after the shown ones, also after new messages have come", () => {
        const server = chatServer(60);
        const room = createRoomStore();
        const first = server.page(0, 50);
        room.chat.messages = first.messages.map(({ message, username }) => ({ ...message, userName: username }));
        room.chat.hasMore = first.hasMore;

        for (let i = 0; i < 3; i++) room.handleChatMessage(server.post());

        const requests = [];
        const listener = e => requests.push(JSON.parse(e.detail));
        document.addEventListener("room:sendMessage", listener);
        try {
            chatMixin.loadMoreMessages.call({ $store: { room } });
        } finally {
            document.removeEventListener("room:sendMessage", listener);
        }
        const [request] = requests;
        // A message that comes before the answer moves the page by one more.
        room.handleChatMessage(server.post());
        room.handleChatHistory({ messagePage: server.page(request.offset, request.limit) });

        expect(room.chat.messages.map(m => m.id)).toEqual(Array.from({ length: 64 }, (_, i) => i + 1));
        expect(room.chat.hasMore).toBe(false);
    });
});
