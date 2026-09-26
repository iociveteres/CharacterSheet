// Local actions of the room: they change the state and send what the server
// has to know. The islands and the Alpine part of the room call them.
import { confirmMessage, csrfToken, modals, roomId, toasts, type Modals } from "./state";
import type { NewInviteLinkRequest } from "./messages";

/** Sends `msg` over the room's socket (socket.js) with a fresh eventID. */
function send(msg: object): void {
    const detail = JSON.stringify({ ...msg, eventID: crypto.randomUUID() });
    document.dispatchEvent(new CustomEvent("room:sendMessage", { detail }));
}

function setModal(name: keyof Modals, open: boolean): void {
    modals.value = { ...modals.value, [name]: open };
}

// — Confirm ———————————————————————————————

let resolveConfirm: ((ok: boolean) => void) | null = null;

/** Asks `message` in the confirm modal; true when the player pressed OK. */
export function confirm(message: string): Promise<boolean> {
    // A question nobody answered is a no.
    resolveConfirm?.(false);
    confirmMessage.value = message;
    return new Promise(resolve => {
        resolveConfirm = resolve;
    });
}

export function answerConfirm(ok: boolean): void {
    const resolve = resolveConfirm;
    resolveConfirm = null;
    confirmMessage.value = null;
    resolve?.(ok);
}

// — Modals ————————————————————————————————

export function openInviteModal(): void {
    setModal("invite", true);
}

export function openImportModal(): void {
    setModal("import", true);
}

/** Cancel and Esc: an open confirm is answered no, otherwise invite and import close. */
export function closeModal(): void {
    if (confirmMessage.value !== null) {
        answerConfirm(false);
        return;
    }
    modals.value = { ...modals.value, invite: false, import: false };
}

export function createInviteLink(expiresInDays: number | null, maxUses: number | null): void {
    const request: NewInviteLinkRequest = { type: "newInviteLink", expiresInDays, maxUses };
    send(request);
}

/** Uploads an exported sheet into the room; the server announces it as newCharacterItem. */
export async function importSheet(file: File | undefined): Promise<void> {
    if (!file) {
        await confirm("Please select a file to import");
        return;
    }
    const form = new FormData();
    form.append("csrf_token", csrfToken);
    form.append("room_id", String(roomId));
    form.append("sheet_file", file);
    try {
        const response = await fetch("/sheet/import", { method: "POST", body: form });
        if (response.ok) {
            setModal("import", false);
        } else {
            await confirm("Failed to import character sheet. Please check the file and try again.");
        }
    } catch (err) {
        console.error("Import error:", err);
        await confirm("An error occurred while importing the character sheet.");
    }
}

// — Toasts ————————————————————————————————

const TOAST_MS = 5000;
let lastToastId = 0;

/** A short notice at the top of the page for five seconds. */
export function showToast(message: string): void {
    // The same notice again replaces the shown one, so it stays its full time.
    const id = ++lastToastId;
    toasts.value = [...toasts.value.filter(t => t.message !== message), { id, message }];
    setTimeout(() => {
        toasts.value = toasts.value.filter(t => t.id !== id);
    }, TOAST_MS);
}
