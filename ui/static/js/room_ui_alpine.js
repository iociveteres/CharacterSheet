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
            sheets: []
        },
        otherPlayers: [],
        inviteLink: '',
        isElevated: false,
        isGamemaster: false,
        modals: {
            invite: false,
            kicked: false,
            connectionLost: false
        },

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

        // Initialize from SSR data
        // If you name just "init", it will be called twice
        initUI() {
            this.extractSSRData();
            this.setupNetworkListeners();
        },

        extractSSRData() {
            // Extract current user
            const currentUserEl = document.getElementById('ssr-current-user');
            if (currentUserEl) {
                this.currentUser.id = parseInt(currentUserEl.dataset.userId, 10);
                this.currentUser.name = currentUserEl.dataset.userName;
                this.currentUser.role = currentUserEl.dataset.userRole;
                this.currentUser.joinedAt = currentUserEl.dataset.joinedAt;

                // Extract current user's sheets
                const sheetEls = currentUserEl.querySelectorAll('.ssr-sheet');
                this.currentUser.sheets = Array.from(sheetEls).map(el => ({
                    id: parseInt(el.dataset.sheetId, 10),
                    name: el.dataset.name,
                    created: el.dataset.created,
                    updated: el.dataset.updated
                }));
            }

            // Extract other players
            const playerEls = document.querySelectorAll('.ssr-player');
            this.otherPlayers = Array.from(playerEls).map(playerEl => {
                const sheetEls = playerEl.querySelectorAll('.ssr-sheet');
                return {
                    id: parseInt(playerEl.dataset.userId, 10),
                    name: playerEl.dataset.userName,
                    role: playerEl.dataset.userRole,
                    joinedAt: playerEl.dataset.joinedAt,
                    sheets: Array.from(sheetEls).map(el => ({
                        id: parseInt(el.dataset.sheetId, 10),
                        name: el.dataset.name,
                        created: el.dataset.created,
                        updated: el.dataset.updated
                    }))
                };
            });

            // Extract invite link
            const inviteLinkEl = document.getElementById('ssr-invite-link');
            if (inviteLinkEl) {
                this.inviteLink = inviteLinkEl.dataset.link;
            }
        },

        setupNetworkListeners() {
            // WebSocket events
            document.addEventListener('ws:newCharacterItem', (e) => this.handleNewCharacter(e.detail));
            document.addEventListener('ws:deleteCharacter', (e) => this.handleDeleteCharacter(e.detail));
            document.addEventListener('ws:nameChanged', (e) => this.handleNameChanged(e.detail));
            document.addEventListener('ws:newPlayer', (e) => this.handleNewPlayer(e.detail));
            document.addEventListener('ws:kickPlayer', (e) => this.handleKickPlayer(e.detail));
            document.addEventListener('ws:changePlayerRole', (e) => this.handleChangePlayerRole(e.detail));
            document.addEventListener('ws:newInviteLink', (e) => this.handleNewInviteLink(e.detail));
            window.addEventListener('ws:connectionLost', () => this.handleConnectionLost());

            // Local character sheet changes (from current user's edits)
            document.addEventListener('sheet:nameChanged', (e) => this.handleNameChanged(e.detail));
        },

        // Character handlers
        handleNewCharacter(msg) {
            const sheetId = parseInt(msg.sheetID, 10);
            const userId = parseInt(msg.userID, 10);

            const sheet = {
                id: sheetId,
                name: msg.name || 'Unnamed character',
                created: msg.created,
                updated: msg.updated
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
        }
    });

    // Component for room UI interactions
    Alpine.data('roomComponent', function () {
        return {
            // Local component state (not shared)
            inviteLinkCopied: false,
            newInvite: {
                expiresInDays: null,
                maxUses: null
            },

            init: function () {
                this.$store.room.initUI();
            },

            // Character actions
            createCharacter: function () {
                const msg = JSON.stringify({
                    type: 'newCharacter',
                    eventID: crypto.randomUUID(),
                });
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
            },

            deleteCharacter: function (sheetId, charName) {
                if (!confirm(`Delete ${charName}?`)) return;

                const payload = {
                    type: 'deleteCharacter',
                    eventID: crypto.randomUUID(),
                    sheetID: String(sheetId)
                };
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));
            },

            // Player actions
            kickPlayer: function (userId, userName) {
                if (!confirm(`Kick ${userName}?`)) return;

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
                const msg = JSON.stringify({
                    type: "newInviteLink",
                    eventID: crypto.randomUUID(),
                    expiresInDays: this.newInvite.expiresInDays,
                    maxUses: this.newInvite.maxUses
                });
                document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
            },

            // Modal actions
            closeModal: function () {
                this.$store.room.modals.invite = false;
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
                    } else {
                        this.closeModal();
                    }
                }
            }
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