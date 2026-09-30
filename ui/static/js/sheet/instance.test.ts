import { afterEach, describe, expect, it } from "vitest";
import type { SheetPayload } from "./payload";
import { createSheetInstance, holdSheet, releaseSheet, replaceSheet, sheets as onPage, type SheetInstance } from "./instance";
// Routes the remote changes to the sheets they are for.
import "./network";

const payload = (sheetId: string, name: string, strength: number): SheetPayload => ({
    sheetId,
    kind: "black_crusade",
    canEdit: true,
    content: {
        characterInfo: { characterName: name },
        characteristics: { S: { value: strength } },
    } as unknown as SheetPayload["content"],
    rollDefaults: {} as SheetPayload["rollDefaults"],
});

const receive = (msg: { type: string; [key: string]: unknown }) =>
    document.dispatchEvent(new CustomEvent(`ws:${msg.type}`, { detail: msg }));

const nameOf = (sheet: SheetInstance) => sheet.state.characterInfo.characterName.value;
const strengthOf = (sheet: SheetInstance) => sheet.state.characteristics.S.calculatedValue.value;

describe("two sheets in one document", () => {
    let sheets: SheetInstance[] = [];
    const open = (p: SheetPayload) => {
        const sheet = createSheetInstance(p);
        sheets.push(sheet);
        return sheet;
    };

    afterEach(() => {
        for (const sheet of sheets) sheet.dispose();
        sheets = [];
    });

    it("keep their own values and computeds", () => {
        const kharn = open(payload("1", "Kharn", 50));
        const lorgar = open(payload("2", "Lorgar", 30));

        expect([nameOf(kharn), nameOf(lorgar)]).toEqual(["Kharn", "Lorgar"]);
        expect([strengthOf(kharn), strengthOf(lorgar)]).toEqual([50, 30]);

        kharn.actions.change("characteristics.S.value", 60);
        expect([strengthOf(kharn), strengthOf(lorgar)]).toEqual([60, 30]);
    });

    it("keep their own collapsed items and open tabs", () => {
        const kharn = open(payload("1", "Kharn", 50));
        const lorgar = open(payload("2", "Lorgar", 30));

        kharn.ui.collapsedSignal("talents.list.items.t1", () => false).value = true;
        kharn.ui.selectedTabSignal("psykana.tabs.items").value = "t2";

        expect(lorgar.ui.collapsedSignal("talents.list.items.t1", () => false).value).toBe(false);
        expect(lorgar.ui.selectedTabSignal("psykana.tabs.items").value).toBe(null);
    });

    it("take only the remote changes of their own sheet", () => {
        const kharn = open(payload("1", "Kharn", 50));
        const lorgar = open(payload("2", "Lorgar", 30));

        receive({ type: "change", eventID: "e1", sheetID: "1", path: "characterInfo.characterName", change: "Kharn the Betrayer" });

        expect([nameOf(kharn), nameOf(lorgar)]).toEqual(["Kharn the Betrayer", "Lorgar"]);
    });

    it("go on when another one is disposed", () => {
        const kharn = open(payload("1", "Kharn", 50));
        const lorgar = open(payload("2", "Lorgar", 30));

        kharn.dispose();
        receive({ type: "change", eventID: "e1", sheetID: "1", path: "characterInfo.characterName", change: "Gone" });
        receive({ type: "change", eventID: "e2", sheetID: "2", path: "characteristics.S.value", change: 45 });

        expect(nameOf(kharn)).toBe("Kharn");
        expect(strengthOf(lorgar)).toBe(45);
    });
});

// The room shows a sheet the encounter keeps too: both hold one instance.
describe("a sheet held twice", () => {
    afterEach(() => {
        for (const sheet of [...onPage.values()]) sheet.dispose();
    });

    it("is one instance until the last holder lets go", () => {
        const shown = holdSheet(payload("1", "Kharn", 50));
        const kept = holdSheet(payload("1", "Someone else", 10));
        expect(kept).toBe(shown);
        expect(nameOf(kept)).toBe("Kharn");

        releaseSheet("1");
        expect(onPage.get("1")).toBe(shown);
        receive({ type: "change", eventID: "e1", sheetID: "1", path: "characterInfo.characterName", change: "Kharn the Betrayer" });
        expect(nameOf(kept)).toBe("Kharn the Betrayer");

        releaseSheet("1");
        expect(onPage.has("1")).toBe(false);
    });

    it("read again, is a new instance with the old UI state for all its holders", () => {
        const old = holdSheet(payload("1", "Kharn", 50));
        holdSheet(payload("1", "Kharn", 50));
        old.ui.selectedTabSignal("psykana.tabs").value = "t2";
        const replaced: string[] = [];
        const listen = (e: Event) => {
            replaced.push((e as CustomEvent).detail.sheetID);
            // The views move over while the old one still stands.
            expect(old.scope.pending).toBeGreaterThan(0);
        };
        document.addEventListener("sheet:replaced", listen);

        const renewed = replaceSheet(payload("1", "Lorgar", 30))!;
        document.removeEventListener("sheet:replaced", listen);

        expect(replaced).toEqual(["1"]);
        expect(onPage.get("1")).toBe(renewed);
        expect(nameOf(renewed)).toBe("Lorgar");
        expect(renewed.ui.selectedTabSignal("psykana.tabs").value).toBe("t2");
        releaseSheet("1");
        expect(onPage.get("1")).toBe(renewed);
        releaseSheet("1");
        expect(onPage.has("1")).toBe(false);
        expect(replaceSheet(payload("1", "Nobody", 1))).toBeNull();
    });
});
