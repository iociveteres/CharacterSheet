import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { installDictionary } from "../i18n/testDictionary";
import type { Bestiary as BestiaryData, BestiaryCollection, Creature, UploadResult } from "./types.gen";
import { answerConfirm, deleteCollection, loadBestiary, openDialog, uploadFiles } from "./actions";
import { byline, quotaText } from "./format";
import { Bestiary } from "./components/Bestiary";
import { confirmMessage, toasts } from "./state";

const collection = (id: number, name: string, creatures: number): BestiaryCollection =>
    ({ id, name, own: true, owner: "gm", visibility: "private", default: id === 1, subscribed: false, publishedAt: null, description: "", creatures, updatedAt: "" });

const bestiary: BestiaryData = {
    collections: [collection(1, "Orks", 1), collection(2, "Daemons", 3), collection(3, "Xenos", 5), collection(4, "Cult", 21)],
    quota: { used: 180 * 1024, limit: 10 * 1024 * 1024 },
};

const creatures: Creature[] = [
    { id: 11, collectionId: 1, name: "Ork Boy", kind: "black_crusade", sourceLabel: null, author: "gm", byYou: true, updatedAt: "" },
    { id: 12, collectionId: 1, name: "Gretchin", kind: "black_crusade", sourceLabel: null, author: "alex", byYou: false, updatedAt: "" },
];

// The server stopped at d.json, over the quota: e.json was not tried.
const uploaded: UploadResult[] = [
    { file: "a.json", added: 1 },
    { file: "b.json", added: 3 },
    { file: "c.json", added: 5 },
    { file: "x.json", added: 0, error: "invalid" },
    { file: "d.json", added: 0, error: "quota" },
];

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

function server(input: string): Promise<Response> {
    const url = new URL(input, "http://localhost");
    if (url.pathname === "/bestiary/collections") return Promise.resolve(json(bestiary));
    if (url.pathname === "/bestiary/creatures") return Promise.resolve(json(url.searchParams.get("collection") === "1" ? creatures : []));
    if (url.pathname === "/bestiary/collections/1/upload") return Promise.resolve(json(uploaded));
    return Promise.resolve(new Response("Not Found", { status: 404 }));
}

const box = document.createElement("div");
const $ = (selector: string) => box.querySelector<HTMLElement>(selector);

beforeAll(() => {
    vi.stubGlobal("fetch", vi.fn(server));
    document.body.append(box);
});

afterAll(() => {
    render(null, box);
    box.remove();
    vi.unstubAllGlobals();
});

beforeEach(() => installDictionary("ru"));

describe("the bestiary in Russian", () => {
    it("writes the quota with Russian units and a decimal comma", () => {
        expect(quotaText(bestiary.quota)).toBe("Занято 180 КБ из 10 МБ");
        expect(quotaText({ used: 512, limit: 1.5 * 1024 * 1024 })).toBe("Занято 512 Б из 1,5 МБ");
    });

    it("keeps the English quota as it was", () => {
        installDictionary("en");
        expect(quotaText({ used: 512, limit: 1.5 * 1024 * 1024 })).toBe("Used 512 B of 1.5 MB");
    });

    it("names the author of a creature", () => {
        expect(byline({ author: "gm", byYou: true })).toBe("от вас");
        expect(byline({ author: "alex", byYou: false })).toBe("от alex");
        expect(byline({ author: "", byYou: false })).toBe("");
    });

    it("counts the creatures deleted with a collection", async () => {
        await loadBestiary();
        const asked = async (id: number) => {
            void deleteCollection(id);
            await vi.waitFor(() => expect(confirmMessage.value).not.toBeNull());
            const message = confirmMessage.value;
            answerConfirm(false);
            return message;
        };
        expect(await asked(1)).toBe("Удалить коллекцию «Orks» вместе с 1 существом?");
        expect(await asked(2)).toBe("Удалить коллекцию «Daemons» вместе с 3 существами?");
        expect(await asked(3)).toBe("Удалить коллекцию «Xenos» вместе с 5 существами?");
        expect(await asked(4)).toBe("Удалить коллекцию «Cult» вместе с 21 существом?");
    });

    it("says how each uploaded file went", async () => {
        const file = (name: string) => new File(["{}"], name, { type: "application/json" });
        await uploadFiles(1, ["a.json", "b.json", "c.json", "x.json", "d.json", "e.json"].map(file));
        expect(toasts.value.at(-1)!.message.split("\n")).toEqual([
            "a.json: 1 существо",
            "b.json: 3 существа",
            "c.json: 5 существ",
            "x.json: не лист и не коллекция",
            "d.json: не хватает места",
            "e.json: не загружен",
        ]);
    });

    it("renders the collection panel and the move dialog", async () => {
        await loadBestiary(1);
        act(() => render(<Bestiary />, box));
        await vi.waitFor(() => expect($(".bestiary-creature-author")).not.toBeNull());
        expect($(".bestiary-collection-view .bestiary-visibility")!.textContent).toBe("личная");
        expect($(".bestiary-collection .bestiary-default")!.textContent).toBe("основная");
        expect([...box.querySelectorAll(".bestiary-creature-author")].map(e => e.textContent)).toEqual(["от вас", "от alex"]);
        expect($(".bestiary-quota")!.textContent).toBe("Занято 180 КБ из 10 МБ");
        act(() => openDialog({ type: "move", id: 11 }));
        expect($(".bestiary-dialog h3")!.textContent).toBe("Переместить «Ork Boy» в");
        expect($(".bestiary-dialog-ok")!.textContent).toBe("Переместить");
    });
});
