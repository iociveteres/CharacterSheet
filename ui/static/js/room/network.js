// ui/static/js/room/network.js
import { humanDate } from './time_format.js';

export const networkHandlers = {
    setupNetworkListeners() {
        // WebSocket events
        document.addEventListener('ws:newCharacterItem', (e) => this.handleNewCharacter(e.detail));
        document.addEventListener('ws:deleteCharacter', (e) => this.handleDeleteCharacter(e.detail));
        document.addEventListener('ws:nameChanged', (e) => this.handleNameChanged(e.detail));
        document.addEventListener('ws:changeSheetVisibility', (e) => this.handleSheetVisibilityChanged(e.detail));
        document.addEventListener('ws:newPlayer', (e) => this.handleNewPlayer(e.detail));
        document.addEventListener('ws:kickPlayer', (e) => this.handleKickPlayer(e.detail));
        document.addEventListener('ws:changePlayerRole', (e) => this.handleChangePlayerRole(e.detail));
        document.addEventListener('ws:newInviteLink', (e) => this.handleNewInviteLink(e.detail));
        document.addEventListener('ws:chatMessage', (e) => this.handleChatMessage(e.detail));
        document.addEventListener('ws:deleteMessage', (e) => this.handleDeleteMessage(e.detail));
        document.addEventListener('ws:chatHistory', (e) => this.handleChatHistory(e.detail));
        window.addEventListener('ws:connectionLost', () => this.handleConnectionLost());

        document.addEventListener('ws:folderCreated', (e) => this.handleFolderCreated(e.detail));
        document.addEventListener('ws:updateFolder', (e) => this.handleUpdateFolder(e.detail));
        document.addEventListener('ws:deleteFolder', (e) => this.handleDeleteFolder(e.detail));
        document.addEventListener('ws:reorderFolders', (e) => this.handleReorderFolders(e.detail));
        document.addEventListener('ws:moveSheetToFolder', (e) => this.handleMoveSheetToFolder(e.detail));

        // Local character sheet changes (from current user's edits)
        document.addEventListener('sheet:nameChanged', (e) => this.handleNameChanged(e.detail));
        
        // Sheet roll events
        document.addEventListener('sheet:rollVersus', (e) => this.handleSheetRollVersus(e.detail));
        document.addEventListener('sheet:rollExact', (e) => this.handleSheetRollExact(e.detail));
    },

    // Character handlers
    handleNewCharacter(msg) {
        const sheetId = parseInt(msg.sheetID, 10);
        const userId = parseInt(msg.userID, 10);

        const sheet = {
            id: sheetId,
            name: msg.name || 'Unnamed character',
            created: humanDate(msg.created),
            updated: humanDate(msg.updated),
            visibility: msg.visibility || 'everyone_can_view',
            folderId: null
        };

        const player = this.findPlayer(userId);
        if (player) {
            const exists = player.sheets.some(s => s.id === sheetId);
            if (!exists) {
                player.sheets.unshift(sheet);
            }
        }
    },

    handleDeleteCharacter(msg) {
        const sheetId = parseInt(msg.sheetID, 10);

        this.allPlayers.forEach(player => {
            const index = player.sheets.findIndex(s => s.id === sheetId);
            if (index !== -1) {
                player.sheets.splice(index, 1);
            }
        });

        const charactersheet = document.getElementById('charactersheet');
        const currentSheetId = charactersheet?.dataset?.sheetId;
        if (currentSheetId && parseInt(currentSheetId, 10) === sheetId) {
            charactersheet.remove();
        }
    },

    handleNameChanged(msg) {
        const sheetId = parseInt(msg.sheetID, 10);

        this.allPlayers.forEach(player => {
            const sheet = player.sheets.find(s => s.id === sheetId);
            if (sheet) {
                sheet.name = msg.change;
            }
        });
    },

    handleSheetVisibilityChanged(msg) {
        const sheetId = parseInt(msg.sheetID, 10);
        const newVisibility = msg.visibility;

        this.allPlayers.forEach(player => {
            const sheet = player.sheets.find(s => s.id === sheetId);
            if (sheet) {
                sheet.visibility = newVisibility;
            }
        });
    },

    // Folder handlers
    handleFolderCreated(msg) {
        const folder = {
            id: msg.folderId,
            name: msg.name,
            visibility: msg.visibility,
            sortOrder: msg.sortOrder
        };

        const player = this.findPlayer(msg.ownerId);
        if (player) {
            if (!player.folders) {
                player.folders = [];
            }
            player.folders.push(folder);
            player.folders.sort((a, b) => a.sortOrder - b.sortOrder);
        }
    },

    handleUpdateFolder(msg) {
        this.allPlayers.forEach(player => {
            if (player.folders) {
                const folder = player.folders.find(f => f.id === msg.folderId);
                if (folder) {
                    folder.name = msg.name;
                    folder.visibility = msg.visibility;
                }
            }
        });
    },

    handleDeleteFolder(msg) {
        this.allPlayers.forEach(player => {
            if (player.folders) {
                const index = player.folders.findIndex(f => f.id === msg.folderId);
                if (index !== -1) {
                    player.folders.splice(index, 1);
                }
            }

            if (player.sheets) {
                player.sheets.forEach(sheet => {
                    if (sheet.folderId === msg.folderId) {
                        sheet.folderId = null;
                    }
                });
            }
        });
    },

    handleReorderFolders(msg) {
        const player = this.findPlayer(this.currentUser.id);
        if (player && player.folders) {
            msg.folderIds.forEach((folderId, index) => {
                const folder = player.folders.find(f => f.id === folderId);
                if (folder) {
                    folder.sortOrder = index;
                }
            });
            player.folders.sort((a, b) => a.sortOrder - b.sortOrder);
        }
    },

    handleMoveSheetToFolder(msg) {
        this.allPlayers.forEach(player => {
            if (player.sheets) {
                const sheet = player.sheets.find(s => s.id === msg.sheetId);
                if (sheet) {
                    sheet.folderId = msg.folderId;
                }
            }
        });
    },

    // Player handlers
    handleNewPlayer(msg) {
        const userId = parseInt(msg.userID, 10);
        const existingPlayer = this.otherPlayers.find(p => p.id === userId);
        if (!existingPlayer) {
            this.otherPlayers.push({
                id: userId,
                name: msg.name,
                role: msg.role || 'player',
                joinedAt: humanDate(msg.joined) || '',
                sheets: []
            });
        }
    },

    handleKickPlayer(msg) {
        const userId = parseInt(msg.userID, 10);

        if (userId === this.currentUser.id) {
            this.modals.kicked = true;
            return;
        }

        const index = this.otherPlayers.findIndex(p => p.id === userId);
        if (index !== -1) {
            this.otherPlayers.splice(index, 1);
        }
    },

    handleChangePlayerRole(msg) {
        const userId = parseInt(msg.userID, 10);
        const player = this.findPlayer(userId);
        if (player) {
            player.role = msg.role;
        }
    },

    // Invite link handlers
    handleNewInviteLink(msg) {
        this.inviteLink = msg.link;
    },

    handleConnectionLost() {
        this.modals.connectionLost = true;
    },

    // Chat handlers
    handleChatMessage(msg) {
        const message = {
            id: msg.messageId,
            userId: msg.userId,
            userName: msg.userName,
            messageBody: msg.messageBody,
            commandResult: msg.commandResult || null,
            createdAt: msg.created
        };

        this.chat.messages = [...this.chat.messages, message];

        queueMicrotask(() => {
            document.dispatchEvent(new CustomEvent('chat:newMessage'));
        });
    },

    handleDeleteMessage(msg) {
        const messageId = parseInt(msg.messageId, 10);
        const index = this.chat.messages.findIndex(m => m.id === messageId);
        if (index !== -1) {
            this.chat.messages.splice(index, 1);
            this.chat.loadedCount = Math.max(0, this.chat.loadedCount - 1);
        }
    },

    handleChatHistory(msg) {
        const messagePage = msg.messagePage;

        if (!messagePage.messages || messagePage.messages.length === 0) {
            this.chat.hasMore = false;
            return;
        }

        const newMessages = messagePage.messages.map(m => ({
            id: m.message.id,
            userId: m.message.userId,
            userName: m.username,
            messageBody: m.message.messageBody,
            commandResult: m.message.commandResult || null,
            createdAt: m.message.createdAt
        }));

        this.chat.messages = [...newMessages, ...this.chat.messages];
        this.chat.loadedCount += newMessages.length;
        this.chat.hasMore = messagePage.hasMore;
    },

    // Sheet roll handlers (called from store, dispatches to component)
    handleSheetRollVersus(detail) {
        document.dispatchEvent(new CustomEvent('room:rollVersus', { detail }));
    },

    handleSheetRollExact(detail) {
        document.dispatchEvent(new CustomEvent('room:rollExact', { detail }));
    }
};