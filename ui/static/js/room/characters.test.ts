import { beforeEach, describe, expect, it } from "vitest";
import {
    listCharacters, readCollapsed, readSheetKind, reorderedFolders, saveCollapsed, saveSheetKind,
    type Folder, type Player, type Sheet,
} from "./characters";
import type { Viewer } from "./permissions";
import type { Visibility } from "./messages";

const players: Player[] = [
    { id: 1, name: "GM", role: "gamemaster", joinedAt: "" },
    { id: 2, name: "Moderator", role: "moderator", joinedAt: "" },
    { id: 3, name: "Player", role: "player", joinedAt: "" },
    { id: 4, name: "Other", role: "player", joinedAt: "" },
];

const folder = (id: number, ownerId: number, visibility: Visibility, sortOrder = 0): Folder =>
    ({ id, ownerId, name: `f${id}`, visibility, sortOrder });
const sheet = (id: number, ownerId: number, visibility: Visibility, folderId: number | null = null): Sheet =>
    ({ id, ownerId, name: `s${id}`, kind: "black_crusade", visibility, folderId, createdAt: "", updatedAt: "" });

// Player 3's sheets and folders, each visibility once.
const folders = [folder(30, 3, "hide_from_players"), folder(31, 3, "everyone_can_see")];
const sheets = [
    sheet(1, 3, "everyone_can_edit"),
    sheet(2, 3, "everyone_can_view"),
    sheet(3, 3, "everyone_can_see"),
    sheet(4, 3, "hide_from_players"),
    sheet(5, 3, "everyone_can_edit", 30),
    sheet(6, 3, "hide_from_players", 31),
];

/** What `viewer` sees of player 3: shown sheets as id and whether they link, outside folders and per folder. */
function seenBy(viewer: Viewer) {
    const entry = listCharacters(players, folders, sheets, viewer).find(e => e.player.id === 3)!;
    const shown = (list: { sheet: Sheet; canOpen: boolean }[]) => list.map(e => `${e.sheet.id}${e.canOpen ? "" : " (no link)"}`);
    return {
        sheets: shown(entry.sheets),
        folders: Object.fromEntries(entry.folders.map(f => [f.folder.id, shown(f.sheets)])),
    };
}

describe("the character list", () => {
    it("shows the gamemaster everything, linked", () => {
        expect(seenBy({ id: 1, role: "gamemaster" })).toEqual({
            sheets: ["1", "2", "3", "4"],
            folders: { 30: ["5"], 31: ["6"] },
        });
    });

    it("hides hidden ones of others from a moderator, and links the rest", () => {
        expect(seenBy({ id: 2, role: "moderator" })).toEqual({
            sheets: ["1", "2", "3"],
            folders: { 31: ["6"] },
        });
    });

    it("links sheets a player may open; a sheet in a folder has the folder's visibility", () => {
        expect(seenBy({ id: 4, role: "player" })).toEqual({
            sheets: ["1", "2", "3 (no link)"],
            folders: { 31: ["6 (no link)"] },
        });
    });

    it("shows the owner all of their own, linked", () => {
        expect(seenBy({ id: 3, role: "player" })).toEqual({
            sheets: ["1", "2", "3", "4"],
            folders: { 30: ["5"], 31: ["6"] },
        });
    });

    it("keeps the order of players and sheets, and orders each player's folders", () => {
        const list = listCharacters(
            players.slice(0, 2),
            [folder(12, 1, "everyone_can_view", 2), folder(20, 2, "everyone_can_view", 0), folder(10, 1, "everyone_can_view", 0), folder(11, 1, "everyone_can_view", 1)],
            [sheet(8, 1, "everyone_can_view"), sheet(7, 2, "everyone_can_view"), sheet(6, 1, "everyone_can_view")],
            { id: 1, role: "gamemaster" },
        );

        expect(list.map(e => [e.player.id, e.folders.map(f => f.folder.id), e.sheets.map(s => s.sheet.id)])).toEqual([
            [1, [10, 11, 12], [8, 6]],
            [2, [20], [7]],
        ]);
    });
});

it("reordered folders number the given ones in their order and leave the rest", () => {
    const reordered = reorderedFolders([folder(10, 1, "everyone_can_view", 0), folder(11, 1, "everyone_can_view", 1), folder(20, 2, "everyone_can_view", 0)], [11, 10]);

    expect(reordered.map(f => [f.id, f.sortOrder])).toEqual([[10, 1], [11, 0], [20, 0]]);
});

describe("localStorage", () => {
    beforeEach(() => localStorage.clear());

    it("brings back the kind of the last new sheet while the server offers it", () => {
        expect(readSheetKind(["black_crusade", "pathfinder_crusade"])).toBe("black_crusade");

        saveSheetKind("pathfinder_crusade");
        expect(localStorage.getItem("newSheetKind")).toBe("pathfinder_crusade");
        expect(readSheetKind(["black_crusade", "pathfinder_crusade"])).toBe("pathfinder_crusade");
        expect(readSheetKind(["black_crusade"])).toBe("black_crusade");
    });

    it("keeps a collapse and falls back without one", () => {
        expect(readCollapsed("folder_collapsed_5_10", true)).toBe(true);

        saveCollapsed("folder_collapsed_5_10", false);

        expect(localStorage.getItem("folder_collapsed_5_10")).toBe("false");
        expect(readCollapsed("folder_collapsed_5_10", true)).toBe(false);
    });
});
