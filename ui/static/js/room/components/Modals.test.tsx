import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { Modals } from "./Modals";
import { confirmMessage, modals, players } from "../state";
import { answerConfirm, confirm, openImportModal, openInviteModal } from "../actions";

const closed = { invite: false, import: false, kicked: false, connectionLost: false };

let root: HTMLElement;
const overlay = () => root.querySelector<HTMLElement>("#overlay")!;

beforeEach(() => {
    players.value = [{ id: 1, name: "Me", role: "gamemaster", joinedAt: "" }];
    modals.value = closed;
    root = document.createElement("div");
    document.body.append(root);
    act(() => render(<Modals />, root));
});

afterEach(() => {
    act(() => answerConfirm(false));
    render(null, root);
    root.remove();
});

function key(target: EventTarget, key: string): KeyboardEvent {
    const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
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

describe("the overlay", () => {
    it("is open while a modal is", () => {
        expect(overlay().className).toBe("overlay");
        expect(overlay().getAttribute("aria-hidden")).toBe("true");

        act(() => openImportModal());

        expect(overlay().className).toBe("overlay open");
        expect(overlay().hasAttribute("aria-hidden")).toBe(false);
    });
});

describe("the confirm", () => {
    function ask(): Promise<boolean> {
        let answer!: Promise<boolean>;
        act(() => {
            answer = confirm("Delete Kharn?");
        });
        return answer;
    }

    it("shows the question and answers yes on Enter anywhere", async () => {
        const answer = ask();
        expect(root.querySelector("#confirm-modal .confirm-text")!.textContent).toBe("Delete Kharn?");

        const e = key(document.body, "Enter");

        await expect(answer).resolves.toBe(true);
        expect(e.defaultPrevented).toBe(true);
        expect(root.querySelector("#confirm-modal")).toBeNull();
    });

    it("answers no on Esc", async () => {
        const answer = ask();

        key(document.body, "Escape");

        await expect(answer).resolves.toBe(false);
    });

    it("answers a key pressed before the confirm has rendered", async () => {
        const answer = confirm("Delete Kharn?");

        key(document.body, "Escape");

        await expect(answer).resolves.toBe(false);
    });

    it("answers no on a click on the overlay, not on the modal", async () => {
        const answer = ask();

        click(root.querySelector("#confirm-modal .confirm-text")!);
        expect(confirmMessage.value).toBe("Delete Kharn?");
        click(overlay());

        await expect(answer).resolves.toBe(false);
    });
});

describe("the invite modal", () => {
    const sent: object[] = [];
    const listener = (e: Event) => sent.push(JSON.parse((e as CustomEvent<string>).detail));
    beforeEach(() => {
        sent.length = 0;
        document.addEventListener("room:sendMessage", listener);
    });
    afterEach(() => document.removeEventListener("room:sendMessage", listener));

    it("is not shown to a player", () => {
        players.value = [{ id: 1, name: "Me", role: "player", joinedAt: "" }];
        act(() => openInviteModal());

        expect(root.querySelector("#invite-link-modal")).toBeNull();
    });

    it("asks for an unlimited link by default, 0 uses meaning no limit", () => {
        act(() => openInviteModal());
        const uses = root.querySelector<HTMLInputElement>('input[name="max-uses"]')!;
        uses.value = "0";
        act(() => {
            uses.dispatchEvent(new Event("input", { bubbles: true }));
        });

        click(root.querySelector('button[title="Create new invite link"]')!);

        expect(sent).toMatchObject([{ type: "newInviteLink", expiresInDays: null, maxUses: null }]);
    });

    it("asks for a link with the picked limits", () => {
        act(() => openInviteModal());
        const expires = root.querySelector<HTMLSelectElement>("#new-link-options select")!;
        const uses = root.querySelector<HTMLInputElement>('input[name="max-uses"]')!;
        expires.value = "7";
        uses.value = "3";
        act(() => {
            expires.dispatchEvent(new Event("change", { bubbles: true }));
            uses.dispatchEvent(new Event("input", { bubbles: true }));
        });

        click(root.querySelector('button[title="Create new invite link"]')!);

        expect(sent).toMatchObject([{ type: "newInviteLink", expiresInDays: 7, maxUses: 3 }]);
    });

    it("says the link is copied for a moment", async () => {
        vi.useFakeTimers();
        const writeText = vi.fn(async () => {});
        vi.stubGlobal("navigator", { clipboard: { writeText } });
        try {
            act(() => openInviteModal());
            const copy = root.querySelector<HTMLButtonElement>('button[title="Copy invite link"]')!;

            await act(async () => {
                copy.click();
            });
            expect(copy.textContent).toBe("Copied!");
            act(() => {
                vi.advanceTimersByTime(1400);
            });

            expect(copy.textContent).toBe("Copy");
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });
});

it("Esc in the import modal closes it", () => {
    act(() => openImportModal());

    key(root.querySelector("#sheet-file")!, "Escape");

    expect(modals.value.import).toBe(false);
});
