import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { ChatMessage } from "./ChatMessage";
import type { ResultData } from "../commands.gen";
import { installDictionary } from "../../i18n/testDictionary";

let root: HTMLElement;
beforeEach(() => {
    root = document.createElement("div");
    document.body.append(root);
});
afterEach(() => {
    render(null, root);
    root.remove();
});

const commandResult = "d100 vs 40 [+1]:\n12, 4 success, crit!";
const resultData: ResultData = { kind: "versus", expression: "d100", target: 40, bonus: 1, rolls: [{ roll: 12, success: true, degrees: 4, crit: true }] };

function resultOf(msg: { commandResult: string | null; resultData?: ResultData | null }): string | null | undefined {
    render(<ChatMessage msg={{ messageBody: "/r d100 vs 40 [+1]", createdAt: "2026-10-01T12:00:00Z", ...msg }} own={false} />, root);
    return root.querySelector(".command-result")?.textContent;
}

describe("the result of a chat command", () => {
    it("is drawn from its data in the viewer's language", () => {
        expect(resultOf({ commandResult, resultData })).toBe(commandResult);
        installDictionary("ru");
        expect(resultOf({ commandResult, resultData })).toBe("d100 vs 40 [+1]:\n12, 4 Успеха, крит!");
    });

    it("of a message without data is the text the server stored", () => {
        installDictionary("ru");
        expect(resultOf({ commandResult, resultData: null })).toBe(commandResult);
        expect(resultOf({ commandResult })).toBe(commandResult);
        expect(resultOf({ commandResult: null })).toBeUndefined();
    });
});
