import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Chat } from "./Chat";
import { chat, initRoomState, players } from "../state";
import { listenRemote } from "../remote";
import type { ChatMessage, RoomPayload } from "../payload.gen";

// The observer of the chat's end: tests say when it is in view.
let showBottom: (visible: boolean) => void;
class FakeIntersectionObserver {
    constructor(private callback: IntersectionObserverCallback) {}
    observe() {
        showBottom = visible => act(() => this.callback([{ isIntersecting: visible } as IntersectionObserverEntry], this as never));
    }
    disconnect() {}
}

let root: HTMLElement;
const sent: { type: string; [key: string]: unknown }[] = [];
const recordSent = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const input = () => root.querySelector("textarea")!;
const $ = (selector: string) => root.querySelector<HTMLElement>(selector);
const $$ = (selector: string) => [...root.querySelectorAll<HTMLElement>(selector)];

const message = (id: number, userId: number, characterName: string | null = null): ChatMessage => ({
    id, userId, userName: `user${userId}`, messageBody: `m${id}`, commandResult: null, characterName,
    createdAt: "2026-09-27T10:00:00Z",
});

function receive(id: number, userId: number): void {
    act(() => {
        document.dispatchEvent(new CustomEvent("ws:chatMessage", { detail: {
            type: "chatMessage", eventID: "e", messageId: id, userId, userName: `user${userId}`, messageBody: `m${id}`,
            created: "2026-09-27T10:00:00Z",
        } }));
    });
}

function type(text: string): void {
    act(() => {
        input().value = text;
        input().dispatchEvent(new Event("input", { bubbles: true }));
    });
}

function key(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
    act(() => {
        target.dispatchEvent(e);
    });
    return e;
}

