import { afterEach, describe, expect, it } from "vitest";
import { act } from "preact/test-utils";
import { flush, loadState, renderBlock, rollOf, teardownSheet, testState, type Rendered } from "../components/testUtils";
import { BlackCrusadeStatBlock, blackCrusade } from "../kinds/black_crusade";
import { PathfinderCrusadeStatBlock, pathfinderCrusade } from "../kinds/pathfinder_crusade";
import { attachComputeds } from "../state/computed";
import { powerPR } from "../state/damage";
import { updateSignalAtPath, valueAt } from "../state/sync";
import { ManaBar } from "./Mana";
import { Psykana } from "./Powers";
import { PreparedRow } from "./Prepared";
import { SorceryBar } from "./Sorcery";

const pos = (colIndex: number, rowIndex: number) => ({ colIndex, rowIndex });
const POWERS = "psykana.tabs.items.t1.powers.items";
const S1 = `${POWERS}.s1`;

const advances = (n: number) => Object.fromEntries(["plus0", "plus10", "plus20", "plus30"].slice(0, n).map(key => [key, true]));

/** A bard of F 40 with Deceive +20 and Delude, a Sorcery spell of Level 1 tested on Deceive. */
const content = (delude: object = {}, over: object = {}, spells: Record<string, object> = {}) => {
    const all = { s1: { name: "Delude", subtypes: "Sorcery (Bard)", sustained: "Free action", level: 1, roll: { skill: "deceive" }, ...delude }, ...spells };
    return {
        characteristics: { F: { value: "40" }, W: { value: "30" } },
        skillsLeft: { deceive: advances(3) },
        psykana: {
            psykanaType: "Arcane",
            testOptions: { items: { o1: { base: "W" } }, layouts: { o1: pos(0, 0) } },
            tabs: {
                items: { t1: { name: "Bard", powers: { items: all, layouts: Object.fromEntries(Object.keys(all).map((id, i) => [id, pos(0, i)])) } } },
                layouts: { t1: pos(0, 0) },
            },
        },
        mana: { current: 5, max: { base: "5" } },
        sorceryMana: { current: 2, max: { base: "F.b" } },
        ...over,
    };
};

let rendered: Rendered | null = null;

function load(c: object, kind = pathfinderCrusade) {
    loadState(c, kind);
    attachComputeds(testState());
}

function show(c: object, kind = pathfinderCrusade) {
    load(c, kind);
    rendered = renderBlock(<Psykana />);
    act(() => $(`[data-id="s1"] .name label`)!.click());
}

afterEach(() => {
    rendered?.unmount();
    rendered = null;
    teardownSheet();
    document.body.innerHTML = "";
});

const $ = <E extends HTMLElement = HTMLElement>(selector: string) => rendered!.container.querySelector<E>(selector);
const inRoll = <E extends HTMLElement = HTMLElement>(id: string) => $<E>(`[data-id="s1"] [data-id="roll"] [data-id="${id}"]`);
const rollButton = () => inRoll<HTMLButtonElement>("rollButton")!;
const total = () => Number(inRoll<HTMLInputElement>("total")!.value);
const at = (path: string) => valueAt(testState(), path);

/** The tests the clicks of `run` send. */
function rolls(run: () => void): { [key: string]: unknown }[] {
    const sent: { [key: string]: unknown }[] = [];
    const listener = (e: Event) => sent.push((e as CustomEvent).detail);
    document.addEventListener("sheet:rollVersus", listener);
    act(run);
    document.removeEventListener("sheet:rollVersus", listener);
    return sent;
}

const answer = (requestId: unknown, outcome: object) => document.dispatchEvent(new CustomEvent("sheet:rollResult", {
    detail: { requestId, outcome: { target: 50, roll: 22, degrees: 2, success: true, doubles: true, crit: false, ...outcome } },
}));

