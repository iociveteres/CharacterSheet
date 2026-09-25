// Scenario 11: an initiative roll goes to the chat, and the chat's answer is
// stored as the last initiative.
import { beforeAll, describe, expect, it } from "vitest";
import type { Player } from "../lib/player";
import { useTable } from "../lib/table";
import { eventually } from "../lib/wait";

const NAME = "e2e 11 last initiative";

async function lastInitiative(p: Player): Promise<{ text: string; title: string | null }> {
    return (await p.el({ sel: "#initiativeResult" })).evaluate(el => ({
        text: el.querySelector("#lastInitiativeDisplay")!.textContent ?? "",
        title: el.getAttribute("title"),
    }));
}

describe("11. last initiative through the chat", () => {
    const t = useTable("11 last initiative");

    beforeAll(async () => {
        await t.a.write("characterInfo.characterName", NAME);
        await t.a.write("initiative.flatBonus", 2);
        await t.a.openNavTab("combat");
        await t.b.expectValue("initiative.flatBonus", "2");
    });

    it("the total of the chat's answer less the modifier is stored, and both players show the total", async () => {
        const { a, b } = t;
        await a.blockRolls(false);
        await a.clearRecords();
        await b.clearRecords();
        await a.click({ sel: ".initiative-wrapper label.rollable" });
        expect(await a.rolls()).toEqual([{ kind: "exact", expression: "d10+2", label: "Initiative" }]);

        const answer = await a.waitReceived(m => m.type === "chatMessage" && m.characterName === NAME && !!m.commandResult, "the roll in the chat");
        const total = Number(String(answer.commandResult).match(/=\s*(-?\d+)\s*$/)![1]);
        const sent = await a.waitSent(m => m.type === "change" && m.path === "initiative.lastInitiative", "the last initiative");
        expect(sent.change).toBe(total - 2);

        for (const p of [a, b]) {
            await eventually(() => lastInitiative(p), v => expect(v, p.name).toEqual({
                text: String(total),
                title: `Roll: ${total - 2}, Modifiers: +2, Total: ${total}`,
            }));
        }
        expect((await b.settledSheetMessages()).filter(m => m.path === "initiative.lastInitiative"), "B stores nothing").toEqual([]);
    });

    it("an answer for another character is ignored", async () => {
        const { a } = t;
        await a.blockRolls(true);
        await a.clearRecords();
        await a.click({ sel: ".initiative-wrapper label.rollable" });
        // An answer as network.js hands it on; it only reaches this page's chat.
        const answer = (characterName: string, commandResult: string) => a.page.evaluate(detail => {
            document.dispatchEvent(new CustomEvent("ws:chatMessage", { detail }));
        }, {
            type: "chatMessage", messageId: -1, userId: -1, userName: "e2e", messageBody: "/r d10+2",
            characterName, commandResult, created: new Date().toISOString(),
        });

        await answer("Somebody Else", "d10+2:\n5 + 2 = 7");
        expect(await a.settledSheetMessages()).toEqual([]);

        // The roll was still waiting for its answer.
        await answer(NAME, "d10+2:\n6 + 2 = 8");
        const sent = await a.waitSent(m => m.type === "change" && m.path === "initiative.lastInitiative", "the last initiative");
        expect(sent.change).toBe(6);
    });

    it("a roll without a modifier stores nothing: its answer has no \"=\" (old behaviour)", async () => {
        const { a } = t;
        await a.write("initiative.flatBonus", 0);
        await a.blockRolls(false);
        await a.clearRecords();
        await a.click({ sel: ".initiative-wrapper label.rollable" });
        expect(await a.rolls()).toEqual([{ kind: "exact", expression: "d10", label: "Initiative" }]);
        const answer = await a.waitReceived(m => m.type === "chatMessage" && m.characterName === NAME && !!m.commandResult, "the roll in the chat");
        expect(answer.commandResult).not.toMatch(/=/);
        expect(await a.settledSheetMessages()).toEqual([]);
        // The raw roll of the previous test, now without a modifier.
        expect(await lastInitiative(a)).toEqual({ text: "6", title: "Roll: 6, Modifiers: +0, Total: 6" });
    });
});
