import { formatDateLabel, formatTime } from './time_format.js';

export const chatMixin = {
    // State
    chatInput: '',
    availableCommands: [],
    showCommandsPopover: false,
    messageMenuOpen: null,
    chatHistoryIndex: -1,
    chatHistoryDraft: '',
    isChatBottomVisible: true,
    chatBottomObserver: null,
    unreadMessageCount: 0,
    showNewMessagesButton: false,

    // Methods
    getChatGroupedMessages() {
        const groups = [];
        let currentGroup = null;

        this.$store.room.chat.messages.forEach((msg) => {
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

    groupMessagesByUser(messages) {
        const userGroups = [];
        let currentUserGroup = null;

        messages.forEach(msg => {
            if (!currentUserGroup || currentUserGroup.userId !== msg.userId) {
                currentUserGroup = {
                    userId: msg.userId,
                    userName: msg.userName,
                    messages: []
                };
                userGroups.push(currentUserGroup);
            }

            currentUserGroup.messages.push(msg);
        });

        return userGroups;
    },

    setupChatBottomObserver() {
        this.$nextTick(() => {
            const chatBottom = this.$refs.chatBottom;
            if (!chatBottom) return;

            this.chatBottomObserver = new IntersectionObserver(
                (entries) => {
                    this.isChatBottomVisible = entries[0].isIntersecting;

                    if (this.isChatBottomVisible) {
                        this.clearNewMessagesIndicator();
                    }
                },
                {
                    root: document.querySelector('#chat .scroll-container'),
                    rootMargin: '0px 0px 100px 0px',
                    threshold: 0
                }
            );

            this.chatBottomObserver.observe(chatBottom);
        });
    },

    sendChatMessage() {
        const messageBody = this.chatInput.trim();
        if (!messageBody) return;

        const payload = {
            type: 'chatMessage',
            eventID: crypto.randomUUID(),
            messageBody: messageBody
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));

        this.addToChatHistory(messageBody);

        this.chatInput = '';
        this.chatHistoryIndex = -1;
        this.chatHistoryDraft = '';

        this._justSentMessage = true;
    },

    toggleMessageMenu(messageId) {
        if (this.messageMenuOpen === messageId) {
            this.messageMenuOpen = null;
        } else {
            this.messageMenuOpen = messageId;
        }
    },

    deleteMessage(messageId) {
        const payload = {
            type: 'deleteMessage',
            eventID: crypto.randomUUID(),
            messageId: messageId
        };
        document.dispatchEvent(new CustomEvent('room:sendMessage', { detail: JSON.stringify(payload) }));

        this.messageMenuOpen = null;
    },

    loadMoreMessages() {
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

    initialScrollSetup() {
        const chatTab = document.getElementById('show-chat');
        const chatContainer = document.querySelector('#chat .scroll-container');

        if (!chatContainer) return;

        const isChatVisible = () => {
            const chatPanel = document.getElementById('chat');
            return chatPanel && chatPanel.offsetParent !== null;
        };

        const scrollWhenReady = () => {
            this.$nextTick(() => {
                if (chatContainer.scrollHeight > 0) {
                    this.scrollChatToBottom();
                }
            });
        };

        if (isChatVisible()) {
            scrollWhenReady();
            return;
        }

        let hasScrolled = false;
        const handleTabChange = () => {
            if (!hasScrolled && isChatVisible()) {
                hasScrolled = true;
                scrollWhenReady();
                chatTab?.removeEventListener('change', handleTabChange);
            }
        };

        chatTab?.addEventListener('change', handleTabChange);
    },

    scrollChatToBottom() {
        const container = document.querySelector('#chat .scroll-container');
        if (!container) return;

        container.scrollTop = container.scrollHeight;

        requestAnimationFrame(() => {
            container.scrollTop = container.scrollHeight;
        });
    },

    scrollToNewMessages() {
        this.scrollChatToBottom();
        this.clearNewMessagesIndicator();
    },

    clearNewMessagesIndicator() {
        this.unreadMessageCount = 0;
        this.showNewMessagesButton = false;
    },

    getChatHistoryKey() {
        return `chat_history_room_${this.$store.room.roomId}`;
    },

    loadChatHistory() {
        try {
            const key = this.getChatHistoryKey();
            const stored = sessionStorage.getItem(key);
            return stored ? JSON.parse(stored) : [];
        } catch (err) {
            console.error('Failed to load chat history:', err);
            return [];
        }
    },

    saveChatHistory(history) {
        try {
            const key = this.getChatHistoryKey();
            sessionStorage.setItem(key, JSON.stringify(history));
        } catch (err) {
            console.error('Failed to save chat history:', err);
        }
    },

    addToChatHistory(message) {
        const trimmed = message.trim();
        if (!trimmed) return;

        let history = this.loadChatHistory();

        if (history.length > 0 && history[history.length - 1] === trimmed) {
            return;
        }

        history.push(trimmed);

        if (history.length > 50) {
            history = history.slice(-50);
        }

        this.saveChatHistory(history);
    },

    wouldScrollUp(textarea) {
        const cursorPos = textarea.selectionStart;
        const textBeforeCursor = textarea.value.substring(0, cursorPos);
        const lines = textBeforeCursor.split('\n');
        return lines.length === 1;
    },

    wouldScrollDown(textarea) {
        const cursorPos = textarea.selectionStart;
        const textAfterCursor = textarea.value.substring(cursorPos);
        return !textAfterCursor.includes('\n');
    },

    handleChatKeydown(event) {
        const textarea = event.target;

        if (event.key === 'Enter') {
            if (!event.shiftKey) {
                event.preventDefault();
                this.sendChatMessage();
                return;
            } else {
                const start = textarea.selectionStart;
                const end = textarea.selectionEnd;
                const value = this.chatInput;

                this.chatInput = value.substring(0, start) + '\n' + value.substring(end);

                this.$nextTick(() => {
                    textarea.setSelectionRange(start + 1, start + 1);
                });
                return;
            }
        }

        const history = this.loadChatHistory();
        if (history.length === 0) return;

        if (event.key === 'ArrowUp' && this.wouldScrollUp(textarea)) {
            event.preventDefault();

            if (this.chatHistoryIndex === -1) {
                this.chatHistoryDraft = this.chatInput;
            }

            if (this.chatHistoryIndex < history.length - 1) {
                this.chatHistoryIndex++;
                const previousMessage = history[history.length - 1 - this.chatHistoryIndex];

                this.chatInput = previousMessage;

                this.$nextTick(() => {
                    textarea.setSelectionRange(0, 0);
                });
            }
        } else if (event.key === 'ArrowDown' && this.wouldScrollDown(textarea)) {
            event.preventDefault();

            if (this.chatHistoryIndex > 0) {
                this.chatHistoryIndex--;
                const nextMessage = history[history.length - 1 - this.chatHistoryIndex];
                this.chatInput = nextMessage;

                this.$nextTick(() => {
                    const endPos = nextMessage.length;
                    textarea.setSelectionRange(endPos, endPos);
                });
            } else if (this.chatHistoryIndex === 0) {
                this.chatHistoryIndex = -1;
                const draft = this.chatHistoryDraft;
                this.chatInput = draft;
                this.chatHistoryDraft = '';

                this.$nextTick(() => {
                    const endPos = draft.length;
                    textarea.setSelectionRange(endPos, endPos);
                });
            }
        }
    },

    handleChatInput(event) {
        if (this.chatHistoryIndex !== -1 && this.chatInput !== '') {
            this.chatHistoryIndex = -1;
            this.chatHistoryDraft = '';
        }
    },

    toggleCommandsPopover() {
        this.showCommandsPopover = !this.showCommandsPopover;
    },

    insertCommand(command) {
        this.chatInput = command + ' ';
        this.showCommandsPopover = false;
        this.$nextTick(() => {
            this.$refs.chatTextarea?.focus();
        });
    }
};