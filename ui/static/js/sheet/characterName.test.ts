import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadState, recordingActions } from "./components/testUtils";
import { teardownSheet } from "./lifecycle";
import { applyRemoteToState } from "./state/remote";
import { announceCharacterName } from "./characterName";
import { networkHandlers } from "../room/network.js";

const TYPES = ["sheet:nameChanged", "sheet:closed"];

let events: [string, unknown][] = [];
const record = (e: Event) => events.push([e.type, (e as CustomEvent).detail]);

beforeEach(() => {
    events = [];
    TYPES.forEach(type => document.addEventListener(type, record));
    loadState({ characterInfo: { characterName: "Kharn" } });
});

afterEach(() => {
    teardownSheet();
    TYPES.forEach(type => document.removeEventListener(type, record));
});

describe("announceCharacterName", () => {
    it("tells the room the name on open, on local and remote edits, and the close", () => {
        announceCharacterName("7");
        recordingActions().change("characterInfo.characterName", "Abaddon");
        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: "Lorgar" });
        applyRemoteToState({ type: "change", path: "characterInfo.race", change: "Human" });
        teardownSheet();
        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: "Late" });

        expect(events).toEqual([
            ["sheet:nameChanged", { sheetID: "7", change: "Kharn" }],
            ["sheet:nameChanged", { sheetID: "7", change: "Abaddon" }],
            ["sheet:nameChanged", { sheetID: "7", change: "Lorgar" }],
            ["sheet:closed", { sheetID: "7" }],
        ]);
    });

    it("keeps the room list of sheets in step", () => {
        const room = { allPlayers: [{ sheets: [{ id: 7, name: "Kharn" }, { id: 8, name: "Other" }] }] };
        const listener = (e: Event) => networkHandlers.handleNameChanged.call(room as never, (e as CustomEvent).detail);
        document.addEventListener("sheet:nameChanged", listener);
        announceCharacterName("7");
        applyRemoteToState({ type: "change", path: "characterInfo.characterName", change: "Lorgar" });
        document.removeEventListener("sheet:nameChanged", listener);

        expect(room.allPlayers[0].sheets.map(s => s.name)).toEqual(["Lorgar", "Other"]);
    });
});
