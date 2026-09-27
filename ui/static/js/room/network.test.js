import { describe, expect, it } from "vitest";
import { createRoomStore } from "./store.js";

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
