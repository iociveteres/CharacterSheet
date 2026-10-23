import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { loadState, renderBlock, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { blackCrusade } from "../kinds/black_crusade";
import { PathfinderCrusadeStatBlock, pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { ManaBar } from "./Mana";
import { Psykana } from "./Powers";
import { PreparedRow } from "./Prepared";
import { ArtsBar } from "./Arts";
import { PRCapWarning, SpellcastingRow } from "./Spellcasting";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const grid = (items: Record<string, object>) => ({ items, layouts: Object.fromEntries(Object.keys(items).map((id, i) => [id, pos(0, i)])) });

/** A caster of I 40, W 30 and P 25 ticking `ticked`, of `spells` on the Magic test options Cast and W. */
const content = (ticked: string[], spells: Record<string, object>, over: object = {}) => ({
    characteristics: { I: { value: "40" }, W: { value: "30" }, P: { value: "25" } },
    spellcasting: Object.fromEntries(ticked.map(key => [key, true])),
    psykana: {
        testOptions: grid({ o1: { base: "cast" }, o2: { base: "W" } }),
        tabs: grid({ t1: { name: "Tab", powers: grid(spells) } }),
    },
    ...over,
});
const cast = (over: object = {}) => ({ roll: { testOption: "o1", ...over } });

let rendered: Rendered | null = null;

function show(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
    rendered = renderBlock(<Psykana />);
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const openRoll = (id: string) => act(() => $(`[data-id="${id}"] .name label`)!.click());
const inRoll = <E extends HTMLElement = HTMLElement>(id: string, field: string) => $<E>(`[data-id="${id}"] [data-id="roll"] [data-id="${field}"]`);
/** What the roll of spell `id` is tested on, as its select shows it, and its total. */
const test = (id: string) => {
    const select = inRoll<HTMLSelectElement>(id, "testOption")!;
    return [select.options[select.selectedIndex].text, Number(inRoll<HTMLInputElement>(id, "total")!.value)];
};

describe("the Magic test option Cast", () => {
    it("reads as I for a spell of Arcane Spellcasting, W otherwise", () => {
        show(content(["arcane"], { s1: { name: "Bolt", ...cast() } }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (I)", 40]);
        const select = inRoll<HTMLSelectElement>("s1", "testOption")!;
        expect(Array.from(select.options, o => o.text)).toEqual(["Cast (I)", "W"]);

        act(() => updateSignalAtPath(testState(), "spellcasting.arcane", false));
        act(() => updateSignalAtPath(testState(), "spellcasting.spontaneous", true));
        expect(test("s1")).toEqual(["Cast (W)", 30]);
        // Nothing ticked: W.
        act(() => updateSignalAtPath(testState(), "spellcasting.spontaneous", false));
        expect(test("s1")).toEqual(["Cast (W)", 30]);
    });

    it("reads each spell of a cleric-wizard as the characteristic of its own variant", () => {
        show(content(["arcane", "divine"], { s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (I)", 40]);
        openRoll("s2");
        expect(test("s2")).toEqual(["Cast (W)", 30]);
    });

    it("reads as the characteristic it names, for every spell", () => {
        show(content(["arcane", "divine"], { s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }, {
            psykana: {
                testOptions: grid({ o1: { base: "cast", characteristic: "P" } }),
                tabs: grid({ t1: { name: "Tab", powers: grid({ s1: { name: "Bolt", ...cast() }, s2: { name: "Heal", ...cast({ spellcasting: "divine" }) } }) } }),
            },
        }));
        openRoll("s1");
        expect(test("s1")).toEqual(["Cast (P)", 25]);
        openRoll("s2");
        expect(test("s2")).toEqual(["Cast (P)", 25]);
    });

    it("is offered first under the ⚙ of Magic, and not in Black Crusade", () => {
        const bases = () => {
            act(() => $<HTMLButtonElement>(".block-settings-toggle")!.click());
            const select = $<HTMLSelectElement>('[data-id="o2"] [data-id="base"]')!;
            act(() => { select.dispatchEvent(new FocusEvent("focusin", { bubbles: true })); });
            return [Array.from(select.querySelectorAll("optgroup"), g => g.label)[0], select.options[0].value];
        };
        show(content([], {}));
        expect(bases()).toEqual(["Spellcasting", "cast"]);
        expect($('[data-id="o1"] [data-id="characteristic"]')!.title).toBe("Tested on; — for the characteristic of each spell's Spellcasting");
        rendered!.unmount();
        teardownSheet();

        show(content([], {}), blackCrusade);
        expect(bases()).toEqual(["Characteristics", "WS"]);
    });
});

describe("the base of a pool", () => {
    /** The rule its ⚙ says and the placeholder of its base. */
    const rule = (pool: string) => {
        act(() => $<HTMLButtonElement>(`[data-id="${pool}"] .resource-field .mod-toggle`)!.click());
        return [$(`[data-id="${pool}"] [data-id="rule"]`)?.textContent ?? null, $<HTMLInputElement>(`[data-id="${pool}"] [data-id="base"]`)!.placeholder];
    };
    const bar = (c: object) => {
        loadState(c, pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<><ManaBar /><ManaBar pool="focus.bard" /></>);
    };

    it("names each variant ticked with what its formula comes to", () => {
        bar(content(["arcane", "divine", "bard"], {}, { characteristics: { I: { value: "40" }, W: { value: "60" }, F: { value: "35" } } }));
        expect($<HTMLInputElement>('[data-id="mana"] [data-id="maxTotal"]')!.value).toBe("10");
        expect(rule("mana")).toEqual(["By the rules: Spellcasting gives it, the largest: Arcane 8; Divine 10", "W.b+I.b+2×bPR"]);
        expect(rule("focus.bard")).toEqual(["By the rules: Spellcasting gives it: Bard 3", "F.b"]);
    });

    it("says nothing is ticked, and goes once a base is typed", () => {
        bar(content([], {}));
        expect(rule("mana")).toEqual(["By the rules: the PR variants of Spellcasting give it; none is ticked", "0"]);
        expect(rule("focus.bard")).toEqual(["By the rules: Bard Spellcasting gives it, F.b; it is not ticked", "0"]);
        act(() => updateSignalAtPath(testState(), "mana.max.base", "5"));
        expect($('[data-id="mana"] [data-id="rule"]')).toBeNull();
    });
});

describe("the Spellcasting of a PR spell's roll", () => {
    const spells = { s1: { name: "Bolt", ...cast() }, s2: { name: "Delude", subtypes: "Arts (Bard)", roll: { skill: "deceive" } } };
    const select = () => inRoll<HTMLSelectElement>("s1", "spellcasting");

    it("is picked while two PR variants are ticked, and moves the spell to its variant", () => {
        show(content(["arcane", "divine"], spells));
        openRoll("s1");
        expect(Array.from(select()!.options, o => [o.value, o.text])).toEqual([["arcane", "Arcane"], ["divine", "Divine"]]);
        expect(select()!.value).toBe("arcane");
        act(() => {
            select()!.value = "divine";
            select()!.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(valueAt(testState(), "psykana.tabs.items.t1.powers.items.s1.roll.spellcasting")).toBe("divine");
        expect(test("s1")).toEqual(["Cast (W)", 30]);
        // The Arts spell has none.
        openRoll("s2");
        expect(inRoll("s2", "spellcasting")).toBeNull();
    });

    it("is shown with one PR variant too, not with a half-caster's alone or none", () => {
        for (const [ticked, options] of [[["arcane"], ["Arcane"]], [["arcane", "bard"], ["Arcane"]], [["bard", "ranger"], null], [[], null]]) {
            show(content(ticked!, spells));
            openRoll("s1");
            expect(select() && Array.from(select()!.options, o => o.text), ticked!.join()).toEqual(options);
            rendered!.unmount();
            rendered = null;
            teardownSheet();
        }
    });

    it("decides whether the roll has a Kick: an Arcane spell cannot push", () => {
        show(content(["arcane", "divine"], spells));
        openRoll("s1");
        const kick = () => inRoll("s1", "kickPR");
        expect(kick()).toBeNull();
        act(() => {
            select()!.value = "divine";
            select()!.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(kick()).not.toBeNull();
    });
});

describe("the rows of the Magic tab", () => {
    const magic = () => <Psykana bar={<><ManaBar /><PreparedRow /></>} ways={<ArtsBar />} />;
    /** Which rows show: the PR ones, the mana and each Focus. */
    const rows = (ticked: string[], spells: Record<string, object>) => {
        loadState(content(ticked, spells), pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(magic());
        const shown = {
            pr: $('[data-id="psykana"] [data-id="basePR"]') !== null,
            mana: $('[data-id="mana"]') !== null,
            bard: $('[data-id="focus.bard"]') !== null,
            ranger: $('[data-id="focus.ranger"]') !== null,
            sustained: $('[data-id="artsSustained"]') !== null,
        };
        rendered.unmount();
        rendered = null;
        teardownSheet();
        return shown;
    };
    const bolt = { s1: { name: "Bolt" } };
    const delude = { s2: { name: "Delude", subtypes: "Arts (Bard)" } };

    it("of a pure bard are its Focus and the Arts sustained, with or without spells", () => {
        const bard = { pr: false, mana: false, bard: true, ranger: false, sustained: true };
        expect(rows(["bard"], {})).toEqual(bard);
        expect(rows(["bard"], delude)).toEqual(bard);
        // An untyped spell is cast by PR, but the PR rows wait for a PR variant.
        expect(rows(["bard"], { ...delude, ...bolt })).toEqual(bard);
    });

    it("of a pure wizard are the PR ones and the mana", () => {
        const wizard = { pr: true, mana: true, bard: false, ranger: false, sustained: false };
        expect(rows(["arcane"], {})).toEqual(wizard);
        expect(rows(["arcane"], bolt)).toEqual(wizard);
    });

    it("of a bard-wizard are both", () => {
        expect(rows(["arcane", "bard"], {})).toEqual({ pr: true, mana: true, bard: true, ranger: false, sustained: true });
        // A ranger spell shows the Ranger Focus, unticked.
        expect(rows(["arcane", "bard"], { s3: { name: "Jump", subtypes: "Arts (Ranger)" } }))
            .toEqual({ pr: true, mana: true, bard: true, ranger: true, sustained: true });
    });

    it("with nothing ticked have no PR rows, and the Arts ones by the spells", () => {
        const none = { pr: false, mana: false, bard: false, ranger: false, sustained: false };
        expect(rows([], {})).toEqual(none);
        expect(rows([], delude)).toEqual({ ...none, bard: true, sustained: true });
        expect(rows([], bolt)).toEqual(none);
    });
});

describe("the bar of Spellcasting", () => {
    // As the layout of Pathfinder Crusade composes it.
    const magic = () => (
        <Psykana bar={<><ManaBar /><PreparedRow /></>} ways={<ArtsBar />} spellcasting={<SpellcastingRow />} prCap={<PRCapWarning />} />
    );
    const tab = (c: object) => {
        loadState(c, pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(magic());
    };
    const picker = () => $<HTMLButtonElement>('[data-id="spellcasting"] [data-id="picker"]')!;
    const box = (key: string) => $<HTMLInputElement>(`[data-id="spellcasting"] [data-id="${key}"]`);
    /** Ticks or unticks the variant in the list, opening it first like a player. */
    const click = (key: string) => {
        if (!box(key)) act(() => picker().click());
        act(() => box(key)!.click());
    };
    const all = (selector: string) => Array.from(rendered!.container.querySelectorAll(`[data-id="spellcasting"] ${selector}`), el => el.textContent);

    it("is a button of the variants ticked that lists them all, each titled by its rules", () => {
        tab(content([], {}));
        expect([picker().textContent, box("arcane")]).toEqual(["none", null]);
        expect($('[data-id="psykanaType"]')).toBeNull();

        act(() => picker().click());
        expect(all(".column-label")).toEqual(["Cast by PR", "Arts"]);
        expect(all(".spellcasting-option-label")).toEqual(["Arcane", "Divine", "Spontaneous", "Bard", "Paladin", "Ranger"]);
        const option = (key: string) => box(key)!.closest("label")!;
        expect(option("arcane").title).toBe("Arcane Spellcasting: spells cast by PR, Cast on I; Mana 2×I.b+2×bPR; Arcane gift; prepares the spells of the day");
        expect(option("arcane").querySelector(".spellcasting-option-text")!.textContent).toBe("Cast on I · Arcane gift · Mana 2×I.b+2×bPR · prepares");
        expect(option("bard").title).toBe("Bard Spellcasting: Arts spells of the Bard or Бард, tested on their skill; Bardic Focus F.b");
        expect(option("bard").querySelector(".spellcasting-option-text")!.textContent).toBe("Bard spells, tested on their skill · Bardic Focus F.b");

        click("arcane");
        click("bard");
        expect([picker().textContent, valueAt(testState(), "spellcasting.arcane"), box("arcane")!.checked]).toEqual(["Arcane, Bard", true, true]);
        click("arcane");
        expect([picker().textContent, valueAt(testState(), "spellcasting.arcane")]).toEqual(["Bard", false]);
    });

    it("prepares while Arcane or Divine is ticked", () => {
        tab(content(["spontaneous"], { s1: { name: "Bolt" } }));
        const row = () => $('[data-id="preparedSpells"]');
        expect(row()).toBeNull();
        click("arcane");
        expect(row()).not.toBeNull();
        click("arcane");
        expect(row()).toBeNull();
        click("divine");
        expect(row()).not.toBeNull();
    });

    it("warns of a base PR past the casting characteristic, and the warning goes", () => {
        tab(content(["divine"], { s1: { name: "Bolt" } }, { psykana: { basePR: 4, tabs: grid({ t1: { name: "Tab", powers: grid({ s1: { name: "Bolt" } }) } }) } }));
        expect($('[data-id="prCap"]')!.textContent).toBe("PR grows up to W.b (3)");
        // Arcane's I.b is 4.
        click("arcane");
        expect($('[data-id="prCap"]')).toBeNull();
        act(() => updateSignalAtPath(testState(), "psykana.basePR", 5));
        expect($('[data-id="prCap"]')!.textContent).toBe("PR grows up to I.b (4)");
    });

    it("shows no notice in the Magic tab", () => {
        tab(content(["arcane"], { s1: { name: "Bolt" } }));
        expect($('[data-id="psykanaNotice"]')).toBeNull();
    });

    it("is none of a Black Crusade sheet, which keeps its gift and its notice", () => {
        loadState(content(["arcane"], { s1: { name: "Bolt" } }, { psykana: { basePR: 9, tabs: grid({ t1: { name: "Tab", powers: grid({ s1: { name: "Bolt" } }) } }) } }), blackCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<Psykana />);
        expect([$('[data-id="spellcasting"]'), $('[data-id="prCap"]')]).toEqual([null, null]);
        expect($('[data-id="psykanaNotice"]')).not.toBeNull();
        expect($('[data-id="psykanaType"]')).not.toBeNull();
    });
});

describe("the stat block of Spellcasting", () => {
    const stat = (ticked: string[], spells: Record<string, object>) => {
        loadState(content(ticked, spells), pathfinderCrusade);
        attachComputeds(testState());
        rendered = renderBlock(<PathfinderCrusadeStatBlock />);
    };

    it("has the PR variants on the PR line and a line per Focus", () => {
        stat(["arcane", "divine", "bard"], { s1: { name: "Bolt" } });
        expect($('[data-id="psykana"] [data-id="spellcasting"]')!.textContent).toBe("Arcane, Divine");
        expect([$('[data-id="focus.bard"]') !== null, $('[data-id="focus.ranger"]')]).toEqual([true, null]);
        rendered!.unmount();
        teardownSheet();

        stat(["bard", "ranger"], { s1: { name: "Delude", subtypes: "Arts (Bard)" } });
        expect($('[data-id="psykana"] [data-id="effectivePR"]')).toBeNull();
        expect(Array.from(rendered!.container.querySelectorAll('[data-id^="focus."] .stat-resource'), l => l.textContent!.split(" ").slice(0, 2).join(" ")))
            .toEqual(["Bardic Focus", "Ranger Focus"]);
    });
});
