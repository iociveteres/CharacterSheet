import { networkHandlers } from './network.js';

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
        modals: {
            invite: false,
            kicked: false,
            connectionLost: false,
            import: false,
            confirm: false
        },
        chat: {
            messages: [],
            hasMore: false,
            loadedCount: 0
        },
        confirmModal: {
            message: '',
            resolveCallback: null
        },
        rightPanelVisible: true,

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
            this.extractSSRData();
            this.setupNetworkListeners();
        },

        extractSSRData() {
            const currentUserEl = document.getElementById('ssr-current-user');
            if (currentUserEl) {
                this.currentUser.id = parseInt(currentUserEl.dataset.userId, 10);
                this.currentUser.name = currentUserEl.dataset.userName;
                this.currentUser.role = currentUserEl.dataset.userRole;
                this.currentUser.joinedAt = currentUserEl.dataset.joinedAt;

                const folderEls = currentUserEl.querySelectorAll('.ssr-folder');
                this.currentUser.folders = Array.from(folderEls).map(el => ({
                    id: parseInt(el.dataset.folderId, 10),
                    name: el.dataset.name,
                    visibility: el.dataset.visibility,
                    sortOrder: parseInt(el.dataset.sortOrder, 10)
                }));

                const sheetEls = currentUserEl.querySelectorAll('.ssr-sheet');
                this.currentUser.sheets = Array.from(sheetEls).map(el => ({
                    id: parseInt(el.dataset.sheetId, 10),
                    name: el.dataset.name,
                    created: el.dataset.created,
                    updated: el.dataset.updated,
                    visibility: el.dataset.visibility || 'everyone_can_edit',
                    folderId: el.dataset.folderId ? parseInt(el.dataset.folderId, 10) : null
                }));
            }

            const playerEls = document.querySelectorAll('.ssr-player');
            this.otherPlayers = Array.from(playerEls).map(playerEl => {
                const folderEls = playerEl.querySelectorAll('.ssr-folder');
                const sheetEls = playerEl.querySelectorAll('.ssr-sheet');

                return {
                    id: parseInt(playerEl.dataset.userId, 10),
                    name: playerEl.dataset.userName,
                    role: playerEl.dataset.userRole,
                    joinedAt: playerEl.dataset.joinedAt,
                    folders: Array.from(folderEls).map(el => ({
                        id: parseInt(el.dataset.folderId, 10),
                        name: el.dataset.name,
                        visibility: el.dataset.visibility,
                        sortOrder: parseInt(el.dataset.sortOrder, 10)
                    })),
                    sheets: Array.from(sheetEls).map(el => ({
                        id: parseInt(el.dataset.sheetId, 10),
                        name: el.dataset.name,
                        created: el.dataset.created,
                        updated: el.dataset.updated,
                        visibility: el.dataset.visibility || 'everyone_can_view',
                        folderId: el.dataset.folderId ? parseInt(el.dataset.folderId, 10) : null
                    }))
                };
            });

            const inviteLinkEl = document.getElementById('ssr-invite-link');
            if (inviteLinkEl) {
                this.inviteLink = inviteLinkEl.dataset.link;
            }

            const roomIdEl = document.getElementById('ssr-room-id');
            if (roomIdEl) {
                this.roomId = parseInt(roomIdEl.dataset.value, 10);
            }

            const messageEls = document.querySelectorAll('.ssr-message');
            this.chat.messages = Array.from(messageEls).map(el => ({
                id: parseInt(el.dataset.id, 10),
                userId: parseInt(el.dataset.userId, 10),
                userName: el.dataset.userName,
                messageBody: el.dataset.message,
                commandResult: el.dataset.commandResult || null,
                createdAt: el.dataset.created
            }));

            this.chat.loadedCount = this.chat.messages.length;

            const ssrHasMore = document.getElementById('ssr-messages')?.dataset?.hasMore;
            this.chat.hasMore = ssrHasMore === 'true';

            console.log(this);
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

        triggerSortableReinit() {
            document.dispatchEvent(new CustomEvent('room:reinitializeSortable'));
        },

        // Mix in network handlers
        ...networkHandlers
    };
}