describe("the roll of a Sorcery spell", () => {
    it("is tested on its skill, without 5 per ePR, kick or Safe, and takes the skill's level as its Max", () => {
        show(content({ roll: { skill: "deceive", modifier: 5, effectivePR: 1, kickPR: 2 } }));
        expect(inRoll("skill")).not.toBeNull();
        expect([inRoll("safePR"), inRoll("kickPR"), inRoll("testOption")]).toEqual([null, null, null]);
        // F 40 at +20: 60, and 5.
        expect(total()).toBe(65);
        expect(inRoll("capSource")!.textContent).toBe("Max 3: Deceive +20");

        act(() => inRoll<HTMLButtonElement>("maxPR")!.click());
        expect(at(`${S1}.roll.effectivePR`)).toBe(3);
        expect(total()).toBe(65);

        act(() => updateSignalAtPath(testState(), `${S1}.roll.characteristic`, "W"));
        expect(total()).toBe(55);
    });

    it("offers the skills of the sheet without the characteristics, and its own characteristic first", () => {
        show(content());
        const skill = inRoll<HTMLSelectElement>("skill")!;
        expect([...skill.querySelectorAll("optgroup")].map(g => g.label)).toEqual(["Skills", "Navigation", "Operate"]);
        expect(skill.value).toBe("deceive");
        const characteristic = inRoll<HTMLSelectElement>("characteristic")!;
        expect([characteristic.options[0].value, characteristic.options[0].textContent]).toEqual(["", "Skill's own"]);
    });

    it("pays its Level from the Sorcery pool, calls no phenomena and sustains on success", async () => {
        show(content({ roll: { skill: "deceive", effectivePR: 2 } }));
        expect(inRoll("manaCost")!.textContent).toBe("1 of 2");
        const [sent] = rolls(() => rollButton().click());
        expect(rollOf(sent)).toEqual({ target: 60, bonusSuccesses: 0, label: "Delude, 2 ePR" });
        expect([at("sorceryMana.current"), at("mana.current")]).toEqual([1, 5]);
        expect([at(`${S1}.cast.pr`), at(`${S1}.cast.kick`), at("psykana.lastCastPower")]).toEqual([2, 0, ""]);

        // Doubles of a success call for none.
        answer(sent.requestId, {});
        await flush();
        expect(at(`${S1}.cast.phenomena`)).toBe("");
        expect([at(`${S1}.sustain.copies`), at(`${S1}.sustain.pr`)]).toEqual([1, 2]);
        // It takes no PR.
        expect(at("psykana.effectivePR")).toBe(0);
    });

    it("warns of an untrained skill, a missing Level and the sustain limit, and rolls all the same", () => {
        const blur = { name: "Blur", subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } };
        show(content({ level: 0 }, { skillsLeft: { deceive: {} } }, { s2: blur }));
        expect(inRoll("untrained")!.textContent).toBe("Deceive is not trained: a Sorcery spell cannot be cast");
        expect(inRoll("noLevel")!.textContent).toBe("Set the Level: it is the mana cost");
        expect(inRoll("sustainLimit")!.textContent).toBe("Already sustaining Blur: the limit is 1");
        expect([rollButton().disabled, rollButton().title]).toEqual([false, ""]);

        // Unticked, it will not sustain past the limit.
        act(() => inRoll<HTMLInputElement>("sustain")!.click());
        expect(inRoll("sustainLimit")).toBeNull();
    });

    it("warns of an ePR past the Max of its skill or at 0, and rolls all the same", () => {
        show(content({ roll: { skill: "deceive" } }));
        expect(inRoll("noEPR")!.textContent).toBe("Set the ePR: Max is 3");
        expect(inRoll("overMax")).toBeNull();

        act(() => updateSignalAtPath(testState(), `${S1}.roll.effectivePR`, 4));
        expect(inRoll("overMax")!.textContent).toBe("Above the Max of Deceive: 3");
        expect(inRoll("noEPR")).toBeNull();
        expect(rollButton().disabled).toBe(false);

        act(() => inRoll<HTMLButtonElement>("maxPR")!.click());
        expect([inRoll("overMax"), inRoll("noEPR")]).toEqual([null, null]);

        // An untrained skill has a warning of its own.
        act(() => { for (const key of ["plus0", "plus10", "plus20"]) updateSignalAtPath(testState(), `skillsLeft.deceive.${key}`, false); });
        expect([inRoll("untrained") !== null, inRoll("overMax"), inRoll("noEPR")]).toEqual([true, null, null]);
    });

    it("counts its own sustaining towards the −10 while the cast is not to be sustained", () => {
        const sustain = { sustain: { copies: 1, pr: 1 } };
        show(content(sustain, {
            talents: { list: { items: { a1: { name: "Expanded Sustain" } }, layouts: { a1: pos(0, 0) } } },
        }, { s2: { name: "Blur", subtypes: "Sorcery (Bard)", sustained: "Free action", ...sustain } }));
        // Sustained again, it ends its own sustaining first: Blur alone is sustained. F 40 at +20: 60.
        expect([inRoll("sustainPenalty"), total()]).toEqual([null, 60]);

        act(() => inRoll<HTMLInputElement>("sustain")!.click());
        expect([inRoll("sustainPenalty")!.textContent, total()]).toEqual(["-10: two sustained", 50]);
    });

    it("shows −10 while two others are sustained, and the Max of Mastery", () => {
        const sustained = { subtypes: "Sorcery (Bard)", sustained: "Free action", sustain: { copies: 1 } };
        show(content({}, {
            skillsLeft: { deceive: advances(4) },
            talents: { list: { items: { a1: { name: "Expanded Sustain" }, a2: { name: "Mastery (Deceive)" } }, layouts: { a1: pos(0, 0), a2: pos(1, 0) } } },
        }, { s2: { name: "Blur", ...sustained }, s3: { name: "Haste", ...sustained } }));
        expect(inRoll("sustainPenalty")!.textContent).toBe("-10: two sustained");
        // F 40 at +30: 70.
        expect(total()).toBe(60);
        expect(inRoll("capSource")!.textContent).toBe("Max 5: Mastery (Deceive)");
        expect(inRoll("sustainLimit")!.textContent).toBe("Already sustaining Blur, Haste: the limit is 2");
    });

    it("is not rolled without a skill, with one gone from the sheet or without the Sorcery mana", () => {
        show(content({ roll: {} }));
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "Pick the skill"]);
        expect(inRoll("capSource")).toBeNull();
        rendered!.unmount();
        teardownSheet();

        // A custom skill deleted since it was picked.
        show(content({ roll: { skill: "custom:c1" } }));
        expect(inRoll("skillLost")!.textContent).toBe("The skill picked is not on the sheet: pick another");
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "The skill picked is not on the sheet: pick another"]);
        rendered!.unmount();
        teardownSheet();

        show(content({ level: 3 }));
        expect(inRoll("noMana")).not.toBeNull();
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "Not enough halfcasting mana: the cast costs 3, 2 left"]);
    });

    it("counts its Max as the PR of its damage before a cast", () => {
        load(content({ damage: "1d10+PR" }));
        expect(powerPR(testState(), S1)).toBe(3);
        updateSignalAtPath(testState(), `${S1}.cast.pr`, 2);
        expect(powerPR(testState(), S1)).toBe(2);
    });

    it("names its Max in the PR of its damage before a cast, not the current PR", () => {
        show(content({ damage: "1d10+PR" }));
        act(() => $('[data-id="s1"] .damage .mod-toggle')!.click());
        expect($('[data-id="s1"] .damage [data-id="prNote"]')!.textContent).toBe("No cast yet: PR 3 counts");
    });

    it("is rolled from the stat block too", () => {
        load(content());
        rendered = renderBlock(<PathfinderCrusadeStatBlock />);
        act(() => $('[data-id="s1"] .stat-power-name label')!.click());
        expect(inRoll("skill")).not.toBeNull();
        expect(inRoll("safePR")).toBeNull();
    });

    it("is the PR roll on a Black Crusade sheet, whatever the Subtypes say", () => {
        show(content({ roll: { testOption: "o1" } }), blackCrusade);
        expect(inRoll("skill")).toBeNull();
        expect(inRoll("safePR")).not.toBeNull();
    });
});

