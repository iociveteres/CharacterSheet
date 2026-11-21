import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { NameRow, type FormerName } from "./Name";

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));

let container: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;
let renamed: ReturnType<typeof vi.fn<(initial: string) => void>>;

beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renamed = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const answer = (status: number, body: object) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function renderRow(former: FormerName[] = []) {
    act(() => render(<NameRow name="Alice" former={former} csrf="token" onRenamed={renamed} />, container));
}

const shownName = () => container.querySelector(".account-name")?.textContent ?? null;
const field = () => container.querySelector<HTMLInputElement>(".account-name-input");
const error = () => container.querySelector(".account-name-error");
const formerNames = () => container.querySelector<HTMLDetailsElement>("details.former-names");
const formerRows = () => [...container.querySelectorAll(".former-names-panel li")]
    .map(li => [li.querySelector(".former-name")?.textContent, li.querySelector(".former-date")?.textContent]);

function openField() {
    act(() => container.querySelector<HTMLElement>(".account-rename")!.click());
}

/** Types `value` into the open field and presses `key`. */
async function typeAndPress(value: string, key: string) {
    const input = field()!;
    input.focus();
    act(() => {
        input.value = value;
        input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    });
    await act(flush);
}

describe("NameRow", () => {
    it("sends the new name on Enter and shows what the server stored", async () => {
        renderRow();
        expect(formerNames()).toBeNull();
        fetchMock.mockResolvedValue(answer(200, { name: "Bob", initial: "B", former: [{ name: "Alice", date: "21.11.2026" }] }));
        openField();
        await typeAndPress("  Bob ", "Enter");

        expect(fetchMock).toHaveBeenCalledOnce();
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe("/account/name");
        expect(init.method).toBe("PUT");
        expect(init.headers["X-CSRF-Token"]).toBe("token");
        expect(JSON.parse(init.body)).toEqual({ name: "  Bob " });
        expect(field()).toBeNull();
        expect(shownName()).toBe("Bob");
        expect(formerRows()).toEqual([["Alice", "21.11.2026"]]);
        expect(renamed).toHaveBeenCalledWith("B");
    });

    it("keeps a refused name in the field with the server's error under it", async () => {
        renderRow();
        fetchMock.mockResolvedValue(answer(422, { errors: { name: "taken" } }));
        openField();
        await typeAndPress("Dupe", "Enter");

        expect(field()?.value).toBe("Dupe");
        expect(field()?.getAttribute("aria-invalid")).toBe("true");
        expect(error()?.textContent).toBe("taken");
        expect(renamed).not.toHaveBeenCalled();

        // Leaving the field with the same refused name does not send it again.
        act(() => field()!.blur());
        await act(flush);
        expect(fetchMock).toHaveBeenCalledOnce();

        // Esc gives the name back and takes the error away.
        await typeAndPress("Dupe", "Escape");
        expect(field()).toBeNull();
        expect(error()).toBeNull();
        expect(shownName()).toBe("Alice");
    });

    it("sends nothing for the same name or on Esc", async () => {
        renderRow([{ name: "Al", date: "01.10.2026" }]);
        openField();
        await typeAndPress(" Alice ", "Enter");
        expect(field()).toBeNull();
        openField();
        await typeAndPress("Bob", "Escape");
        expect(field()).toBeNull();
        expect(fetchMock).not.toHaveBeenCalled();
        expect(shownName()).toBe("Alice");
        expect(formerRows()).toEqual([["Al", "01.10.2026"]]);
    });

    it("lists the former names under ▾, the latest first, closed by a click elsewhere or Esc", () => {
        renderRow([{ name: "Bob", date: "02.11.2026" }, { name: "Al", date: "01.10.2026" }]);
        expect(formerRows()).toEqual([["Bob", "02.11.2026"], ["Al", "01.10.2026"]]);
        const details = formerNames()!;
        details.open = true;
        act(() => details.querySelector<HTMLElement>(".former-names-panel li")!.click());
        expect(details.open).toBe(true);
        act(() => document.body.click());
        expect(details.open).toBe(false);

        details.open = true;
        act(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        });
        expect(details.open).toBe(false);
    });

    it("hides ▾ while the name is edited", () => {
        renderRow([{ name: "Al", date: "01.10.2026" }]);
        openField();
        expect(formerNames()).toBeNull();
    });

    it("shows an error when the server cannot be reached", async () => {
        renderRow();
        fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
        openField();
        await typeAndPress("Bob", "Enter");
        expect(error()).not.toBeNull();
        expect(field()?.value).toBe("Bob");
    });
});
