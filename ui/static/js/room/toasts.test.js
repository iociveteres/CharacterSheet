import { afterEach, describe, expect, it, vi } from "vitest";
import { toastsMixin } from "./toasts.js";

afterEach(() => vi.useRealTimers());

const messages = room => room.toasts.map(t => t.message);

describe("toasts", () => {
    it("show a notice of the sheet for five seconds, a repeated one once", () => {
        vi.useFakeTimers();
        const room = { ...toastsMixin, toasts: [] };
        room.setupToasts();
        const notice = message => document.dispatchEvent(new CustomEvent("sheet:notice", { detail: { message } }));

        notice("Not saved");
        vi.advanceTimersByTime(3000);
        notice("Other");
        notice("Not saved");
        expect(messages(room)).toEqual(["Other", "Not saved"]);

        // The repeated notice counts its five seconds from the repeat.
        vi.advanceTimersByTime(2500);
        expect(messages(room)).toEqual(["Other", "Not saved"]);
        vi.advanceTimersByTime(3000);
        expect(messages(room)).toEqual([]);
    });
});
