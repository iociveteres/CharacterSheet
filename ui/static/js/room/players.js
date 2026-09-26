import { confirm, openImportModal, openInviteModal } from './actions';

const SHEET_KIND_STORAGE_KEY = 'newSheetKind';
const DEFAULT_SHEET_KIND = 'black_crusade';

export const playersMixin = {
    // State
    newSheetKind: DEFAULT_SHEET_KIND,
    sheetKindLabels: {},

    // Methods

    // Restores the last used sheet kind, ignoring a stored kind that the
    // server no longer offers.
    initSheetKind() {
        const kinds = this.$store.room.sheetKinds;
        const offered = kinds.map(k => k.kind);

        this.sheetKindLabels = Object.fromEntries(kinds.map(k => [k.kind, k.label]));

        let stored = null;
        try {
            stored = localStorage.getItem(SHEET_KIND_STORAGE_KEY);
        } catch {
            // storage can be unavailable
        }

        this.newSheetKind = offered.includes(stored) ? stored : (offered[0] ?? DEFAULT_SHEET_KIND);
    },

    sheetKindLabel(kind) {
        if (!kind) return '';
        return this.sheetKindLabels[kind] ?? kind;
    },

    sheetDatesTitle(sheet) {
        return `Created ${sheet.created}
Modified ${sheet.updated}`;
    },

    createCharacter() {
        const msg = JSON.stringify({
            type: 'newCharacter',
            eventID: crypto.randomUUID(),
            kind: this.newSheetKind,
        });
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
    },

    rememberSheetKind() {
        try {
            localStorage.setItem(SHEET_KIND_STORAGE_KEY, this.newSheetKind);
        } catch {
            // storage can be unavailable
        }
    },

    async deleteCharacter(sheetId, charName) {
        const confirmed = await confirm(`Delete ${charName}?`);
        if (!confirmed) return;

        const payload = {
            type: 'deleteCharacter',
            eventID: crypto.randomUUID(),
            sheetID: String(sheetId)
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    },

    changeSheetVisibility(sheetId, newVisibility) {
        const sheet = this.$store.room.currentUser.sheets.find(s => s.id === sheetId);
        if (sheet) sheet.visibility = newVisibility;

        const payload = {
            type: 'changeSheetVisibility',
            eventID: crypto.randomUUID(),
            sheetID: String(sheetId),
            visibility: newVisibility
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    },

    exportCharacter(sheetId, charName) {
        const a = document.createElement('a');
        a.href = `/sheet/export/${sheetId}`;
        a.download = `character_${charName}_${sheetId}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    },

    // The modals are Preact's (components/Modals.tsx).
    openImportModal,
    openInviteModal,

    async kickPlayer(userId, userName) {
        const confirmed = await confirm(`Kick ${userName}?`);
        if (!confirmed) return;

        const payload = {
            type: 'kickPlayer',
            eventID: crypto.randomUUID(),
            userID: userId
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    },

    changePlayerRole(userId, newRole) {
        const payload = {
            type: 'changePlayerRole',
            eventID: crypto.randomUUID(),
            userID: userId,
            role: newRole
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    },
};
