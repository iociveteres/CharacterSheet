import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SheetPayload } from "./current";
import { characterState } from "./state/state";
import { selectedTabSignal } from "./state/ui";

const payload = (name: string): SheetPayload => ({
    sheetId: "7",
    kind: "black_crusade",
    canEdit: true,
    content: { characterInfo: { characterName: name } } as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

let served = payload("Kharn");
const fetchMock = vi.fn(async (url: string) =>
    new Response(url.startsWith("/static/") ? "" : JSON.stringify(served)));

let notices: string[] = [];

const inserted = () => new Promise(resolve =>
    document.addEventListener("charactersheet_inserted", resolve, { once: true }));

// main.ts opens the sheet of #sheet-state on import.
beforeAll(async () => {
    document.body.innerHTML = `
        <div id="character-sheet-container" data-sheet-css="/static/css/sheet.css">
            <script id="sheet-state" type="application/json">${JSON.stringify(served)}</script>
        </div>`;
    vi.stubGlobal("fetch", fetchMock);
    // happy-dom's replace() resolves to undefined; browsers resolve to the sheet.
    vi.stubGlobal("CSSStyleSheet", class extends CSSStyleSheet {
        async replace(text: string): Promise<CSSStyleSheet> {
            await super.replace(text);
            return this;
        }
    });
    document.addEventListener("sheet:notice", e => notices.push((e as CustomEvent).detail.message));
    const opened = inserted();
    await import("./main");
    await opened;
});

beforeEach(() => {
    notices = [];
    fetchMock.mockClear();
});

const navRadio = (id: string) =>
    document.getElementById("charactersheet")!.shadowRoot!.getElementById(id) as HTMLInputElement;

const failEdit =(sheetID: string, reason: string) =>
    document.dispatchEvent(new CustomEvent("sheet:editFailed", { detail: { sheetID, reason } }));

describe("a failed edit", () => {
    it("reloads the open sheet from the server and keeps its open tabs", async () => {
        selectedTabSignal("psykana.tabs").value = "t2";
        navRadio("show-gear").click();
        expect(navRadio("show-player-sheet").checked).toBe(false);
        served = payload("Lorgar");

        const reloaded = inserted();
        failEdit("7", "validation");
        await reloaded;

        expect(fetchMock).toHaveBeenCalledWith("/sheet/view/7", expect.anything());
        expect(characterState.characterInfo.characterName.value).toBe("Lorgar");
        expect(selectedTabSignal("psykana.tabs").value).toBe("t2");
        expect(navRadio("show-gear").checked).toBe(true);
        expect(notices).toEqual(["Your change was not saved: the server rejected it."]);
    });

    it("of a sheet no longer open only tells the player", () => {
        failEdit("8", "permission");

        expect(fetchMock).not.toHaveBeenCalled();
        expect(notices).toEqual(["Your change was not saved: you can no longer edit this sheet."]);
    });
});

describe("the connection", () => {
    it("tells the player it dropped, and reloads the sheet once it is back", async () => {
        served = payload("Abaddon");
        document.dispatchEvent(new CustomEvent("ws:disconnected"));
        expect(fetchMock).not.toHaveBeenCalled();

        const reloaded = inserted();
        document.dispatchEvent(new CustomEvent("ws:reconnected"));
        await reloaded;

        expect(characterState.characterInfo.characterName.value).toBe("Abaddon");
        expect(notices).toEqual([
            "Connection lost: the sheet is read-only until it is back.",
            "Connection restored.",
        ]);
    });
});

describe("the scroll of the sheet", () => {
    const box = () => document.getElementById("character-sheet-container")!;

    it("is not restored by the browser", () => {
        expect(history.scrollRestoration).toBe("manual");
    });

    it("starts at the top of a sheet picked in the room list", async () => {
        box().scrollTop = 500;
        const link = document.createElement("a");
        link.href = "/sheet/view/8";
        document.body.append(link);

        const opened = inserted();
        link.click();
        await opened;
        link.remove();

        expect(box().scrollTop).toBe(0);
    });

    it("stays where it was when the open sheet is reloaded", async () => {
        box().scrollTop = 500;

        const reloaded = inserted();
        document.dispatchEvent(new CustomEvent("ws:reconnected"));
        await reloaded;

        expect(box().scrollTop).toBe(500);
    });
});
