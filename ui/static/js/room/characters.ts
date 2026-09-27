// The Characters tab without the DOM: what the list shows to whom, and the
// settings of the player that it keeps in localStorage.
import type { RoomFolder, RoomPlayer, RoomSheet } from "./payload.gen";
import type { SheetKind } from "../sheet/kinds/kinds.gen";
import { canOpen, canSee, type Viewer } from "./permissions";
import type { Visibility } from "./messages";

export type Player = Omit<RoomPlayer, "folders" | "sheets">;
export type Folder = RoomFolder & { ownerId: number };
export type Sheet = RoomSheet & { ownerId: number };

export interface SheetEntry {
    sheet: Sheet;
    /** Whether the name links the sheet. */
    canOpen: boolean;
}

export interface FolderEntry {
    folder: Folder;
    sheets: SheetEntry[];
}

export interface PlayerCharacters {
    player: Player;
    folders: FolderEntry[];
    /** The sheets outside folders. */
    sheets: SheetEntry[];
}

/** The folders of `ownerId` in their order. */
export function playerFolders(folders: readonly Folder[], ownerId: number): Folder[] {
    return folders.filter(f => f.ownerId === ownerId).sort((a, b) => a.sortOrder - b.sortOrder);
}

/** `folders` with the ones in `ids` numbered in that order. */
export function reorderedFolders(folders: readonly Folder[], ids: readonly number[]): Folder[] {
    return folders.map(f => {
        const sortOrder = ids.indexOf(f.id);
        return sortOrder === -1 ? f : { ...f, sortOrder };
    });
}

/**
 * The folders and sheets of each player that `viewer` sees, in the order of
 * `players`. A sheet in a folder has the folder's visibility, whatever its own.
 */
export function listCharacters(players: readonly Player[], folders: readonly Folder[], sheets: readonly Sheet[], viewer: Viewer): PlayerCharacters[] {
    return players.map(player => {
        const theirs = sheets.filter(s => s.ownerId === player.id);
        const entry = (sheet: Sheet, visibility: Visibility): SheetEntry =>
            ({ sheet, canOpen: canOpen(viewer, player.id, visibility) });
        return {
            player,
            folders: playerFolders(folders, player.id)
                .filter(folder => canSee(viewer, player.id, folder.visibility))
                .map(folder => ({
                    folder,
                    sheets: theirs.filter(s => s.folderId === folder.id).map(s => entry(s, folder.visibility)),
                })),
            sheets: theirs
                .filter(s => s.folderId === null && canSee(viewer, player.id, s.visibility))
                .map(s => entry(s, s.visibility)),
        };
    });
}

/** What the list and the questions about a sheet call it. */
export function sheetName(sheet: Sheet): string {
    return sheet.name || "_____";
}

// — localStorage ——————————————————————————

const SHEET_KIND_KEY = "newSheetKind";

/** The kind of the player's last new sheet, if the server still offers it. */
export function readSheetKind(offered: readonly SheetKind[]): SheetKind {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(SHEET_KIND_KEY);
    } catch {
        // storage can be unavailable
    }
    return offered.find(kind => kind === stored) ?? offered[0];
}

export function saveSheetKind(kind: SheetKind): void {
    try {
        localStorage.setItem(SHEET_KIND_KEY, kind);
    } catch {
        // storage can be unavailable
    }
}

export const folderCollapsedKey = (roomId: number, folderId: number) => `folder_collapsed_${roomId}_${folderId}`;
export const playerCollapsedKey = (roomId: number, playerId: number) => `player_collapsed_${roomId}_${playerId}`;

export function readCollapsed(key: string, fallback: boolean): boolean {
    try {
        const stored = localStorage.getItem(key);
        return stored === null ? fallback : stored === "true";
    } catch {
        return fallback;
    }
}

export function saveCollapsed(key: string, collapsed: boolean): void {
    try {
        localStorage.setItem(key, String(collapsed));
    } catch {
        // storage can be unavailable
    }
}
