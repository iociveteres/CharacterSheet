import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { PathfinderCrusadeStatBlock, pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { manaMax } from "../state/mana";
import { resourceStat } from "../state/tech";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { ManaBar } from "./Mana";
import { Psykana } from "./Powers";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const S = "psykana.tabs.items.t1.powers.items.s1";

/** A Bound caster with one spell, cast at ePR 3 with a kick of 1. */
const content = (over: object = {}) => ({
    characteristics: { W: { value: "40" } },
    psykana: {
        psykanaType: "Bound",
        basePR: 3,
        maxPush: 3,
        testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
        tabs: {
            items: { t1: { name: "Tab", powers: { items: { s1: { name: "Bolt", sustained: "Half action", roll: { testOption: "o1", effectivePR: 3, kickPR: 1 } } },
                layouts: { s1: pos(0, 0) } } } },
            layouts: { t1: pos(0, 0) },
        },
    },
    mana: { current: 5, max: { base: "7" } },
    ...over,
});

let rendered: Rendered | null = null;

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const openRoll = () => act(() => $(`[data-id="s1"] .name label`)!.click());
const rollButton = () => $<HTMLButtonElement>('[data-id="s1"] [data-id="rollButton"]')!;
const mana = () => valueAt(testState(), "mana.current");

/** The tests the clicks of `run` send, by their requestId. */
function rolls(run: () => void): string[] {
    const ids: string[] = [];
    const listener = (e: Event) => ids.push((e as CustomEvent).detail.requestId);
    document.addEventListener("sheet:rollVersus", listener);
    act(run);
    document.removeEventListener("sheet:rollVersus", listener);
    return ids;
}

const fail = (requestId: string) => document.dispatchEvent(new CustomEvent("sheet:rollResult", {
    detail: { requestId, outcome: { target: 40, roll: 90, degrees: 0, success: false, doubles: false, crit: false } },
}));

describe("the mana of a Pathfinder Crusade sheet", () => {
    it("is a block of its own, which a Black Crusade sheet has none of", () => {
        load({});
        expect([valueAt(testState(), "mana.current"), manaMax(testState()).total, valueAt(testState(), "settings.psykana.mana")]).toEqual([0, 0, true]);

        load(content(), blackCrusade);
        expect("mana" in testState()).toBe(false);
        expect("mana" in testState().settings.psykana).toBe(false);
    });

    it("has a maximum of the base PR and characteristic bonuses, which the resources of Techno Arcana do not count", () => {
        load(content({ mana: { max: {
            base: "2×bPR+W.b",
            mods: { items: { m1: { name: "Staff", expr: "½bPR▲", enabled: true } }, layouts: { m1: pos(0, 0) } },
        } } }));
        // bPR 3, W 40: 6 + 4, and 2 of the staff.
        expect(manaMax(testState())).toMatchObject({ baseValue: 10, total: 12 });

        load({ psykana: { basePR: 3 }, technoArcana: { cognitionMax: { base: "bPR" } } }, blackCrusade);
        expect(resourceStat(testState(), "cognitionMax").baseValue).toBeNull();
    });

    it("is spent by a cast, its ePR and kick, before its test and whatever it comes to", async () => {
        load(content());
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        expect($<HTMLInputElement>('[data-id="mana"] [data-id="maxTotal"]')!.value).toBe("7");
        // Under the PR, out of the Scope of psykana.
        const current = $('[data-id="psykana"] [data-id="effectivePR"]')!;
        expect(current.compareDocumentPosition($('[data-id="mana"]')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        expect($('[data-id="psykana"] [data-id="mana"]')).toBeNull();

        openRoll();
        expect($('[data-id="s1"] [data-id="manaCost"]')!.textContent).toBe("4 of 5");
        const [requestId] = rolls(() => rollButton().click());
        expect(mana()).toBe(1);
        fail(requestId);
        await Promise.resolve();
        expect(mana()).toBe(1);

        // Not enough for another: the roll says why and is not rolled.
        openRoll();
        expect($('[data-id="s1"] [data-id="noMana"]')).not.toBeNull();
        expect(rollButton().disabled).toBe(true);
        expect(rollButton().title).toBe("Not enough mana: the cast costs 4, 1 left");

        // A safe cast costs its own ePR, half the PR, without the kick.
        act(() => $<HTMLButtonElement>('[data-id="s1"] [data-id="safePR"]')!.click());
        expect($('[data-id="s1"] [data-id="manaCost"]')!.textContent).toBe("2 of 1");
        act(() => updateSignalAtPath(testState(), "mana.current", 2));
        rolls(() => rollButton().click());
        expect(mana()).toBe(0);
    });

    it("stops no roll of a viewer, who spends nothing", () => {
        load(content({ mana: { current: 0, max: { base: "7" } } }));
        rendered = renderBlock(<Psykana bar={<ManaBar />} />, { canEdit: false });
        openRoll();
        expect(rollButton().disabled).toBe(false);
        expect(rolls(() => rollButton().click())).toHaveLength(1);
        expect(mana()).toBe(0);
    });

    it("is neither shown in the roll nor spent while the sheet does not count it", () => {
        load(content({ mana: { current: 0 }, settings: { psykana: { mana: false } } }));
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        openRoll();
        expect($('[data-id="s1"] [data-id="manaCost"]')).toBeNull();
        expect(rolls(() => rollButton().click())).toHaveLength(1);
        expect(mana()).toBe(0);
    });

    it("is restored to its maximum by Max, while a spell is sustained too", () => {
        load(content({ mana: { current: 2, max: { base: "7", mods: { items: { m1: { name: "Ring", expr: "2", enabled: true } }, layouts: { m1: pos(0, 0) } } } } }));
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        const max = () => $<HTMLButtonElement>('[data-id="mana"] [data-id="restore"]')!;

        // The rules restore none while a spell is sustained; the table decides, the button stays.
        act(() => updateSignalAtPath(testState(), `${S}.sustain.copies`, 1));
        expect(max().disabled).toBe(false);
        act(() => max().click());
        expect(mana()).toBe(9);

        // A value past the maximum, which dropped under it, stays.
        act(() => updateSignalAtPath(testState(), "mana.max.base", "5"));
        act(() => max().click());
        expect(mana()).toBe(9);
    });

    it("is spent on the upkeep of sustained Upkeep (X) spells by its button, X a cast, free by Cycle or not", () => {
        const spells = { items: {
            s1: { name: "Bolt", sustained: "Half action", subtypes: "Аура, Поддержание (1)", sustain: { copies: 1, pr: 3 } },
            s2: { name: "Ward", sustained: "Free action", subtypes: "Upkeep (2), Цикл, Повторяемая (2)", sustain: { copies: 2, pr: 2, free: true } },
            s3: { name: "Veil", sustained: "Free action", sustain: { copies: 1, pr: 1 } },
        }, layouts: { s1: pos(0, 0), s2: pos(0, 1), s3: pos(0, 2) } };
        // I 20: one spell sustained free by Cycle.
        load(content({ characteristics: { W: { value: "40" }, I: { value: "20" } }, psykana: { basePR: 5, tabs: { items: { t1: { name: "Tab", powers: spells } }, layouts: { t1: pos(0, 0) } } } }));
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        const upkeep = () => $<HTMLButtonElement>('[data-id="mana"] [data-id="upkeep"]')!;
        const pill = (id: string) => $(`[data-id="${id}"] [data-id="sustainPill"] .sustain-text`)!.textContent;

        expect([pill("s1"), pill("s2"), pill("s3")]).toEqual(["Sustained PR 3 · 1 mana a turn", "Sustained ×2 · PR 2 · free · 4 mana a turn", "Sustained PR 1"]);
        expect(upkeep().textContent).toBe("Upkeep 5");
        act(() => upkeep().click());
        expect(mana()).toBe(0);

        // Short of the mana for all of them it pays none and dispels none: that is the player's call.
        expect(upkeep().disabled).toBe(true);
        expect(upkeep().title).toBe("Not enough mana for the upkeep: it costs 5, 0 left");
        expect(valueAt(testState(), `${S}.sustain.copies`)).toBe(1);

        act(() => updateSignalAtPath(testState(), "mana.current", 6));
        act(() => updateSignalAtPath(testState(), `${S}.sustain.copies`, 0));
        expect(upkeep().textContent).toBe("Upkeep 4");
        act(() => updateSignalAtPath(testState(), "psykana.tabs.items.t1.powers.items.s2.sustain.copies", 0));
        expect([upkeep().disabled, upkeep().title]).toEqual([true, "No sustained spell has Upkeep (X)"]);
    });

    it("leaves the upkeep to the player while casts spend no mana, and to the owner of the sheet", () => {
        const sustained = { name: "Bolt", sustained: "Half action", subtypes: "Поддержание (1)", sustain: { copies: 1, pr: 3 } };
        const withBolt = (over: object = {}) => content({ psykana: { basePR: 3, tabs: { items: { t1: { name: "Tab", powers: {
            items: { s1: sustained }, layouts: { s1: pos(0, 0) } } } }, layouts: { t1: pos(0, 0) } } }, ...over });
        load(withBolt({ settings: { psykana: { mana: false } } }));
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        expect($('[data-id="mana"] [data-id="upkeep"]')).toBeNull();
        expect($('[data-id="s1"] [data-id="sustainPill"] .sustain-text')!.textContent).toBe("Sustained PR 3");
        rendered.unmount();
        teardownSheet();

        load(withBolt());
        rendered = renderBlock(<Psykana bar={<ManaBar />} />, { canEdit: false });
        expect($<HTMLButtonElement>('[data-id="mana"] [data-id="upkeep"]')!.disabled).toBe(true);
    });

    it("has its rule under the ⚙ of Magic, which Black Crusade has not", () => {
        const rules = () => {
            act(() => $<HTMLButtonElement>(".block-settings-toggle")!.click());
            return Array.from(rendered!.container.querySelectorAll<HTMLInputElement>('.block-settings-dropdown [data-id="settings"] input'), b => b.dataset.id);
        };
        load(content());
        rendered = renderBlock(<Psykana bar={<ManaBar />} />);
        expect(rules()).toEqual(["sustained", "cycle", "phenomena", "mana", "prepared"]);
        rendered.unmount();
        teardownSheet();

        load(content(), blackCrusade);
        rendered = renderBlock(<Psykana />);
        expect(rules()).toEqual(["sustained", "cycle", "phenomena"]);
        openRoll();
        expect($('[data-id="s1"] [data-id="manaCost"]')).toBeNull();
        rolls(() => rollButton().click());
        expect(valueAt(testState(), "mana.current")).toBeUndefined();
    });

    it("shows in the stat block over the spells", () => {
        load(content());
        rendered = renderBlock(<PathfinderCrusadeStatBlock />);
        expect($('[data-id="psykana"] [data-id="mana"]')).toBeNull();
        expect($<HTMLInputElement>('[data-id="mana"] [data-id="current"]')!.value).toBe("5");
        expect($('[data-id="mana"] .stat-resource')!.textContent).toBe("Mana  / 7");
    });
});