describe("the card of a Sorcery spell", () => {
    const card = (id: string, selector: string) => $(`[data-id="${id}"] ${selector}`);
    const chip = (id: string) => card(id, '[data-id="sorceryChip"]')?.textContent ?? null;
    const traits = (id: string) => {
        act(() => card(id, ".power-traits-toggle")!.click());
        return [...rendered!.container.querySelectorAll(`[data-id="${id}"] [data-id="traits"] li`)].map(li => li.textContent);
    };

    it("has a chip of its class and cost after the name, following Subtypes and Level", () => {
        load(content({}, {}, { s2: { name: "Shield", prepared: true } }));
        rendered = renderBlock(<Psykana />);
        expect([chip("s1"), chip("s2")]).toEqual(["Bard, 1 mana", null]);
        // After the name and its ⚙, out of the name's row.
        expect(card("s1", ".name [data-id=\"sorceryChip\"]")).toBeNull();

        act(() => updateSignalAtPath(testState(), `${S1}.level`, 0));
        expect(chip("s1")).toBe("Bard");
        act(() => updateSignalAtPath(testState(), `${S1}.subtypes`, "Illusion, Колдовство (Следопыт)"));
        expect(chip("s1")).toBe("Следопыт");
        act(() => updateSignalAtPath(testState(), `${S1}.subtypes`, "Колдовство"));
        expect(chip("s1")).toBeNull();
    });

    it("has a Level by its Subtypes, which a PR spell has not", () => {
        load(content({ level: 2 }, {}, { s2: { name: "Shield" } }));
        rendered = renderBlock(<Psykana />);
        const level = card("s1", '.level [data-id="level"]') as HTMLInputElement;
        expect(level.value).toBe("2");
        expect(level.closest(".layout-row.level")!.previousElementSibling!.classList.contains("subtypes")).toBe(true);
        expect(card("s2", '[data-id="level"]')).toBeNull();
    });

    it("lists its type under the ⚙", () => {
        load(content());
        rendered = renderBlock(<Psykana />);
        expect(traits("s1")).toContain("Sorcery (Bard): tested on a skill, ePR by its level, costs its Level, no phenomena");
    });

    it("has no phenomena modifier or talent of the PR under the ⚙, which a PR spell has", () => {
        load(content({}, {}, { s2: { name: "Shield" } }));
        rendered = renderBlock(<Psykana />);
        traits("s1");
        traits("s2");
        const fields = (id: string) => ["phenomenaMod", "ignoreTprPenalty"].map(field => card(id, `[data-id="${field}"]`) !== null);
        expect([fields("s1"), fields("s2")]).toEqual([[false, false], [true, true]]);
    });

    it("is none of a Black Crusade sheet", () => {
        load(content(), blackCrusade);
        rendered = renderBlock(<Psykana />);
        expect([chip("s1"), card("s1", '[data-id="level"]')]).toEqual([null, null]);
        expect(traits("s1").some(line => line!.startsWith("Sorcery"))).toBe(false);
    });
});

