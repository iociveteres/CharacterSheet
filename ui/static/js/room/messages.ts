// WebSocket messages of the room. The Go structs in internal/roomws are not
// exported, so tygo does not see them: these types follow them by hand.
import type { RoomPlayer } from "./payload.gen";

export type RoomRole = RoomPlayer["role"];

// — From the server ———————————————————————

/** The kicked player is disconnected two seconds later. */
export interface KickPlayerMessage {
    type: "kickPlayer";
    eventID: string;
    userID: number;
}

export interface ChangePlayerRoleMessage {
    type: "changePlayerRole";
    eventID: string;
    userID: number;
    role: RoomRole;
}

/** Only the player who asked for the link gets it. */
export interface InviteLinkMessage {
    type: "newInviteLink";
    eventID: string;
    link: string;
    created: string;
    expiresAt: string | null;
    MaxUses: number | null;
}

// — To the server —————————————————————————

/** null means no limit; the server takes maxUses 0 as no limit too. */
export interface NewInviteLinkRequest {
    type: "newInviteLink";
    expiresInDays: number | null;
    maxUses: number | null;
}
