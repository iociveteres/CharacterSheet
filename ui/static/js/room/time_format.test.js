import { describe, expect, it } from "vitest";
import { humanDate } from "./time_format.js";

describe("humanDate", () => {
    it("reads as the server wrote it, in any browser language", () => {
        // Local time, so the expectation holds in the time zone of any machine.
        expect(humanDate(new Date(2026, 0, 5, 0, 7).toISOString())).toBe("05 Jan 2026 at 00:07");
        expect(humanDate(new Date(2026, 8, 27, 23, 59).toISOString())).toBe("27 Sep 2026 at 23:59");
        expect(humanDate("")).toBe("");
    });
});
