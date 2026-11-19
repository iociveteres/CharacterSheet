import { describe, expect, it } from "vitest";
import { installDictionary } from "../i18n/testDictionary";
import { formatDateLabel, humanDate } from "./time_format";

describe("humanDate", () => {
    it("reads as the server wrote it, in any browser language", () => {
        // Local time, so the expectation holds in the time zone of any machine.
        expect(humanDate(new Date(2026, 0, 5, 0, 7).toISOString())).toBe("05 Jan 2026 at 00:07");
        expect(humanDate(new Date(2026, 8, 27, 23, 59).toISOString())).toBe("27 Sep 2026 at 23:59");
        expect(humanDate("")).toBe("");
    });

    it("follows the site's language", () => {
        installDictionary("ru");
        expect(humanDate(new Date(2026, 0, 5, 0, 7).toISOString())).toBe("5 января 2026 в 00:07");
        expect(humanDate(new Date(2026, 8, 27, 23, 59).toISOString())).toBe("27 сентября 2026 в 23:59");
    });
});

describe("formatDateLabel", () => {
    it("names today and yesterday, and spells other days in the site's language", () => {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const names = [formatDateLabel(new Date()), formatDateLabel(yesterday)];
        expect(names.every(name => !/\d/.test(name))).toBe(true);
        expect(new Set(names).size).toBe(2);
        expect(formatDateLabel(new Date(2026, 0, 5))).toBe("January 5");
        installDictionary("ru");
        expect(formatDateLabel(new Date(2026, 0, 5))).toBe("5 января");
    });
});
