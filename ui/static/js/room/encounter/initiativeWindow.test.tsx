import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render } from "preact";
import { act } from "preact/test-utils";
import { setShownView, toggleInitiativeWindow } from "./actions";
import { InitiativeWindow } from "./components/InitiativeWindow";
import { installDictionary } from "../../i18n/testDictionary";

const box = document.createElement("div");
const title = () => box.querySelector(".initiative-window-title")?.textContent;
const body = () => box.querySelector(".initiative-window-body")?.textContent;

/** Renders the window anew, as a page loaded in the language set. */
function show(): void {
    act(() => render(null, box));
    act(() => render(<InitiativeWindow />, box));
}

beforeAll(() => {
    document.body.appendChild(box);
    toggleInitiativeWindow();
});

afterAll(() => {
    render(null, box);
    box.remove();
});

describe("the initiative window", () => {
    it("names the round of the order shown", () => {
        setShownView({ round: 2, current: 0, rows: [{ name: "Ulrich", value: 14 }] });
        show();
        expect(title()).toBe("Initiative · round 2");
        installDictionary("ru");
        show();
        expect(title()).toBe("Инициатива · раунд 2");
    });

    it("says when no order is shown", () => {
        setShownView(null);
        show();
        expect(title()).toBe("Initiative");
        expect(body()).toBe("No encounter is shown.");
        installDictionary("ru");
        show();
        expect(title()).toBe("Инициатива");
        expect(body()).toBe("Ведущий не показывает столкновение.");
    });
});
