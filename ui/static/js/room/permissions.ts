// What a role may do in the room. These only decide what the room shows.
import type { RoomRole, Visibility } from "./messages";

export interface Viewer {
    id: number;
    role: RoomRole;
}

export function isElevated(role: RoomRole): boolean {
    return role === "gamemaster" || role === "moderator";
}

export function isGamemaster(role: RoomRole): boolean {
    return role === "gamemaster";
}

/**
 * Whether `viewer` sees a sheet or a folder of `ownerId` in the list. A
 * moderator does not see hidden ones of others, though the server lets them
 * open those.
 */
export function canSee(viewer: Viewer, ownerId: number, visibility: Visibility): boolean {
    return isGamemaster(viewer.role) || ownerId === viewer.id || visibility !== "hide_from_players";
}

/** Whether the list links the sheet, so that `viewer` can open it. */
export function canOpen(viewer: Viewer, ownerId: number, visibility: Visibility): boolean {
    return isElevated(viewer.role) || ownerId === viewer.id
        || visibility === "everyone_can_edit" || visibility === "everyone_can_view";
}
