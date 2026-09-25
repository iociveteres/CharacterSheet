import { describe, expect, it } from "vitest";
import { normalizeChange } from "./normalizeChange";

function control(html: string): HTMLElement {
    const host = document.createElement("div");
    host.innerHTML = html;
    return host.firstElementChild as HTMLElement;
}

describe("normalizeChange on input", () => {
    it("sends text as typed", () => {
        expect(normalizeChange(control(`<input type="text" value="007">`), "input")).toBe("007");
        expect(normalizeChange(control(`<input value=" a ">`), "input")).toBe(" a ");
        expect(normalizeChange(control(`<textarea>line\nline</textarea>`), "input")).toBe("line\nline");
    });

    it("parses a number input and sends null when it is empty", () => {
        expect(normalizeChange(control(`<input type="number" value="12">`), "input")).toBe(12);
        expect(normalizeChange(control(`<input type="number" value="-1.5">`), "input")).toBe(-1.5);
        expect(normalizeChange(control(`<input type="number" value="">`), "input")).toBeNull();
    });

    it("sends a checkbox state and only the checked radio button", () => {
        const box = control(`<input type="checkbox">`) as HTMLInputElement;
        box.checked = true;
        expect(normalizeChange(box, "input")).toBe(true);

        const radio = control(`<input type="radio" value="half">`) as HTMLInputElement;
        expect(normalizeChange(radio, "input")).toBeUndefined();
        radio.checked = true;
        expect(normalizeChange(radio, "input")).toBe("half");
    });

    it("parses select values that look like numbers", () => {
        const sel = control(`<select><option value="2">2</option><option value="WS">WS</option></select>`) as HTMLSelectElement;
        sel.value = "2";
        expect(normalizeChange(sel, "input")).toBe(2);
        sel.value = "WS";
        expect(normalizeChange(sel, "input")).toBe("WS");
    });

    it("ignores elements that are not controls", () => {
        expect(normalizeChange(control(`<div data-id="x"></div>`), "input")).toBeUndefined();
    });
});

describe("normalizeChange on change", () => {
    it("leaves text to the input event", () => {
        expect(normalizeChange(control(`<input type="text" value="a">`), "change")).toBeUndefined();
        expect(normalizeChange(control(`<input type="number" class="textlike" value="1">`), "change")).toBeUndefined();
        expect(normalizeChange(control(`<textarea>a</textarea>`), "change")).toBeUndefined();
    });

    it("sends nothing for an empty value", () => {
        expect(normalizeChange(control(`<input type="number" value="">`), "change")).toBeUndefined();
    });

    it("sends numbers for number inputs and marked controls", () => {
        expect(normalizeChange(control(`<input type="number" value="007">`), "change")).toBe(7);
        const sel = control(`<select data-type="number"><option value="3">3</option></select>`);
        expect(normalizeChange(sel, "change")).toBe(3);
        const size = control(`<select data-id="size"><option value="4">4</option></select>`);
        expect(normalizeChange(size, "change")).toBe(4);
    });

    it("keeps select and radio values as strings", () => {
        const sel = control(`<select><option value="2">2</option></select>`);
        expect(normalizeChange(sel, "change")).toBe("2");
        const radio = control(`<input type="radio" value="1" checked>`);
        expect(normalizeChange(radio, "change")).toBe("1");
    });

    it("sends the checkbox state", () => {
        const box = control(`<input type="checkbox">`) as HTMLInputElement;
        expect(normalizeChange(box, "change")).toBe(false);
        box.checked = true;
        expect(normalizeChange(box, "change")).toBe(true);
    });
});

describe("normalizeChange on an advance checkbox of a skill", () => {
    it("sends nothing: the row sends all four advances as one batch", () => {
        for (const id of ["skills", "custom-skills"]) {
            const host = control(`<div id="${id}"><label><input type="checkbox" data-id="plus10"></label></div>`);
            const box = host.querySelector<HTMLInputElement>("input")!;
            box.checked = true;
            expect(normalizeChange(box, "input")).toBeUndefined();
            expect(normalizeChange(box, "change")).toBeUndefined();
        }
    });
});
