import { networkHandlers } from './network.js';
import { humanDate } from './time_format.js';
import { isElevated, isGamemaster } from './permissions';

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
        roomId: null,
        sheetKinds: [],
        // Getters
        get isElevated() {
            return isElevated(this.currentUser.role);
        },

        get isGamemaster() {
            return isGamemaster(this.currentUser.role);
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

        /** @param {import('./payload.gen').RoomPayload} state the page's #room-state */
        readRoomState(state) {
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
            this.sheetKinds = state.sheetKinds;
        },

        // Mix in network handlers
        ...networkHandlers
    };
}