describe("the Magic tab", () => {
    const magic = () => <Psykana bar={<><ManaBar /><PreparedRow /></>} ways={<SorceryBar />} />;
    const prRows = () => $('[data-id="psykana"] [data-id="basePR"]') !== null;
    const row = (pool: string) => $(`[data-id="${pool}"]`);
    const rules = () => {
        act(() => $<HTMLButtonElement>(".block-settings-toggle")!.click());
        const ids = Array.from(rendered!.container.querySelectorAll<HTMLInputElement>('.block-settings-dropdown [data-id="settings"] input'), b => b.dataset.id);
        act(() => $<HTMLButtonElement>(".block-settings-toggle")!.click());
        return ids;
    };
    const notice = () => Array.from(rendered!.container.querySelectorAll('[data-id="psykanaNotice"] p'), p => p.getAttribute("data-id"));
    const sustainedNames = () => Array.from(rendered!.container.querySelectorAll('[data-id="sustainedList"] .sustain-name'), b => b.textContent);
    const shield = { name: "Shield", prepared: true };

    it("of a pure bard has the Sorcery row and none of the PR rows", () => {
        load(content());
        rendered = renderBlock(magic());
        expect([prRows(), row("mana"), $('[data-id="preparedSpells"]')]).toEqual([false, null, null]);
        expect(row("sorceryMana")!.querySelector<HTMLInputElement>('[data-id="current"]')!.value).toBe("2");
        expect(row("sorceryMana")!.querySelector<HTMLInputElement>('[data-id="maxTotal"]')!.value).toBe("4");
        expect($('[data-id="sorcerySustained"]')!.textContent).toBe("Sustained: 0 / 1");
        // On a line of its own under the mana.
        expect(row("sorceryMana")!.querySelector('[data-id="sorcerySustained"]')).toBeNull();
        expect(row("sorceryMana")!.nextElementSibling!.querySelector('[data-id="sorcerySustained"]')).not.toBeNull();
        expect(rules()).toEqual(["sustained", "mana", "prepared"]);
        expect(notice()).toEqual(["sorceryNotice"]);

        // A base PR, or a spell cast by PR, brings the PR rows back.
        act(() => updateSignalAtPath(testState(), "psykana.basePR", 1));
        expect(prRows()).toBe(true);
        expect(rules()).toEqual(["sustained", "cycle", "phenomena", "mana", "prepared"]);
    });

    it("of a pure wizard, or with no spells, is as it was", () => {
        load(content({ subtypes: "" }));
        rendered = renderBlock(magic());
        expect([prRows(), row("mana") !== null, row("sorceryMana")]).toEqual([true, true, null]);
        expect(rules()).toEqual(["sustained", "cycle", "phenomena", "mana", "prepared"]);
        expect(notice()).toEqual(["prNotice", "preparedNotice"]);
        rendered!.unmount();
        teardownSheet();

        load({ ...content(), psykana: { tabs: { items: { t1: { name: "Tab" } }, layouts: { t1: pos(0, 0) } } } });
        rendered = renderBlock(magic());
        expect([prRows(), row("mana") !== null, row("sorceryMana")]).toEqual([true, true, null]);
    });

    it("of a mixed caster has both, with one list of the sustained in the order of the tabs", () => {
        const sustain = { sustain: { copies: 1, pr: 1 } };
        load(content(sustain, { mana: { current: 1, max: { base: "5" } } }, {
            s2: { ...shield, sustained: "Free action", ...sustain },
            s3: { name: "Blur", subtypes: "Sorcery (Bard), Поддержание (1)", sustained: "Free action", ...sustain },
        }));
        rendered = renderBlock(magic());
        expect([prRows(), row("mana") !== null, row("sorceryMana") !== null]).toEqual([true, true, true]);
        expect(notice()).toEqual(["prNotice", "preparedNotice", "sorceryNotice"]);
        expect(sustainedNames()).toEqual(["Delude", "Shield", "Blur"]);
        // Shield alone takes PR.
        expect($<HTMLInputElement>('[data-id="psykana"] [data-id="sustainedCount"]')!.value).toBe("1");
        const pill = (id: string) => $(`[data-id="${id}"] [data-id="sustainPill"] .sustain-text`)!.textContent;
        expect([pill("s1"), pill("s2")]).toEqual(["Sustained ePR 1", "Sustained PR 1"]);

        const counted = $('[data-id="sorcerySustained"]')!;
        expect([counted.textContent, counted.classList.contains("over")]).toEqual(["Sustained: 2 / 1", true]);
        const button = (pool: string, id: string) => row(pool)!.querySelector<HTMLButtonElement>(`[data-id="${id}"]`)!;
        expect([button("mana", "restore").disabled, button("sorceryMana", "restore").disabled]).toEqual([true, true]);
        expect([button("mana", "upkeep").textContent, button("sorceryMana", "upkeep").textContent]).toEqual(["Upkeep 0", "Upkeep 1"]);

        // Dropping the PR spell frees the PR mana alone.
        act(() => updateSignalAtPath(testState(), `${POWERS}.s2.sustain.copies`, 0));
        expect([button("mana", "restore").disabled, button("sorceryMana", "restore").disabled]).toEqual([false, true]);
        act(() => button("sorceryMana", "upkeep").click());
        expect([valueAt(testState(), "sorceryMana.current"), valueAt(testState(), "mana.current")]).toEqual([1, 1]);
    });

    it("of a Black Crusade sheet has no Sorcery row, whatever the Subtypes say", () => {
        load(content(), blackCrusade);
        rendered = renderBlock(<Psykana ways={<SorceryBar />} />);
        expect([prRows(), row("sorceryMana")]).toEqual([true, null]);
        expect(rules()).toEqual(["sustained", "cycle", "phenomena"]);
        expect(notice()).toEqual(["prNotice"]);
    });
});

