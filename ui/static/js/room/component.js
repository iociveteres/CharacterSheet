import { createRoomStore } from './store.js';
import { chatMixin } from './chat.js';
import { diceMixin } from './dice.js';
import { foldersMixin } from './folders.js';
import { playersMixin } from './players.js';
import { modalsMixin } from './modals.js';

document.addEventListener('alpine:init', () => {
    Alpine.store('room', createRoomStore());

    Alpine.data('roomComponent', function () {
        return {
            ...chatMixin,
            ...diceMixin,
            ...foldersMixin,
            ...playersMixin,
            ...modalsMixin,

            rightPanelVisible: true,

            init() {
                // Disable transitions during initial load
                document.body.classList.add('no-transitions');
                this.$nextTick(() => {
                    setTimeout(() => {
                        document.body.classList.remove('no-transitions');
                    }, 100);
                });

                this.$store.room.initUI();

                const commandEls = document.querySelectorAll('.ssr-command');
                this.availableCommands = Array.from(commandEls).map(el => ({
                    command: el.dataset.command,
                    description: el.dataset.description,
                    detailedDescription: el.dataset.detailedDescription,
                }));

                // Chat setup
                this.setupChatBottomObserver();
                document.addEventListener('chat:newMessage', () => {
                    this.$nextTick(() => {
                        if (this._justSentMessage) {
                            this._justSentMessage = false;
                            this.scrollChatToBottom();
                            this.clearNewMessagesIndicator();
                        } else if (this.isChatBottomVisible) {
                            this.scrollChatToBottom();
                            this.clearNewMessagesIndicator();
                        } else {
                            this.unreadMessageCount++;
                            this.showNewMessagesButton = true;
                        }
                    });
                });
                this.initialScrollSetup();
                this.loadChatHistory();

                // Dice setup
                this.loadDiceSettings();
                this.setupDiceListeners();

                // Folder setup
                this.loadCollapseStates();
                this.$nextTick(() => {
                    this.initializeSortable();
                    this.lastFolderCount = this.$store.room.currentUser.folders.length;
                });

                // Watch for folder count changes (creation/deletion)
                this.$watch('$store.room.currentUser.folders.length', (newCount) => {
                    if (newCount !== this.lastFolderCount) {
                        this.lastFolderCount = newCount;
                        this.$nextTick(() => {
                            this.initializeSortable();
                        });
                    }
                });
            }
        };
    });
});
