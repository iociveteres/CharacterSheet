// What comes to the room from outside: the server's messages (ws:<type>, see
// socket.js) and the sheet's notices. The handlers only change the state.
// Until a domain moves off Alpine, network.js handles the same message for
// its part, e.g. kickPlayer and changePlayerRole of other players.
import { inviteLink, me, modals } from "./state";
import { showToast } from "./actions";
import { isElevated } from "./permissions";
import type { ChangePlayerRoleMessage, InviteLinkMessage, KickPlayerMessage } from "./messages";

export function listenRemote(): void {
    document.addEventListener("ws:kickPlayer", e => {
        const msg = (e as CustomEvent<KickPlayerMessage>).detail;
        if (msg.userID === me.value.id) modals.value = { ...modals.value, kicked: true };
    });
    document.addEventListener("ws:changePlayerRole", e => {
        const msg = (e as CustomEvent<ChangePlayerRoleMessage>).detail;
        if (msg.userID !== me.value.id) return;
        me.value = { ...me.value, role: msg.role };
        // Modals.tsx hides the invite from a player; closed, it no longer holds the overlay open.
        if (!isElevated(msg.role)) modals.value = { ...modals.value, invite: false };
    });
    document.addEventListener("ws:newInviteLink", e => {
        inviteLink.value = (e as CustomEvent<InviteLinkMessage>).detail.link;
    });
    // socket.js gives up after three reconnects.
    window.addEventListener("ws:connectionLost", () => {
        modals.value = { ...modals.value, connectionLost: true };
    });

    document.addEventListener("sheet:notice", e => {
        showToast((e as CustomEvent<{ message: string }>).detail.message);
    });
}
