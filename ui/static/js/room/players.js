export const playersMixin = {
    // Methods
    createCharacter() {
        const msg = JSON.stringify({
            type: 'newCharacter',
            eventID: crypto.randomUUID(),
        });
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
    },

    async deleteCharacter(sheetId, charName) {
        const confirmed = await this.$store.room.confirm(`Delete ${charName}?`);
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

    openImportModal() {
        this.$store.room.modals.import = true;
        this.$nextTick(() => {
            document.querySelector('#import-modal input[type="file"]')?.focus();
        });
    },

    async submitImport() {
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
                this.closeModal();
            } else {
                await this.$store.room.confirm('Failed to import character sheet. Please check the file and try again.');
            }
        } catch (err) {
            console.error('Import error:', err);
            await this.$store.room.confirm('An error occurred while importing the character sheet.');
        }
    },

    async kickPlayer(userId, userName) {
        const confirmed = await this.$store.room.confirm(`Kick ${userName}?`);
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

    openInviteModal() {
        this.$store.room.modals.invite = true;
        this.$nextTick(() => {
            document.querySelector('#invite-link-modal button')?.focus();
        });
    },

    async copyInviteLink() {
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

    createNewInviteLink() {
        let expiresInDays = this.newInvite.expiresInDays;
        if (this.newInvite.expiresInDays == "null") {
            expiresInDays = null;
        }
        let maxUses = this.newInvite.maxUses;
        if (this.newInvite.maxUses == 0) {
            maxUses = null;
        }

        const msg = JSON.stringify({
            type: "newInviteLink",
            eventID: crypto.randomUUID(),
            expiresInDays: expiresInDays,
            maxUses: maxUses
        });
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: msg }));
    }
};