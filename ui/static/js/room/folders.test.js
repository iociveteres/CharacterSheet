import { afterEach, describe, expect, it, vi } from "vitest";
import { createRoomStore } from "./store.js";
import { foldersMixin } from "./folders.js";

afterEach(() => document.body.replaceChildren());

describe("reordering own folders", () => {
    it("keeps the dropped order in the store and sends it", () => {
        const room = createRoomStore();
        room.currentUser = { id: 1, folders: [{ id: 10, sortOrder: 0 }, { id: 11, sortOrder: 1 }, { id: 12, sortOrder: 2 }], sheets: [] };
        // The order Sortable left in the DOM.
        document.body.innerHTML = `<div data-user-id="1"><div class="sortable-folders">
            <div class="folder" data-folder-id="12"></div><div class="folder" data-folder-id="10"></div><div class="folder" data-folder-id="11"></div>
        </div></div>`;
        const sent = vi.fn();
        document.addEventListener("room:sendMessage", sent);

        foldersMixin.handleFolderReorder.call({ $store: { room } });

        document.removeEventListener("room:sendMessage", sent);
        expect(room.currentUser.folders.map(f => f.id)).toEqual([12, 10, 11]);
        expect(JSON.parse(sent.mock.calls[0][0].detail).folderIds).toEqual([12, 10, 11]);
    });
});
