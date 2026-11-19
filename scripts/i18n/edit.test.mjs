import { describe, expect, it } from "vitest";
import { Conflict, updateEntryText } from "./edit.mjs";

const file = [
    "{",
    `  "room.chat.send": { "en": "Send", "ru": "Отправить" },`,
    `  "room.chat.days": { "en": {"one": "{count} day", "other": "{count} days"}, "note": "дни" },`,
    `  "room.chat.today": { "en": "Today", "ru": "Сегодня", "note": "разделитель" }`,
    "}",
    "",
].join("\r\n");

describe("updateEntryText", () => {
    it("rewrites only the entry's line, keeping line endings and the trailing comma", () => {
        const { text, fields } = updateEntryText(file, "room.chat.send", "ru", "Отправить", "Послать \"это\"\nсейчас");
        expect(fields).toEqual({ en: "Send", ru: "Послать \"это\"\nсейчас" });
        const lines = text.split("\r\n");
        expect(lines[1]).toBe(`  "room.chat.send": { "en": "Send", "ru": "Послать \\"это\\"\\nсейчас" },`);
        expect(lines.filter((_, i) => i !== 1)).toEqual(file.split("\r\n").filter((_, i) => i !== 1));
        expect(JSON.parse(text)["room.chat.send"].ru).toBe("Послать \"это\"\nсейчас");
    });

    it("adds plural forms between en and note, in the catalog's style", () => {
        const forms = { one: "{count} день", few: "{count} дня", many: "{count} дней" };
        const { text } = updateEntryText(file, "room.chat.days", "ru", null, forms);
        expect(text.split("\r\n")[2]).toBe(`  "room.chat.days": { "en": {"one": "{count} day", "other": "{count} days"}, "ru": {"one": "{count} день", "few": "{count} дня", "many": "{count} дней"}, "note": "дни" },`);
    });

    it("leaves a cleared field out, on the last line without a comma", () => {
        const { text, fields } = updateEntryText(file, "room.chat.today", "note", "разделитель", "");
        expect(fields).toEqual({ en: "Today", ru: "Сегодня" });
        expect(text.split("\r\n")[3]).toBe(`  "room.chat.today": { "en": "Today", "ru": "Сегодня" }`);
    });

    it("refuses when the field has changed since the page was loaded", () => {
        expect(() => updateEntryText(file, "room.chat.send", "ru", "Отправка", "Послать")).toThrow(Conflict);
        expect(() => updateEntryText(file, "room.chat.days", "ru", "", "x")).not.toThrow();
    });

    it("refuses fields and values an entry can't hold", () => {
        expect(() => updateEntryText(file, "room.chat.send", "key", null, "x")).toThrow(/not one of/);
        expect(() => updateEntryText(file, "room.chat.send", "note", null, { one: "x" })).toThrow(/a string is expected/);
        expect(() => updateEntryText(file, "room.chat.missing", "ru", null, "x")).toThrow(/not on a line/);
    });
});
