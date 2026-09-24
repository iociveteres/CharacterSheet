import { afterEach, describe, expect, it } from "vitest";
import { teardownSheet } from "../lifecycle";
import { isMigratedPath } from "../state/migrated";
import { getDataPath } from "../utils.js";
import { TextField } from "./fields";
import { isInMountedBlock, mountBlock, setBlockEnv } from "./mount";
import { loadState, recordingActions } from "./testUtils";

afterEach(() => {
    teardownSheet();
    document.body.innerHTML = "";
});

describe("mountBlock", () => {
    it("replaces the mount point's contents and continues the path of its ancestors", () => {
        loadState({ characterInfo: { characterName: "Kharn" } });
        setBlockEnv({ canEdit: true, actions: recordingActions(), autocomplete: null });
        document.body.innerHTML = `<div data-id="characterInfo"><div id="mount"><p>server markup</p></div></div>`;
        const mount = document.getElementById("mount")!;

        mountBlock(mount, <TextField field="characterName" />, { paths: ["characterInfo"] });

        const input = mount.querySelector("input")!;
        expect(mount.querySelector("p")).toBeNull();
        expect(input.value).toBe("Kharn");
        expect(getDataPath(input)).toBe("characterInfo.characterName");
        expect(isInMountedBlock(input)).toBe(true);
        expect(isInMountedBlock(document.body)).toBe(false);
        expect(isMigratedPath("characterInfo.characterName")).toBe(true);
    });

    it("unmounts the block and releases its paths when the sheet is removed", () => {
        loadState({});
        setBlockEnv({ canEdit: true, actions: recordingActions(), autocomplete: null });
        document.body.innerHTML = `<div id="mount"></div>`;
        const mount = document.getElementById("mount")!;
        mountBlock(mount, <TextField field="name" />, { paths: ["notes"] });

        document.body.dispatchEvent(new CustomEvent("charactersheet_removing", { bubbles: true }));

        expect(mount.childNodes).toHaveLength(0);
        expect(isMigratedPath("notes")).toBe(false);
        expect(isInMountedBlock(mount)).toBe(false);
    });
});