describe("the stat block", () => {
    const stat = (c: object, kind = pathfinderCrusade, Block = PathfinderCrusadeStatBlock) => {
        load(c, kind);
        rendered = renderBlock(<Block />);
    };
    const lines = () => ({
        pr: $('[data-id="psykana"] [data-id="effectivePR"]') !== null,
        mana: $('[data-id="mana"]') !== null,
        phenomena: $('[data-id="phenomenaToggle"]') !== null,
        sorcery: $('[data-id="sorceryMana"]')?.textContent ?? null,
    });
    const chip = (id: string) => $(`[data-id="${id}"] [data-id="sorceryChip"]`)?.textContent ?? null;

    it("of a pure bard has the Sorcery line, its sustained ones and chips, and none of the PR", () => {
        stat(content({ sustain: { copies: 1, pr: 2 } }));
        expect(lines()).toEqual({ pr: false, mana: false, phenomena: false, sorcery: "Halfcasting Mana  / 4Sustained: 1 / 1" });
        expect($<HTMLInputElement>('[data-id="sorceryMana"] [data-id="current"]')!.value).toBe("2");
        expect(chip("s1")).toBe("Bard, 1 mana");
        expect(Array.from(rendered!.container.querySelectorAll('[data-id="sustainedList"] b'), b => b.textContent)).toEqual(["Delude"]);
    });

    it("of a pure wizard is as it was, and of a mixed caster has both", () => {
        stat(content({ subtypes: "" }));
        expect(lines()).toEqual({ pr: true, mana: true, phenomena: true, sorcery: null });
        expect(chip("s1")).toBeNull();
        rendered!.unmount();
        teardownSheet();

        stat(content({}, {}, { s2: { name: "Shield" } }));
        expect(lines()).toMatchObject({ pr: true, mana: true, phenomena: true, sorcery: "Halfcasting Mana  / 4Sustained: 0 / 1" });
        expect([chip("s1"), chip("s2")]).toEqual(["Bard, 1 mana", null]);
    });

    it("of a Black Crusade sheet has no Sorcery, whatever the Subtypes say", () => {
        stat(content(), blackCrusade, BlackCrusadeStatBlock);
        expect(lines()).toMatchObject({ pr: true, phenomena: true, sorcery: null });
        expect(chip("s1")).toBeNull();
    });
});

