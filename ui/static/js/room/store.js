import { networkHandlers } from './network.js';
import { humanDate } from './time_format.js';

export function createRoomStore() {
    return {
        // State
        currentUser: {
            id: null,
            name: '',
            role: '',
            joinedAt: '',
            sheets: [],
            folders: []
        },
        otherPlayers: [],
        inviteLink: '',
        roomId: null,
        csrfToken: '',
        commands: [],
        dicePresets: [],
        sheetKinds: [],
        modals: {
            invite: false,
            kicked: false,
            connectionLost: false,
            import: false,
            confirm: false
        },
        chat: {
            messages: [],
            hasMore: false
        },
        confirmModal: {
            message: '',
            resolveCallback: null
        },
        // Getters
        get isElevated() {
            return this.currentUser.role === 'gamemaster' || this.currentUser.role === 'moderator';
        },

        get isGamemaster() {
            return this.currentUser.role === 'gamemaster';
        },

        get allPlayers() {
            return [this.currentUser, ...this.otherPlayers];
        },

        findPlayer(userId) {
            return this.allPlayers.find(p => p.id === userId);
        },

        isSheetVisible(sheet, ownerId) {
            if (this.isGamemaster) return true;
            if (ownerId === this.currentUser.id) return true;

            if (sheet.folderId) {
                const owner = this.findPlayer(ownerId);
                if (owner && owner.folders) {
                    const folder = owner.folders.find(f => f.id === sheet.folderId);
                    if (folder) {
                        if (folder.visibility === 'hide_from_players') {
                            return false;
                        }
                        return true;
                    }
                }
            }

            if (sheet.visibility === 'hide_from_players') return false;
            return true;
        },

        canOpenSheet(sheet, ownerId) {
            if (this.isGamemaster || this.currentUser.role === 'moderator') return true;
            if (ownerId === this.currentUser.id) return true;

            if (sheet.folderId) {
                const owner = this.findPlayer(ownerId);
                if (owner && owner.folders) {
                    const folder = owner.folders.find(f => f.id === sheet.folderId);
                    if (folder) {
                        if (folder.visibility === 'everyone_can_edit' || folder.visibility === 'everyone_can_view') {
                            return true;
                        }
                        return false;
                    }
                }
            }

            if (sheet.visibility === 'everyone_can_edit' || sheet.visibility === 'everyone_can_view') {
                return true;
            }

            return false;
        },

        initUI() {
            this.readRoomState();
            this.setupNetworkListeners();
        },

        // Reads the room the server put into the page (templates.RoomPayload).
        readRoomState() {
            /** @type {import('./payload.gen').RoomPayload} */
            const state = JSON.parse(document.getElementById('room-state').textContent);

            const [me, ...others] = state.players.map(player => ({
                id: player.id,
                name: player.name,
                role: player.role,
                joinedAt: humanDate(player.joinedAt),
                folders: player.folders,
                sheets: player.sheets.map(sheet => ({
                    id: sheet.id,
                    name: sheet.name,
                    created: humanDate(sheet.createdAt),
                    updated: humanDate(sheet.updatedAt),
                    kind: sheet.kind,
                    visibility: sheet.visibility,
                    folderId: sheet.folderId
                }))
            }));
            this.currentUser = me;
            this.otherPlayers = others;

            this.roomId = state.roomId;
            this.inviteLink = state.inviteLink;
            this.csrfToken = state.csrfToken;
            this.chat.messages = state.chat.messages;
            this.chat.hasMore = state.chat.hasMore;
            this.commands = state.commands;
            this.dicePresets = state.dicePresets;
            this.sheetKinds = state.sheetKinds;
        },

        // Custom confirm
        confirm(message) {
            return new Promise((resolve) => {
                this.confirmModal.message = message;
                this.confirmModal.resolveCallback = resolve;
                this.modals.confirm = true;
            });
        },

        resolveConfirm(result) {
            if (this.confirmModal.resolveCallback) {
                this.confirmModal.resolveCallback(result);
                this.confirmModal.resolveCallback = null;
            }
            this.modals.confirm = false;
            this.confirmModal.message = '';
        },

        // Mix in network handlers
        ...networkHandlers
    };
}