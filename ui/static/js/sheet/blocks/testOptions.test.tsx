import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, recordingActions, renderBlock, type Rendered } from "../components/testUtils";
import { teardownSheet } from "../lifecycle";
import { BLACK_CRUSADE_STATS } from "../schema/constants";
import { attachComputeds } from "../state/computed";
import { characterState } from "../state/state";
import { applyRemoteToState } from "../state/remote";
import { createItemInState, deleteItemFromState, updateSignalAtPath } from "../state/sync";
import { testBaseGroups } from "../state/testOptions";
import { resetUiState } from "../state/ui";
import { CustomSkills } from "./CustomSkills";
import { Psykana, TechnoArcana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (items: { [id: string]: object }) => ({
    items,
    layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])),
});

const TECH = "technoArcana.tabs.items.t1.powers.items.p1.roll.testOption";

let rendered: Rendered | null = null;

beforeEach(() => {
    loadState({
        characteristics: { A: { value: "30" }, I: { value: "40" }, W: { value: "45" } },
        skillsRight: { "1_common_lore": { name: "Imperium" } },
        customSkills: {
            list: {
                items: { s2: { name: "" }, s1: { name: "Pilot", characteristic: "A", plus0: true, miscBonus: 7 }, s3: { name: "Brew" } },
                layouts: { s1: pos(0, 1), s2: pos(0, 0), s3: pos(0, 2) },
            },
        },
        psykana: {
            testOptions: grid({ o1: { base: "W" }, o2: { base: "psyniscience", characteristic: "W" } }),
            tabs: grid({ t1: { powers: grid({ p1: { name: "Smite", roll: { testOption: "o1" } } }) } }),
        },
        technoArcana: {
            testOptions: grid({
                o1: { base: "tech-use" },
                o2: { base: "awareness", characteristic: "I" },
                o3: { base: "custom:s1" },
                o4: { base: "navigate_warp" },
                o5: { base: "1_common_lore" },
                // A characteristic is tested on itself.
                o6: { base: "A", characteristic: "I" },
                o7: { base: "tech-use" },
            }),
            tabs: grid({ t1: { powers: grid({ p1: { name: "Scan", roll: { testOption: "o3" } } }) } }),
        },
    });
    attachComputeds(characterState);
});

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    resetUiState();
    teardownSheet();
});

const q = <E extends Element>(selector: string) => rendered!.container.querySelector<E>(selector)!;
const optionsOf = (select: HTMLSelectElement) => Array.from(select.options, o => [o.value, o.text]);
const powerSelect = () => q<HTMLSelectElement>('[data-id="p1"] [data-id="testOption"]');

describe("testBaseGroups", () => {
    it("groups the characteristics, the skills by their row's group and the named custom skills", () => {
        loadState({
            skillsRight: { "1_common_lore": { name: "Imperium" } },
            customSkills: { list: grid({ s1: { name: "Pilot" }, s2: { name: " " } }) },
        });
        const groups = testBaseGroups(BLACK_CRUSADE_STATS);

        expect(groups.map(g => g.label)).toEqual(["Characteristics", "Skills", "Navigate", "Operate", "Common Lore", "Custom skills"]);
        expect(groups[0].options).toEqual(["WS", "BS", "S", "T", "A", "I", "P", "W", "F", "Inf", "Cor"]);
        expect(groups[2].options).toEqual([
            { value: "navigate_surface", label: "Surface" },
            { value: "navigate_stellar", label: "Stellar" },
            { value: "navigate_warp", label: "Warp" },
        ]);
        expect(groups[4].options).toEqual([{ value: "1_common_lore", label: "Imperium" }]);
        expect(groups[5].options).toEqual([{ value: "custom:s1", label: "Pilot" }]);
    });
});

describe("the test select of a power", () => {
    const total = () => q<HTMLInputElement>('[data-id="p1"] [data-id="total"]').value;

    it("offers the test options of its block in their order, by id", () => {
        rendered = renderBlock(<TechnoArcana />);
        expect(optionsOf(powerSelect())).toEqual([
            ["o1", "Tech-Use"],
            ["o2", "Awareness (I)"],
            ["o3", "Pilot"],
            ["o4", "Navigate: Warp"],
            ["o5", "Imperium"],
            ["o6", "A"],
            ["o7", "Tech-Use"],
        ]);
        expect(powerSelect().value).toBe("o3");
    });

    it("tests a custom skill by its id", () => {
        rendered = renderBlock(<TechnoArcana />);
        // A 30, trained, misc 7.
        expect(total()).toBe("37");

        act(() => updateSignalAtPath("customSkills.list.items.s1.name", "Voidship"));
        expect(total()).toBe("37");
        expect(powerSelect().selectedOptions[0].text).toBe("Voidship");
    });

    it("follows an edit of its test option", () => {
        rendered = renderBlock(<TechnoArcana />);
        act(() => updateSignalAtPath("technoArcana.testOptions.items.o3.base", "I"));

        expect(powerSelect().value).toBe("o3");
        expect(powerSelect().selectedOptions[0].text).toBe("I");
        expect(total()).toBe("40");
    });

    it("has no test when its test option is deleted", () => {
        rendered = renderBlock(<TechnoArcana />);
        act(() => deleteItemFromState("technoArcana.testOptions.items.o3"));

        expect(optionsOf(powerSelect())[0]).toEqual(["o3", "(test deleted)"]);
        expect(powerSelect().value).toBe("o3");
        expect(total()).toBe("0");
        expect(q<HTMLButtonElement>('[data-id="p1"] [data-id="rollButton"]').disabled).toBe(true);
    });

    it("sends the picked test option", () => {
        const actions = recordingActions();
        rendered = renderBlock(<TechnoArcana />, { actions });
        const select = powerSelect();
        select.value = "o2";
        act(() => { select.dispatchEvent(new Event("change", { bubbles: true })); });

        expect(actions.scheduled).toEqual([[{ type: "change", path: TECH, change: "o2" }, TECH]]);
        // Untrained Awareness on I 40.
        expect(total()).toBe("20");
    });

    it("of a new power is the first test option of its block", () => {
        const actions = recordingActions();
        rendered = renderBlock(<Psykana />, { actions });
        act(() => applyRemoteToState({ type: "positionsChanged", path: "psykana.testOptions.items", positions: { o2: pos(0, 0), o1: pos(0, 1) } }));
        act(() => q<HTMLButtonElement>('[data-id="powers.items"] .add-button').click());

        const created = actions.sent.find(m => (m as { type: string }).type === "createItem") as { init: { roll: { testOption: string } } };
        expect(created.init.roll.testOption).toBe("o2");
    });
});

