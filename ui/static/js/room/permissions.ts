// What a role may do in the room. These only decide what the room shows.
import type { RoomRole } from "./messages";

export function isElevated(role: RoomRole): boolean {
    return role === "gamemaster" || role === "moderator";
}