describe("the skills of the Magic test in the roll", () => {
    const buttons = () => Array.from(rendered!.container.querySelectorAll<HTMLButtonElement>('[data-id="s1"] [data-id="testChoice"]'));
    const pressed = () => buttons().filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent);
    const trade = { skillsRight: { "1_trade": { name: "Musician", characteristic: "A", plus0: true, plus10: true }, "2_trade": { name: "Orator", plus0: true } } };

    it("are buttons that test the roll on them, the one picked pressed", () => {
        show(content({ psychotest: "Charm(F) -10 или Trade(Bardic)(Стат Навыка) +0 vs W +0", roll: {} }, { ...trade, characteristics: { F: { value: "40" }, A: { value: "35" } } }));
        expect(buttons().map(b => b.textContent)).toEqual(["Charm (F) untrained", "Musician +10", "Orator +0"]);
        expect([pressed(), rollButton().title]).toEqual([[], "Pick the skill"]);

        act(() => buttons()[1].click());
        expect([at(`${S1}.roll.skill`), at(`${S1}.roll.characteristic`)]).toEqual(["1_trade", ""]);
        expect(pressed()).toEqual(["Musician +10"]);
        // A 35 at +10, the row's own characteristic.
        expect(total()).toBe(45);
        expect(inRoll("capSource")!.textContent).toBe("Max 2: Musician +10");

        // Each alternative sets its own modifier, not the one before it.
        act(() => buttons()[0].click());
        expect(at(`${S1}.roll.modifier`)).toBe(-10);
        act(() => buttons()[1].click());
        expect(at(`${S1}.roll.modifier`)).toBe(0);

        // Changed in the selects, the pick no longer matches a button.
        act(() => updateSignalAtPath(testState(), `${S1}.roll.characteristic`, "F"));
        expect(pressed()).toEqual([]);
    });

    it("name what the sheet has no skill for while none is picked", () => {
        show(content({ psychotest: "Trade(Bardic)(Стат Навыка) -10", roll: {} }));
        expect(buttons()).toEqual([]);
        expect(inRoll("testMissing")!.textContent).toBe("Pick your Trade (Bardic): Dancer, Musician, Orator or Soothsayer");
        expect([rollButton().disabled, rollButton().title]).toEqual([true, "Pick your Trade (Bardic): Dancer, Musician, Orator or Soothsayer"]);
    });

    it("are not shown for a single skill already picked, nor for a test the sheet cannot read", () => {
        show(content({ psychotest: "Deceive(F) +0 vs W +0" }));
        expect($('[data-id="s1"] .test-choices-row')).toBeNull();
        rendered!.unmount();
        teardownSheet();

        show(content({ psychotest: "see the description", roll: {} }));
        expect($('[data-id="s1"] .test-choices-row')).toBeNull();
    });
});
