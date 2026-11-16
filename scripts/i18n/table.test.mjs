import { beforeEach, describe, expect, it } from "vitest";
import { renderTable } from "./table.mjs";

const entries = [
    { key: "common.close", file: "i18n/catalog/common.json", prefix: "common", line: 2, en: "Close", ru: "Закрыть" },
    { key: "common.evil", file: "i18n/catalog/common.json", prefix: "common", line: 3, en: "</script><b id=x>bold</b>", note: "<i>note</i>" },
    { key: "room.chat.days", file: "i18n/catalog/room/chat.json", prefix: "room.chat", line: 2,
        en: { one: "{count} day", other: "{count} days" }, ru: { one: "{count} день", few: "{count} дня", many: "{count} дней" } },
];
const texts = [{ name: "content/about", files: { en: "ui/html/content/about.en.html" } }];

/** The page in happy-dom with its script run: innerHTML leaves scripts inert. */
function open() {
    const html = renderTable({ entries, texts });
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
