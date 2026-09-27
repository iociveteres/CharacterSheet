// The Chat tab: messages grouped by day, player and character, and the input.
import { createRef, type JSX } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { chat, chatGroups, commands, me, roomId } from "../state";
import { deleteMessage, loadEarlierMessages, sendChat } from "../actions";
import { isGamemaster } from "../permissions";
import { readInputHistory } from "../chat";
import { formatDateLabel, formatTime } from "../time_format.js";
import type { ChatMessage } from "../payload.gen";
import { Transition } from "./Transition";
import { useClickOutside } from "./useClickOutside";

const chatInput = createRef<HTMLTextAreaElement>();

/** The dice roller hands the focus back to the input after a roll. */
export function focusChatInput(): void {
    chatInput.current?.focus();
}

function scrollToBottom(el: HTMLElement): void {
    el.scrollTop = el.scrollHeight;
    // Once more after the browser has laid out what came in this frame.
    requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
    });
}

export function Chat() {
    const scroller = useRef<HTMLDivElement>(null);
    const bottom = useRef<HTMLDivElement>(null);
    const bottomVisible = useRef(true);
    const [unread, setUnread] = useState(0);
    // The count stays on the button while it fades out.
    const shownUnread = useRef(0);
    if (unread > 0) shownUnread.current = unread;

    const messages = chat.value.messages;
    const newestId = useRef(messages.at(-1)?.id ?? 0);

    useEffect(() => {
        const observer = new IntersectionObserver(([entry]) => {
            bottomVisible.current = entry.isIntersecting;
            if (entry.isIntersecting) setUnread(0);
        }, { root: scroller.current, rootMargin: "0px 0px 100px 0px", threshold: 0 });
        observer.observe(bottom.current!);
        return () => observer.disconnect();
    }, []);

    // The chat opens at the newest message: the first time the panel has a
    // height, whether the tab is picked or the page opens on it.
    useEffect(() => {
        const el = scroller.current!;
        const observer = new ResizeObserver(() => {
            if (el.clientHeight === 0) return;
            observer.disconnect();
            scrollToBottom(el);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    // New messages scroll the chat down when its end is in view or one of them
    // is mine; otherwise the button counts them. Earlier ones come before.
    useLayoutEffect(() => {
        const arrived = messages.filter(m => m.id > newestId.current);
        if (arrived.length === 0) return;
        newestId.current = arrived.at(-1)!.id;
        if (bottomVisible.current || arrived.some(m => m.userId === me.value.id)) {
            scrollToBottom(scroller.current!);
            setUnread(0);
        } else {
            setUnread(n => n + arrived.length);
        }
    }, [messages]);

    const showNewMessages = () => {
        scrollToBottom(scroller.current!);
        setUnread(0);
    };

    const myId = me.value.id;
    const gamemaster = isGamemaster(me.value.role);
    const count = shownUnread.current;

    return (
        <>
            <div class="scroll-container" ref={scroller}>
                {chat.value.hasMore && (
                    <button onClick={loadEarlierMessages} class="load-more-btn" type="button">Load earlier messages</button>
                )}

                {chatGroups.value.map(day => (
                    <div key={day.key} class="message-group">
                        <div class="date-separator">{formatDateLabel(day.date)}</div>
                        {day.authors.map(author => {
                            const own = author.userId === myId;
                            return (
                                <div key={author.key} class="user-message-group">
                                    <div class={own ? "sticky-author own-message-header" : "sticky-author"}>
                                        <span class="author-name">{author.userName}</span>
                                    </div>
                                    {author.characters.map(group => (
                                        <div key={group.key} class={own ? "character-subgroup own-character-subgroup" : "character-subgroup"}>
                                            {group.characterName && <div class="sticky-charactername">{group.characterName}</div>}
                                            {group.messages.map(msg => (
                                                <Message key={msg.id} msg={msg} own={own} gamemaster={gamemaster} />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                ))}

                <div ref={bottom}></div>

                <Transition show={unread > 0} name="new-msg">
                    <div onClick={showNewMessages} class="new-messages-button">
                        <span>{count === 1 ? "1 new message" : `${count} new messages`}</span>
                        <span class="arrow-down">↓</span>
                    </div>
                </Transition>
            </div>

            <ChatInput />
        </>
    );
}

function Message({ msg, own, gamemaster }: { msg: ChatMessage; own: boolean; gamemaster: boolean }) {
    return (
        <div class={own ? "message own-message" : "message"}>
            <div class="message-body">{msg.messageBody}</div>
            {msg.commandResult && <div class="command-result">{msg.commandResult}</div>}
            <div class="message-footer">
                <div class="message-time-wrapper">
                    {gamemaster && <MessageMenu messageId={msg.id} />}
                    <div class="message-time">{formatTime(new Date(msg.createdAt))}</div>
                </div>
            </div>
        </div>
    );
}

function MessageMenu({ messageId }: { messageId: number }) {
    const [open, setOpen] = useState(false);
    const wrapper = useRef<HTMLDivElement>(null);
    useClickOutside(wrapper, open, () => setOpen(false));

    return (
        <div class="message-menu-wrapper" ref={wrapper}>
            <button onClick={() => setOpen(o => !o)} class="message-menu-btn" type="button" title="Message actions">⋮</button>
            <Transition show={open} name="popover">
                <div class="popover message-menu-popover">
                    <div class="popover-item" onClick={() => {
                        setOpen(false);
                        deleteMessage(messageId);
                    }}>Delete message</div>
                </div>
            </Transition>
        </div>
    );
}

function ChatInput() {
    const [draft, setDraft] = useState("");
    // Where ↑ and ↓ are in the sent messages: -1 is the draft, 0 the last sent.
    const historyIndex = useRef(-1);
    const savedDraft = useRef("");

    /** Puts `text` into the input with the caret at `caret`. */
    const showText = (textarea: HTMLTextAreaElement, text: string, caret: number) => {
        textarea.value = text;
        textarea.setSelectionRange(caret, caret);
        setDraft(text);
    };

    const sendInput = () => {
        const textarea = chatInput.current!;
        const body = textarea.value.trim();
        if (!body) return;
        sendChat(body);
        showText(textarea, "", 0);
        historyIndex.current = -1;
        savedDraft.current = "";
    };

    const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>) => {
        const textarea = e.currentTarget;
        if (e.key === "Enter") {
            // Shift+Enter leaves the new line to the browser.
            if (!e.shiftKey) {
                e.preventDefault();
                sendInput();
            }
            return;
        }

        const history = readInputHistory(roomId);
        if (history.length === 0) return;
        const caret = textarea.selectionStart;

        // ↑ on the first line of the input goes back in what was sent, ↓ on the last line forward.
        if (e.key === "ArrowUp" && !textarea.value.slice(0, caret).includes("\n")) {
            e.preventDefault();
            if (historyIndex.current === -1) savedDraft.current = textarea.value;
            if (historyIndex.current < history.length - 1) {
                historyIndex.current++;
                showText(textarea, history[history.length - 1 - historyIndex.current], 0);
            }
        } else if (e.key === "ArrowDown" && !textarea.value.slice(caret).includes("\n")) {
            e.preventDefault();
            if (historyIndex.current > 0) {
                historyIndex.current--;
                const text = history[history.length - 1 - historyIndex.current];
                showText(textarea, text, text.length);
            } else if (historyIndex.current === 0) {
                historyIndex.current = -1;
                const text = savedDraft.current;
                savedDraft.current = "";
                showText(textarea, text, text.length);
            }
        }
    };

    const onInput = (e: JSX.TargetedInputEvent<HTMLTextAreaElement>) => {
        const text = e.currentTarget.value;
        setDraft(text);
        // Editing a sent message makes it the draft.
        if (historyIndex.current !== -1 && text !== "") {
            historyIndex.current = -1;
            savedDraft.current = "";
        }
    };

    const insertCommand = (command: string) => {
        const textarea = chatInput.current!;
        const text = command + " ";
        showText(textarea, text, text.length);
        textarea.focus();
    };

    return (
        <div class="chat-input-container">
            <textarea ref={chatInput} value={draft} onKeyDown={onKeyDown} onInput={onInput}
                placeholder="Type a message..." rows={3} maxLength={2000}></textarea>

            <div class="layout-column">
                <Commands onPick={insertCommand} />
                <button onClick={sendInput} class="button-colored button-wide send-btn" disabled={!draft.trim()} type="button">
                    Send
                </button>
            </div>
        </div>
    );
}

function Commands({ onPick }: { onPick: (command: string) => void }) {
    const [open, setOpen] = useState(false);
    const wrapper = useRef<HTMLDivElement>(null);
    useClickOutside(wrapper, open, () => setOpen(false));

    return (
        <div class="commands-popover-wrapper" ref={wrapper}>
            <button onClick={() => setOpen(o => !o)} class="button-colored button-wide commands-btn" type="button"
                title="Available commands">/</button>
            <Transition show={open} name="popover">
                <div class="commands-popover">
                    <div class="commands-popover-header">Available Commands</div>
                    <div class="commands-list">
                        {commands.map(cmd => (
                            <div key={cmd.command} class="command-entry" title={cmd.detailedDescription} onClick={() => {
                                setOpen(false);
                                onPick(cmd.command);
                            }}>
                                <code class="command-name">{cmd.command}</code>
                                <span class="command-description">{cmd.description}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </Transition>
        </div>
    );
}
