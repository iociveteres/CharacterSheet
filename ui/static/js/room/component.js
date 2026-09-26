import Alpine from '@alpinejs/csp';
import './socket.js';
import { createRoomStore } from './store.js';
import { chatMixin } from './chat.js';
import { diceMixin } from './dice.js';
import { foldersMixin } from './folders.js';
import { playersMixin } from './players.js';

// Registers the room with Alpine; room/main.ts starts Alpine after it.
/** @param {import('./payload.gen').RoomPayload} payload */
export function registerRoom(payload) {
    const store = createRoomStore();
    store.readRoomState(payload);
    Alpine.store('room', store);

    Alpine.data('roomComponent', function () {
        return {
            ...chatMixin,
            ...diceMixin,
            ...foldersMixin,
            ...playersMixin,

            rightPanelVisible: true,

            init() {
                // Disable transitions during initial load
                document.body.classList.add('no-transitions');
                this.$nextTick(() => {
                    setTimeout(() => {
                        document.body.classList.remove('no-transitions');
                    }, 100);
                });

                try {
                    this.rightPanelVisible = localStorage.getItem('rightPanelVisible') !== 'false';
                } catch {
                    // storage can be unavailable
                }

                this.$store.room.setupNetworkListeners();

                this.initSheetKind();

                this.availableCommands = this.$store.room.commands;

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
}
