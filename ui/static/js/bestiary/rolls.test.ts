import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createSheetInstance, type SheetInstance } from "../sheet/instance";
import type { SheetPayload } from "../sheet/payload";
import { listenRolls } from "./rolls";
import { rolls } from "./state";

const payload: SheetPayload = {
    sheetId: "11",
    kind: "black_crusade",
    canEdit: false,
    content: { characterInfo: { characterName: "Ork Boy" } } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
};

/** What the page sent over its socket; `offline` cancels the event, as socket.ts does with no connection. */
const sent: { type: string; eventID: string; messageBody: string; characterName: string | null }[] = [];
let offline = false;

const server = (type: string, detail: object) => document.dispatchEvent(new CustomEvent(`ws:${type}`, { detail }));

let sheet: SheetInstance;

beforeAll(() => {
    document.addEventListener("room:sendMessage", e => {
        if (offline) {
            e.preventDefault();
            return;
        }
        sent.push(JSON.parse((e as CustomEvent<string>).detail));
    });
    listenRolls();
    sheet = createSheetInstance(payload);
});

afterEach(() => {
    sent.length = 0;
    offline = false;
    rolls.value = [];
});

describe("a roll of a sheet on the bestiary page", () => {
    it("goes to the server as the room's command, signed with the character", async () => {
        const outcome = sheet.rolls.versus(45, 1, "Ballistic Skill");
        expect(sent).toEqual([{
            type: "roll",
            eventID: expect.any(String),
            messageBody: "/r d100 vs 45 [+1]\n>> Ballistic Skill",
            characterName: "Ork Boy",
        }]);

        const versus = { roll: 12, target: 45, success: true, degrees: 4, crit: false, doubles: false };
        server("rollResult", {
            type: "rollResult", eventID: sent[0].eventID, messageBody: sent[0].messageBody,
            commandResult: "d100 vs 45 [+1]:\n12, 4 success", versus, characterName: "Ork Boy", created: "2026-10-01T12:00:00Z",
        });

        await expect(outcome).resolves.toEqual(versus);
        expect(rolls.value).toEqual([expect.objectContaining({
            messageBody: "/r d100 vs 45 [+1]\n>> Ballistic Skill",
            commandResult: "d100 vs 45 [+1]:\n12, 4 success",
            characterName: "Ork Boy",
            createdAt: "2026-10-01T12:00:00Z",
        })]);
    });

    it("gives the total of a dice expression", async () => {
        const total = sheet.rolls.exact("1d10+4", "Choppa");
        expect(sent[0].messageBody).toBe("/r 1d10+4\n>> Choppa");
        server("rollResult", {
            type: "rollResult", eventID: sent[0].eventID, messageBody: sent[0].messageBody,
            commandResult: "1d10+4:\n7 + 4 = 11", characterName: "Ork Boy", created: "2026-10-01T12:00:00Z",
        });
        await expect(total).resolves.toBe(11);
    });

    it("comes to nothing when the server refuses it, the socket drops or is closed", async () => {
        const refused = sheet.rolls.exact("1d10", "");
        server("response", { type: "response", eventID: sent[0].eventID, OK: false, code: "validation" });
        await expect(refused).resolves.toBeNull();

        const dropped = sheet.rolls.versus(30, 0, "");
        server("disconnected", {});
        await expect(dropped).resolves.toBeNull();

        offline = true;
        await expect(sheet.rolls.versus(30, 0, "")).resolves.toBeNull();
        expect(rolls.value).toEqual([]);
    });

    it("keeps the last 20 in the feed", () => {
        for (let i = 1; i <= 25; i++) {
            void sheet.rolls.exact(`${i}d10`, "");
            const msg = sent.at(-1)!;
            server("rollResult", {
                type: "rollResult", eventID: msg.eventID, messageBody: msg.messageBody,
                commandResult: `${i}d10:\n${i}`, created: "2026-10-01T12:00:00Z",
            });
        }
        expect(rolls.value.map(r => r.messageBody)).toEqual(Array.from({ length: 20 }, (_, i) => `/r ${i + 6}d10`));
    });
});
