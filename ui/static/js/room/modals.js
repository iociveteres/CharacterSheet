export const modalsMixin = {
    // State
    inviteLinkCopied: false,
    newInvite: {
        expiresInDays: null,
        maxUses: null
    },

    // Methods
    closeModal() {
        if (this.$store.room.modals.confirm) {
            this.confirmCancel();
            return;
        }

        this.$store.room.modals.invite = false;
        this.$store.room.modals.import = false;
    },

    confirmCancel() {
        this.$store.room.resolveConfirm(false);
    },

    confirmOk() {
        this.$store.room.resolveConfirm(true);
    },

    closeKickedModal() {
        this.$store.room.modals.kicked = false;
        const origin = window.location.origin;
        window.location.href = `${origin}/account/rooms`;
    },

    reloadPage() {
        window.location.reload();
    },

    closeModalOnOverlay(e) {
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
    }
};