// Alpine.js Store and Component for room management
document.addEventListener('alpine:init', () => {
    // Global store for room state (shared across all components)
    Alpine.store('room', {
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

        get isElevated() {
            return this.currentUser.role === 'gamemaster' || this.currentUser.role === 'moderator';
        },

        get isGamemaster() {
            return this.currentUser.role === 'gamemaster';
        },

        get allPlayers() {
            return [this.currentUser, ...this.otherPlayers];
        },

        // Helper: Find player by ID
        findPlayer(userId) {
            return this.allPlayers.find(p => p.id === userId);
        },

        isSheetVisible(sheet, ownerId) {
            // Gamemasters can see everything
            if (this.isGamemaster) return true;

            // Owners can see their own sheets
            if (ownerId === this.currentUser.id) return true;

            // If sheet is in a folder, ONLY folder visibility matters
            if (sheet.folderId) {
                const owner = this.findPlayer(ownerId);
                if (owner && owner.folders) {
                    const folder = owner.folders.find(f => f.id === sheet.folderId);
                    if (folder) {
                        // Folder visibility completely overrides sheet visibility
                        if (folder.visibility === 'hide_from_players') {
                            return false;
                        }
                        // Folder is visible to regular players
                        return true;
                    }
                }
                // If we can't find the folder, fall back to sheet visibility
            }

            // Sheet is NOT in a folder - use its own visibility
            if (sheet.visibility === 'hide_from_players') return false;

            return true;
        },

        canOpenSheet(sheet, ownerId) {
            // Gamemasters and moderators can open everything
            if (this.isGamemaster || this.currentUser.role === 'moderator') return true;

            // Owners can open their own sheets
            if (ownerId === this.currentUser.id) return true;

            // If sheet is in a folder, ONLY folder visibility matters
            if (sheet.folderId) {
                const owner = this.findPlayer(ownerId);
                if (owner && owner.folders) {
                    const folder = owner.folders.find(f => f.id === sheet.folderId);
                    if (folder) {
                        // Folder visibility completely determines access
                        if (folder.visibility === 'everyone_can_edit' || folder.visibility === 'everyone_can_view') {
                            return true;
                        }
                        // 'everyone_can_see' or 'hide_from_players'
                        return false;
                    }
                }
                // If we can't find the folder, fall back to sheet visibility
            }

            // Sheet is NOT in a folder - use its own visibility
            if (sheet.visibility === 'everyone_can_edit' || sheet.visibility === 'everyone_can_view') {
                return true;
            }

            return false;
        },

        // Initialize from SSR data
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

            console.log(this)
        },

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
        },

        // custom confirm
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
                // Check if sheet already exists (prevent duplicates)
                const exists = player.sheets.some(s => s.id === sheetId);
                if (!exists) {
                    player.sheets.unshift(sheet);
                }
            }
        },

        handleDeleteCharacter(msg) {
            const sheetId = parseInt(msg.sheetID, 10);

            // Remove from all players' sheets
            this.allPlayers.forEach(player => {
                const index = player.sheets.findIndex(s => s.id === sheetId);
                if (index !== -1) {
                    player.sheets.splice(index, 1);
                }
            });

            // Close character sheet if it's the one being deleted
            const charactersheet = document.getElementById('charactersheet');
            const currentSheetId = charactersheet?.dataset?.sheetId;
            if (currentSheetId && parseInt(currentSheetId, 10) === sheetId) {
                charactersheet.remove();
            }
        },

        handleNameChanged(msg) {
            const sheetId = parseInt(msg.sheetID, 10);

            // Update in all players' sheets
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

            // Update in all players' sheets
            this.allPlayers.forEach(player => {
                const sheet = player.sheets.find(s => s.id === sheetId);
                if (sheet) {
                    sheet.visibility = newVisibility;
                }
            });
        },

        triggerSortableReinit() {
            document.dispatchEvent(new CustomEvent('room:reinitializeSortable'));
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
                // Sort by sortOrder
                player.folders.sort((a, b) => a.sortOrder - b.sortOrder);
            }
        },

        handleUpdateFolder(msg) {
            // Update folder for ALL players who have this folder ID
            // since folder IDs are unique, only the owner will have it
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

                // Move sheets from deleted folder to default area
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

            // Check if current user is being kicked
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

            // Dispatch event for conditional scrolling
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

            // Server sends messages in chronological order (oldest first after reversal)
            const newMessages = messagePage.messages.map(m => ({
                id: m.message.id,
                userId: m.message.userId,
                userName: m.username,
                messageBody: m.message.messageBody,
                commandResult: m.message.commandResult || null,
                createdAt: m.message.createdAt
            }));

            // Prepend to beginning of messages array
            this.chat.messages = [...newMessages, ...this.chat.messages];

            // Update loaded count for next pagination request
            this.chat.loadedCount += newMessages.length;

            this.chat.hasMore = messagePage.hasMore;
        },

    });

    // Component for room UI interactions
    Alpine.data('roomComponent', function () {
        return {
            // Local component state (not shared)
            rightPanelVisible: true,

            inviteLinkCopied: false,
            newInvite: {
                expiresInDays: null,
                maxUses: null
            },

            // Chat
            chatInput: '',
            availableCommands: [],
            showCommandsPopover: false,
            messageMenuOpen: null,
            chatInput: '',
            chatHistoryIndex: -1, // -1 means not navigating history
            chatHistoryDraft: '',
            isChatBottomVisible: true,
            chatBottomObserver: null,
            unreadMessageCount: 0,
            showNewMessagesButton: false,

            // Dice roller
            showDiceRoller: false,
            diceModifier: 0,
            diceAmount: 1,
            customDice: ['', '', '', '', ''],
            rollAgainstInputs: ['', '', '', ''],
            selectedRollAgainst: null,
            dicePresetDebounceTimers: {},

            // Folder
            collapsedFolders: {},
            collapsedPlayers: {},
            folderUpdateTimers: {},
            sortableInstances: [],
            lastFolderCount: 0,

            get chatGroupedMessages() {
                const groups = [];
                let currentGroup = null;

                this.$store.room.chat.messages.forEach((msg, index) => {
                    const msgDate = new Date(msg.createdAt);

                    if (isNaN(msgDate.getTime())) {
                        console.error('Invalid date for message:', msg);
                        return;
                    }

                    const dateKey = msgDate.toDateString();

                    if (!currentGroup || currentGroup.date !== dateKey) {
                        currentGroup = {
                            date: dateKey,
                            dateLabel: formatDateLabel(msgDate),
                            messages: []
                        };
                        groups.push(currentGroup);
                    }

                    const prevMessage = currentGroup.messages[currentGroup.messages.length - 1];
                    const showAuthor = !prevMessage || prevMessage.userId !== msg.userId;

                    currentGroup.messages.push({
                        ...msg,
                        timeLabel: formatTime(msgDate),
                        showAuthor: showAuthor
                    });
                });

                return groups;
            },

            groupMessagesByUser: function (messages) {
                const userGroups = [];
                let currentUserGroup = null;

                messages.forEach(msg => {
                    // Start a new group if user changed or this is the first message
                    if (!currentUserGroup || currentUserGroup.userId !== msg.userId) {
                        currentUserGroup = {
                            userId: msg.userId,
                            userName: msg.userName,
                            messages: []
                        };
                        userGroups.push(currentUserGroup);
                    }

                    // Add message to current user's group
                    currentUserGroup.messages.push(msg);
                });

                return userGroups;
            },

            getVisibleSheets(player) {
                return player.sheets.filter(sheet =>
                    this.$store.room.isSheetVisible(sheet, player.id)
                );
            },

            getVisibleFolders: function (player) {
                if (!player.folders) return [];

                if (this.$store.room.isGamemaster) return player.folders;

                if (player.id === this.$store.room.currentUser.id) return player.folders;

                return player.folders.filter(folder => folder.visibility !== 'hide_from_players');
            },

            init: function () {
                document.body.classList.add('no-transitions');
                this.$nextTick(() => {
                    setTimeout(() => {
                        document.body.classList.remove('no-transitions');
                    }, 100);
                });

                this.$store.room.initUI();

                // Extract available commands
                const commandEls = document.querySelectorAll('.ssr-command');
                this.availableCommands = Array.from(commandEls).map(el => ({
                    command: el.dataset.command,
                    description: el.dataset.description,
                    detailedDescription: el.dataset.detailedDescription,
                }));

                // Set up IntersectionObserver for chat auto-scroll
                this.setupChatBottomObserver();

                // Listen for new messages to conditionally scroll
                document.addEventListener('chat:newMessage', () => {
                    // Wait for Alpine to render the new message, then scroll if needed
                    this.$nextTick(() => {
                        if (this._justSentMessage) {
                            this._justSentMessage = false;
                            this.scrollChatToBottom();
                            this.clearNewMessagesIndicator();
                        } else if (this.isChatBottomVisible) {
                            this.scrollChatToBottom();
                            this.clearNewMessagesIndicator();
                        } else {
                            // User is not at bottom - increment unread count
                            this.unreadMessageCount++;
                            this.showNewMessagesButton = true;
                        }
                    });
                });

                this.initialScrollSetup();

                this.loadChatHistory();

                this.loadDiceSettings();
                this.setupDiceListeners();

                this.loadCollapseStates();
                this.$nextTick(() => {
                    this.initializeSortable();
                    this.lastFolderCount = this.$store.room.currentUser.folders.length;
                });
                // Watch for folder count changes (creation/deletion only)
                this.$watch('$store.room.currentUser.folders.length', (newCount) => {
                    if (newCount !== this.lastFolderCount) {
                        this.lastFolderCount = newCount;
                        this.$nextTick(() => {
                            this.initializeSortable();
                        });
                    }
                });
            },

            // Initialize all Sortable instances
            initializeSortable: function () {
                // Clean up existing instances
                this.sortableInstances.forEach(instance => instance.destroy());
                this.sortableInstances = [];

                const currentUserId = this.$store.room.currentUser.id;

                // 1. Initialize folder sorting
                const foldersContainer = document.querySelector(`[data-user-id="${currentUserId}"] .sortable-folders`);
                if (foldersContainer) {
                    const folderSortable = new Sortable(foldersContainer, {
                        animation: 150,
                        handle: '.folder-drag-handle',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag',
                        onEnd: () => {
                            this.handleFolderReorder();
                        }
                    });
                    this.sortableInstances.push(folderSortable);
                }

                // 2. Initialize sheet sorting within default area 
                const defaultArea = document.querySelector(`[data-user-id="${currentUserId}"] .default-area.sortable-sheets`);
                if (defaultArea) {
                    const defaultSortable = new Sortable(defaultArea, {
                        group: 'sheets',
                        animation: 150,
                        handle: '.sheet-drag-handle',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag',
                        onAdd: (evt) => {
                            const sheetId = parseInt(evt.item.dataset.sheetId, 10);
                            this.moveSheetToFolder(sheetId, null);
                        }
                    });
                    this.sortableInstances.push(defaultSortable);
                }

                // 3. Initialize sheet sorting within folders
                const folderSheetContainers = document.querySelectorAll(`[data-user-id="${currentUserId}"] .folder-sheets.sortable-sheets`);
                folderSheetContainers.forEach(container => {
                    const folderId = parseInt(container.dataset.folderId, 10);
                    const folderSortable = new Sortable(container, {
                        group: 'sheets',
                        animation: 150,
                        handle: '.sheet-drag-handle',
                        ghostClass: 'sortable-ghost',
                        chosenClass: 'sortable-chosen',
                        dragClass: 'sortable-drag',
                        onAdd: (evt) => {
                            const sheetId = parseInt(evt.item.dataset.sheetId, 10);
                            this.moveSheetToFolder(sheetId, folderId);
                        }
                    });
                    this.sortableInstances.push(folderSortable);
                });
            },

            // Collapse state management
            loadCollapseStates: function () {
                const roomId = this.$store.room.roomId;

                // Load folder collapse states (default: collapsed)
                this.$store.room.allPlayers.forEach(player => {
                    if (player.folders) {
                        player.folders.forEach(folder => {
                            const key = `folder_collapsed_${roomId}_${folder.id}`;
                            const stored = localStorage.getItem(key);
                            this.collapsedFolders[folder.id] = stored !== null ? stored === 'true' : true;
                        });
                    }
                });

                // Load player collapse states (default: expanded)
                this.$store.room.allPlayers.forEach(player => {
                    const key = `player_collapsed_${roomId}_${player.id}`;
                    const stored = localStorage.getItem(key);
                    this.collapsedPlayers[player.id] = stored !== null ? stored === 'true' : false;
                });
            },

            isFolderCollapsed: function (folderId) {
                return this.collapsedFolders[folderId] ?? true;
            },

            toggleFolderCollapse: function (folderId) {
                const roomId = this.$store.room.roomId;
                const currentState = this.collapsedFolders[folderId] ?? true;
                this.collapsedFolders[folderId] = !currentState;
                try {
                    const key = `folder_collapsed_${roomId}_${folderId}`;
                    localStorage.setItem(key, this.collapsedFolders[folderId].toString());
                } catch (e) {
                    console.error('Failed to save folder collapse state:', e);
                }
            },

            isPlayerCollapsed: function (playerId) {
                return this.collapsedPlayers[playerId] ?? false;
            },

            togglePlayerCollapse: function (playerId) {
                const roomId = this.$store.room.roomId;
                const currentState = this.collapsedPlayers[playerId] ?? false;
                this.collapsedPlayers[playerId] = !currentState;

                try {
                    const key = `player_collapsed_${roomId}_${playerId}`;
                    localStorage.setItem(key, this.collapsedPlayers[playerId].toString());
                } catch (e) {
                    console.error('Failed to save player collapse state:', e);
                }
            },

            getDefaultAreaSheets: function (player) {
                return player.sheets.filter(sheet =>
                    sheet.folderId === null && this.$store.room.isSheetVisible(sheet, player.id)
                );
            },

            getFolderSheets: function (player, folderId) {
                return player.sheets.filter(sheet =>
                    sheet.folderId === folderId && this.$store.room.isSheetVisible(sheet, player.id)
                );
            },

            createFolder: async function () {
                const name = prompt('Enter folder name:');
                if (!name || !name.trim()) return;

                const payload = {
                    type: 'createFolder',
                    eventID: crypto.randomUUID(),
                    name: name.trim(),
                    visibility: 'everyone_can_view'
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            debouncedUpdateFolderName: function (folderId, newName) {
                if (this.folderUpdateTimers[folderId]) {
                    clearTimeout(this.folderUpdateTimers[folderId]);
                }

                this.folderUpdateTimers[folderId] = setTimeout(() => {
                    this.updateFolder(folderId, newName);
                    delete this.folderUpdateTimers[folderId];
                }, 500);
            },

            updateFolder: function (folderId, newName) {
                const folder = this.$store.room.currentUser.folders.find(f => f.id === folderId);
                if (!folder) return;

                folder.name = newName;

                const payload = {
                    type: 'updateFolder',
                    eventID: crypto.randomUUID(),
                    folderId: folderId,
                    name: newName,
                    visibility: folder.visibility
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            changeFolderVisibility: function (folderId, newVisibility) {
                const folder = this.$store.room.currentUser.folders.find(f => f.id === folderId);
                if (!folder) return;

                folder.visibility = newVisibility;

                const payload = {
                    type: 'updateFolder',
                    eventID: crypto.randomUUID(),
                    folderId: folderId,
                    name: folder.name,
                    visibility: newVisibility
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            deleteFolder: async function (folderId, folderName) {
                const folder = this.$store.room.currentUser.folders.find(f => f.id === folderId);
                if (!folder) return;

                const sheetsInFolder = this.$store.room.currentUser.sheets.filter(s => s.folderId === folderId);

                let message = `Delete folder "${folderName}"?`;
                if (sheetsInFolder.length > 0) {
                    message = `Delete folder "${folderName}"?\n\n${sheetsInFolder.length} character sheet(s) will be moved to the default area.`;
                }

                const confirmed = await this.$store.room.confirm(message);
                if (!confirmed) return;

                const payload = {
                    type: 'deleteFolder',
                    eventID: crypto.randomUUID(),
                    folderId: folderId
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            handleFolderReorder: function () {
                const foldersContainer = document.querySelector(`[data-user-id="${this.$store.room.currentUser.id}"] .sortable-folders`);
                if (!foldersContainer) return;

                const folderElements = foldersContainer.querySelectorAll('.folder[data-folder-id]');
                const folderIds = Array.from(folderElements).map(el => parseInt(el.dataset.folderId, 10));

                if (folderIds.length === 0) return;

                const payload = {
                    type: 'reorderFolders',
                    eventID: crypto.randomUUID(),
                    folderIds: folderIds
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            moveSheetToFolder: function (sheetId, folderId) {
                const sheet = this.$store.room.currentUser.sheets.find(s => s.id === sheetId);
                if (!sheet) return;

                if (sheet.folderId === folderId) return;

                sheet.folderId = folderId;

                const payload = {
                    type: 'moveSheetToFolder',
                    eventID: crypto.randomUUID(),
                    sheetId: sheetId,
                    folderId: folderId
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },


            toggleRightPanel: function () {
                this.rightPanelVisible = !this.rightPanelVisible;

                try {
                    localStorage.setItem('rightPanelVisible', this.rightPanelVisible);
                } catch (e) {
                }
            },

            setupChatBottomObserver: function () {
                // Wait for chat bottom element to exist
                this.$nextTick(() => {
                    const chatBottom = this.$refs.chatBottom;
                    if (!chatBottom) return;

                    // Observer with 100px margin at bottom - triggers when within 100px of being visible
                    this.chatBottomObserver = new IntersectionObserver(
                        (entries) => {
                            this.isChatBottomVisible = entries[0].isIntersecting;

                            // If user scrolls back to bottom, clear the new messages indicator
                            if (this.isChatBottomVisible) {
                                this.clearNewMessagesIndicator();
                            }
                        },
                        {
                            root: document.querySelector('#chat .scroll-container'),
                            rootMargin: '0px 0px 100px 0px', // 100px buffer at bottom
                            threshold: 0
                        }
                    );

                    this.chatBottomObserver.observe(chatBottom);
                });
            },

            // Character actions
            createCharacter: function () {
                const msg = JSON.stringify({
                    type: 'newCharacter',
                    eventID: crypto.randomUUID(),
                });
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
            },

            deleteCharacter: async function (sheetId, charName) {
                const confirmed = await this.$store.room.confirm(`Delete ${charName}?`);
                if (!confirmed) return;

                const payload = {
                    type: 'deleteCharacter',
                    eventID: crypto.randomUUID(),
                    sheetID: String(sheetId)
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            changeSheetVisibility: function (sheetId, newVisibility) {
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

            exportCharacter: function (sheetId, charName) {
                // Create a temporary anchor element to trigger download
                const a = document.createElement('a');
                a.href = `/sheet/export/${sheetId}`;
                a.download = `character_${charName}_${sheetId}.json`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
            },

            openImportModal: function () {
                this.$store.room.modals.import = true;
                this.$nextTick(() => {
                    document.querySelector('#import-modal input[type="file"]')?.focus();
                });
            },

            submitImport: async function () {
                const form = this.$refs.importForm;
                const fileInput = form.querySelector('input[type="file"]');

                if (!fileInput.files || fileInput.files.length === 0) {
                    await this.$store.room.confirm('Please select a file to import');
                    return;
                }

                const formData = new FormData(form);

                try {
                    const response = await fetch('/sheet/import', {
                        method: 'POST',
                        body: formData
                    });

                    if (response.ok) {
                        this.closeModal()
                    } else {
                        await this.$store.room.confirm('Failed to import character sheet. Please check the file and try again.');
                    }
                } catch (err) {
                    console.error('Import error:', err);
                    await this.$store.room.confirm('An error occurred while importing the character sheet.');
                }
            },

            // Player actions
            kickPlayer: async function (userId, userName) {
                const confirmed = await this.$store.room.confirm(`Kick ${userName}?`);
                if (!confirmed) return;

                const payload = {
                    type: 'kickPlayer',
                    eventID: crypto.randomUUID(),
                    userID: userId
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            changePlayerRole: function (userId, newRole) {
                const payload = {
                    type: 'changePlayerRole',
                    eventID: crypto.randomUUID(),
                    userID: userId,
                    role: newRole
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            // Invite link actions
            openInviteModal: function () {
                this.$store.room.modals.invite = true;
                this.$nextTick(function () {
                    document.querySelector('#invite-link-modal button')?.focus();
                });
            },

            copyInviteLink: async function () {
                try {
                    await navigator.clipboard.writeText(this.$store.room.inviteLink);
                    this.inviteLinkCopied = true;
                    setTimeout(() => {
                        this.inviteLinkCopied = false;
                    }, 1400);
                } catch (err) {
                    console.error('Failed to copy:', err);
                }
            },

            createNewInviteLink: function () {
                let expiresInDays = this.newInvite.expiresInDays;
                if (this.newInvite.expiresInDays == "null") {
                    expiresInDays = null
                }
                let maxUses = this.newInvite.maxUses;
                if (this.newInvite.maxUses == 0) {
                    maxUses = null
                }

                const msg = JSON.stringify({
                    type: "newInviteLink",
                    eventID: crypto.randomUUID(),
                    expiresInDays: expiresInDays,
                    maxUses: maxUses
                });
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
            },

            // Chat actions
            sendChatMessage: function () {
                const messageBody = this.chatInput.trim();
                if (!messageBody) return;

                const payload = {
                    type: 'chatMessage',
                    eventID: crypto.randomUUID(),
                    messageBody: messageBody
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));

                // Add to history after successful send
                this.addToChatHistory(messageBody);

                // Clear input and reset history navigation
                this.chatInput = '';
                this.chatHistoryIndex = -1;
                this.chatHistoryDraft = '';

                // Flag that we just sent a message - we want to force scroll
                this._justSentMessage = true;
            },

            toggleMessageMenu: function (messageId) {
                if (this.messageMenuOpen === messageId) {
                    this.messageMenuOpen = null;
                } else {
                    this.messageMenuOpen = messageId;
                }
            },

            deleteMessage: async function (messageId) {
                const payload = {
                    type: 'deleteMessage',
                    eventID: crypto.randomUUID(),
                    messageId: messageId
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));

                this.messageMenuOpen = null;
            },

            loadMoreMessages: function () {
                if (!this.$store.room.chat.hasMore) return;

                const offset = this.$store.room.chat.loadedCount;

                const payload = {
                    type: 'chatHistory',
                    eventID: crypto.randomUUID(),
                    offset: offset,
                    limit: 50
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            initialScrollSetup: function () {
                const chatTab = document.getElementById('show-chat');
                const chatContainer = document.querySelector('#chat .scroll-container');

                if (!chatContainer) return;

                const isChatVisible = () => {
                    const chatPanel = document.getElementById('chat');
                    return chatPanel && chatPanel.offsetParent !== null;
                };

                const scrollWhenReady = () => {
                    // Wait for next tick to ensure rendering is complete
                    this.$nextTick(() => {
                        if (chatContainer.scrollHeight > 0) {
                            this.scrollChatToBottom();
                        }
                    });
                };

                // If chat is already visible
                if (isChatVisible()) {
                    scrollWhenReady();
                    return;
                }

                // Set up one-time listener for when chat becomes visible
                let hasScrolled = false;
                const handleTabChange = () => {
                    if (!hasScrolled && isChatVisible()) {
                        hasScrolled = true;
                        scrollWhenReady();
                        // Clean up listener
                        chatTab?.removeEventListener('change', handleTabChange);
                    }
                };

                // Listen for chat tab selection
                chatTab?.addEventListener('change', handleTabChange);
            },

            // Scroll to bottom
            scrollChatToBottom: function () {
                const container = document.querySelector('#chat .scroll-container');
                if (!container) return;

                // Immediate scroll
                container.scrollTop = container.scrollHeight;

                // Retry with requestAnimationFrame for better reliability when throttled
                requestAnimationFrame(() => {
                    container.scrollTop = container.scrollHeight;
                });
            },

            scrollToNewMessages: function () {
                this.scrollChatToBottom();
                this.clearNewMessagesIndicator();
            },

            clearNewMessagesIndicator: function () {
                this.unreadMessageCount = 0;
                this.showNewMessagesButton = false;
            },

            // chat history message iteration
            getChatHistoryKey: function () {
                return `chat_history_room_${this.$store.room.roomId}`;
            },

            loadChatHistory: function () {
                try {
                    const key = this.getChatHistoryKey();
                    const stored = sessionStorage.getItem(key);
                    return stored ? JSON.parse(stored) : [];
                } catch (err) {
                    console.error('Failed to load chat history:', err);
                    return [];
                }
            },

            // Save chat history to sessionStorage
            saveChatHistory: function (history) {
                try {
                    const key = this.getChatHistoryKey();
                    sessionStorage.setItem(key, JSON.stringify(history));
                } catch (err) {
                    console.error('Failed to save chat history:', err);
                }
            },

            // Add message to history (called after successful send)
            addToChatHistory: function (message) {
                const trimmed = message.trim();
                if (!trimmed) return;

                let history = this.loadChatHistory();

                // Don't add if it's the same as the last message
                if (history.length > 0 && history[history.length - 1] === trimmed) {
                    return;
                }

                history.push(trimmed);

                // Keep only last 50 messages
                if (history.length > 50) {
                    history = history.slice(-50);
                }

                this.saveChatHistory(history);
            },

            // Check if arrow up would scroll (cursor on first line)
            wouldScrollUp: function (textarea) {
                const cursorPos = textarea.selectionStart;
                const textBeforeCursor = textarea.value.substring(0, cursorPos);
                const lines = textBeforeCursor.split('\n');

                // If we're on the first line, arrow up won't scroll
                return lines.length === 1;
            },

            // Check if arrow down would scroll (cursor on last line)
            wouldScrollDown: function (textarea) {
                const cursorPos = textarea.selectionStart;
                const textAfterCursor = textarea.value.substring(cursorPos);

                // If there are no newlines after cursor, we're on the last line
                return !textAfterCursor.includes('\n');
            },

            // Handle keyboard navigation in chat input
            handleChatKeydown: function (event) {
                const textarea = event.target;

                // Handle Enter key first
                if (event.key === 'Enter') {
                    if (!event.shiftKey) {
                        // Regular Enter - send message
                        event.preventDefault();
                        this.sendChatMessage();
                        return;
                    } else {
                        const start = textarea.selectionStart;
                        const end = textarea.selectionEnd;
                        const value = this.chatInput;

                        // Insert newline at cursor position
                        this.chatInput = value.substring(0, start) + '\n' + value.substring(end);

                        // Move cursor after the newline
                        this.$nextTick(() => {
                            textarea.setSelectionRange(start + 1, start + 1);
                        });
                        return;
                    }
                }

                // Rest of the function for arrow keys...
                const history = this.loadChatHistory();
                if (history.length === 0) return;

                // Arrow Up - navigate to previous message
                if (event.key === 'ArrowUp' && this.wouldScrollUp(textarea)) {
                    event.preventDefault();

                    // Save current draft on first navigation
                    if (this.chatHistoryIndex === -1) {
                        this.chatHistoryDraft = this.chatInput;
                    }

                    // Move to previous message
                    if (this.chatHistoryIndex < history.length - 1) {
                        this.chatHistoryIndex++;
                        const previousMessage = history[history.length - 1 - this.chatHistoryIndex];

                        this.chatInput = previousMessage;

                        // Place cursor at same column on last line of previous message
                        this.$nextTick(() => {
                            textarea.setSelectionRange(0, 0);
                        });
                    }
                }

                // Arrow Down - navigate to next message
                else if (event.key === 'ArrowDown' && this.wouldScrollDown(textarea)) {
                    event.preventDefault();

                    if (this.chatHistoryIndex > 0) {
                        // Move to next message
                        this.chatHistoryIndex--;
                        const nextMessage = history[history.length - 1 - this.chatHistoryIndex];
                        this.chatInput = nextMessage;

                        // Place cursor at the end
                        this.$nextTick(() => {
                            const endPos = nextMessage.length;
                            textarea.setSelectionRange(endPos, endPos);
                        });
                    } else if (this.chatHistoryIndex === 0) {
                        // Restore draft
                        this.chatHistoryIndex = -1;
                        const draft = this.chatHistoryDraft;
                        this.chatInput = draft;
                        this.chatHistoryDraft = '';

                        // Place cursor at the end
                        this.$nextTick(() => {
                            const endPos = draft.length;
                            textarea.setSelectionRange(endPos, endPos);
                        });
                    }
                }
            },


            // Reset history navigation when user types
            handleChatInput: function (event) {
                // If user is navigating history and starts typing actual content, reset
                // But check that it's actual content change, not just a key being processed
                if (this.chatHistoryIndex !== -1 && this.chatInput !== '') {
                    this.chatHistoryIndex = -1;
                    this.chatHistoryDraft = '';
                }
            },

            // Commands popover
            toggleCommandsPopover: function () {
                this.showCommandsPopover = !this.showCommandsPopover;
            },

            insertCommand: function (command) {
                this.chatInput = command + ' ';
                this.showCommandsPopover = false;
                // Focus textarea
                this.$nextTick(() => {
                    this.$refs.chatTextarea?.focus();
                });
            },

            // Modal actions
            closeModal: function () {
                if (this.$store.room.modals.confirm) {
                    this.confirmCancel();
                    return;
                }

                this.$store.room.modals.invite = false;
                this.$store.room.modals.import = false;
            },

            confirmCancel: function () {
                this.$store.room.resolveConfirm(false);
            },

            confirmOk: function () {
                this.$store.room.resolveConfirm(true);
            },

            closeKickedModal: function () {
                this.$store.room.modals.kicked = false;
                const origin = window.location.origin;
                window.location.href = `${origin}/account/rooms`;
            },

            reloadPage: function () {
                window.location.reload();
            },

            closeModalOnOverlay: function (e) {
                if (e.target.id === 'overlay') {
                    if (this.$store.room.modals.kicked) {
                        this.closeKickedModal();
                    } else if (this.$store.room.modals.connectionLost) {
                        window.location.reload();
                    } else if (this.$store.room.modals.confirm) {
                        this.$store.room.resolveConfirm(false);
                    } else {
                        this.closeModal();
                    }
                }
            },

            setupDiceListeners: function () {
                document.addEventListener('ws:dicePresetUpdated', (e) => {
                    const { slotNumber, diceNotation } = e.detail;
                    if (slotNumber >= 1 && slotNumber <= 5) {
                        this.customDice[slotNumber - 1] = diceNotation;
                    }
                });
            },

            loadDiceSettings: function () {
                try {
                    const key = `dice_amount_room_${this.$store.room.roomId}`;
                    const stored = localStorage.getItem(key);
                    if (stored) {
                        const amount = parseInt(stored, 10);
                        if (amount >= 1 && amount <= 5) {
                            this.diceAmount = amount;
                        }
                    }
                } catch (err) {
                    console.error('Failed to load dice amount:', err);
                }

                try {
                    const modKey = `dice_modifier_room_${this.$store.room.roomId}`;
                    const storedMod = localStorage.getItem(modKey);
                    if (storedMod) {
                        const modifier = parseInt(storedMod, 10);
                        if (modifier >= -60 && modifier <= 60) {
                            this.diceModifier = modifier;
                        }
                    }
                } catch (err) {
                    console.error('Failed to load dice modifier:', err);
                }

                try {
                    for (let i = 0; i < 4; i++) {
                        const key = `dice_roll_against_${i}_room_${this.$store.room.roomId}`;
                        const stored = localStorage.getItem(key);
                        if (stored) {
                            this.rollAgainstInputs[i] = stored;
                        }
                    }
                } catch (err) {
                    console.error('Failed to load roll against inputs:', err);
                }

                try {
                    const selKey = `dice_roll_against_selected_room_${this.$store.room.roomId}`;
                    const storedSel = localStorage.getItem(selKey);
                    if (storedSel !== null) {
                        const index = parseInt(storedSel, 10);
                        if (index >= 0 && index <= 3) {
                            this.selectedRollAgainst = index;
                        }
                    }
                } catch (err) {
                    console.error('Failed to load roll against selection:', err);
                }

                const presetEls = document.querySelectorAll('.ssr-dice-preset');
                presetEls.forEach(el => {
                    const slot = parseInt(el.dataset.slot, 10);
                    const notation = el.dataset.notation;
                    if (slot >= 1 && slot <= 5 && notation) {
                        this.customDice[slot - 1] = notation;
                    }
                });
            },

            updateDiceAmount: function (amount) {
                this.diceAmount = amount;

                try {
                    const key = `dice_amount_room_${this.$store.room.roomId}`;
                    localStorage.setItem(key, amount.toString());
                } catch (err) {
                    console.error('Failed to save dice amount:', err);
                }
            },

            updateDiceModifier: function (modifier) {
                this.diceModifier = modifier;

                try {
                    const key = `dice_modifier_room_${this.$store.room.roomId}`;
                    localStorage.setItem(key, modifier.toString());
                } catch (err) {
                    console.error('Failed to save dice modifier:', err);
                }
            },

            toggleRollAgainst: function (index) {
                if (this.selectedRollAgainst === index) {
                    this.selectedRollAgainst = null;
                } else {
                    this.selectedRollAgainst = index;
                }

                try {
                    const key = `dice_roll_against_selected_room_${this.$store.room.roomId}`;
                    if (this.selectedRollAgainst === null) {
                        localStorage.removeItem(key);
                    } else {
                        localStorage.setItem(key, this.selectedRollAgainst.toString());
                    }
                } catch (err) {
                    console.error('Failed to save roll against selection:', err);
                }
            },

            updateRollAgainstInput: function (index, value) {
                this.rollAgainstInputs[index] = value;

                // Save to localStorage
                try {
                    const key = `dice_roll_against_${index}_room_${this.$store.room.roomId}`;
                    if (value.trim()) {
                        localStorage.setItem(key, value.trim());
                    } else {
                        localStorage.removeItem(key);
                    }
                } catch (err) {
                    console.error('Failed to save roll against input:', err);
                }
            },

            getActiveRollAgainst: function () {
                if (this.selectedRollAgainst === null) {
                    return null;
                }

                const value = this.rollAgainstInputs[this.selectedRollAgainst];
                if (!value || !value.trim()) {
                    return null;
                }

                const parsed = parseInt(value.trim(), 10);
                if (isNaN(parsed) || parsed < 1) {
                    return null;
                }

                return parsed;
            },

            toggleDiceRoller: function () {
                this.showDiceRoller = !this.showDiceRoller;
            },

            closeDiceRoller: function () {
                if (this.showDiceRoller) {
                    this.showDiceRoller = false;
                }
            },

            rollStandardDice: function (sides) {
                let command = `/r ${this.diceAmount}d${sides}`;

                const vsValue = this.getActiveRollAgainst();
                if (vsValue !== null) {
                    // Add modifier to the target value instead of the roll
                    const adjustedTarget = vsValue + this.diceModifier;
                    command += ` vs ${adjustedTarget}`;
                } else {
                    // No versus roll, add modifier to the dice roll itself
                    if (this.diceModifier !== 0) {
                        const sign = this.diceModifier > 0 ? '+' : '';
                        command += `${sign}${this.diceModifier}`;
                    }
                }

                this.chatInput = command;

                // Focus chat input and send
                this.$nextTick(() => {
                    this.$refs.chatTextarea?.focus();
                    this.sendChatMessage();
                });
            },

            rollCustomDice: function (index) {
                const notation = this.customDice[index]?.trim();
                if (!notation) return;

                // Prepend /r if not already there
                const command = notation.startsWith('/r') ? notation : `/r ${notation}`;
                this.chatInput = command;

                // Focus chat input and send
                this.$nextTick(() => {
                    this.$refs.chatTextarea?.focus();
                    this.sendChatMessage();
                });
            },

            isCustomDiceEmpty: function (index) {
                return !this.customDice[index] || !this.customDice[index].trim();
            },

            updateCustomDice: function (index, value) {
                this.customDice[index] = value;

                if (this.dicePresetDebounceTimers[index]) {
                    clearTimeout(this.dicePresetDebounceTimers[index]);
                }

                this.dicePresetDebounceTimers[index] = setTimeout(() => {
                    this.sendDicePresetUpdate(index + 1, value);
                    delete this.dicePresetDebounceTimers[index];
                }, 500);
            },

            sendDicePresetUpdate: function (slotNumber, notation) {
                const payload = {
                    type: 'updateDicePreset',
                    eventID: crypto.randomUUID(),
                    slotNumber: slotNumber,
                    diceNotation: notation.trim()
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },
        };
    });
});

function humanDate(date) {
    if (!date || isNaN(new Date(date).getTime())) {
        return '';
    }

    const t = new Date(date);

    function formatWithTZ(timeZone) {
        const options = {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
            timeZone
        };
        const parts = new Intl.DateTimeFormat(undefined, options).formatToParts(t);
        const get = type => parts.find(p => p.type === type)?.value ?? '';
        return `${get('day')} ${get('month')} ${get('year')} at ${get('hour')}:${get('minute')}`;
    }

    try {
        // Try user's local timezone first
        return formatWithTZ(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } catch {
        // Fallback to UTC
        return formatWithTZ('UTC');
    }
}

function formatDateLabel(date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const dateStr = date.toDateString();
    const todayStr = today.toDateString();
    const yesterdayStr = yesterday.toDateString();

    if (dateStr === todayStr) return 'Today';
    if (dateStr === yesterdayStr) return 'Yesterday';

    const options = { month: 'long', day: 'numeric' };
    return date.toLocaleDateString(undefined, options);
}

function formatTime(date) {
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${hours}:${minutes}:${seconds}`;
}

// Flash message auto-hide
document.addEventListener('DOMContentLoaded', function () {
    const flashMessage = document.getElementById('flash-message');
    if (flashMessage) {
        setTimeout(function () {
            flashMessage.classList.add('hidden');
        }, 5000);
    }
});