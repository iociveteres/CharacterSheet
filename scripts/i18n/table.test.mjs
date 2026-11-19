import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderTable } from "./table.mjs";

const entries = [
    { key: "common.close", file: "i18n/catalog/common.json", prefix: "common", line: 2, en: "Close", ru: "Закрыть" },
    { key: "common.evil", file: "i18n/catalog/common.json", prefix: "common", line: 3, en: "</script><b id=x>bold</b>", note: "<i>note</i>" },
    { key: "room.chat.days", file: "i18n/catalog/room/chat.json", prefix: "room.chat", line: 2,
        en: { one: "{count} day", other: "{count} days" }, ru: { one: "{count} день", few: "{count} дня", many: "{count} дней" } },
];
const texts = [{ name: "content/about", files: { en: "ui/html/content/about.en.html" } }];

/** The page in happy-dom with its script run: innerHTML leaves scripts inert. */
function open(editable = false) {
    const html = renderTable({ entries, texts, editable });
    document.documentElement.innerHTML = html.replace(/^<!doctype html>\s*<html[^>]*>/, "").replace(/<\/html>\s*$/, "");
    const scripts = document.querySelectorAll("script:not([type])");
    new Function(scripts[scripts.length - 1].textContent)();
}

const visibleKeys = () => [...document.querySelectorAll("#entries tbody tr:not(.file)")].filter(r => !r.hidden).map(r => r.querySelector("code").textContent);
const input = (el, value) => {
    if (typeof value === "boolean") el.checked = value;
    else el.value = value;
    el.dispatchEvent(new Event(typeof value === "boolean" ? "change" : "input"));
};

describe("i18n:table", () => {
    beforeEach(open);

    it("shows catalog text as text, never as markup", () => {
        expect(document.getElementById("x")).toBeNull();
        const row = [...document.querySelectorAll("#entries tbody tr")].find(r => r.textContent.includes("common.evil"));
        expect(row.textContent).toContain("</script><b id=x>bold</b>");
        expect(row.textContent).toContain("<i>note</i>");
    });

    it("links each entry to its file and line, and each large text to its files", () => {
        const link = [...document.querySelectorAll("#entries a")].find(a => a.textContent === "i18n/catalog/common.json:2");
        expect(link.getAttribute("href")).toMatch(/^vscode:\/\/file\/.*i18n\/catalog\/common\.json:2$/);
        expect(document.querySelector("#texts a").getAttribute("href")).toMatch(/about\.en\.html:1$/);
    });

    it("shows plural forms by name", () => {
        const row = [...document.querySelectorAll("#entries tbody tr")].find(r => r.textContent.includes("room.chat.days"));
        expect([...row.querySelectorAll(".form b")].map(b => b.textContent)).toEqual(["one", "other", "one", "few", "many"]);
    });

    it("filters by search, by the not translated box and by section", () => {
        input(document.getElementById("search"), "ЗАКР");
        expect(visibleKeys()).toEqual(["common.close"]);
        input(document.getElementById("search"), "");
        input(document.getElementById("todo"), true);
        expect(visibleKeys()).toEqual(["common.evil"]);
        expect(document.querySelector("#texts tbody tr").hidden).toBe(false);
        input(document.getElementById("todo"), false);
        [...document.querySelectorAll("nav button")].find(b => b.dataset.path === "room").click();
        expect(visibleKeys()).toEqual(["room.chat.days"]);
        expect(document.getElementById("texts-section").hidden).toBe(true);
    });
});

describe("i18n:edit", () => {
    const rowOf = key => [...document.querySelectorAll("#entries tbody tr")].find(r => r.querySelector("code")?.textContent === key);
    const ruCell = key => rowOf(key).children[2];
    const press = (cell, key, ctrlKey = false) => cell.querySelector("textarea").dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey, bubbles: true }));
    let requests;
    const answer = (status, body) => vi.stubGlobal("fetch", vi.fn(async (url, init) => {
        requests.push(JSON.parse(init.body));
        return { ok: status === 200, status, json: async () => body };
    }));
    const flush = () => new Promise(resolve => setTimeout(resolve));

    beforeEach(() => {
        requests = [];
        open(true);
    });
    afterEach(() => vi.unstubAllGlobals());

    it("saves the field on Ctrl+Enter with the value it had, and counts the entry translated", async () => {
        answer(200, { fields: { en: "</script><b id=x>bold</b>", ru: "Жирный", note: "<i>note</i>" }, problems: [] });
        ruCell("common.evil").click();
        ruCell("common.evil").querySelector("textarea").value = "Жирный";
        press(ruCell("common.evil"), "Enter", true);
        await flush();
        expect(requests).toEqual([{ key: "common.evil", field: "ru", before: null, after: "Жирный" }]);
        expect(ruCell("common.evil").textContent).toBe("Жирный");
        expect(ruCell("common.evil").classList.contains("todo")).toBe(false);
        expect(document.getElementById("stats").textContent).toBe("3 keys, 0 without ru, 1 large texts");
    });

    it("edits plural forms one by one and sends them together, showing the problems of the result", async () => {
        const ru = { one: "{n} день", few: "{count} дня", many: "{count} дней" };
        answer(200, { fields: { en: entries[2].en, ru }, problems: ["placeholders differ: en {count}, ru {count, n}"] });
        ruCell("room.chat.days").click();
        const areas = [...ruCell("room.chat.days").querySelectorAll("textarea")];
        expect(areas.map(a => a.value)).toEqual(["{count} день", "{count} дня", "{count} дней"]);
        areas[0].value = "{n} день";
        press(ruCell("room.chat.days"), "Enter", true);
        await flush();
        expect(requests[0].after).toEqual(ru);
        expect(rowOf("room.chat.days").querySelector(".problems").textContent).toContain("placeholders differ");
    });

    it("sends nothing when the text is unchanged or Esc puts it back", async () => {
        answer(200, {});
        ruCell("common.close").click();
        press(ruCell("common.close"), "Enter", true);
        ruCell("common.close").click();
        ruCell("common.close").querySelector("textarea").value = "Прочь";
        press(ruCell("common.close"), "Escape");
        await flush();
        expect(requests).toEqual([]);
        expect(ruCell("common.close").textContent).toBe("Закрыть");
    });

    it("shows what the file holds and the unsaved text when the entry changed meanwhile", async () => {
        answer(409, { error: "changed", fields: { en: "Close", ru: "Закрой" } });
        ruCell("common.close").click();
        ruCell("common.close").querySelector("textarea").value = "Прочь";
        press(ruCell("common.close"), "Enter", true);
        await flush();
        expect(ruCell("common.close").textContent).toBe("Закрой");
        expect(rowOf("common.close").querySelector(".problems").textContent).toContain("Прочь");
    });
});
