import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import type { Signal } from "@preact/signals-core";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { attachComputeds } from "../state/computed";
import { resolvePath } from "../state/sync";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const value = (path: string) => (resolvePath(testState(), path) as Signal<unknown>).value;

let rendered: Rendered | null = null;

function render(content: object, canEdit = true): void {
    loadState(content);
    attachComputeds(testState());
    rendered = renderBlock(<Psykana />, { canEdit });
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

const $ = <E extends Element = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);

describe("the psykana settings", () => {
    it("are on unless the sheet turned them off", () => {
        render({ settings: { psykana: { cycle: false } } });
        expect(["sustained", "cycle", "phenomena", "noticeSeen"].map(f => value(`settings.psykana.${f}`))).toEqual([true, false, true, false]);
    });

    it("open under the ⚙ next to the heading and change the sheet's flags", () => {
        render({});
        expect($(".psykana-heading h2")!.textContent).toBe("Psykana");
        expect($(".psykana-settings-dropdown")).toBeNull();

        act(() => $<HTMLButtonElement>(".psykana-settings-toggle")!.click());
        const boxes = Array.from(rendered!.container.querySelectorAll<HTMLInputElement>(".psykana-settings-dropdown input"));
        expect(boxes.map(b => [b.dataset.id, b.checked])).toEqual([["sustained", true], ["cycle", true], ["phenomena", true]]);

        act(() => boxes[0].click());
        expect(value("settings.psykana.sustained")).toBe(false);
    });
});

describe("the psykana notice", () => {
    const power = {
        tabs: {
            items: { t1: { name: "Tab", powers: { items: { p1: { name: "Smite" } }, layouts: { p1: pos(0, 0) } } } },
            layouts: { t1: pos(0, 0) },
        },
    };

    it("shows on a psyker's sheet until dismissed", () => {
        render({ psykana: power });
        expect($('[data-id="psykanaNotice"]')).not.toBeNull();
        expect($('[data-id="typedSustained"]')).toBeNull();

        act(() => $<HTMLButtonElement>('[data-id="psykanaNotice"] button')!.click());
        expect(value("settings.psykana.noticeSeen")).toBe(true);
        expect($('[data-id="psykanaNotice"]')).toBeNull();
    });

    it("says that typed sustained powers are counted now, unless the counting is off", () => {
        render({ psykana: { basePR: 4, sustainedPowers: 2 } });
        expect($('[data-id="typedSustained"]')!.textContent).toMatch(/^Sustained Powers was typed as 2\./);

        teardownSheet();
        rendered!.unmount();
        render({ psykana: { basePR: 4, sustainedPowers: 2 }, settings: { psykana: { sustained: false } } });
        expect($('[data-id="psykanaNotice"]')).not.toBeNull();
        expect($('[data-id="typedSustained"]')).toBeNull();
    });

    it("stays away from a sheet without psykana, one seen and one that cannot be edited", () => {
        render({});
        expect($('[data-id="psykanaNotice"]')).toBeNull();
        rendered!.unmount();
        teardownSheet();

        render({ psykana: { basePR: 3 }, settings: { psykana: { noticeSeen: true } } });
        expect($('[data-id="psykanaNotice"]')).toBeNull();
        rendered!.unmount();
        teardownSheet();

        render({ psykana: { basePR: 3 } }, false);
        expect($('[data-id="psykanaNotice"]')).toBeNull();
    });
});
