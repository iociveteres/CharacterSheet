import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "preact";
import { installDictionary } from "../i18n/testDictionary";
import type { Bestiary as BestiaryData, BestiaryCollection, Creature, UploadResult } from "./types.gen";
import { answerConfirm, deleteCollection, loadBestiary, uploadFiles } from "./actions";
import { byline, quotaText } from "./format";
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
    it("writes the quota with a decimal comma in Russian, a point in English", () => {
        expect(quotaText(bestiary.quota)).toMatch(/\b180\b.*\b10\b/);
        expect(quotaText({ used: 512, limit: 1.5 * 1024 * 1024 })).toMatch(/\b512\b.*\b1,5\b/);
        installDictionary("en");
        expect(quotaText({ used: 512, limit: 1.5 * 1024 * 1024 })).toMatch(/\b512\b.*\b1\.5\b/);
    });

    it("names the author of a creature, the user apart from the others", () => {
        expect(byline({ author: "gm", byYou: true })).not.toContain("gm");
        expect(byline({ author: "alex", byYou: false })).toContain("alex");
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
        expect(await asked(1)).toMatch(/Orks.*\b1\b/);
        expect(await asked(2)).toMatch(/Daemons.*\b3\b/);
        expect(await asked(4)).toMatch(/Cult.*\b21\b/);
    });

    it("says how each uploaded file went", async () => {
        const file = (name: string) => new File(["{}"], name, { type: "application/json" });
        await uploadFiles(1, ["a.json", "b.json", "c.json", "x.json", "d.json", "e.json"].map(file));
        // A line per file, the one the server did not try too.
        const lines = toasts.value.at(-1)!.message.split("\n");
        expect(lines.map(line => line.split(":")[0])).toEqual(["a.json", "b.json", "c.json", "x.json", "d.json", "e.json"]);
        expect(lines.slice(0, 3).map(line => Number(line.match(/\d+/)![0]))).toEqual([1, 3, 5]);
    });
});
