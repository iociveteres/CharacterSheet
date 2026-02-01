export const foldersMixin = {
    // State
    collapsedFolders: {},
    collapsedPlayers: {},
    folderUpdateTimers: {},
    sortableInstances: [],
    lastFolderCount: 0,

    // Methods
    getVisibleSheets(player) {
        return player.sheets.filter(sheet =>
            this.$store.room.isSheetVisible(sheet, player.id)
        );
    },

    getVisibleFolders(player) {
        if (!player.folders) return [];

        if (this.$store.room.isGamemaster) return player.folders;

        if (player.id === this.$store.room.currentUser.id) return player.folders;

        return player.folders.filter(folder => folder.visibility !== 'hide_from_players');
    },

    initializeSortable() {
        this.sortableInstances.forEach(instance => instance.destroy());
        this.sortableInstances = [];

        const currentUserId = this.$store.room.currentUser.id;

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

    loadCollapseStates() {
        const roomId = this.$store.room.roomId;

        this.$store.room.allPlayers.forEach(player => {
            if (player.folders) {
                player.folders.forEach(folder => {
                    const key = `folder_collapsed_${roomId}_${folder.id}`;
                    const stored = localStorage.getItem(key);
                    this.collapsedFolders[folder.id] = stored !== null ? stored === 'true' : true;
                });
            }
        });

        this.$store.room.allPlayers.forEach(player => {
            const key = `player_collapsed_${roomId}_${player.id}`;
            const stored = localStorage.getItem(key);
            this.collapsedPlayers[player.id] = stored !== null ? stored === 'true' : false;
        });
    },

    isFolderCollapsed(folderId) {
        return this.collapsedFolders[folderId] ?? true;
    },

    toggleFolderCollapse(folderId) {
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

    isPlayerCollapsed(playerId) {
        return this.collapsedPlayers[playerId] ?? false;
    },

    togglePlayerCollapse(playerId) {
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

    getDefaultAreaSheets(player) {
        return player.sheets.filter(sheet =>
            sheet.folderId === null && this.$store.room.isSheetVisible(sheet, player.id)
        );
    },

    getFolderSheets(player, folderId) {
        return player.sheets.filter(sheet =>
            sheet.folderId === folderId && this.$store.room.isSheetVisible(sheet, player.id)
        );
    },

    createFolder() {
        const payload = {
            type: 'createFolder',
            eventID: crypto.randomUUID(),
            name: "New Folder",
            visibility: 'everyone_can_view'
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
    },

    debouncedUpdateFolderName(folderId, newName) {
        if (this.folderUpdateTimers[folderId]) {
            clearTimeout(this.folderUpdateTimers[folderId]);
        }

        this.folderUpdateTimers[folderId] = setTimeout(() => {
            this.updateFolder(folderId, newName);
            delete this.folderUpdateTimers[folderId];
        }, 500);
    },

    updateFolder(folderId, newName) {
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

    changeFolderVisibility(folderId, newVisibility) {
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

    async deleteFolder(folderId, folderName) {
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

    handleFolderReorder() {
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

    moveSheetToFolder(sheetId, folderId) {
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

    toggleRightPanel() {
        this.rightPanelVisible = !this.rightPanelVisible;

        try {
            localStorage.setItem('rightPanelVisible', this.rightPanelVisible);
        } catch (e) {
        }
    }
};