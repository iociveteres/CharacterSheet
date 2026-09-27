import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { DiceRoller } from "./DiceRoller";
import { Chat } from "./Chat";
import { diceSettings, initRoomState } from "../state";
import type { RoomPayload } from "../payload.gen";

let root: HTMLElement;
const sent: { type: string; [key: string]: unknown }[] = [];
const recordSent = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector);
const $$ = <T extends HTMLElement = HTMLElement>(selector: string) => [...root.querySelectorAll<T>(selector)];
const popover = () => $(".dice-popover");

function click(element: Element): void {
    act(() => {
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

function key(target: EventTarget, key: string): void {
    act(() => {
        target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    });
}

function type(input: HTMLInputElement, text: string): void {
    act(() => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

beforeEach(() => {
    localStorage.clear();
    initRoomState({
        roomId: 5,
        csrfToken: "",
        inviteLink: "",
        players: [{ id: 1, name: "GM", role: "gamemaster", joinedAt: "", folders: [], sheets: [] }],
        chat: { messages: [], hasMore: false },
        commands: [],
        dicePresets: [{ slot: 2, notation: "2d10+5" }],
    } as unknown as RoomPayload);
    document.addEventListener("room:sendMessage", recordSent);
    root = document.createElement("div");
    document.body.append(root);
    // The chat is there for the focus a roll gives back to its input.
    act(() => render(<><DiceRoller /><Chat /></>, root));
});

afterEach(() => {
    render(null, root);
    root.remove();
    document.removeEventListener("room:sendMessage", recordSent);
    sent.length = 0;
});

describe("the dice popover", () => {
    it("opens and closes with its button, the close button and Esc", async () => {
        expect(popover()).toBeNull();

        click($(".dice-roller-btn")!);
        expect(popover()).not.toBeNull();
        click($(".dice-roller-btn")!);
        await vi.waitFor(() => expect(popover()).toBeNull());

        click($(".dice-roller-btn")!);
        click($(".dice-close-btn")!);
        await vi.waitFor(() => expect(popover()).toBeNull());

        click($(".dice-roller-btn")!);
        key(window, "Escape");
        await vi.waitFor(() => expect(popover()).toBeNull());
    });

    it("rolls with the picked settings and hands the focus to the chat", () => {
        click($(".dice-roller-btn")!);

        click($$<HTMLInputElement>("input[name=dice-amount]").find(i => i.value === "3")!);
        click($$<HTMLInputElement>("input[name=dice-modifier]").find(i => i.value === "-20")!);
        click($$(".dice-btn").find(b => b.textContent === "d10")!);

        expect(sent.map(m => m.messageBody)).toEqual(["/r 3d10-20"]);
        expect(document.activeElement).toBe($("textarea"));
        expect($<HTMLInputElement>("input[name=dice-amount]:checked")!.value).toBe("3");
        expect(diceSettings.value).toMatchObject({ amount: 3, modifier: -20 });
    });

    it("rolls against a checked target", () => {
        click($(".dice-roller-btn")!);

        type($$<HTMLInputElement>(".roll-against-input")[1], "45");
        click($$<HTMLInputElement>(".roll-against-item input[type=checkbox]")[1]);
        click($$(".dice-btn").find(b => b.textContent === "d100")!);

        expect(sent.map(m => m.messageBody)).toEqual(["/r 1d100 vs 45"]);
        expect($$<HTMLInputElement>(".roll-against-item input[type=checkbox]").map(c => c.checked)).toEqual([false, true, false, false]);
    });

    it("shows the presets and rolls one with its button or Enter", () => {
        click($(".dice-roller-btn")!);
        const inputs = $$<HTMLInputElement>(".custom-dice-input");
        const buttons = $$<HTMLButtonElement>(".custom-dice-roll-btn");

        expect(inputs.map(i => i.value)).toEqual(["", "2d10+5", "", "", ""]);
        expect(inputs[0].placeholder).toBe("e.g., 2d10+5");
        expect(buttons.map(b => b.disabled)).toEqual([true, false, true, true, true]);

        click(buttons[1]);
        type(inputs[3], "d5");
        key(inputs[3], "Enter");
        key(inputs[4], "Enter");

        expect(sent.filter(m => m.type === "chatMessage").map(m => m.messageBody)).toEqual(["/r 2d10+5", "/r d5"]);
        expect(buttons[3].disabled).toBe(false);
    });
});
