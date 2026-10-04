import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyRemote, loadState, recordingActions, teardownSheet, testScope, testState } from "./components/testUtils";
import { announceCharacterName } from "./characterName";

let events: unknown[] = [];
const record = (e: Event) => events.push((e as CustomEvent).detail);

beforeEach(() => {
    events = [];
    document.addEventListener("sheet:nameChanged", record);
    loadState({ characterInfo: { characterName: "Kharn" } });
});

afterEach(() => {
    teardownSheet();
    document.removeEventListener("sheet:nameChanged", record);
});

describe("announceCharacterName", () => {
    it("tells the room the name on open and on local and remote edits while the sheet lives", () => {
        announceCharacterName({ sheetId: "7", state: testState(), scope: testScope });
        recordingActions().change("characterInfo.characterName", "Abaddon");
        applyRemote({ type: "change", path: "characterInfo.characterName", change: "Lorgar" });
        applyRemote({ type: "change", path: "characterInfo.race", change: "Human" });
        teardownSheet();
        applyRemote({ type: "change", path: "characterInfo.characterName", change: "Late" });

        expect(events).toEqual([
            { sheetID: "7", change: "Kharn" },
            { sheetID: "7", change: "Abaddon" },
            { sheetID: "7", change: "Lorgar" },
        ]);
    });
});
