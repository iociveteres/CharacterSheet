import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { render } from "preact";
import { ChatMessage } from "./ChatMessage";
import type { ResultData } from "../commands.gen";
import { messageText, renderResult } from "../commandResult";
import { labelText } from "../../sheet/api";
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

const commandResult = "d100 vs 40 [+1]:\n12, 4 successes, crit!";
const resultData: ResultData = { kind: "versus", expression: "d100", target: 40, bonus: 1, rolls: [{ roll: 12, success: true, degrees: 4, crit: true }] };

function resultOf(msg: { commandResult: string | null; resultData?: ResultData | null }): string | null | undefined {
    render(<ChatMessage msg={{ messageBody: "/r d100 vs 40 [+1]", createdAt: "2026-10-01T12:00:00Z", ...msg }} own={false} />, root);
    return root.querySelector(".command-result")?.textContent;
}

describe("the result of a chat command", () => {
    it("is drawn from its data, not from the text the server stored", () => {
        expect(resultOf({ commandResult: "stored", resultData })).toBe(renderResult(resultData));
    });

    it("of the roll for NPCs is headed by its data, whatever body was stored", () => {
        const initiative: ResultData = { kind: "initiative", expression: "", target: 0, rolls: [], initiative: [{ name: "Group 1", expression: "1d10+4", total: 9 }] };
        const show = (body: string, data: ResultData | null) => {
            render(<ChatMessage msg={{ messageBody: body, commandResult: "Group 1: 1d10+4 = 9", resultData: data, createdAt: "2026-10-01T12:00:00Z" }} own={false} />, root);
            return root.querySelector(".message-body")?.textContent;
        };
        expect(show("Initiative", initiative)).toBe(show("Инициатива", initiative));
        // Stored before the data, it shows as the server wrote it.
        expect(show("Initiative", null)).toBe("Initiative");
    });

    it("of a message without data is the text the server stored", () => {
        installDictionary("ru");
        expect(resultOf({ commandResult, resultData: null })).toBe(commandResult);
        expect(resultOf({ commandResult })).toBe(commandResult);
        expect(resultOf({ commandResult: null })).toBeUndefined();
    });
});

describe("the label of a roll stored as data", () => {
    it("follows the body in the reader's language", () => {
        const labelData = { n: ["name:initiative"] as [string] };
        const body = () => {
            render(<ChatMessage msg={{ messageBody: "/r 1d10", commandResult: null, labelData, createdAt: "2026-10-01T12:00:00Z" }} own={false} />, root);
            return root.querySelector(".message-body")?.textContent;
        };
        expect(body()).toBe(messageText("/r 1d10", null, labelData));
        installDictionary("ru");
        expect(body()).toBe(`/r 1d10\n>> ${labelText(labelData)}`);
    });
});
