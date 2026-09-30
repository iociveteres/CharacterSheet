import { afterEach, expect, it } from "vitest";
import { createSheetInstance, type SheetInstance } from "../instance";
import type { SheetPayload } from "../payload";
import { rollInitiative } from "./initiative";

let sheet: SheetInstance | null = null;
afterEach(() => {
    sheet?.dispose();
    sheet = null;
});

it("is kept by a sheet that is not rendered, when its own result is back", async () => {
    sheet = createSheetInstance({
        sheetId: "7",
        kind: "black_crusade",
        canEdit: true,
        content: { characterInfo: { characterName: "Ork Boy" }, initiative: { dice: "1d10", flatBonus: 3 } },
        rollDefaults: {},
    } as unknown as SheetPayload);

    let requestId = "";
    const listener = (e: Event) => { requestId = (e as CustomEvent).detail.requestId; };
    document.addEventListener("sheet:rollExact", listener);
    const done = rollInitiative(sheet);
    document.removeEventListener("sheet:rollExact", listener);
    document.dispatchEvent(new CustomEvent("sheet:rollResult", { detail: { requestId, outcome: null, commandResult: "1d10+3 = 11" } }));
    await done;

    expect(sheet.state.initiative.lastInitiative.value).toBe(8);
});