function click(element: Element): void {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

beforeAll(() => {
    vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
    listenRemote();
});

beforeEach(() => {
    sessionStorage.clear();
    initRoomState({
        roomId: 5,
        csrfToken: "",
        inviteLink: "",
        players: [{ id: 1, name: "GM", role: "gamemaster", joinedAt: "", folders: [], sheets: [] }],
        chat: { messages: [], hasMore: false },
        commands: [{ command: "/r", description: "Roll dice", detailedDescription: "" }],
        dicePresets: [],
    } as unknown as RoomPayload);
    document.addEventListener("room:sendMessage", recordSent);
    root = document.createElement("div");
    document.body.append(root);
    act(() => render(<Chat />, root));
});

afterEach(() => {
    render(null, root);
    root.remove();
    document.removeEventListener("room:sendMessage", recordSent);
    sent.length = 0;
});

describe("the input", () => {
    it("sends on Enter and empties", () => {
        type("  hello ");

        const e = key(input(), "Enter");

        expect(sent).toEqual([{ type: "chatMessage", messageBody: "hello", eventID: expect.any(String) }]);
        expect(e.defaultPrevented).toBe(true);
        expect(input().value).toBe("");
    });

    it("leaves Shift+Enter to the browser", () => {
        type("hello");

        const e = key(input(), "Enter", { shiftKey: true });

        expect(sent).toEqual([]);
        expect(e.defaultPrevented).toBe(false);
        expect(input().value).toBe("hello");
    });

    it("sends with the Send button, which waits for some text", () => {
        const send = $(".send-btn") as HTMLButtonElement;
        expect(send.disabled).toBe(true);

        type("hello");
        expect(send.disabled).toBe(false);
        click(send);

        expect(sent.map(m => m.messageBody)).toEqual(["hello"]);
        expect(input().value).toBe("");
        expect(send.disabled).toBe(true);
    });

    it("keeps its draft when a roll goes to the chat", () => {
        type("half a sentence");

        act(() => {
            document.dispatchEvent(new CustomEvent("sheet:rollExact", { detail: { expression: "2d10", label: "" } }));
        });

        expect(sent.map(m => m.messageBody)).toEqual(["/r 2d10"]);
        expect(input().value).toBe("half a sentence");
    });

    it("brings back what was sent with ↑ and ↓, then the draft", () => {
        for (const text of ["first", "second"]) {
            type(text);
            key(input(), "Enter");
        }
        type("draft");

        key(input(), "ArrowUp");
        expect(input().value).toBe("second");
        expect(input().selectionStart).toBe(0);
        key(input(), "ArrowUp");
        key(input(), "ArrowUp");
        expect(input().value).toBe("first");
        key(input(), "ArrowDown");
        expect(input().value).toBe("second");
        key(input(), "ArrowDown");
        expect(input().value).toBe("draft");
        expect(input().selectionStart).toBe(5);
    });

    it("moves the caret between lines instead of going back", () => {
        type("sent");
        key(input(), "Enter");
        type("one\ntwo");
        input().setSelectionRange(5, 5);

        const e = key(input(), "ArrowUp");

        expect(e.defaultPrevented).toBe(false);
        expect(input().value).toBe("one\ntwo");
    });

    it("takes a command from the commands popover", async () => {
        click($(".commands-btn")!);
        click($(".command-entry")!);

        expect(input().value).toBe("/r ");
        expect(document.activeElement).toBe(input());
        await vi.waitFor(() => expect($(".commands-popover")).toBeNull());
    });
});

describe("the commands popover", () => {
    it("closes on a click outside", async () => {
        click($(".commands-btn")!);
        expect($(".commands-popover")).not.toBeNull();

        click(document.body);

        await vi.waitFor(() => expect($(".commands-popover")).toBeNull());
    });
});

describe("the messages", () => {
    it("are grouped by player and character, mine to the side", () => {
        act(() => {
            chat.value = { messages: [message(1, 1, "Kharn"), message(2, 1), message(3, 2)], hasMore: false };
        });

        expect($$(".user-message-group").map(g => [g.querySelector(".author-name")!.textContent, g.querySelector(".sticky-author")!.className]))
            .toEqual([["user1", "sticky-author own-message-header"], ["user2", "sticky-author"]]);
        expect($$(".sticky-charactername").map(e => e.textContent)).toEqual(["Kharn"]);
        expect($$(".message").map(m => [m.querySelector(".message-body")!.textContent, m.className])).toEqual([
            ["m1", "message own-message"], ["m2", "message own-message"], ["m3", "message"],
        ]);
    });

    it("have a delete menu for the gamemaster only", async () => {
        act(() => {
            chat.value = { messages: [message(1, 2)], hasMore: false };
        });

        click($(".message-menu-btn")!);
        click($(".message-menu-popover .popover-item")!);

        expect(sent).toEqual([{ type: "deleteMessage", messageId: 1, eventID: expect.any(String) }]);
        await vi.waitFor(() => expect($(".message-menu-popover")).toBeNull());

        act(() => {
            players.value = [{ id: 1, name: "Me", role: "moderator", joinedAt: "" }];
        });
        expect($(".message-menu-wrapper")).toBeNull();
    });

    it("load earlier ones while the server has more", () => {
        expect($(".load-more-btn")).toBeNull();
        act(() => {
            chat.value = { messages: [message(1, 2)], hasMore: true };
        });

        click($(".load-more-btn")!);

        expect(sent).toEqual([{ type: "chatHistory", offset: 1, limit: 50, eventID: expect.any(String) }]);
    });
});

describe("the new messages button", () => {
    const button = () => $(".new-messages-button");

    it("counts messages that come while the end of the chat is out of view", async () => {
        showBottom(false);
        receive(1, 2);
        expect(button()!.textContent).toBe("1 new message↓");
        receive(2, 2);
        expect(button()!.textContent).toBe("2 new messages↓");

        showBottom(true);

        await vi.waitFor(() => expect(button()).toBeNull());
    });

    it("does not come for messages while the end is in view, nor for mine", () => {
        receive(1, 2);
        showBottom(false);
        receive(2, 1);

        expect(button()).toBeNull();
    });

    it("does not count earlier messages loaded above", () => {
        act(() => {
            chat.value = { messages: [message(10, 2)], hasMore: true };
        });
        showBottom(false);

        act(() => {
            document.dispatchEvent(new CustomEvent("ws:chatHistory", { detail: {
                type: "chatHistory", eventID: "e",
                messagePage: { messages: [{ message: { ...message(9, 2), roomId: 5 }, username: "user2" }], hasMore: false },
            } }));
        });

        expect($$(".message")).toHaveLength(2);
        expect(button()).toBeNull();
    });
});