describe("the Test Options dropdown", () => {
    const optionRow = (id: string) => `[data-id="testOptions.items"] [data-id="${id}"]`;

    it("opens from its button", () => {
        rendered = renderBlock(<Psykana />);
        const dropdown = q(".test-options-dropdown");
        expect(dropdown.classList.contains("visible")).toBe(false);
        act(() => q<HTMLButtonElement>(".test-options-toggle").click());
        expect(dropdown.classList.contains("visible")).toBe(true);
    });

    it("picks the base of an option from groups of what the sheet has", () => {
        rendered = renderBlock(<TechnoArcana />);
        const base = q<HTMLSelectElement>(`${optionRow("o3")} [data-id="base"]`);
        const groups = Array.from(base.querySelectorAll("optgroup"), g => g.label);

        expect(groups).toEqual(["Characteristics", "Skills", "Navigate", "Operate", "Common Lore", "Custom skills"]);
        expect(base.value).toBe("custom:s1");
        expect(Array.from(base.querySelectorAll<HTMLOptionElement>('optgroup[label="Custom skills"] option'), o => o.text)).toEqual(["Pilot", "Brew"]);
    });

    it("keeps a base the sheet no longer has as an option of its own", () => {
        rendered = renderBlock(<TechnoArcana />);
        const base = q<HTMLSelectElement>(`${optionRow("o5")} [data-id="base"]`);
        expect(base.value).toBe("1_common_lore");

        act(() => updateSignalAtPath("skillsRight.1_common_lore.name", ""));
        expect(base.options[0].value).toBe("1_common_lore");
        expect(base.options[0].text).toBe("Common Lore");
        expect(base.value).toBe("1_common_lore");

        act(() => updateSignalAtPath("skillsRight.1_common_lore.name", "Tau"));
        expect(base.options[0].value).toBe("WS");
        expect(base.value).toBe("1_common_lore");
        expect(base.selectedOptions[0].text).toBe("Tau");
    });

    it("tests a characteristic on itself", () => {
        rendered = renderBlock(<TechnoArcana />);
        expect(q<HTMLSelectElement>(`${optionRow("o6")} [data-id="characteristic"]`).disabled).toBe(true);
        expect(q<HTMLSelectElement>(`${optionRow("o2")} [data-id="characteristic"]`).disabled).toBe(false);
        expect(q<HTMLSelectElement>(`${optionRow("o2")} [data-id="characteristic"]`).value).toBe("I");
    });

    it("drops the characteristic of a skill when the base becomes a characteristic", () => {
        const actions = recordingActions();
        rendered = renderBlock(<TechnoArcana />, { actions });
        const o2 = "technoArcana.testOptions.items.o2";
        const base = q<HTMLSelectElement>(`${optionRow("o2")} [data-id="base"]`);
        const pick = (value: string) => {
            base.value = value;
            act(() => { base.dispatchEvent(new Event("change", { bubbles: true })); });
        };

        pick("logic");
        expect(actions.scheduled.at(-1)).toEqual([{ type: "batch", path: o2, changes: { base: "logic" } }, o2]);
        expect(q<HTMLSelectElement>(`${optionRow("o2")} [data-id="characteristic"]`).value).toBe("I");

        pick("W");
        expect(actions.scheduled.at(-1)).toEqual([{ type: "batch", path: o2, changes: { base: "W", characteristic: "" } }, o2]);
        expect(q<HTMLSelectElement>(`${optionRow("o2")} [data-id="characteristic"]`).value).toBe("");
    });

    it("of a custom skill go with the skill", () => {
        const actions = recordingActions();
        act(() => createItemInState("psykana.testOptions.items", "o3", { base: "custom:s1", characteristic: "" }, pos(0, 2)));
        rendered = renderBlock(<><CustomSkills /><TechnoArcana /></>, { actions });
        act(() => q<HTMLButtonElement>('[data-id="s1"] .delete-button').click());

        expect(actions.sent.map(m => (m as { path: string }).path).sort()).toEqual([
            "customSkills.list.items.s1", "psykana.testOptions.items.o3", "technoArcana.testOptions.items.o3",
        ]);
        expect(characterState.technoArcana.testOptions.items.o3).toBeUndefined();
        expect(characterState.technoArcana.testOptions.items.o7).toBeDefined();
        expect(powerSelect().selectedOptions[0].text).toBe("(test deleted)");
    });

    it("offers a new option to the powers", () => {
        rendered = renderBlock(<Psykana />);
        act(() => createItemInState("psykana.testOptions.items", "o3", { base: "logic", characteristic: "" }, pos(0, 2)));
        expect(optionsOf(powerSelect()).at(-1)).toEqual(["o3", "Logic"]);
    });
});
